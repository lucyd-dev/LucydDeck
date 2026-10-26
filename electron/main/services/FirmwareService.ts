// ---------------------------------------------------------------------------
// The firmware update state machine.
//
// Two entry points share one flash path. A release update reads the newest
// stable manifest, checks the deck's board and version, downloads and verifies
// the image, then hands the deck to its ROM bootloader and writes the app slot.
// An Advanced flash takes a local image through the same handoff, write and
// return, skipping the release source and its version policy.
//
// All network, platform and esptool detail stays behind `FirmwareReleaseSource`,
// `FirmwareFlasher` and `RomPortLocator`, so this module is tested with fakes.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import {
    APP_SLOT_ADDRESS,
    FirmwareErrorCodes,
    idleFirmwareState,
    isFirmwareActive,
    isFirmwareBusy,
    validateFlashSize,
} from "@shared/firmware";
import type {
    FirmwareCheckRequest,
    FirmwareErrorCode,
    FirmwareErrorInfo,
    FirmwareImageInfo,
    FirmwareReleaseInfo,
    FirmwareState,
    FlashLocalRequest,
    FlashPhase,
    FlashProgressPayload,
} from "@shared/firmware";
import { evaluateRelease, normalizeVersion } from "@shared/firmwareRelease";
import type { FirmwareBoardEntry, FirmwareManifest } from "@shared/firmwareRelease";
import { DeviceResponse, ErrorCode, HostCommand } from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";
import type { DeviceInfo } from "@shared/ipc";
import { isFirmwareError } from "./usb/FirmwareError";
import type { FirmwareFlasher } from "./flash/EsptoolFlasher";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./flash/PortFingerprint";
import type { RomPortLocator } from "./flash/RomPortLocator";
import { delay } from "./flash/delay";
import { ReleaseSourceError, isAbortError } from "./ReleaseSource";
import type { FirmwareReleaseSource } from "./ReleaseSource";

export class FirmwareFlashError extends Error {
    readonly code: FirmwareErrorCode;

    constructor(message: string, code: FirmwareErrorCode) {
        super(message);
        this.name = "FirmwareFlashError";
        this.code = code;
    }
}

/** Narrow view of `UsbService` used by the state machine. */
export interface FirmwareUsbClient {
    readonly connected: boolean;
    hidFingerprint(): HidDescriptorLike | null;
    /** True while the app HID interface is still enumerated; null when unknown. */
    hidPresent(): Promise<boolean | null>;
    command(
        opcode: HostCommand,
        payload?: Uint8Array,
        expect?: DeviceResponse,
    ): Promise<Uint8Array>;
    disconnect(): Promise<void>;
    connect(): Promise<void>;
}

/** Narrow view of `DeviceService`. */
export interface FirmwareDeviceClient {
    getDeviceInfo(): Promise<DeviceInfo>;
}

export interface FirmwareServiceOptions {
    usb: FirmwareUsbClient;
    device: FirmwareDeviceClient;
    flasher: FirmwareFlasher;
    locator: Pick<RomPortLocator, "fingerprintFor" | "waitFor">;
    releaseSource: FirmwareReleaseSource;
    /** Opens the native picker; returns an absolute path or `null`. */
    pickImage: () => Promise<string | null>;
    onState?: (state: FirmwareState) => void;
    onProgress?: (progress: FlashProgressPayload) => void;
    /** How long the deck has to bring its HID interface back. */
    returnTimeoutMs?: number;
    connectPollMs?: number;
    /** How long to wait for the HID interface to disappear after the handoff. */
    hidDropTimeoutMs?: number;
    readFile?: (file: string) => Uint8Array;
    statFile?: (file: string) => {
        size: number;
        isFile: () => boolean;
        isSymbolicLink: () => boolean;
    };
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

interface LoadedImage {
    info: FirmwareImageInfo;
    bytes: Uint8Array;
}

interface PendingRelease {
    manifest: FirmwareManifest;
    entry: FirmwareBoardEntry;
}

type StatFile = NonNullable<FirmwareServiceOptions["statFile"]>;

const HANDOFF_FAILED_MESSAGE = "The deck did not restart for the update. Replug it and try again.";
const USB_PORT_UNKNOWN_MESSAGE =
    "The app could not recognise the deck's USB port. Replug it and try again.";

function cloneState(state: FirmwareState): FirmwareState {
    return {
        ...state,
        image: state.image === null ? null : { ...state.image },
        error: state.error === null ? null : { ...state.error },
        release: {
            ...state.release,
            latest: state.release.latest === null ? null : { ...state.release.latest },
            error: state.release.error === null ? null : { ...state.release.error },
        },
    };
}

/**
 * Owns the firmware state machine: the release check, the release update and
 * the local image path. One operation at a time; the renderer only sees state
 * transitions and progress.
 */
export class FirmwareService {
    private readonly usb: FirmwareUsbClient;
    private readonly device: FirmwareDeviceClient;
    private readonly flasher: FirmwareFlasher;
    private readonly locator: Pick<RomPortLocator, "fingerprintFor" | "waitFor">;
    private readonly releaseSource: FirmwareReleaseSource;
    private readonly pickImage: () => Promise<string | null>;
    private readonly onState: (state: FirmwareState) => void;
    private readonly onProgress: (progress: FlashProgressPayload) => void;
    private readonly returnTimeoutMs: number;
    private readonly connectPollMs: number;
    private readonly hidDropTimeoutMs: number;
    private readonly readFile: (file: string) => Uint8Array;
    private readonly statFile: StatFile;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;

    private current: FirmwareState = idleFirmwareState();
    /** The release a successful check made available to flash. */
    private pending: PendingRelease | null = null;
    /** Aborts a manifest fetch or a download that the user cancelled. */
    private abort: AbortController | null = null;

    constructor(options: FirmwareServiceOptions) {
        this.usb = options.usb;
        this.device = options.device;
        this.flasher = options.flasher;
        this.locator = options.locator;
        this.releaseSource = options.releaseSource;
        this.pickImage = options.pickImage;
        this.onState = options.onState ?? (() => undefined);
        this.onProgress = options.onProgress ?? (() => undefined);
        this.returnTimeoutMs = options.returnTimeoutMs ?? 5000;
        this.connectPollMs = options.connectPollMs ?? 250;
        this.hidDropTimeoutMs = options.hidDropTimeoutMs ?? 5000;
        this.readFile = options.readFile ?? ((file) => fs.readFileSync(file));
        this.statFile = options.statFile ?? ((file) => fs.lstatSync(file));
        this.sleep = options.sleep ?? delay;
        this.now = options.now ?? Date.now;
    }

    state(): FirmwareState {
        return cloneState(this.current);
    }

    /** True while a flash owns the deck; quitting then needs confirmation. */
    isBusy(): boolean {
        return isFirmwareBusy(this.current.phase);
    }

    /** Check, download and flash all keep a second operation out. */
    isActive(): boolean {
        return isFirmwareActive(this.current);
    }

    /** Read the deck's firmware version and board when a deck is connected. */
    async refreshDeckInfo(): Promise<FirmwareState> {
        if (!this.usb.connected) {
            return this.state();
        }
        const info = await this.readDeckInfo();
        if (info !== null) {
            // A deck replugged after "did not come back" is back; show the
            // version it reports instead of keeping the stale error.
            const recovered =
                this.current.phase === "error" &&
                this.current.error?.code === FirmwareErrorCodes.NoReturn;
            this.current = {
                ...this.current,
                ...(recovered ? { phase: "done" as const, error: null } : {}),
                installedVersion: info.firmwareVersion || null,
                board: info.board || null,
            };
            this.reconcileRelease();
        }
        return this.state();
    }

    /**
     * Read the newest stable release for this deck. A launch check is silent on
     * failure; a manual check stores the failure for the Firmware section.
     */
    async checkForUpdate(request: FirmwareCheckRequest = {}): Promise<FirmwareState> {
        const silent = request.silent === true;
        if (this.isActive()) {
            return this.state();
        }
        if (!this.usb.connected) {
            this.pending = null;
            this.setReleaseStatus("no-deck");
            return this.state();
        }

        const previous = this.current.release;
        this.setReleaseStatus("checking");
        const controller = new AbortController();
        this.abort = controller;
        try {
            const info = await this.readDeckInfo();
            if (controller.signal.aborted) {
                return this.state();
            }
            if (info === null) {
                this.pending = null;
                this.setReleaseStatus("no-deck");
                return this.state();
            }
            this.current = {
                ...this.current,
                installedVersion: info.firmwareVersion || null,
                board: info.board || null,
            };

            const { manifest, publishedAt } = await this.releaseSource.latest(controller.signal);
            const evaluation = evaluateRelease(manifest, info.board, info.firmwareVersion);
            const latest: FirmwareReleaseInfo = {
                version: evaluation.latestVersion,
                notesUrl: manifest.releaseUrl,
                publishedAt,
            };
            this.pending =
                evaluation.status === "available" && evaluation.entry !== null
                    ? { manifest, entry: evaluation.entry }
                    : null;
            this.current = {
                ...this.current,
                release: {
                    status: evaluation.status,
                    latest,
                    error: null,
                },
            };
            this.emitState();
            return this.state();
        } catch (error) {
            if (isAbortError(error)) {
                return this.state();
            }
            log.warn(`[firmware] update check failed: ${String(error)}`);
            if (silent) {
                // A launch check leaves the last known release alone, including
                // a previous "update available" hint.
                this.current = { ...this.current, release: previous };
                this.emitState();
                return this.state();
            }
            this.pending = null;
            this.current = {
                ...this.current,
                release: {
                    status: "error",
                    latest: previous.latest,
                    error: mapReleaseError(error),
                },
            };
            this.emitState();
            return this.state();
        } finally {
            if (this.abort === controller) {
                this.abort = null;
            }
        }
    }

    /**
     * Download, verify and flash the release a successful check found. The
     * deck's board and version are re-read first, so a deck that changed since
     * the check is never written with a stale or older release.
     */
    async update(): Promise<FirmwareState> {
        if (this.isActive()) {
            return this.state();
        }
        const pending = this.pending;
        if (pending === null || this.current.release.status !== "available") {
            return this.setError(
                FirmwareErrorCodes.NoUpdate,
                "There is no update available. Check for updates, then try again.",
            );
        }
        if (!this.usb.connected) {
            return this.setError(
                FirmwareErrorCodes.NotConnected,
                "Connect the deck, then try again.",
            );
        }

        const info = await this.readDeckInfo();
        if (info === null) {
            return this.setError(
                FirmwareErrorCodes.NotConnected,
                "The app could not read the deck. Replug it and try again.",
            );
        }
        this.current = {
            ...this.current,
            installedVersion: info.firmwareVersion || null,
            board: info.board || null,
        };
        const evaluation = evaluateRelease(pending.manifest, info.board, info.firmwareVersion);
        if (evaluation.status !== "available") {
            this.pending = null;
            this.setReleaseStatus(evaluation.status);
            return this.state();
        }

        this.enter("downloading", 0, { error: null });

        const controller = new AbortController();
        this.abort = controller;
        let staged: string | null = null;
        try {
            staged = await this.releaseSource.download(pending.entry, controller.signal);
            const bytes = this.readFile(staged);
            if (bytes.length !== pending.entry.size) {
                throw new FirmwareFlashError(
                    "The downloaded update did not finish saving. Try again.",
                    FirmwareErrorCodes.Checksum,
                );
            }
            const sizeCheck = validateFlashSize(bytes.length);
            if (!sizeCheck.ok) {
                throw new FirmwareFlashError(sizeCheck.message, FirmwareErrorCodes.ImageRejected);
            }
            const image: LoadedImage = {
                info: {
                    path: staged,
                    name: pending.entry.asset,
                    size: bytes.length,
                    address: pending.entry.address,
                },
                bytes,
            };
            return await this.flashImage(image, pending.manifest.version);
        } catch (error) {
            if (isAbortError(error)) {
                this.current = { ...this.current, phase: "idle" };
                this.emitState();
                return this.state();
            }
            log.error(`[firmware] update failed: ${String(error)}`);
            if (error instanceof FirmwareFlashError) {
                return this.setError(error.code, error.message);
            }
            const failure = mapReleaseError(error);
            return this.setError(failure.code, failure.message);
        } finally {
            if (this.abort === controller) {
                this.abort = null;
            }
            if (staged !== null) {
                try {
                    this.releaseSource.remove(staged);
                } catch (error) {
                    log.warn(`[firmware] could not remove the staged update: ${String(error)}`);
                }
            }
        }
    }

    /**
     * Pick (or validate) a local image without flashing. The renderer shows a
     * confirmation with the returned `image`, then calls `flashLocal` with
     * `confirmed: true`. Returns `null` when the picker was cancelled.
     */
    async selectLocal(filePath?: string): Promise<FirmwareState | null> {
        this.assertIdle();
        const selected = filePath ?? (await this.pickImage());
        if (selected === null) {
            return null;
        }
        const image = this.loadImage(selected);
        this.current = {
            ...this.current,
            phase: "ready",
            image: image.info,
            error: null,
        };
        this.emitState();
        return this.state();
    }

    /**
     * Start a local flash. Without `confirmed` this only validates the image
     * (same as `selectLocal`), so the UI can confirm first.
     */
    async flashLocal(request: FlashLocalRequest = {}): Promise<FirmwareState | null> {
        if (request.confirmed !== true) {
            return this.selectLocal(request.path);
        }
        this.assertIdle();
        const selected = request.path ?? this.current.image?.path;
        if (selected === undefined) {
            return this.setError(
                FirmwareErrorCodes.NoImage,
                "Choose a firmware image before flashing.",
            );
        }

        const image = this.loadImage(selected);
        this.current = { ...this.current, image: image.info, error: null };
        return this.flashImage(image);
    }

    /**
     * Cancel a check, a download or a local selection before the handoff. There
     * is no cancel once the write owns the deck.
     */
    async cancel(): Promise<FirmwareState> {
        if (this.isBusy()) {
            return this.state();
        }
        const checking = this.current.release.status === "checking";
        const downloading = this.current.phase === "downloading";
        if (checking || downloading) {
            this.abort?.abort();
            this.current = {
                ...this.current,
                ...(downloading ? { phase: "idle" as const } : {}),
                ...(checking
                    ? {
                          release: {
                              ...this.current.release,
                              status:
                                  this.pending === null
                                      ? ("idle" as const)
                                      : ("available" as const),
                              error: null,
                          },
                      }
                    : {}),
            };
            this.emitState();
            return this.state();
        }
        this.current = {
            ...this.current,
            phase: "idle",
            image: null,
            error: null,
        };
        this.emitState();
        return this.state();
    }

    /** Hand the deck to its bootloader and write `image` at its address. */
    private async flashImage(image: LoadedImage, expectedVersion?: string): Promise<FirmwareState> {
        if (!this.usb.connected) {
            return this.setError(
                FirmwareErrorCodes.NotConnected,
                "Connect the deck, then try again.",
            );
        }
        const hid = this.usb.hidFingerprint();
        if (hid === null) {
            return this.setError(FirmwareErrorCodes.Handoff, USB_PORT_UNKNOWN_MESSAGE);
        }
        const fingerprint = this.locator.fingerprintFor(hid);
        if (fingerprint.serialNumber === null && fingerprint.usbPath === null) {
            return this.setError(FirmwareErrorCodes.Handoff, USB_PORT_UNKNOWN_MESSAGE);
        }
        if (!(await this.handoff())) {
            return this.state();
        }
        const drop = await this.waitForHidDrop();
        if (drop !== "dropped") {
            return this.setError(
                FirmwareErrorCodes.Handoff,
                drop === "unknown"
                    ? "The app could not check the deck's USB port. Replug it and try again."
                    : HANDOFF_FAILED_MESSAGE,
            );
        }
        const port = await this.locate(fingerprint);
        if (port === null) {
            return this.state();
        }
        await this.write(image, port, expectedVersion);
        return this.state();
    }

    private async handoff(): Promise<boolean> {
        this.enter("handoff");

        try {
            await this.usb.command(
                HostCommand.EnterBootloader,
                new Uint8Array(),
                DeviceResponse.Ack,
            );
        } catch (error) {
            if (isFirmwareError(error, ErrorCode.UnknownCommand)) {
                await this.setError(
                    FirmwareErrorCodes.FirmwareTooOld,
                    "This deck's firmware is too old to update from the app. Flash the first update-ready release once, then try again.",
                );
                return false;
            }
            if (this.usb.connected) {
                log.error(`[firmware] handoff failed: ${String(error)}`);
                await this.setError(FirmwareErrorCodes.Handoff, HANDOFF_FAILED_MESSAGE);
                return false;
            }
            // The interface went away before the ack arrived; the restart began.
            log.warn(`[firmware] handoff ack lost as the deck restarted: ${String(error)}`);
        }

        // Close our HID handle now: the deck is restarting either way, and a
        // closed handle makes the interface drop unambiguous.
        await this.usb.disconnect().catch(() => undefined);
        return true;
    }

    /**
     * Wait for the app's HID interface to leave the bus. Only then can a serial
     * port carrying the same serial number be the ROM loader rather than the
     * running app's own CDC interface.
     */
    private async waitForHidDrop(): Promise<"dropped" | "timeout" | "unknown"> {
        const deadline = this.now() + this.hidDropTimeoutMs;
        let unknown = false;
        while (this.now() <= deadline) {
            const present = await this.usb.hidPresent();
            if (present === false) {
                return "dropped";
            }
            if (present === null) {
                unknown = true;
            }
            await this.sleep(100);
        }
        log.warn("[firmware] the deck's HID interface did not drop before the loader search");
        return unknown ? "unknown" : "timeout";
    }

    private async locate(fingerprint: DeckUsbFingerprint): Promise<SerialPortInfoLike | null> {
        this.enter("locating");

        const port = await this.locator.waitFor(fingerprint);
        if (port === null) {
            await this.setError(
                FirmwareErrorCodes.PortNotFound,
                "The app could not reach the deck's bootloader mode. Unplug the deck, plug it back in, and try again.",
            );
            return null;
        }
        return port;
    }

    private async write(
        image: LoadedImage,
        port: SerialPortInfoLike,
        expectedVersion?: string,
    ): Promise<void> {
        this.enter("writing");

        try {
            await this.flasher.flash(port, image.bytes, {
                address: image.info.address,
                onProgress: (written, total) => {
                    const percent =
                        total <= 0 ? 0 : Math.min(100, Math.round((written / total) * 100));
                    this.emitProgress(percent, written, total);
                },
            });
        } catch (error) {
            log.error(`[firmware] write failed: ${String(error)}`);
            const [code, message] = mapFlasherError(error);
            await this.setError(code, message);
            return;
        }

        await this.finishReturn(expectedVersion);
    }

    private async finishReturn(expectedVersion?: string): Promise<void> {
        this.enter("returning", 100);

        if (!(await this.waitForDeck())) {
            await this.setError(
                FirmwareErrorCodes.NoReturn,
                "The deck did not come back. Unplug it, plug it back in, then check the version.",
            );
            return;
        }

        const info = await this.readDeckInfo();
        if (info === null || info.firmwareVersion === "") {
            await this.setError(
                FirmwareErrorCodes.NoVersion,
                "The deck came back but the app could not read its firmware version. Replug it and try again.",
            );
            return;
        }
        if (expectedVersion !== undefined) {
            const expected = normalizeVersion(expectedVersion);
            const actual = normalizeVersion(info.firmwareVersion);
            if (expected === null || actual === null || actual !== expected) {
                this.current = {
                    ...this.current,
                    installedVersion: info.firmwareVersion,
                    board: info.board || this.current.board,
                };
                this.reconcileRelease();
                await this.setError(
                    FirmwareErrorCodes.VersionMismatch,
                    `The deck came back on ${info.firmwareVersion} instead of ${expectedVersion}. Replug it, then check the version.`,
                );
                return;
            }
            this.pending = null;
            this.enter("done", 100, {
                installedVersion: actual,
                board: info.board || this.current.board,
                error: null,
                release: {
                    ...this.current.release,
                    status: "up-to-date",
                    error: null,
                },
            });
            return;
        }

        const installedVersion = info.firmwareVersion || this.current.installedVersion;
        const board = info.board || this.current.board;
        this.current = { ...this.current, installedVersion, board };
        this.reconcileRelease();
        this.enter("done", 100, { installedVersion, board, error: null });
    }

    private async waitForDeck(): Promise<boolean> {
        const deadline = this.now() + this.returnTimeoutMs;
        while (this.now() <= deadline) {
            if (this.usb.connected) {
                return true;
            }
            try {
                await this.usb.connect();
            } catch {
                // The ROM loader is still on the cable; try again shortly.
            }
            if (this.usb.connected) {
                return true;
            }
            await this.sleep(this.connectPollMs);
        }
        return this.usb.connected;
    }

    private async readDeckInfo(): Promise<DeviceInfo | null> {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.device.getDeviceInfo();
            } catch (error) {
                log.warn(`[firmware] could not read device info: ${String(error)}`);
                if (attempt < 2) {
                    await this.sleep(this.connectPollMs);
                }
            }
        }
        return null;
    }

    /** Keep the release verdict in step with a version read outside a check. */
    private reconcileRelease(): void {
        const pending = this.pending;
        if (pending === null) {
            return;
        }
        const evaluation = evaluateRelease(
            pending.manifest,
            this.current.board,
            this.current.installedVersion,
        );
        this.current = {
            ...this.current,
            release: { ...this.current.release, status: evaluation.status, error: null },
        };
        if (evaluation.status !== "available") {
            this.pending = null;
        }
    }

    private setReleaseStatus(status: FirmwareState["release"]["status"]): void {
        this.current = {
            ...this.current,
            release: { ...this.current.release, status, error: null },
        };
        this.emitState();
    }

    private loadImage(filePath: string): LoadedImage {
        const resolved = path.resolve(filePath);
        const stats = this.statFile(resolved);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new FirmwareFlashError(
                "Choose a regular .bin file.",
                FirmwareErrorCodes.ImageRejected,
            );
        }
        if (path.extname(resolved).toLowerCase() !== ".bin") {
            throw new FirmwareFlashError(
                "Choose a .bin firmware image.",
                FirmwareErrorCodes.ImageRejected,
            );
        }
        const check = validateFlashSize(stats.size);
        if (!check.ok) {
            throw new FirmwareFlashError(check.message, FirmwareErrorCodes.ImageRejected);
        }
        const info: FirmwareImageInfo = {
            path: resolved,
            name: path.basename(resolved),
            size: stats.size,
            address: APP_SLOT_ADDRESS,
        };
        const bytes = this.readFile(resolved);
        if (bytes.length !== stats.size) {
            throw new FirmwareFlashError(
                "The image changed while it was being read. Choose it again.",
                FirmwareErrorCodes.ImageRejected,
            );
        }
        return { info, bytes };
    }

    private assertIdle(): void {
        if (this.isActive()) {
            throw new FirmwareFlashError(
                "A firmware operation is already running.",
                FirmwareErrorCodes.Busy,
            );
        }
    }

    private async setError(code: FirmwareErrorCode, message: string): Promise<FirmwareState> {
        this.current = {
            ...this.current,
            phase: "error",
            error: { code, message },
        };
        this.emitState();
        return this.state();
    }

    private emitState(): void {
        this.onState(this.state());
    }

    private enter(phase: FlashPhase, percent = 0, patch: Partial<FirmwareState> = {}): void {
        this.current = { ...this.current, ...patch, phase };
        this.emitState();
        this.emitProgress(percent);
    }

    private emitProgress(percent: number, writtenBytes?: number, totalBytes?: number): void {
        this.onProgress({
            percent,
            ...(writtenBytes === undefined ? {} : { writtenBytes }),
            ...(totalBytes === undefined ? {} : { totalBytes }),
        });
    }
}

/** Turn a release source failure into one sentence and a next step. */
function mapReleaseError(error: unknown): FirmwareErrorInfo {
    if (error instanceof FirmwareFlashError) {
        return { code: error.code, message: error.message };
    }
    if (error instanceof ReleaseSourceError) {
        if (error.reason === "offline") {
            return {
                code: FirmwareErrorCodes.Download,
                message:
                    "Could not reach the firmware release server. Check your internet connection, then try again.",
            };
        }
        if (error.reason === "manifest" || error.reason === "response") {
            return {
                code: FirmwareErrorCodes.ReleaseUnreadable,
                message: "The latest firmware release could not be read. Try again later.",
            };
        }
        if (error.reason === "size" || error.reason === "checksum") {
            return {
                code: FirmwareErrorCodes.Checksum,
                message: "The downloaded firmware did not match the published release. Try again.",
            };
        }
        return {
            code: FirmwareErrorCodes.Download,
            message: "The downloaded update could not be saved. Try again.",
        };
    }
    return {
        code: FirmwareErrorCodes.Failed,
        message: "The update could not be prepared. Try again.",
    };
}

/** Turn an esptool/serial failure into one sentence and a next step. */
function mapFlasherError(error: unknown): [FirmwareErrorCode, string] {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (
        lower.includes("permission denied") ||
        lower.includes("eacces") ||
        lower.includes("access is denied")
    ) {
        return [
            FirmwareErrorCodes.PortPermission,
            "The app cannot open the deck's USB port. Check your USB permissions, then replug the deck.",
        ];
    }
    if (
        lower.includes("resource busy") ||
        lower.includes("ebusy") ||
        lower.includes("cannot open") ||
        lower.includes("could not open")
    ) {
        return [
            FirmwareErrorCodes.PortBusy,
            "Another program is using the deck's USB port. Close it, replug the deck, then try again.",
        ];
    }
    if (
        lower.includes("failed to connect") ||
        lower.includes("bootloader") ||
        lower.includes("rom loader") ||
        lower.includes("wrong boot mode")
    ) {
        return [
            FirmwareErrorCodes.Loader,
            "The deck's bootloader mode did not answer. Unplug it, plug it back in, and try again.",
        ];
    }
    return [
        FirmwareErrorCodes.Write,
        "The image did not finish writing. Replug the deck, then try again.",
    ];
}
