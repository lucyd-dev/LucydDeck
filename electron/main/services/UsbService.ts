import log from "electron-log/main";
import { DeviceState } from "@shared/ipc";
import type { DeviceStatus, UsbEventPayload } from "@shared/ipc";
import {
    ACK_TIMEOUT_MS,
    DEVICE_PIDS,
    DeviceResponse,
    ErrorCode,
    HostCommand,
    MAX_RESPONSE_BYTES,
    SEQ_MASK,
    STREAM_TIMEOUT_MS,
    describeErrorCode,
    findUsbDevice,
} from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";
import { buildFrame, parseFrame, trimTrailingZeros } from "./usb/Framer";
import type { ParsedFrame } from "./usb/Framer";
import { nodeHidTransport } from "./usb/transport";
import type { HidConnection, HidTransport } from "./usb/transport";

/** Stable, serializable error codes surfaced to IPC callers. */
export const UsbErrorCodes = {
    NoDevice: "USB_NO_DEVICE",
    NotConnected: "USB_NOT_CONNECTED",
    Timeout: "USB_TIMEOUT",
    UnexpectedResponse: "USB_UNEXPECTED_RESPONSE",
    Transport: "USB_TRANSPORT",
} as const;

/** Error thrown by `UsbService.command` and friends. */
export class UsbError extends Error {
    readonly code: string;
    /** Firmware `RESP_ERROR` code, when the failure came from the device. */
    readonly firmwareCode?: ErrorCode;

    constructor(message: string, code: string, firmwareCode?: ErrorCode) {
        super(message);
        this.name = "UsbError";
        this.code = code;
        this.firmwareCode = firmwareCode;
    }
}

interface QueuedCommand {
    opcode: HostCommand;
    payload: Uint8Array;
    expect: DeviceResponse;
    resolve: (payload: Uint8Array) => void;
    reject: (error: Error) => void;
}

interface PendingCommand extends QueuedCommand {
    seq: number;
    chunks: Uint8Array[];
    bytes: number;
    timer: ReturnType<typeof setTimeout> | null;
}

/** Host→device sequence provider: resets on connect, monotonic `prev+1`, M=0. */
export class SequenceProvider {
    private current = 0;

    reset(): void {
        this.current = 0;
    }

    /** Next host sequence; the first frame after a reset is `1`. */
    next(): number {
        this.current = (this.current + 1) & SEQ_MASK;
        return this.current;
    }
}

export interface UsbServiceOptions {
    transport?: HidTransport;
    /** Accepted product IDs (both documented values by default). */
    pids?: readonly number[];
    ackTimeoutMs?: number;
    streamTimeoutMs?: number;
    /** Cap for a reassembled response payload (defensive). */
    maxResponseBytes?: number;
    /** Poll/reconnect after a dropped device. Disable in unit tests. */
    autoReconnect?: boolean;
    reconnectBackoffMs?: number[];
}

const OPCODE_NAMES: Record<number, string> = Object.fromEntries(
    Object.entries(HostCommand)
        .filter(([, value]) => typeof value === "number")
        .map(([name, value]) => [value as number, name]),
);

function opcodeName(opcode: number): string {
    return OPCODE_NAMES[opcode] ?? `0x${opcode.toString(16).padStart(2, "0")}`;
}

function describeDevice(device: HidDescriptorLike, pid: number): string {
    const name = device.product ?? "LucydDeck";
    return `${name} (0x${device.vendorId.toString(16)}:0x${pid.toString(16)})`;
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

/**
 * Canonical USB/HID engine: discovery, connection lifecycle, sequence handling,
 * single-outstanding-request command queue, M-bit stream reassembly, `0xA0`
 * event feed, timeout handling, and reconnect polling.
 */
export class UsbService {
    private readonly transport: HidTransport;
    private readonly pids: readonly number[];
    private readonly ackTimeoutMs: number;
    private readonly streamTimeoutMs: number;
    private readonly maxResponseBytes: number;
    private readonly autoReconnect: boolean;
    private readonly backoffMs: number[];

    private connection: HidConnection | null = null;
    private readonly sequence = new SequenceProvider();
    private pending: PendingCommand | null = null;
    private readonly queue: QueuedCommand[] = [];
    private readonly listeners = new Set<(event: UsbEventPayload) => void>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private backoffIndex = 0;
    private manualStop = false;
    /** Incremented on disconnect to invalidate an in-flight `connect()`. */
    private connectToken = 0;
    /** Independent M-bit accumulator for unsolicited `0xA0` action streams. */
    private actionChunks: Uint8Array[] = [];
    private actionTimer: ReturnType<typeof setTimeout> | null = null;

    private statusValue: DeviceStatus = {
        state: DeviceState.Disconnected,
        label: "No device connected",
    };

    constructor(options: UsbServiceOptions = {}) {
        this.transport = options.transport ?? nodeHidTransport;
        this.pids = options.pids ?? DEVICE_PIDS;
        this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
        this.streamTimeoutMs = options.streamTimeoutMs ?? STREAM_TIMEOUT_MS;
        this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
        this.autoReconnect = options.autoReconnect ?? true;
        this.backoffMs = options.reconnectBackoffMs ?? [1000, 2000, 3000, 5000];
    }

    // --- Events / status -------------------------------------------------

    /** Subscribe to status + device-pushed events. Returns an unsubscribe fn. */
    onEvent(listener: (event: UsbEventPayload) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    status(): DeviceStatus {
        return { ...this.statusValue };
    }

    get connected(): boolean {
        return this.connection !== null;
    }

    private emit(event: UsbEventPayload): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (error) {
                log.warn(`[usb] event listener failed: ${String(error)}`);
            }
        }
    }

    private setStatus(status: DeviceStatus): void {
        this.statusValue = { ...status };
        this.emit({ type: "status", status: { ...status } });
    }

    // --- Connection lifecycle -------------------------------------------

    async connect(): Promise<void> {
        if (this.connection) {
            return;
        }
        const token = ++this.connectToken;
        this.manualStop = false;
        log.info(`[usb] scanning for device (PIDs ${this.pids.map(formatPid).join(", ")})`);
        this.setStatus({ state: DeviceState.Connecting, label: "Connecting…" });

        let devices: HidDescriptorLike[];
        try {
            devices = await this.transport.list();
        } catch (error) {
            if (token !== this.connectToken) {
                throw new UsbError("Connect superseded by disconnect", UsbErrorCodes.NotConnected);
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus({ state: DeviceState.Error, label: "USB enumeration failed" });
            throw new UsbError(`USB enumeration failed: ${message}`, UsbErrorCodes.Transport);
        }
        if (token !== this.connectToken) {
            throw new UsbError("Connect superseded by disconnect", UsbErrorCodes.NotConnected);
        }

        const found = findUsbDevice(devices, this.pids);
        if (!found || !found.device.path) {
            const paths = devices.map(
                (device) => `0x${device.vendorId.toString(16)}:0x${device.productId.toString(16)}`,
            );
            log.warn(
                `[usb] no match for ${this.pids.map(formatPid).join("/")}; saw [${
                    paths.join(", ") || "none"
                }]`,
            );
            this.setStatus({ state: DeviceState.Disconnected, label: "No device connected" });
            throw new UsbError(
                `No LucydDeck device found (tried ${this.pids.map(formatPid).join(", ")})`,
                UsbErrorCodes.NoDevice,
            );
        }

        log.info(
            `[usb] matched VID 0x${found.device.vendorId.toString(16)} PID ${formatPid(
                found.pid,
            )}${found.device.path ? ` path ${found.device.path}` : ""}`,
        );

        let connection: HidConnection;
        try {
            connection = await this.transport.open(found.device.path);
        } catch (error) {
            if (token !== this.connectToken) {
                throw new UsbError("Connect superseded by disconnect", UsbErrorCodes.NotConnected);
            }
            const message = error instanceof Error ? error.message : String(error);
            this.setStatus({ state: DeviceState.Error, label: "Could not open device" });
            throw new UsbError(
                `Could not open device at ${found.device.path}: ${message}`,
                UsbErrorCodes.Transport,
            );
        }
        if (token !== this.connectToken) {
            await connection.close().catch(() => undefined);
            throw new UsbError("Connect superseded by disconnect", UsbErrorCodes.NotConnected);
        }

        this.connection = connection;
        this.sequence.reset();
        this.backoffIndex = 0;
        connection.onData((report) => this.handleReport(report));
        connection.onError((error) => this.handleTransportError(error));
        this.setStatus({
            state: DeviceState.Connected,
            label: describeDevice(found.device, found.pid),
        });
    }

    async disconnect(): Promise<void> {
        this.connectToken++;
        this.manualStop = true;
        this.cancelReconnect();
        this.teardownConnection();
        this.resetActionStream();
        this.sequence.reset();
        this.rejectAll(new UsbError("Device disconnected", UsbErrorCodes.NotConnected));
        this.setStatus({ state: DeviceState.Disconnected, label: "No device connected" });
    }

    private teardownConnection(): void {
        const connection = this.connection;
        this.connection = null;
        if (connection) {
            void connection.close().catch((error: unknown) => {
                log.warn(`[usb] close failed: ${String(error)}`);
            });
        }
    }

    private handleTransportError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`[usb] transport error: ${message}`);
        this.teardownConnection();
        this.resetActionStream();
        this.rejectAll(new UsbError(`USB transport error: ${message}`, UsbErrorCodes.Transport));
        this.setStatus({ state: DeviceState.Error, label: "Device disconnected" });
        this.scheduleReconnect();
    }

    private scheduleReconnect(): void {
        if (!this.autoReconnect || this.manualStop || this.reconnectTimer !== null) {
            return;
        }
        const delay = this.backoffMs[Math.min(this.backoffIndex, this.backoffMs.length - 1)];
        log.info(`[usb] reconnect attempt in ${delay} ms`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.connection || this.manualStop) {
                return;
            }
            this.connect()
                .then(() => {
                    this.backoffIndex = 0;
                })
                .catch(() => {
                    this.backoffIndex++;
                    this.scheduleReconnect();
                });
        }, delay);
    }

    private cancelReconnect(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.backoffIndex = 0;
    }

    // --- Command queue ---------------------------------------------------

    /**
     * Send one host command and resolve with the reassembled response payload.
     * Commands are serialized: at most one request is outstanding at a time.
     * `RESP_ERROR` rejects with a `UsbError` carrying the firmware code.
     */
    command(
        opcode: HostCommand,
        payload: Uint8Array = new Uint8Array(),
        expect: DeviceResponse = DeviceResponse.Ack,
    ): Promise<Uint8Array> {
        return new Promise<Uint8Array>((resolve, reject) => {
            this.queue.push({ opcode, payload, expect, resolve, reject });
            this.pump();
        });
    }

    private pump(): void {
        if (this.pending || this.queue.length === 0) {
            return;
        }
        const connection = this.connection;
        if (!connection) {
            this.rejectQueued(new UsbError("Device is not connected", UsbErrorCodes.NotConnected));
            return;
        }
        const queued = this.queue.shift();
        if (!queued) {
            return;
        }

        const seq = this.sequence.next();
        let report: Uint8Array;
        try {
            // Host frames always carry M=0; `sequence.next()` never sets it.
            report = buildFrame(queued.opcode, seq, queued.payload);
        } catch (error) {
            queued.reject(error instanceof Error ? error : new Error(String(error)));
            this.pump();
            return;
        }

        const pending: PendingCommand = { ...queued, seq, chunks: [], bytes: 0, timer: null };
        pending.timer = setTimeout(() => this.handleTimeout(pending), this.ackTimeoutMs);
        this.pending = pending;
        connection.write(report).catch((error: unknown) => this.handleTransportError(error));
    }

    private handleReport(report: Uint8Array): void {
        let frame: ParsedFrame;
        try {
            frame = parseFrame(report);
        } catch (error) {
            log.warn(`[usb] dropped malformed report: ${String(error)}`);
            return;
        }

        if (frame.opcode === DeviceResponse.ActionTriggered) {
            this.handleActionFrame(frame);
            return;
        }

        const pending = this.pending;
        if (!pending) {
            log.warn(`[usb] unsolicited frame ${opcodeName(frame.opcode)} (no request pending)`);
            return;
        }
        if (frame.opcode === DeviceResponse.Error) {
            const code = (frame.payload[0] ?? ErrorCode.UnknownCommand) as ErrorCode;
            const label = describeErrorCode(code);
            this.finishPending(
                new UsbError(`${opcodeName(pending.opcode)} failed: ${label}`, label, code),
            );
            return;
        }
        if (frame.opcode !== pending.expect) {
            log.warn(
                `[usb] ignoring ${opcodeName(frame.opcode)}; waiting for ${opcodeName(
                    pending.expect,
                )}`,
            );
            return;
        }

        const chunk = trimTrailingZeros(frame.payload);
        pending.bytes += chunk.length;
        if (pending.bytes > this.maxResponseBytes) {
            this.finishPending(
                new UsbError(
                    `Response from ${opcodeName(pending.opcode)} exceeded ${this.maxResponseBytes} bytes`,
                    UsbErrorCodes.UnexpectedResponse,
                ),
            );
            return;
        }
        pending.chunks.push(chunk);
        if (frame.mBit) {
            this.armTimer(pending, this.streamTimeoutMs);
            return;
        }
        this.finishPending(null, concat(pending.chunks));
    }

    /**
     * Reassemble unsolicited `0xA0` action streams independently of the pending
     * command. The firmware chunks actions >60 bytes with the M-bit set.
     */
    private handleActionFrame(frame: ParsedFrame): void {
        this.actionChunks.push(trimTrailingZeros(frame.payload));
        if (frame.mBit) {
            if (this.actionTimer !== null) {
                clearTimeout(this.actionTimer);
            }
            this.actionTimer = setTimeout(() => this.resetActionStream(), this.streamTimeoutMs);
            return;
        }
        const chunks = this.actionChunks;
        this.resetActionStream();
        const action = new TextDecoder().decode(concat(chunks));
        log.info(`[usb] action triggered: ${action}`);
        this.emit({ type: "action-triggered", action });
    }

    private resetActionStream(): void {
        this.actionChunks = [];
        if (this.actionTimer !== null) {
            clearTimeout(this.actionTimer);
            this.actionTimer = null;
        }
    }

    private armTimer(pending: PendingCommand, timeoutMs: number): void {
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
        }
        pending.timer = setTimeout(() => this.handleTimeout(pending), timeoutMs);
    }

    private handleTimeout(pending: PendingCommand): void {
        if (this.pending !== pending) {
            return;
        }
        this.finishPending(
            new UsbError(
                `Timed out waiting for ${opcodeName(pending.expect)} after ${opcodeName(
                    pending.opcode,
                )}`,
                UsbErrorCodes.Timeout,
            ),
        );
    }

    private finishPending(error: UsbError | null, payload?: Uint8Array): void {
        const pending = this.pending;
        if (!pending) {
            return;
        }
        this.pending = null;
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
            pending.timer = null;
        }
        if (error) {
            pending.reject(error);
        } else {
            pending.resolve(payload ?? new Uint8Array());
        }
        this.pump();
    }

    private rejectQueued(error: UsbError): void {
        const queued = this.queue.splice(0);
        for (const command of queued) {
            command.reject(error);
        }
    }

    private rejectAll(error: UsbError): void {
        const pending = this.pending;
        this.pending = null;
        if (pending && pending.timer !== null) {
            clearTimeout(pending.timer);
        }
        if (pending) {
            pending.reject(error);
        }
        this.rejectQueued(error);
    }
}

function formatPid(pid: number): string {
    return `0x${pid.toString(16)}`;
}
