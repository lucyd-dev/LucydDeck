import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { SerialPortAdapter } from "./SerialPortAdapter";

class FakePort extends EventEmitter {
    readonly written: Buffer[] = [];
    opened = false;
    closed = false;
    signals: unknown = null;
    baudRate: number | null = null;

    open(callback: (error: Error | null) => void): void {
        this.opened = true;
        callback(null);
    }

    close(callback: () => void): void {
        this.closed = true;
        callback();
    }

    write(data: Buffer, callback: (error: Error | null) => void): void {
        this.written.push(data);
        callback(null);
    }

    drain(callback: (error: Error | null) => void): void {
        callback(null);
    }

    set(options: unknown, callback: (error: Error | null) => void): void {
        this.signals = options;
        callback(null);
    }

    update(options: { baudRate: number }, callback: (error: Error | null) => void): void {
        this.baudRate = options.baudRate;
        callback(null);
    }
}

function makeAdapter() {
    const port = new FakePort();
    const adapter = new SerialPortAdapter(
        "/dev/ttyACM1",
        () => port as unknown as import("serialport").SerialPort,
    );
    return { port, adapter };
}

describe("SerialPortAdapter", () => {
    it("opens the native port and forwards read data", async () => {
        const { port, adapter } = makeAdapter();
        await adapter.open({ baudRate: 115200 });
        expect(port.opened).toBe(true);

        const reader = adapter.readable!.getReader();
        port.emit("data", Buffer.from([1, 2, 3]));
        await expect(reader.read()).resolves.toEqual({
            value: new Uint8Array([1, 2, 3]),
            done: false,
        });
        reader.releaseLock();
        await adapter.close();
    });

    it("writes through the port and drains", async () => {
        const { port, adapter } = makeAdapter();
        await adapter.open();

        const writer = adapter.writable!.getWriter();
        await writer.write(new Uint8Array([4, 5]));
        writer.releaseLock();

        expect(port.written).toEqual([Buffer.from([4, 5])]);
        await adapter.close();
    });

    it("maps control signals and in-place baud changes", async () => {
        const { port, adapter } = makeAdapter();
        await adapter.open();

        await adapter.setSignals({ dataTerminalReady: true, requestToSend: false });
        await adapter.setBaudRate(460800);

        expect(port.signals).toEqual({ dtr: true, rts: false, brk: undefined });
        expect(port.baudRate).toBe(460800);
        await adapter.close();
    });

    it("closes a pending reader with the port", async () => {
        const { port, adapter } = makeAdapter();
        await adapter.open();
        const reader = adapter.readable!.getReader();
        const pending = reader.read();

        await adapter.close();

        await expect(pending).resolves.toEqual({ value: undefined, done: true });
        expect(port.closed).toBe(true);
        reader.releaseLock();
    });
});
