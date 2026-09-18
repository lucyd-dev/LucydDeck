import log from "electron-log/main";
import {
    DeviceResponse,
    ErrorCode,
    FILE_TRANSFER_MAX_BYTES,
    HostCommand,
    PAYLOAD_MAX,
} from "@shared/protocol";
import type { PathType } from "@shared/protocol";
import type { TransferProgressEvent } from "@shared/ipc";
import { crc32BigEndian } from "./usb/Crc32";
import type { UsbError } from "./UsbService";

export type TransferState = "idle" | "active" | "done" | "cancelled";

export const FileTransferErrorCodes = {
    Busy: "TRANSFER_BUSY",
    Cancelled: "TRANSFER_CANCELLED",
    TooLarge: "TRANSFER_TOO_LARGE",
} as const;

export class FileTransferError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = "FileTransferError";
        this.code = code;
    }
}

/** Minimal surface `FileTransfer` needs from `UsbService` (mockable in tests). */
export interface UsbCommandClient {
    command(opcode: HostCommand, payload: Uint8Array, expect: DeviceResponse): Promise<Uint8Array>;
}

export interface FileTransferOptions {
    chunkSize?: number;
    /** How many times to retry the whole file after `ERR_CRC` on END. */
    crcRetries?: number;
    crc?: (bytes: Uint8Array) => Uint8Array;
    /** Minimum spacing between chunk progress events (ms). */
    progressIntervalMs?: number;
    /** Clock override for deterministic progress tests. */
    now?: () => number;
    onEvent?: (event: TransferProgressEvent) => void;
}

function textBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function isCrcError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "firmwareCode" in error &&
        (error as UsbError).firmwareCode === ErrorCode.Crc
    );
}

/**
 * Three-phase `CMD_FILE_*` uploader: START → ACK-paced chunks → END with a
 * big-endian CRC32. One transfer at a time; `ERR_CRC` on END retries the file
 * once (the device keeps the last-good file until a rename succeeds).
 */
export class FileTransfer {
    private readonly usb: UsbCommandClient;
    private readonly chunkSize: number;
    private readonly crcRetries: number;
    private readonly crc: (bytes: Uint8Array) => Uint8Array;
    private readonly progressIntervalMs: number;
    private readonly now: () => number;
    private readonly listeners = new Set<(event: TransferProgressEvent) => void>();

    private statusValue: TransferState = "idle";
    private cancelled = false;
    private currentPath = "";
    private currentPathType: number = 0;
    private lastProgressAt = 0;

    constructor(usb: UsbCommandClient, options: FileTransferOptions = {}) {
        this.usb = usb;
        this.chunkSize = options.chunkSize ?? PAYLOAD_MAX;
        this.crcRetries = options.crcRetries ?? 1;
        this.crc = options.crc ?? crc32BigEndian;
        this.progressIntervalMs = options.progressIntervalMs ?? 100;
        this.now = options.now ?? (() => Date.now());
        if (options.onEvent) {
            this.listeners.add(options.onEvent);
        }
    }

    get state(): TransferState {
        return this.statusValue;
    }

    private get isDone(): boolean {
        return this.statusValue === "done";
    }

    onEvent(listener: (event: TransferProgressEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Upload `bytes` to `path` (`pathType` selects page vs icon grammar).
     * Resolves after the device ACKs `CMD_FILE_END`.
     */
    async upload(pathType: PathType | number, path: string, bytes: Uint8Array): Promise<void> {
        if (this.statusValue === "active") {
            throw new FileTransferError(
                "A file transfer is already active",
                FileTransferErrorCodes.Busy,
            );
        }
        if (path === "" || textBytes(path).length + 1 > PAYLOAD_MAX) {
            throw new FileTransferError(
                `Invalid transfer path: "${path}"`,
                "TRANSFER_INVALID_PATH",
            );
        }
        if (bytes.length > FILE_TRANSFER_MAX_BYTES) {
            throw new FileTransferError(
                `File too large: ${bytes.length} > ${FILE_TRANSFER_MAX_BYTES} bytes`,
                FileTransferErrorCodes.TooLarge,
            );
        }

        this.statusValue = "active";
        this.cancelled = false;
        this.currentPath = path;
        this.currentPathType = pathType;
        this.lastProgressAt = 0;

        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    await this.runTransfer(pathType, path, bytes);
                    break;
                } catch (error) {
                    if (attempt < this.crcRetries && !this.cancelled && isCrcError(error)) {
                        log.warn(`[transfer] CRC mismatch for ${path}; retrying the file once`);
                        this.emit("retry", 0, bytes.length);
                        continue;
                    }
                    throw error;
                }
            }
            // `runTransfer` only returns after the device ACKed `CMD_FILE_END`, so
            // the file is committed; a late `cancel()` must not report it cancelled.
            this.statusValue = "done";
        } catch (error) {
            this.statusValue = this.cancelled ? "cancelled" : "idle";
            if (this.cancelled) {
                throw new FileTransferError("Transfer cancelled", FileTransferErrorCodes.Cancelled);
            }
            throw error;
        } finally {
            this.currentPath = "";
        }
    }

    /** Abort the active transfer with `CMD_FILE_CANCEL`. Safe when idle. */
    async cancel(): Promise<void> {
        if (this.statusValue !== "active") {
            return;
        }
        this.cancelled = true;
        try {
            await this.usb.command(HostCommand.FileCancel, new Uint8Array(), DeviceResponse.Ack);
        } catch (error) {
            log.warn(`[transfer] cancel command failed: ${String(error)}`);
        }
        // A cancel that lands after the END ACK no longer applies; the upload
        // resolves as `done`, so don't advertise a cancelled transfer.
        if (!this.isDone) {
            this.emit("cancelled", 0, 0);
        }
    }

    private async runTransfer(
        pathType: PathType | number,
        path: string,
        bytes: Uint8Array,
    ): Promise<void> {
        const encodedPath = textBytes(path);
        const startPayload = new Uint8Array(1 + encodedPath.length);
        startPayload[0] = pathType;
        startPayload.set(encodedPath, 1);

        this.assertNotCancelled();
        await this.send(HostCommand.FileStart, startPayload);
        this.emit("start", 0, bytes.length);

        let sent = 0;
        while (sent < bytes.length) {
            this.assertNotCancelled();
            const end = Math.min(sent + this.chunkSize, bytes.length);
            await this.send(HostCommand.FileChunk, bytes.subarray(sent, end));
            sent = end;
            this.maybeEmitChunkProgress(sent, bytes.length);
        }

        this.assertNotCancelled();
        await this.send(HostCommand.FileEnd, this.crc(bytes));
        this.emit("end", bytes.length, bytes.length);
    }

    /** Throttle chunk progress; always emit the final chunk. */
    private maybeEmitChunkProgress(sent: number, total: number): void {
        const now = this.now();
        if (sent >= total || now - this.lastProgressAt >= this.progressIntervalMs) {
            this.lastProgressAt = now;
            this.emit("chunk", sent, total);
        }
    }

    private send(opcode: HostCommand, payload: Uint8Array): Promise<Uint8Array> {
        return this.usb.command(opcode, payload, DeviceResponse.Ack);
    }

    private assertNotCancelled(): void {
        if (this.cancelled) {
            throw new FileTransferError("Transfer cancelled", FileTransferErrorCodes.Cancelled);
        }
    }

    private emit(phase: TransferProgressEvent["phase"], sent: number, total: number): void {
        if (this.listeners.size === 0) {
            return;
        }
        const event: TransferProgressEvent = {
            type: "transfer-progress",
            phase,
            pathType: this.currentPathType,
            path: this.currentPath,
            sent,
            total,
            percent: total === 0 ? 100 : Math.round((sent / total) * 100),
        };
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (error) {
                log.warn(`[transfer] progress listener failed: ${String(error)}`);
            }
        }
    }
}
