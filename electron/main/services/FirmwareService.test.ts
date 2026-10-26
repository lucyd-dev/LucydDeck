import { describe, expect, it, vi } from "vitest";
import { APP_SLOT_ADDRESS, APP_SLOT_SIZE, FirmwareErrorCodes } from "@shared/firmware";
import type { FlashProgressPayload, FirmwareState } from "@shared/firmware";
import type { DeviceInfo } from "@shared/ipc";
import { ErrorCode, HostCommand } from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";
import { FirmwareService } from "./FirmwareService";
import type { FirmwareDeviceClient, FirmwareUsbClient } from "./FirmwareService";
import type { FirmwareFlasher, FlashImageOptions } from "./flash/EsptoolFlasher";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./flash/PortFingerprint";

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
    commandError: Error | null = null;
    disconnectCalls = 0;
    connectCalls = 0;
    connectSucceeds = true;
    hidPresentCalls = 0;
    hidPresentResults: boolean[] = [];

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
        return Promise.resolve(new Uint8Array());
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
        this.connected = true;
    }
}

class FakeDevice implements FirmwareDeviceClient {
    version = "0.4.0";
    calls = 0;
    fail = false;

    async getDeviceInfo(): Promise<DeviceInfo> {
        this.calls++;
        if (this.fail) {
            throw new Error("no device info");
        }
        return {
            firmwareVersion: this.version,
            protocolVersion: "1",
            board: "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3",
            freeSpaceKb: 2048,
        };
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
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.release = () => {
                options.onProgress(image.length, image.length);
                resolve();
            };
        });
    }

    finish(): void {
        this.release?.();
        this.release = null;
    }
}

class FakeLocator {
    port: SerialPortInfoLike | null = PORT;
    waitCalls = 0;
    readonly order: string[];

    constructor(order: string[] = []) {
        this.order = order;
    }

    fingerprint: DeckUsbFingerprint = {
        serialNumber: "806599A5038C",
        usbPath: "1-2",
        product: "LucydDeck",
    };

    fingerprintFor(): DeckUsbFingerprint {
        return this.fingerprint;
    }

    async waitFor(): Promise<SerialPortInfoLike | null> {
        this.waitCalls++;
        this.order.push("locate");
        return this.port;
    }
}

function make(overrides: { fileSize?: number; pick?: string | null; order?: string[] } = {}) {
    const order = overrides.order ?? [];
    const usb = new FakeUsb(order);
    const device = new FakeDevice();
    const flasher = new FakeFlasher();
    const locator = new FakeLocator(order);
    const states: FirmwareState[] = [];
    const progress: FlashProgressPayload[] = [];
    const fileSize = overrides.fileSize ?? 4096;
    let clock = 0;
    const service = new FirmwareService({
        usb,
        device,
        flasher,
        locator,
        pickImage: async () => (overrides.pick === undefined ? FILE : overrides.pick),
        onState: (state) => states.push(state),
        onProgress: (event) => progress.push(event),
        statFile: () => ({
            size: fileSize,
            isFile: () => true,
            isSymbolicLink: () => false,
        }),
        readFile: () => new Uint8Array(fileSize),
        sleep: async (ms) => {
            clock += ms;
        },
        now: () => {
            clock += 10;
            return clock;
        },
    });
    return { service, usb, device, flasher, locator, states, progress };
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
            "writing",
            "writing",
            "writing",
            "returning",
            "done",
        ]);
        expect(
            progress.filter((event) => event.phase === "writing").map((event) => event.percent),
        ).toEqual([0, 0, 50, 100]);
        expect(progress.find((event) => event.phase === "writing")?.message).toContain(
            "Do not unplug",
        );
        expect(progress.at(-1)).toMatchObject({ phase: "done", percent: 100 });
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
        expect(state!.error?.message).toContain("update-ready");
        expect(usb.disconnectCalls).toBe(0);
        expect(flasher.calls).toHaveLength(0);
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
        const { service, usb, flasher, locator } = make();
        locator.port = null;

        const state = await service.flashLocal({ path: FILE, confirmed: true });

        expect(state).toMatchObject({
            phase: "error",
            error: { code: FirmwareErrorCodes.PortNotFound },
        });
        expect(usb.calls).toEqual([HostCommand.EnterBootloader]);
        expect(flasher.calls).toHaveLength(0);
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
});
