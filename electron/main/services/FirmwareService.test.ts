import { describe, expect, it, vi } from "vitest";
import { APP_SLOT_ADDRESS, APP_SLOT_SIZE, FirmwareErrorCodes } from "@shared/firmware";
import type { FlashProgressPayload, FirmwareState } from "@shared/firmware";
import type { FirmwareBoardEntry, FirmwareManifest } from "@shared/firmwareRelease";
import type { DeviceInfo } from "@shared/ipc";
import { ErrorCode, HostCommand } from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";
import { FirmwareService } from "./FirmwareService";
import type { FirmwareDeviceClient, FirmwareUsbClient } from "./FirmwareService";
import { DeviceLock } from "./DeviceLock";
import type { FirmwareTransferClient } from "./FirmwareService";
import type { FirmwareFlasher, FlashImageOptions } from "./flash/EsptoolFlasher";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./flash/PortFingerprint";
import { ReleaseSourceError } from "./ReleaseSource";
import type { FirmwareReleaseSource, LatestRelease } from "./ReleaseSource";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const FILE = "/tmp/LucydDeck-firmware-v0.4.0.bin";
const PORT: SerialPortInfoLike = {
    path: "/dev/ttyACM1",
    serialNumber: "80:65:99:A5:03:8C",
};

class FakeUsb implements FirmwareUsbClient {
    connected = true;
    readonly calls: HostCommand[] = [];
    readonly order: string[];
    scanCalls = 0;
    commandError: Error | null = null;
    disconnectCalls = 0;
    connectCalls = 0;
    connectSucceeds = true;
    hidPresentCalls = 0;
    hidPresentResults: boolean[] = [];
    hidError: Error | null = null;
    deferCommand = false;
    private finishCommand: (() => void) | null = null;
    deferConnect = false;
    private finishConnect: (() => void) | null = null;

    constructor(order: string[] = []) {
        this.order = order;
    }

    hid: HidDescriptorLike = {
        vendorId: 0x303a,
        productId: 0x1001,
        path: "/dev/hidraw0",
        serialNumber: "806599A5038C",
        product: "LucydDeck",
    };

    hidFingerprint(): HidDescriptorLike | null {
        if (this.hidError !== null) {
            throw this.hidError;
        }
        return this.hid;
    }

    async hidPresent(): Promise<boolean> {
        this.order.push("hid");
        this.hidPresentCalls++;
        const next = this.hidPresentResults.shift();
        return next ?? this.connected;
    }

    command(opcode: HostCommand): Promise<Uint8Array> {
        this.order.push("handoff");
        this.calls.push(opcode);
        if (this.commandError !== null) {
            return Promise.reject(this.commandError);
        }
        if (!this.deferCommand) {
            return Promise.resolve(new Uint8Array());
        }
        return new Promise((resolve) => {
            this.finishCommand = () => resolve(new Uint8Array());
        });
    }

    finishHandoff(): void {
        this.finishCommand?.();
        this.finishCommand = null;
    }

    resumeScanning(): void {
        this.scanCalls++;
    }

    async disconnect(): Promise<void> {
        this.disconnectCalls++;
        this.connected = false;
        this.order.push("disconnect");
    }

    async connect(): Promise<void> {
        this.connectCalls++;
        if (!this.connectSucceeds) {
            throw new Error("no deck");
        }
        if (this.deferConnect) {
            await new Promise<void>((resolve) => {
                this.finishConnect = () => {
                    this.connected = true;
                    resolve();
                };
            });
            return;
        }
        this.connected = true;
    }

    releaseConnect(): void {
        this.finishConnect?.();
        this.finishConnect = null;
    }
}

class FakeDevice implements FirmwareDeviceClient {
    version = "0.4.0";
    board = "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3";
    calls = 0;
    fail = false;
    deferInfo = false;
    private finishInfo: (() => void) | null = null;

    async getDeviceInfo(): Promise<DeviceInfo> {
        this.calls++;
        if (this.fail) {
            throw new Error("no device info");
        }
        if (this.deferInfo) {
            await new Promise<void>((resolve) => {
                this.finishInfo = resolve;
            });
        }
        return {
            firmwareVersion: this.version,
            protocolVersion: "1",
            board: this.board,
            freeSpaceKb: 2048,
        };
    }

    finish(): void {
        this.finishInfo?.();
        this.finishInfo = null;
    }
}

interface FlashCall {
    port: SerialPortInfoLike;
    size: number;
    address: number;
    bytes: Uint8Array;
}

class FakeFlasher implements FirmwareFlasher {
    readonly calls: FlashCall[] = [];
    failOnce: Error | null = null;
    defer = false;
    /** Runs after a successful write, before the service reads the version. */
    onFlash: (() => void) | null = null;
    private release: (() => void) | null = null;

    flash(port: SerialPortInfoLike, image: Uint8Array, options: FlashImageOptions): Promise<void> {
        this.calls.push({ port, size: image.length, address: options.address, bytes: image });
        if (this.failOnce !== null) {
            const failure = this.failOnce;
            this.failOnce = null;
            return Promise.reject(failure);
        }
        if (!this.defer) {
            options.onProgress(0, image.length);
            options.onProgress(Math.floor(image.length / 2), image.length);
            options.onProgress(image.length, image.length);
            this.onFlash?.();
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.release = () => {
                options.onProgress(image.length, image.length);
                this.onFlash?.();
                resolve();
            };
        });
    }

    finish(): void {
        this.release?.();
        this.release = null;
    }
}

class FakeTransfer implements FirmwareTransferClient {
    calls = 0;
    fail: Error | null = null;

    constructor(private readonly order: string[] = []) {}

    async cancelOpen(): Promise<void> {
        this.calls++;
        this.order.push("cancel-transfer");
        if (this.fail !== null) {
            throw this.fail;
        }
    }
}

class FakeLocator {
    port: SerialPortInfoLike | null = PORT;
    findPort: SerialPortInfoLike | null = { ...PORT, usbPath: "1-2" };
    waitCalls = 0;
    findCalls = 0;
    waitError: Error | null = null;
    findError: Error | null = null;
    fingerprintError: Error | null = null;
    fingerprintCalls = 0;
    defer = false;
    private finishWait: (() => void) | null = null;
    readonly order: string[];

    constructor(order: string[] = []) {
        this.order = order;
    }

    fingerprint: DeckUsbFingerprint = {
        serialNumber: "806599A5038C",
        usbPath: "1-2",
        product: "LucydDeck",
        bootloaderVendorId: 0x303a,
        bootloaderProductId: 0x1001,
        preHandoffPaths: [],
    };

    async fingerprintFor(): Promise<DeckUsbFingerprint> {
        this.fingerprintCalls++;
        this.order.push("fingerprint");
        if (this.fingerprintError !== null) {
            throw this.fingerprintError;
        }
        return this.fingerprint;
    }

    async find(): Promise<SerialPortInfoLike | null> {
        this.findCalls++;
        if (this.findError !== null) {
            throw this.findError;
        }
        return this.findPort;
    }

    async waitFor(): Promise<SerialPortInfoLike | null> {
        this.waitCalls++;
        this.order.push("locate");
        if (this.waitError !== null) {
            throw this.waitError;
        }
        if (!this.defer) {
            return this.port;
        }
        return new Promise((resolve) => {
            this.finishWait = () => resolve(this.port);
        });
    }

    finish(): void {
        this.finishWait?.();
        this.finishWait = null;
    }
}

const BOARD = "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3";
const STAGED = "/tmp/lucyddeck-staged/LucydDeck-firmware-v0.4.0.bin";
const RELEASE_URL = "https://github.com/lucyd-dev/LucydDeck-firmware/releases/tag/v0.4.0";

function releaseEntry(overrides: Partial<FirmwareBoardEntry> = {}): FirmwareBoardEntry {
    return {
        asset: "LucydDeck-firmware-v0.4.0.bin",
        size: 4096,
        sha256: "a".repeat(64),
        chip: "esp32s3",
        address: APP_SLOT_ADDRESS,
        layout: "max_app_8MB",
        ...overrides,
    };
}

function releaseManifest(
    overrides: Partial<FirmwareManifest> & { boards?: Record<string, FirmwareBoardEntry> } = {},
): FirmwareManifest {
    return {
        schemaVersion: 1,
        version: "0.4.0",
        releaseUrl: RELEASE_URL,
        ...overrides,
        boards: overrides.boards ?? { [BOARD]: releaseEntry() },
    };
}

class FakeReleaseSource implements FirmwareReleaseSource {
    latestResult: LatestRelease = {
        manifest: releaseManifest(),
        publishedAt: "2026-10-26T02:51:50.000Z",
    };
    latestError: Error | null = null;
    downloadError: Error | null = null;
    downloadPath: string | null = STAGED;
    latestCalls = 0;
    downloadCalls = 0;
    readonly removed: string[] = [];
    deferLatest = false;
    private finishLatest: (() => void) | null = null;

    latest(signal?: AbortSignal): Promise<LatestRelease> {
        this.latestCalls++;
        if (this.latestError !== null) {
            return Promise.reject(this.latestError);
        }
        if (signal?.aborted === true) {
            return Promise.reject(abortError());
        }
        if (!this.deferLatest) {
            return Promise.resolve(this.latestResult);
        }
        return new Promise((resolve, reject) => {
            this.finishLatest = () => resolve(this.latestResult);
            signal?.addEventListener("abort", () => reject(abortError()), { once: true });
        });
    }

    finishLatestRelease(): void {
        this.finishLatest?.();
        this.finishLatest = null;
    }

    download(_entry: FirmwareBoardEntry, signal?: AbortSignal): Promise<string> {
        this.downloadCalls++;
        if (this.downloadError !== null) {
            return Promise.reject(this.downloadError);
        }
        return new Promise((resolve, reject) => {
            const finish = (): void => {
                if (this.downloadPath === null) {
                    reject(new Error("no staged file"));
                    return;
                }
                resolve(this.downloadPath);
            };
            if (signal?.aborted === true) {
                reject(abortError());
                return;
            }
            if (this.deferDownload) {
                this.finishDownload = finish;
                signal?.addEventListener("abort", () => reject(abortError()), { once: true });
                return;
            }
            finish();
        });
    }

    remove(file: string): void {
        this.removed.push(file);
    }

    deferDownload = false;
    private finishDownload: (() => void) | null = null;

    finish(): void {
        this.finishDownload?.();
        this.finishDownload = null;
    }
}

function abortError(): Error {
    const error = new Error("aborted");
    error.name = "AbortError";
    return error;
}

function make(
    overrides: {
        fileSize?: number;
        pick?: string | null;
        order?: string[];
        platform?: NodeJS.Platform;
        readFile?: (file: string) => Uint8Array;
    } = {},
) {
    const order = overrides.order ?? [];
    const usb = new FakeUsb(order);
    const device = new FakeDevice();
    const flasher = new FakeFlasher();
    const locator = new FakeLocator(order);
    const releaseSource = new FakeReleaseSource();
    const lock = new DeviceLock();
    const transfer = new FakeTransfer(order);
    const states: FirmwareState[] = [];
    const progress: FlashProgressPayload[] = [];
    const fileSize = overrides.fileSize ?? 4096;
    let clock = 0;
    const service = new FirmwareService({
        usb,
        device,
        flasher,
        locator,
        releaseSource,
        pickImage: async () => (overrides.pick === undefined ? FILE : overrides.pick),
        onState: (state) => states.push(state),
        onProgress: (event) => progress.push(event),
        statFile: () => ({
            size: fileSize,
            isFile: () => true,
            isSymbolicLink: () => false,
        }),
        readFile: overrides.readFile ?? (() => new Uint8Array(fileSize)),
        platform: overrides.platform,
        lock,
        transfer,
        sleep: async (ms) => {
            clock += ms;
        },
        now: () => {
            clock += 10;
            return clock;
        },
    });
    return {
        service,
        usb,
        device,
        flasher,
        locator,
        releaseSource,
        lock,
        transfer,
        states,
        progress,
        order,
    };
}

describe("FirmwareService local flash", () => {
    it("flashes the app slot after the handoff and reports the returned version", async () => {
        const { service, usb, device, flasher, locator, states, progress } = make();

        const ready = await service.selectLocal(FILE);
        expect(ready!.phase).toBe("ready");
        expect(ready!.image).toEqual({
            path: FILE,
            name: "LucydDeck-firmware-v0.4.0.bin",
            size: 4096,
            address: APP_SLOT_ADDRESS,
        });

        const done = await service.flashLocal({ path: FILE, confirmed: true });

        expect(done!.phase).toBe("done");
        expect(done!.installedVersion).toBe("0.4.0");
        expect(done!.board).toBe("WAVESHARE_ESP32_S3_TOUCH_LCD_4_3");
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(usb.disconnectCalls).toBe(1);
        expect(locator.waitCalls).toBe(1);
        expect(flasher.calls).toHaveLength(1);
        expect(flasher.calls[0]).toMatchObject({
            port: PORT,
            size: 4096,
            address: APP_SLOT_ADDRESS,
        });
        expect(device.calls).toBe(1);

        expect(states.map((state) => state!.phase)).toEqual([
            "ready",
            "handoff",
            "locating",
            "writing",
            "returning",
            "done",
        ]);
        expect(progress.map((event) => event.percent)).toContain(50);
        expect(progress.find((event) => event.percent === 50)).toMatchObject({
            percent: 50,
            writtenBytes: 2048,
            totalBytes: 4096,
        });
        expect(progress.at(-1)).toEqual({ percent: 100 });
    });

    it("cancels an open transfer before asking for the bootloader", async () => {
        const order: string[] = [];
        const { service, transfer } = make({ order });

        await service.flashLocal({ path: FILE, confirmed: true });

        expect(transfer.calls).toBe(1);
        expect(order.indexOf("cancel-transfer")).toBeGreaterThanOrEqual(0);
        expect(order.indexOf("cancel-transfer")).toBeLessThan(order.indexOf("handoff"));
    });

    it("does not hand off when the open transfer cannot be cancelled", async () => {
        const { service, usb, flasher, transfer } = make();
        transfer.fail = new Error("cancel timed out");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Handoff },
        });
        expect(state!.error?.message).toContain("Unplug the deck, plug it back in");
        expect(state!.error?.message).not.toContain("cancel timed out");
        expect(usb.calls).toHaveLength(0);
        expect(flasher.calls).toHaveLength(0);
    });

    it("releases the deck after a local flash succeeds or fails", async () => {
        const { service, lock, flasher } = make();

        await service.flashLocal({ path: FILE, confirmed: true });
        expect(lock.busy).toBe(false);

        flasher.failOnce = new Error("Resource busy");
        await service.flashLocal({ path: FILE, confirmed: true });
        expect(lock.busy).toBe(false);
    });

    it("refuses a local flash while a sync owns the deck", async () => {
        const { service, lock, usb, flasher } = make();
        lock.beginSync();

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.Busy });
        expect(state!.error?.message).toContain("sync");
        expect(usb.calls).toHaveLength(0);
        expect(flasher.calls).toHaveLength(0);

        lock.endSync();
    });

    it("records the pre-handoff ports before sending 0x05", async () => {
        const order: string[] = [];
        const { service } = make({ order });

        await service.flashLocal({ path: FILE, confirmed: true });

        expect(order.indexOf("fingerprint")).toBeGreaterThanOrEqual(0);
        expect(order.indexOf("fingerprint")).toBeLessThan(order.indexOf("handoff"));
    });

    it("stops before the handoff when the pre-handoff ports cannot be recorded", async () => {
        const { service, usb, flasher, locator } = make();
        locator.fingerprintError = new Error("serialport list failed");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Handoff },
        });
        expect(state!.error?.message).toContain("recognise the deck's USB port");
        expect(locator.fingerprintCalls).toBe(1);
        expect(usb.calls).toHaveLength(0);
        expect(flasher.calls).toHaveLength(0);
    });

    it("accepts exactly 8064 KiB and refuses one byte more before the handoff", async () => {
        const accepted = make({ fileSize: APP_SLOT_SIZE });
        await expect(accepted.service.selectLocal(FILE)).resolves.toMatchObject({
            phase: "ready",
            image: { size: APP_SLOT_SIZE },
        });

        const refused = make({ fileSize: APP_SLOT_SIZE + 1 });
        await expect(refused.service.selectLocal(FILE)).rejects.toMatchObject({
            code: FirmwareErrorCodes.ImageRejected,
        });
        expect(refused.usb.calls).toHaveLength(0);
        expect(refused.flasher.calls).toHaveLength(0);
    });

    it("refuses to flash when the deck is disconnected", async () => {
        const { service, usb, flasher } = make();
        usb.connected = false;

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.NotConnected },
        });
        expect(state!.image?.path).toBe(FILE);
        expect(usb.calls).toHaveLength(0);
        expect(flasher.calls).toHaveLength(0);
    });

    it("names the bootstrap flash when the firmware is too old", async () => {
        const { service, usb, flasher } = make();
        usb.commandError = Object.assign(new Error("unknown command"), {
            firmwareCode: ErrorCode.UnknownCommand,
        });

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.FirmwareTooOld },
        });
        expect(state!.error?.message).toContain("one-time bootstrap");
        expect(state!.error?.message).toContain("PlatformIO");
        expect(usb.disconnectCalls).toBe(0);
        expect(flasher.calls).toHaveLength(0);
    });

    it("keeps the bootstrap instruction when the deck is read again", async () => {
        const { service, usb } = make();
        usb.commandError = Object.assign(new Error("unknown command"), {
            firmwareCode: ErrorCode.UnknownCommand,
        });
        await service.flashLocal({ path: FILE, confirmed: true });

        const state = await service.refreshDeckInfo();

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.FirmwareTooOld },
            installedVersion: "0.4.0",
        });
    });

    it("waits for the HID interface to drop before looking for the loader", async () => {
        const order: string[] = [];
        const { service, usb } = make({ order });
        usb.hidPresentResults = [true, true, false];

        await service.flashLocal({ path: FILE, confirmed: true });

        const afterDisconnect = order.slice(order.indexOf("disconnect"));
        expect(afterDisconnect).toEqual(["disconnect", "hid", "hid", "hid", "locate"]);
    });

    it("stops when the HID interface never drops", async () => {
        const { service, usb, locator } = make();
        usb.hidPresentResults = Array.from({ length: 1000 }, () => true);

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Handoff },
        });
        expect(locator.waitCalls).toBe(0);
    });

    it("stops when the loader port does not appear", async () => {
        const { service, usb, device, flasher, locator } = make();
        locator.port = null;

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.PortNotFound },
        });
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(flasher.calls).toHaveLength(0);
        expect(usb.scanCalls).toBe(1);

        usb.connected = true;
        const recovered = await service.refreshDeckInfo();

        expect(recovered).toMatchObject({
            phase: "idle",
            installedVersion: device.version,
            error: null,
        });
    });

    it("does not claim a new version when the deck comes back unreadable", async () => {
        const { service, device } = make();
        device.fail = true;

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.NoVersion },
        });
    });

    it("reports a write failure without restarting the flash", async () => {
        const { service, usb, flasher, locator } = make();
        flasher.failOnce = new Error("Resource busy");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.PortBusy },
        });
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(locator.waitCalls).toBe(1);
        expect(flasher.calls).toHaveLength(1);
    });

    it("reports writing for the quit guard only while esptool is writing", async () => {
        const { service, flasher } = make();
        flasher.defer = true;

        const flash = service.flashLocal({ path: FILE, confirmed: true });
        await vi.waitFor(() => expect(service.state().phase).toBe("writing"));
        expect(service.isBusy()).toBe(true);

        flasher.finish();
        await flash;
        expect(service.isBusy()).toBe(false);
        expect(service.state().phase).toBe("done");
    });

    it("cancels a selected image but not a running write", async () => {
        const { service, flasher } = make();
        await service.selectLocal(FILE);
        const cancelled = await service.cancel();
        expect(cancelled).toMatchObject({ phase: "idle", image: null, error: null });

        flasher.defer = true;
        const flash = service.flashLocal({ path: FILE, confirmed: true });
        await vi.waitFor(() => expect(service.state().phase).toBe("writing"));
        await expect(service.cancel()).resolves.toMatchObject({ phase: "writing" });
        flasher.finish();
        await flash;
    });

    it("refuses to cancel once the write has finished", async () => {
        const { service, usb } = make();
        usb.deferConnect = true;

        const flash = service.flashLocal({ path: FILE, confirmed: true });
        await vi.waitFor(() => expect(service.state().phase).toBe("returning"));
        await expect(service.cancel()).resolves.toMatchObject({ phase: "returning" });

        usb.releaseConnect();
        await expect(flash).resolves.toMatchObject({ phase: "done" });
    });

    it("cancels a handoff before the write starts", async () => {
        const { service, usb, flasher } = make();
        usb.deferCommand = true;

        const flash = service.flashLocal({ path: FILE, confirmed: true });
        await vi.waitFor(() => expect(service.state().phase).toBe("handoff"));
        await service.cancel();
        usb.finishHandoff();
        const state = await flash;

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Cancelled },
        });
        expect(state!.error?.message).toContain("bootloader mode");
        expect(state!.error?.message).toContain("unplug it and plug it back in");
        expect(flasher.calls).toHaveLength(0);
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
    });

    it("cancels the loader search without writing", async () => {
        const { service, flasher, locator } = make();
        locator.defer = true;

        const flash = service.flashLocal({ path: FILE, confirmed: true });
        await vi.waitFor(() => expect(service.state().phase).toBe("locating"));
        await service.cancel();
        locator.finish();
        const state = await flash;

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Cancelled },
        });
        expect(flasher.calls).toHaveLength(0);
    });

    it("retries a failed write on the retained ROM port without a second handoff", async () => {
        const { service, usb, flasher, locator } = make();
        flasher.failOnce = new Error("Resource busy");

        const failed = await service.flashLocal({ path: FILE, confirmed: true });

        expect(failed).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.PortBusy, retryable: true },
        });
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(locator.waitCalls).toBe(1);

        const done = await service.retry();

        expect(done.phase).toBe("done");
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(locator.waitCalls).toBe(1);
        expect(flasher.calls).toHaveLength(2);
        expect(flasher.calls[1].port).toBe(PORT);
    });

    it("drops Retry when the retained port no longer matches the deck", async () => {
        const { service, usb, flasher, locator } = make();
        flasher.failOnce = new Error("Resource busy");
        await service.flashLocal({ path: FILE, confirmed: true });
        locator.findPort = { ...PORT, serialNumber: "AAAAAAAAAAAA", usbPath: "1-2" };

        const state = await service.retry();

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.PortNotFound },
        });
        expect(state!.error?.message).toContain("Unplug the deck, plug it back in, then Retry");
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(locator.findCalls).toBe(1);
        expect(flasher.calls).toHaveLength(1);

        await service.retry();
        expect(locator.findCalls).toBe(1);
        expect(flasher.calls).toHaveLength(1);
    });

    it("clears the failed-write message while Retry writes", async () => {
        const { service, flasher } = make();
        flasher.failOnce = new Error("Resource busy");
        await service.flashLocal({ path: FILE, confirmed: true });

        flasher.defer = true;
        const retrying = service.retry();
        await vi.waitFor(() => expect(service.state().phase).toBe("writing"));
        expect(service.state().error).toBeNull();

        flasher.finish();
        await retrying;
    });

    it("stops offering Retry when the write failed but the deck did not return", async () => {
        const { service, flasher, usb } = make();
        usb.connectSucceeds = false;

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.NoReturn },
        });
        expect(state!.error?.message).toContain("Unplug it, plug it back in");
        expect(state!.error?.retryable).toBeUndefined();
        expect(usb.scanCalls).toBe(1);
        await service.retry();
        expect(flasher.calls).toHaveLength(1);

        usb.connected = true;
        const recovered = await service.refreshDeckInfo();

        expect(recovered).toMatchObject({
            phase: "done",
            installedVersion: "0.4.0",
            error: null,
        });
        expect(recovered.release.status).toBe("idle");
    });

    it("does nothing when Retry has no retained write", async () => {
        const { service, flasher } = make();

        await expect(service.retry()).resolves.toMatchObject({ phase: "idle" });
        expect(flasher.calls).toHaveLength(0);
    });

    it("drops the Retry once the deck comes back in app mode", async () => {
        const { service, usb, flasher } = make();
        flasher.failOnce = new Error("Resource busy");
        await service.flashLocal({ path: FILE, confirmed: true });

        usb.connected = true;
        const state = await service.refreshDeckInfo();

        expect(state).toMatchObject({ phase: "idle", error: null });
        await service.retry();
        expect(flasher.calls).toHaveLength(1);
    });

    it("drops the retained write when the failure is cancelled", async () => {
        const { service, flasher } = make();
        flasher.failOnce = new Error("Resource busy");
        await service.flashLocal({ path: FILE, confirmed: true });

        const cancelled = await service.cancel();
        expect(cancelled).toMatchObject({ phase: "idle", error: null });
        await service.retry();

        expect(flasher.calls).toHaveLength(1);
    });

    it("names the Linux udev rule when the port is not writable", async () => {
        const { service, flasher } = make({ platform: "linux" });
        flasher.failOnce = Object.assign(
            new Error("EACCES: permission denied, open '/dev/ttyACM1'"),
            {
                code: "EACCES",
            },
        );

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({
            code: FirmwareErrorCodes.PortPermission,
            retryable: true,
        });
        expect(state!.error?.message).toContain("99-lucyddeck.rules");
        expect(state!.error?.message).not.toContain("EACCES");
        expect(state!.error?.message).not.toContain("/dev/ttyACM1");
    });

    it("keeps udev out of a Windows permission failure", async () => {
        const { service, flasher } = make({ platform: "win32" });
        flasher.failOnce = new Error("Access is denied");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.PortPermission });
        expect(state!.error?.message).not.toContain("udev");
        expect(state!.error?.message).not.toContain("Access is denied");
    });

    it("maps a loader failure without leaking esptool text", async () => {
        const { service, flasher } = make();
        flasher.failOnce = new Error("Failed to connect to ESP32-S3: No serial data received.");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({
            code: FirmwareErrorCodes.Loader,
            retryable: true,
        });
        expect(state!.error?.message).not.toContain("ESP32-S3");
        expect(state!.error?.message).not.toContain("serial data");
    });

    it("maps a write failure without leaking esptool text", async () => {
        const { service, flasher } = make();
        flasher.failOnce = new Error(
            "A fatal error occurred: Failed to write to target Flash after seq 42",
        );

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({
            code: FirmwareErrorCodes.Write,
            retryable: true,
        });
        expect(state!.error?.message).not.toContain("fatal");
        expect(state!.error?.message).not.toContain("seq 42");
        expect(state!.error?.message).not.toContain("Flash");
    });

    it("turns an unreadable local image into a sentence, not a filesystem error", async () => {
        const { service } = make({
            readFile: () => {
                throw Object.assign(new Error("EACCES: permission denied, open '/tmp/fw.bin'"), {
                    code: "EACCES",
                });
            },
        });

        await expect(service.selectLocal(FILE)).rejects.toMatchObject({
            code: FirmwareErrorCodes.ImageRejected,
            message: "The app could not read that image. Choose it again.",
        });
    });

    it("turns an unexpected USB failure into a sentence, not a stack", async () => {
        const { service, usb } = make();
        usb.hidError = new Error("HID descriptor read failed at /dev/hidraw0");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Failed },
        });
        expect(state!.error?.message).toBe("The flash could not be prepared. Try again.");
        expect(state!.error?.message).not.toContain("hidraw");
    });

    it("turns a locator failure into the bootloader step", async () => {
        const { service, locator } = make();
        locator.waitError = new Error("serialport: cannot list ports");

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.PortNotFound });
        expect(state!.error?.message).toContain("Unplug the deck, plug it back in");
        expect(state!.error?.message).not.toContain("serialport");
    });

    it("cancels a check before its release is read", async () => {
        const { service, releaseSource } = make();
        releaseSource.deferLatest = true;

        const checking = service.checkForUpdate();
        await vi.waitFor(() => expect(service.state().release.status).toBe("checking"));
        const cancelled = await service.cancel();
        await checking;

        expect(cancelled.release.status).toBe("idle");
        expect(service.state()).toMatchObject({
            phase: "idle",
            release: { status: "idle", error: null },
        });
        expect(releaseSource.latestCalls).toBe(0);
    });
});

describe("FirmwareService release update", () => {
    it("finds a newer release for the deck's board", async () => {
        const { service, device, releaseSource } = make();
        device.version = "0.3.0";

        const state = await service.checkForUpdate();

        expect(releaseSource.latestCalls).toBe(1);
        expect(state).toMatchObject({
            installedVersion: "0.3.0",
            board: BOARD,
            release: {
                status: "available",
                latest: {
                    version: "0.4.0",
                    notesUrl: RELEASE_URL,
                    publishedAt: "2026-10-26T02:51:50.000Z",
                },
                error: null,
            },
        });
    });

    it("does not read a release without a connected deck", async () => {
        const { service, usb, releaseSource } = make();
        usb.connected = false;

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("no-deck");
        expect(releaseSource.latestCalls).toBe(0);
    });

    it("says no firmware is published for an unknown board", async () => {
        const { service, device, releaseSource } = make();
        device.version = "0.3.0";
        releaseSource.latestResult = {
            manifest: releaseManifest({
                boards: { SOME_OTHER_BOARD: releaseEntry() },
            }),
            publishedAt: null,
        };

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("no-firmware");
        expect(state.release.latest?.version).toBe("0.4.0");
        await expect(service.update()).resolves.toMatchObject({
            error: { code: FirmwareErrorCodes.NoUpdate },
        });
    });

    it("says the deck's board could not be read", async () => {
        const { service, device } = make();
        device.version = "0.3.0";
        device.board = "";

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("no-board");
    });

    it("refuses a release built for another chip", async () => {
        const { service, device, releaseSource } = make();
        device.version = "0.3.0";
        releaseSource.latestResult = {
            manifest: releaseManifest({
                boards: { [BOARD]: releaseEntry({ chip: "esp32" }) },
            }),
            publishedAt: null,
        };

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("incompatible");
        await expect(service.update()).resolves.toMatchObject({
            error: { code: FirmwareErrorCodes.NoUpdate },
        });
    });

    it("reports an equal version as up to date", async () => {
        const { service, device } = make();
        device.version = "0.4.0";

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("up-to-date");
    });

    it("reports an installed version newer than the latest release", async () => {
        const { service, device } = make();
        device.version = "0.5.0";

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("newer-installed");
    });

    it("offers nothing for an unreadable installed version", async () => {
        const { service, device } = make();
        device.version = "dev build";

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("unknown");
        await expect(service.update()).resolves.toMatchObject({
            error: { code: FirmwareErrorCodes.NoUpdate },
        });
    });

    it("keeps a launch check silent on failure", async () => {
        const { service, releaseSource } = make();
        releaseSource.latestError = new ReleaseSourceError("offline", "offline");

        const state = await service.checkForUpdate({ silent: true });

        expect(state.release.status).toBe("idle");
        expect(state.release.error).toBeNull();
    });

    it("shows a manual check failure with a next step", async () => {
        const { service, releaseSource } = make();
        releaseSource.latestError = new ReleaseSourceError("offline", "offline");

        const state = await service.checkForUpdate();

        expect(state.release.status).toBe("error");
        expect(state.release.error).toMatchObject({ code: FirmwareErrorCodes.Download });
        expect(state.release.error?.message).toContain("internet connection");
    });

    it("leaves a known update alone when a silent check fails", async () => {
        const { service, device, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();

        releaseSource.latestError = new ReleaseSourceError("offline", "offline");
        const state = await service.checkForUpdate({ silent: true });

        expect(state.release.status).toBe("available");
        expect(state.release.latest?.version).toBe("0.4.0");
        expect(state.release.error).toBeNull();
    });

    it("refuses an update while a sync owns the deck", async () => {
        const { service, device, lock, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        lock.beginSync();

        const state = await service.update();

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.Busy },
        });
        expect(state.error?.message).toContain("sync");
        expect(releaseSource.downloadCalls).toBe(0);
        expect(usb.calls).toHaveLength(0);

        lock.endSync();
    });

    it("refuses an update while a file transfer is open", async () => {
        const { service, device, lock, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        lock.beginTransfer();

        const state = await service.update();

        expect(state.error).toMatchObject({ code: FirmwareErrorCodes.Busy });
        expect(state.error?.message).toContain("file is being sent");
        expect(releaseSource.downloadCalls).toBe(0);
        expect(usb.calls).toHaveLength(0);

        lock.endTransfer();
    });

    it("releases the deck after an update succeeds, fails or is cancelled", async () => {
        const succeeded = make();
        succeeded.device.version = "0.3.0";
        await succeeded.service.checkForUpdate();
        succeeded.flasher.onFlash = () => {
            succeeded.device.version = "0.4.0";
        };
        await succeeded.service.update();
        expect(succeeded.lock.busy).toBe(false);

        const failed = make();
        failed.device.version = "0.3.0";
        await failed.service.checkForUpdate();
        failed.releaseSource.latestError = null;
        failed.releaseSource.downloadError = new ReleaseSourceError("offline", "offline");
        await failed.service.update();
        expect(failed.lock.busy).toBe(false);

        const cancelled = make();
        cancelled.device.version = "0.3.0";
        await cancelled.service.checkForUpdate();
        cancelled.releaseSource.deferDownload = true;
        const running = cancelled.service.update();
        await vi.waitFor(() => expect(cancelled.service.state().phase).toBe("downloading"));
        await cancelled.service.cancel();
        await running;
        expect(cancelled.lock.busy).toBe(false);
    });

    it("downloads, verifies, flashes and removes the staged release", async () => {
        const { service, device, flasher, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        flasher.onFlash = () => {
            device.version = "0.4.0";
        };

        const state = await service.update();

        expect(state).toMatchObject({
            phase: "done",
            installedVersion: "0.4.0",
            image: null,
            error: null,
            release: { status: "up-to-date" },
        });
        expect(releaseSource.downloadCalls).toBe(1);
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(flasher.calls[0]).toMatchObject({ address: APP_SLOT_ADDRESS, size: 4096 });
        expect(releaseSource.removed).toEqual([STAGED]);
    });

    it("offers nothing on a second check after the update", async () => {
        const { service, device, flasher } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        flasher.onFlash = () => {
            device.version = "0.4.0";
        };
        await service.update();

        const checked = await service.checkForUpdate();
        const again = await service.update();

        expect(checked.release.status).toBe("up-to-date");
        expect(again.error).toMatchObject({ code: FirmwareErrorCodes.NoUpdate });
    });

    it("refuses an update that was never offered", async () => {
        const { service, flasher } = make();

        const state = await service.update();

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.NoUpdate });
        expect(flasher.calls).toHaveLength(0);
    });

    it("re-reads the deck before flashing and stops when it is current", async () => {
        const { service, device, flasher, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        device.version = "0.4.0";

        const state = await service.update();

        expect(state.release.status).toBe("up-to-date");
        expect(releaseSource.downloadCalls).toBe(0);
        expect(flasher.calls).toHaveLength(0);
    });

    it("reports a damaged download without touching the deck", async () => {
        const { service, device, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        releaseSource.downloadError = new ReleaseSourceError("bad sha", "checksum");

        const state = await service.update();

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.Checksum });
        expect(state.release.status).toBe("available");
        expect(usb.calls).toHaveLength(0);
        expect(releaseSource.removed).toEqual([]);
    });

    it("removes the staged release when the write fails", async () => {
        const { service, device, flasher, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        flasher.failOnce = new Error("Resource busy");

        const state = await service.update();

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.PortBusy });
        expect(state.release.status).toBe("available");
        expect(releaseSource.removed).toEqual([STAGED]);
    });

    it("removes a download cancelled before the handoff", async () => {
        const { service, device, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        releaseSource.deferDownload = true;

        const running = service.update();
        await vi.waitFor(() => expect(service.state().phase).toBe("downloading"));
        await service.cancel();
        await running;

        expect(usb.calls).toHaveLength(0);
        expect(releaseSource.downloadCalls).toBe(1);
        expect(releaseSource.removed).toEqual([]);
        expect(service.state()).toMatchObject({
            phase: "idle",
            release: { status: "available" },
        });
    });

    it("reports a deck that comes back on the wrong version", async () => {
        const { service, device, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();

        const state = await service.update();

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.VersionMismatch });
        expect(state!.error?.message).toContain("0.3.0");
        expect(state!.error?.message).toContain("0.4.0");
        expect(state.release.status).toBe("available");
        expect(releaseSource.removed).toEqual([STAGED]);
    });

    it("retries a failed release write without downloading or handing off again", async () => {
        const { service, device, flasher, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        flasher.failOnce = new Error("Resource busy");

        const failed = await service.update();

        expect(failed.error).toMatchObject({
            code: FirmwareErrorCodes.PortBusy,
            retryable: true,
        });
        expect(failed.release.status).toBe("available");
        expect(releaseSource.removed).toEqual([STAGED]);
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);

        flasher.onFlash = () => {
            device.version = "0.4.0";
        };
        const retried = await service.retry();

        expect(retried).toMatchObject({
            phase: "done",
            installedVersion: "0.4.0",
            error: null,
            release: { status: "up-to-date" },
        });
        expect(releaseSource.downloadCalls).toBe(1);
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(flasher.calls).toHaveLength(2);
    });

    it("reports a deck that could not be read before the update", async () => {
        const { service, device, flasher } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        device.fail = true;

        const state = await service.update();

        expect(state!.error).toMatchObject({ code: FirmwareErrorCodes.NotConnected });
        expect(state!.error?.message).toContain("Replug it");
        expect(flasher.calls).toHaveLength(0);
    });

    it("cancels an update while the deck is re-read before the download", async () => {
        const { service, device, usb, releaseSource } = make();
        device.version = "0.3.0";
        await service.checkForUpdate();
        device.deferInfo = true;

        const updating = service.update();
        await vi.waitFor(() => expect(device.calls).toBe(2));
        await service.cancel();
        device.finish();
        const state = await updating;

        expect(state).toMatchObject({
            phase: "idle",
            error: null,
            release: { status: "available" },
        });
        expect(releaseSource.downloadCalls).toBe(0);
        expect(usb.calls).toHaveLength(0);
    });
});
