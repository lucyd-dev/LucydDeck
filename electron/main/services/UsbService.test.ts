import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEVICE_PIDS,
    DEVICE_USAGE,
    DEVICE_USAGE_PAGE,
    DEVICE_VID,
    DeviceResponse,
    ErrorCode,
    HostCommand,
} from "@shared/protocol";
import { buildFrame, deviceSequence, parseFrame } from "./usb/Framer";
import type { HidConnection, HidDeviceDescriptor, HidTransport } from "./usb/transport";
import { UsbError, UsbErrorCodes, UsbService } from "./UsbService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

class FakeConnection implements HidConnection {
    readonly writes: Uint8Array[] = [];
    closed = false;
    private dataListeners: Array<(report: Uint8Array) => void> = [];
    private errorListeners: Array<(error: Error) => void> = [];

    write(report: Uint8Array): Promise<void> {
        this.writes.push(report);
        // The service clears the device sequence baseline on connect. Answer it
        // here so tests only drive the commands they are about.
        if (parseFrame(report).opcode === HostCommand.ResetSequence) {
            queueMicrotask(() => this.respond(DeviceResponse.Ack));
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

    emitError(error: Error): void {
        for (const listener of this.errorListeners) {
            listener(error);
        }
    }

    /** Respond to the last host write with one device frame. */
    respond(
        opcode: DeviceResponse,
        payload: Uint8Array = new Uint8Array(),
        more = false,
        index = 0,
    ): void {
        this.emit(buildFrame(opcode, deviceSequence(index, more), payload));
    }

    lastHostFrame() {
        const report = this.writes.at(-1);
        if (!report) {
            throw new Error("no host writes");
        }
        return parseFrame(report);
    }
}

class FakeTransport implements HidTransport {
    devices: HidDeviceDescriptor[] = [
        {
            vendorId: DEVICE_VID,
            productId: DEVICE_PIDS[0],
            usagePage: DEVICE_USAGE_PAGE,
            usage: DEVICE_USAGE,
            path: "fake://lucyddeck",
            product: "LucydDeck",
        },
    ];
    readonly connection = new FakeConnection();
    list = vi.fn(async () => this.devices);
    open = vi.fn(async () => this.connection);
}

function makeService(options: Partial<ConstructorParameters<typeof UsbService>[0]> = {}) {
    const transport = new FakeTransport();
    const usb = new UsbService({ transport, autoReconnect: false, ...options });
    return { transport, usb, connection: transport.connection };
}

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

describe("UsbService.connect", () => {
    it("discovers, opens, and reports connected status", async () => {
        const { transport, usb } = makeService();
        const events: string[] = [];
        usb.onEvent((event) => events.push(event.type));

        await usb.connect();

        expect(transport.list).toHaveBeenCalledOnce();
        expect(transport.open).toHaveBeenCalledWith("fake://lucyddeck");
        expect(usb.connected).toBe(true);
        expect(usb.status().state).toBe("connected");
        expect(events).toContain("status");
    });

    it("shows the deck name for the generic Windows HID product", async () => {
        const { transport, usb } = makeService();
        transport.devices = [
            {
                ...transport.devices[0],
                productId: DEVICE_PIDS[1],
                product: "TinyUSB HID",
            },
        ];

        await usb.connect();

        expect(usb.status().state).toBe("connected");
        expect(usb.status().label).toBe("LucydDeck (0x303a:0x1001)");
    });

    it("reports a typed error when no device matches", async () => {
        const { transport, usb } = makeService();
        transport.devices = [{ vendorId: 0x046d, productId: 0xc52b }];
        await expect(usb.connect()).rejects.toMatchObject({ code: UsbErrorCodes.NoDevice });
        expect(usb.status().state).toBe("disconnected");
    });

    it("drops an in-flight connect that disconnect supersedes", async () => {
        const transport = new FakeTransport();
        let resolveList!: (devices: HidDeviceDescriptor[]) => void;
        const listPromise = new Promise<HidDeviceDescriptor[]>((resolve) => {
            resolveList = resolve;
        });
        transport.list = vi.fn(() => listPromise);
        const usb = new UsbService({ transport, autoReconnect: false });

        const connecting = usb.connect();
        await usb.disconnect();
        resolveList(transport.devices);
        await expect(connecting).rejects.toMatchObject({ code: UsbErrorCodes.NotConnected });
        expect(usb.connected).toBe(false);
        expect(transport.open).not.toHaveBeenCalled();
    });
});

describe("UsbService command sequencing", () => {
    it("opens with a sequence reset, then counts up from there", async () => {
        const { usb, connection } = makeService();
        await usb.connect();

        const handshake = connection.lastHostFrame();
        expect(handshake.opcode).toBe(HostCommand.ResetSequence);
        expect(handshake.seq).toBe(1);

        const first = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        expect(connection.lastHostFrame().seq).toBe(2);
        connection.respond(DeviceResponse.Ack);
        await first;

        const second = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        expect(connection.lastHostFrame().seq).toBe(3);
        connection.respond(DeviceResponse.Ack);
        await second;
    });

    it("keeps the host sequence across a reconnect", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const first = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        connection.respond(DeviceResponse.Ack);
        await first;

        await usb.disconnect();
        await usb.connect();

        // Opening the HID handle again does not re-enumerate the device. The
        // reconnect's reset frame clears the deck baseline; the ping after it
        // continues the host counter.
        expect(connection.lastHostFrame().opcode).toBe(HostCommand.ResetSequence);
        const next = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        expect(connection.lastHostFrame().seq).toBe(4);
        connection.respond(DeviceResponse.Ack);
        await next;
    });

    it("serializes commands and only writes one at a time", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const afterConnect = connection.writes.length;

        const first = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        const second = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        expect(connection.writes).toHaveLength(afterConnect + 1);

        connection.respond(DeviceResponse.Ack);
        await first;
        expect(connection.writes).toHaveLength(afterConnect + 2);
        connection.respond(DeviceResponse.Ack);
        await second;
        expect(connection.writes).toHaveLength(afterConnect + 2);
    });
});

describe("UsbService stream reassembly", () => {
    it("reassembles an N-frame M-bit response and strips padding", async () => {
        const { usb, connection } = makeService();
        await usb.connect();

        const promise = usb.command(
            HostCommand.GetProfilesList,
            new Uint8Array(),
            DeviceResponse.ProfilesList,
        );
        connection.respond(DeviceResponse.ProfilesList, text("part0"), true, 0);
        connection.respond(DeviceResponse.ProfilesList, text("part1"), true, 1);
        connection.respond(
            DeviceResponse.ProfilesList,
            Uint8Array.from([...text("part2"), 0x00, 0x00]),
            false,
            2,
        );

        const payload = await promise;
        expect(new TextDecoder().decode(payload)).toBe("part0part1part2");
    });

    it("ignores interleaved 0xA0 events while waiting", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const actions: string[] = [];
        usb.onEvent((event) => {
            if (event.type === "action-triggered") {
                actions.push(event.action);
            }
        });

        const promise = usb.command(
            HostCommand.GetDeviceInfo,
            new Uint8Array(),
            DeviceResponse.DeviceInfo,
        );
        connection.respond(DeviceResponse.ActionTriggered, text("obs:scene:Scene 1"));
        connection.respond(DeviceResponse.DeviceInfo, text('{"board":"X"}'));

        expect(new TextDecoder().decode(await promise)).toBe('{"board":"X"}');
        expect(actions).toEqual(["obs:scene:Scene 1"]);
    });

    it("reassembles a multi-frame 0xA0 action stream", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const actions: string[] = [];
        usb.onEvent((event) => {
            if (event.type === "action-triggered") {
                actions.push(event.action);
            }
        });

        const longAction = `CMD:${"a".repeat(80)}`;
        connection.respond(DeviceResponse.ActionTriggered, text(longAction.slice(0, 60)), true, 0);
        connection.respond(DeviceResponse.ActionTriggered, text(longAction.slice(60)), false, 1);

        expect(actions).toEqual([longAction]);
    });
});

describe("UsbService failures", () => {
    it("rejects on ACK timeout", async () => {
        const { usb } = makeService({ ackTimeoutMs: 5, streamTimeoutMs: 5 });
        await usb.connect();
        await expect(
            usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack),
        ).rejects.toMatchObject({ code: UsbErrorCodes.Timeout });
    });

    it("surfaces RESP_ERROR with the firmware code", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const promise = usb.command(HostCommand.FileEnd, new Uint8Array(), DeviceResponse.Ack);
        connection.respond(DeviceResponse.Error, Uint8Array.from([ErrorCode.Crc]));
        await expect(promise).rejects.toBeInstanceOf(UsbError);
        const error = await promise.then(
            () => null,
            (rejection: UsbError) => rejection,
        );
        expect(error?.firmwareCode).toBe(ErrorCode.Crc);
        expect(error?.code).toBe("ERR_CRC");
    });

    it("maps ERR_FILE_NOT_FOUND from a delete command", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const promise = usb.command(HostCommand.PageDelete, new Uint8Array(), DeviceResponse.Ack);
        connection.respond(DeviceResponse.Error, Uint8Array.from([ErrorCode.FileNotFound]));
        const error = await promise.then(
            () => null,
            (rejection: UsbError) => rejection,
        );
        expect(error?.firmwareCode).toBe(ErrorCode.FileNotFound);
        expect(error?.code).toBe("ERR_FILE_NOT_FOUND");
    });

    it("rejects pending and queued commands on transport error", async () => {
        const { usb, connection } = makeService();
        await usb.connect();
        const first = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        const second = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        connection.emitError(new Error("device gone"));
        await expect(first).rejects.toMatchObject({ code: UsbErrorCodes.Transport });
        await expect(second).rejects.toMatchObject({ code: UsbErrorCodes.Transport });
    });

    it("rejects a response that exceeds the reassembly cap", async () => {
        const { usb, connection } = makeService({ maxResponseBytes: 6 });
        await usb.connect();
        const promise = usb.command(
            HostCommand.GetProfilesList,
            new Uint8Array(),
            DeviceResponse.ProfilesList,
        );
        connection.respond(DeviceResponse.ProfilesList, text("[PHONE]"), true, 0);
        connection.respond(DeviceResponse.ProfilesList, text("x"), false, 1);
        await expect(promise).rejects.toMatchObject({ code: UsbErrorCodes.UnexpectedResponse });
    });

    it("rejects pending commands on disconnect", async () => {
        const { usb } = makeService();
        await usb.connect();
        const pending = usb.command(HostCommand.Ping, new Uint8Array(), DeviceResponse.Ack);
        await usb.disconnect();
        await expect(pending).rejects.toMatchObject({ code: UsbErrorCodes.NotConnected });
        expect(usb.connected).toBe(false);
    });
});

describe("UsbService.resumeScanning", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps scanning after a disconnected attempt and connects when the deck appears", async () => {
        vi.useFakeTimers();
        const { transport, usb } = makeService({
            autoReconnect: true,
            reconnectBackoffMs: [10],
        });
        const deck = transport.devices[0]!;
        transport.devices = [];

        await usb.disconnect();
        usb.resumeScanning();

        await vi.advanceTimersByTimeAsync(10);
        expect(usb.connected).toBe(false);

        transport.devices = [deck];
        await vi.advanceTimersByTimeAsync(10);

        expect(usb.connected).toBe(true);
        expect(usb.status().state).toBe("connected");
    });

    it("keeps scanning when a user connect finds no deck", async () => {
        vi.useFakeTimers();
        const { transport, usb } = makeService({
            autoReconnect: true,
            reconnectBackoffMs: [10],
        });
        const deck = transport.devices[0]!;
        transport.devices = [];

        await expect(usb.connectWithScanning()).rejects.toMatchObject({
            code: UsbErrorCodes.NoDevice,
        });
        transport.devices = [deck];
        await vi.advanceTimersByTimeAsync(10);

        expect(usb.connected).toBe(true);
    });
});
