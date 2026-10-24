import { describe, expect, it, vi } from "vitest";
import {
    DEVICE_PIDS,
    DEVICE_USAGE,
    DEVICE_USAGE_PAGE,
    DEVICE_VID,
    DeviceResponse,
    ErrorCode,
    HostCommand,
    SEQ_MASK,
} from "@shared/protocol";
import { buildFrame, parseFrame } from "./usb/Framer";
import type { HidConnection, HidDeviceDescriptor, HidTransport } from "./usb/transport";
import { SequenceProvider, UsbErrorCodes, UsbService } from "./UsbService";
import type { UsbServiceOptions } from "./UsbService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

function deviceFrame(opcode: DeviceResponse): Uint8Array {
    return buildFrame(opcode, 0);
}

/**
 * Behavioural twin of the firmware's `CustomHIDDevice::handlePacket` and
 * `Dispatcher` (LucydDeck-firmware, `src/usb/CustomHIDDevice.cpp`).
 *
 * The deck keeps one host-sequence baseline per USB session. It clears the
 * baseline on `ARDUINO_USB_STARTED_EVENT` / `ARDUINO_USB_RESUME_EVENT` and on
 * `CMD_RESET_SEQUENCE`. A reset frame is exempt from the strict check, never
 * becomes the baseline, and still rejects a set M-bit. Otherwise the first
 * frame after a clear may carry any value and becomes the baseline, and every
 * later frame must be exactly `previous + 1`, masked to 15 bits.
 *
 * Closing and reopening the host HID handle raises no USB event, so this object
 * deliberately outlives host connections.
 */
class FakeFirmware {
    /** False models firmware released before `CMD_RESET_SEQUENCE` existed. */
    supportsReset = true;
    /** Drop the next accepted frame silently, like a full RX queue. */
    dropNextFrame = false;

    /** Every host frame the deck received, in order. */
    readonly frames: Array<{ opcode: number; sequence: number }> = [];
    /** Sequences the deck acted on, resets included. */
    readonly accepted: number[] = [];
    /** Sequences answered with `ERR_SEQUENCE`. */
    readonly rejected: number[] = [];
    /** Sequences dropped without a reply. */
    readonly dropped: number[] = [];
    resets = 0;

    private lastSequence = 0;
    private sequenceInitialized = false;

    /** Mirrors the struct reset behind USB start/resume. */
    resetSequence(): void {
        this.lastSequence = 0;
        this.sequenceInitialized = false;
    }

    /** Put the deck one frame ahead of the host, as a lost frame would. */
    desync(): void {
        this.lastSequence = (this.lastSequence + 1) & SEQ_MASK;
        this.sequenceInitialized = true;
    }

    /** One host report in, the device reply out; `null` means no reply. */
    handle(report: Uint8Array): Uint8Array | null {
        const frame = parseFrame(report);
        const sequence = frame.seq & SEQ_MASK;
        const isReset = frame.opcode === HostCommand.ResetSequence;
        const exempt = isReset && this.supportsReset;

        this.frames.push({ opcode: frame.opcode, sequence });

        if (frame.mBit) {
            return this.reject(sequence);
        }

        const expected = (this.lastSequence + 1) & SEQ_MASK;
        if (!exempt && this.sequenceInitialized && sequence !== expected) {
            return this.reject(sequence);
        }

        if (this.dropNextFrame) {
            this.dropNextFrame = false;
            this.dropped.push(sequence);
            return null;
        }

        if (exempt) {
            // The reset clears the baseline and never becomes it.
            this.resetSequence();
            this.resets += 1;
            this.accepted.push(sequence);
            return deviceFrame(DeviceResponse.Ack);
        }

        // Accepted frames advance the baseline, unknown opcodes included.
        this.lastSequence = sequence;
        this.sequenceInitialized = true;
        this.accepted.push(sequence);

        if (isReset) {
            return buildFrame(DeviceResponse.Error, 0, Uint8Array.from([ErrorCode.UnknownCommand]));
        }
        return deviceFrame(DeviceResponse.Ack);
    }

    private reject(sequence: number): Uint8Array {
        this.rejected.push(sequence);
        return buildFrame(DeviceResponse.Error, 0, Uint8Array.from([ErrorCode.Sequence]));
    }
}

class FakeFirmwareConnection implements HidConnection {
    closed = false;
    private dataListeners: Array<(report: Uint8Array) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];

    constructor(private readonly firmware: FakeFirmware) {}

    write(report: Uint8Array): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error("device handle closed"));
        }
        const reply = this.firmware.handle(report);
        // Device replies arrive asynchronously, like a real HID read.
        if (reply !== null) {
            queueMicrotask(() => this.emit(reply));
        }
        return Promise.resolve();
    }

    close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
    }

    onData(listener: (report: Uint8Array) => void): void {
        this.dataListeners.push(listener);
    }

    onError(listener: (error: Error) => void): void {
        this.errorListeners.push(listener);
    }

    emit(report: Uint8Array): void {
        for (const listener of this.dataListeners) {
            listener(report);
        }
    }

    /** Simulate an unplug: the OS reports the loss and the deck reboots. */
    fail(error: Error): void {
        this.closed = true;
        this.firmware.resetSequence();
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }
}

class FakeFirmwareTransport implements HidTransport {
    readonly firmware = new FakeFirmware();
    readonly connections: FakeFirmwareConnection[] = [];
    readonly devices: HidDeviceDescriptor[] = [
        {
            vendorId: DEVICE_VID,
            productId: DEVICE_PIDS[0],
            usagePage: DEVICE_USAGE_PAGE,
            usage: DEVICE_USAGE,
            path: "fake://lucyddeck",
            product: "LucydDeck",
        },
    ];

    list = vi.fn(async () => this.devices);
    open = vi.fn(async () => {
        const connection = new FakeFirmwareConnection(this.firmware);
        this.connections.push(connection);
        return connection;
    });
}

function makeDeck(options: Partial<UsbServiceOptions> = {}) {
    const transport = new FakeFirmwareTransport();
    const usb = new UsbService({ transport, autoReconnect: false, ...options });
    return { transport, firmware: transport.firmware, usb };
}

async function ping(usb: UsbService): Promise<void> {
    await usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
}

function pings(firmware: FakeFirmware): number {
    return firmware.frames.filter((frame) => frame.opcode === HostCommand.Ping).length;
}

describe("host sequence across connections", () => {
    it("clears the deck baseline on connect", async () => {
        const { firmware, usb } = makeDeck();
        await usb.connect();

        expect(firmware.resets).toBe(1);
        expect(firmware.rejected).toEqual([]);
    });

    it("keeps counting after a disconnect and reconnect", async () => {
        const { firmware, usb } = makeDeck();
        await usb.connect();
        await ping(usb);
        await ping(usb);
        await ping(usb);

        // Closing and reopening the HID handle does not re-enumerate the device.
        await usb.disconnect();
        await usb.connect();

        await ping(usb);
        await ping(usb);

        expect(firmware.rejected).toEqual([]);
        expect(firmware.accepted).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("does not wedge the first reconnect command with ERR_SEQUENCE", async () => {
        const { usb } = makeDeck();
        await usb.connect();
        await ping(usb);
        await usb.disconnect();
        await usb.connect();

        await expect(
            usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack),
        ).resolves.toBeInstanceOf(Uint8Array);
    });

    it("accepts any baseline after the device re-enumerates", async () => {
        const { firmware, transport, usb } = makeDeck();
        await usb.connect();
        await ping(usb);
        await ping(usb);

        // Unplug: the host sees a transport error and the deck reboots, which
        // clears its baseline. Any host value is then legal.
        transport.connections.at(-1)?.fail(new Error("device unplugged"));
        await usb.connect();

        await ping(usb);

        expect(firmware.rejected).toEqual([]);
        expect(firmware.accepted).toEqual([1, 2, 3, 4, 5]);
    });

    it("survives several reconnect cycles without repeating a sequence", async () => {
        const { firmware, usb } = makeDeck();
        for (let cycle = 0; cycle < 3; cycle++) {
            await usb.connect();
            await ping(usb);
            await usb.disconnect();
        }

        expect(firmware.rejected).toEqual([]);
        expect(firmware.accepted).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("clears a stale baseline left by a restarted host", async () => {
        const transport = new FakeFirmwareTransport();
        const first = new UsbService({ transport, autoReconnect: false });
        await first.connect();
        await ping(first);
        await ping(first);
        await first.disconnect();

        // A new host process starts its counter again, the deck does not reboot.
        const second = new UsbService({ transport, autoReconnect: false });
        await second.connect();
        await ping(second);

        expect(transport.firmware.rejected).toEqual([]);
        expect(transport.firmware.resets).toBe(2);
    });

    it("works with firmware released before the reset command", async () => {
        const { firmware, usb } = makeDeck();
        firmware.supportsReset = false;

        await usb.connect();
        await expect(ping(usb)).resolves.toBeUndefined();

        // The reset frame was accepted but answered ERR_UNKNOWN_COMMAND, which
        // connect swallows; the ping that follows still lines up.
        expect(firmware.resets).toBe(0);
        expect(firmware.rejected).toEqual([]);
    });
});

describe("host sequence recovery", () => {
    it("resets and retries once when the deck loses a frame", async () => {
        const { firmware, usb } = makeDeck({ ackTimeoutMs: 10 });
        await usb.connect();
        await ping(usb);

        firmware.dropNextFrame = true;
        await expect(
            usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack),
        ).rejects.toMatchObject({ code: UsbErrorCodes.Timeout });

        // The next frame is out of step; the service clears the deck baseline
        // and retries it instead of surfacing ERR_SEQUENCE.
        await expect(ping(usb)).resolves.toBeUndefined();

        expect(firmware.dropped).toHaveLength(1);
        expect(firmware.rejected).toHaveLength(1);
        expect(firmware.resets).toBe(2);
    });

    it("surfaces ERR_SEQUENCE when the deck cannot reset", async () => {
        const { firmware, usb } = makeDeck();
        firmware.supportsReset = false;
        await usb.connect();

        firmware.desync();

        await expect(
            usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack),
        ).rejects.toMatchObject({ firmwareCode: ErrorCode.Sequence });
        // One attempt only: the failed reset does not loop the ping.
        expect(pings(firmware)).toBe(1);
    });
});

describe("SequenceProvider", () => {
    it("starts at 1 and rises by one", () => {
        const provider = new SequenceProvider();
        expect([provider.next(), provider.next(), provider.next()]).toEqual([1, 2, 3]);
    });

    it("wraps through 0x7FFF to 0 and keeps counting", () => {
        const provider = new SequenceProvider(SEQ_MASK - 1);
        expect([provider.next(), provider.next(), provider.next(), provider.next()]).toEqual([
            0x7fff, 0, 1, 2,
        ]);
    });

    it("agrees with the firmware's masked wrap rule", () => {
        const firmware = new FakeFirmware();
        firmware.handle(buildFrame(HostCommand.Ping, SEQ_MASK));
        firmware.handle(buildFrame(HostCommand.Ping, 0));

        expect(firmware.rejected).toEqual([]);
        expect(firmware.accepted).toEqual([SEQ_MASK, 0]);
    });
});
