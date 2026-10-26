// ---------------------------------------------------------------------------
// The local-firmware state machine.
//
// One explicit path: a local app image passes the app-slot size bound, the user
// confirms, the app asks the deck to restart into its ROM bootloader, finds the
// loader's serial port by the identity recorded from the HID interface, writes
// the app image with esptool, and waits for the deck to come back so it can
// read the new firmware version.
//
// All platform and esptool detail stays behind `FirmwareFlasher` and
// `RomPortLocator`, so this module is tested with fakes.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import {
    APP_SLOT_ADDRESS,
    FirmwareErrorCodes,
    FLASH_STAGE_COPY,
    idleFirmwareState,
    isFirmwareBusy,
    validateFlashSize,
} from "@shared/firmware";
import type {
    FirmwareErrorCode,
    FirmwareImageInfo,
    FirmwareState,
    FlashLocalRequest,
    FlashProgressPayload,
} from "@shared/firmware";
import { DeviceResponse, ErrorCode, HostCommand } from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";
import type { DeviceInfo } from "@shared/ipc";
import { isFirmwareError } from "./usb/FirmwareError";
import type { FirmwareFlasher } from "./flash/EsptoolFlasher";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./flash/PortFingerprint";
import type { RomPortLocator } from "./flash/RomPortLocator";
import { delay } from "./flash/delay";

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

type StatFile = NonNullable<FirmwareServiceOptions["statFile"]>;

const HANDOFF_FAILED_MESSAGE = "The deck did not restart for the update. Replug it and try again.";
const USB_PORT_UNKNOWN_MESSAGE =
    "The app could not recognise the deck's USB port. Replug it and try again.";

function cloneState(state: FirmwareState): FirmwareState {
    return {
        ...state,
        image: state.image === null ? null : { ...state.image },
        error: state.error === null ? null : { ...state.error },
    };
}

/**
 * Owns the firmware state machine and the local-flash flow. One flash at a
 * time; the renderer only sees state transitions and progress.
 */
export class FirmwareService {
    private readonly usb: FirmwareUsbClient;
    private readonly device: FirmwareDeviceClient;
    private readonly flasher: FirmwareFlasher;
    private readonly locator: Pick<RomPortLocator, "fingerprintFor" | "waitFor">;
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

    constructor(options: FirmwareServiceOptions) {
        this.usb = options.usb;
        this.device = options.device;
        this.flasher = options.flasher;
        this.locator = options.locator;
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

    /** Read the deck's installed version and board when a deck is connected. */
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
                ...(recovered ? { phase: "done" as const, percent: 100, error: null } : {}),
                installedVersion: info.firmwareVersion || null,
                board: info.board || null,
            };
        }
        return this.state();
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
            percent: null,
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
        this.current = { ...this.current, image: image.info, percent: null, error: null };

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
        await this.write(image, port);
        return this.state();
    }

    /** Cancel a selection before the handoff. There is no cancel after it. */
    async cancel(): Promise<FirmwareState> {
        if (this.isBusy()) {
            return this.state();
        }
        this.current = {
            ...this.current,
            phase: "idle",
            image: null,
            percent: null,
            error: null,
        };
        this.emitState();
        return this.state();
    }

    private async handoff(): Promise<boolean> {
        this.current = { ...this.current, phase: "handoff", percent: 0 };
        this.emitState();
        this.emitProgress("handoff", 0);

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
                    "This deck's firmware is too old to update from the app. Install the first update-ready release once, then try again.",
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
        this.current = { ...this.current, phase: "locating", percent: 0 };
        this.emitState();
        this.emitProgress("locating", 0);

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

    private async write(image: LoadedImage, port: SerialPortInfoLike): Promise<void> {
        this.current = { ...this.current, phase: "writing", percent: 0 };
        this.emitState();
        this.emitProgress("writing", 0);

        try {
            await this.flasher.flash(port, image.bytes, {
                address: image.info.address,
                onProgress: (written, total) => {
                    const percent =
                        total <= 0 ? 0 : Math.min(100, Math.round((written / total) * 100));
                    this.current = { ...this.current, percent };
                    this.emitState();
                    this.emitProgress("writing", percent);
                },
            });
        } catch (error) {
            log.error(`[firmware] write failed: ${String(error)}`);
            const [code, message] = mapFlasherError(error);
            await this.setError(code, message);
            return;
        }

        await this.finishReturn();
    }

    private async finishReturn(): Promise<void> {
        this.current = { ...this.current, phase: "returning", percent: 100 };
        this.emitState();
        this.emitProgress("returning", 100);

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
        this.current = {
            ...this.current,
            phase: "done",
            installedVersion: info.firmwareVersion || this.current.installedVersion,
            board: info.board || this.current.board,
            percent: 100,
            error: null,
        };
        this.emitState();
        this.emitProgress("done", 100);
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
        if (this.isBusy()) {
            throw new FirmwareFlashError(
                "A firmware write is already running.",
                FirmwareErrorCodes.Busy,
            );
        }
    }

    private async setError(code: FirmwareErrorCode, message: string): Promise<FirmwareState> {
        this.current = {
            ...this.current,
            phase: "error",
            percent: null,
            error: { code, message },
        };
        this.emitState();
        return this.state();
    }

    private emitState(): void {
        this.onState(this.state());
    }

    private emitProgress(phase: FlashProgressPayload["phase"], percent: number): void {
        this.onProgress({
            phase,
            percent,
            message: FLASH_STAGE_COPY[phase],
        });
    }
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
