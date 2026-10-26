// ---------------------------------------------------------------------------
// A Web Serial shaped adapter over `serialport`, so esptool-js can drive a
// native serial port from the main process.
//
// esptool-js is written against the browser's Web Serial API (`open`,
// `readable`, `writable`, `setSignals`, `getInfo`). This class presents the
// small subset it uses and owns the Node streams underneath.
// ---------------------------------------------------------------------------

import { SerialPort as NodeSerialPort } from "serialport";
import type { SerialPortInfoLike } from "./PortFingerprint";

export interface WebSerialOpenOptions {
    baudRate?: number;
}

export interface WebSerialSignals {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
    break?: boolean;
}

/** List serial ports in a shape the ROM locator can compare. */
export async function listSerialPorts(): Promise<SerialPortInfoLike[]> {
    const ports = await NodeSerialPort.list();
    return ports.map((port) => ({
        path: port.path,
        serialNumber: port.serialNumber,
        locationId: port.locationId,
    }));
}

type PortFactory = (options: { path: string; baudRate: number; autoOpen: false }) => NodeSerialPort;

const createNodePort: PortFactory = (options) => new NodeSerialPort(options);

/**
 * Minimal Web Serial port implementation backed by `serialport`.
 *
 * The stream is created on `open`, matching Web Serial, and cancelled on
 * `close` so esptool-js's reader unblocks before the native handle goes.
 */
export class SerialPortAdapter {
    readonly path: string;
    readable: ReadableStream<Uint8Array> | null = null;
    writable: WritableStream<Uint8Array> | null = null;

    private readonly portFactory: PortFactory;
    private port: NodeSerialPort | null = null;
    private readController: ReadableStreamDefaultController<Uint8Array> | null = null;
    private closed = false;

    constructor(path: string, portFactory: PortFactory = createNodePort) {
        this.path = path;
        this.portFactory = portFactory;
    }

    getInfo(): { usbVendorId?: number; usbProductId?: number } {
        return {};
    }

    async open(options: WebSerialOpenOptions = {}): Promise<void> {
        if (this.port !== null) {
            return;
        }
        const port = this.portFactory({
            path: this.path,
            baudRate: options.baudRate ?? 115200,
            autoOpen: false,
        });
        await new Promise<void>((resolve, reject) => {
            port.open((error) => (error ? reject(error) : resolve()));
        });
        this.port = port;
        this.closed = false;

        port.on("data", (chunk: Buffer) => this.push(chunk));
        port.on("error", (error: Error) => this.fail(error));

        this.readable = new ReadableStream<Uint8Array>({
            start: (controller) => {
                this.readController = controller;
            },
            cancel: () => {
                this.readController = null;
            },
        });
        this.writable = new WritableStream<Uint8Array>({
            write: (chunk) => this.write(chunk),
        });
    }

    async close(): Promise<void> {
        this.closed = true;
        const controller = this.readController;
        this.readController = null;
        try {
            controller?.close();
        } catch {
            // The stream may already be errored or cancelled.
        }
        this.readable = null;
        this.writable = null;
        const port = this.port;
        this.port = null;
        if (port !== null) {
            await new Promise<void>((resolve) => {
                port.close(() => resolve());
            });
        }
    }

    async setSignals(signals: WebSerialSignals = {}): Promise<void> {
        const port = this.port;
        if (port === null) {
            throw new Error("Serial port is not open");
        }
        await new Promise<void>((resolve, reject) => {
            port.set(
                {
                    dtr: signals.dataTerminalReady,
                    rts: signals.requestToSend,
                    brk: signals.break,
                },
                (error) => (error ? reject(error) : resolve()),
            );
        });
    }

    /** In-place baud change; avoids the reopen that a native USB reset dislikes. */
    async setBaudRate(baudRate: number): Promise<void> {
        const port = this.port;
        if (port === null) {
            throw new Error("Serial port is not open");
        }
        await new Promise<void>((resolve, reject) => {
            port.update({ baudRate }, (error) => (error ? reject(error) : resolve()));
        });
    }

    private push(chunk: Buffer): void {
        if (this.closed || this.readController === null) {
            return;
        }
        this.readController.enqueue(new Uint8Array(chunk));
    }

    private fail(error: Error): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        try {
            this.readController?.error(error);
        } catch {
            // The reader may already be gone.
        }
        this.readController = null;
    }

    private write(chunk: Uint8Array): Promise<void> {
        const port = this.port;
        if (port === null) {
            return Promise.reject(new Error("Serial port is not open"));
        }
        return new Promise<void>((resolve, reject) => {
            port.write(Buffer.from(chunk), (writeError) => {
                if (writeError) {
                    reject(writeError);
                    return;
                }
                port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
            });
        });
    }
}
