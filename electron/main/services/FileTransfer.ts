import log from "electron-log/main";
import {
    DeviceResponse,
    ErrorCode,
    FILE_TRANSFER_MAX_BYTES,
    HostCommand,
    PAYLOAD_MAX,
    padToPayload,
} from "@shared/protocol";
import type { TargetType } from "@shared/protocol";
import type { TransferProgressEvent } from "@shared/ipc";
import { crc32BigEndian } from "@shared/crc32";
import type { UsbError } from "./UsbService";
import { DeviceLockError } from "./DeviceLock";
import type { DeviceLock } from "./DeviceLock";

export type TransferState = "idle" | "active" | "done" | "cancelled";

export const FileTransferErrorCodes = {
    Busy: "TRANSFER_BUSY",
    Cancelled: "TRANSFER_CANCELLED",
    TooLarge: "TRANSFER_TOO_LARGE",
    InvalidIdentity: "TRANSFER_INVALID_IDENTITY",
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
    /**
     * False once the HID link is down. Cleanup commands are pointless then, and
     * the deck resets its transfer state when it re-enumerates.
     */
    readonly connected?: boolean;
}

export interface FileTransferOptions {
    /** How many times to retry the whole file after `ERR_CRC` on END. */
    crcRetries?: number;
    crc?: (bytes: Uint8Array) => Uint8Array;
    /** Minimum spacing between chunk progress events (ms). */
    progressIntervalMs?: number;
    /** Clock override for deterministic progress tests. */
    now?: () => number;
    onEvent?: (event: TransferProgressEvent) => void;
    /** Shared deck ownership; a transfer is refused while an update runs. */
    lock?: DeviceLock;
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

/** True when the deck answered `CMD_FILE_CANCEL` with "nothing to cancel". */
function isNoTransferError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "firmwareCode" in error &&
        (error as UsbError).firmwareCode === ErrorCode.NoTransfer
    );
}

/** True when the deck refused `CMD_FILE_START` because a transfer is open. */
function isBusyError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "firmwareCode" in error &&
        (error as UsbError).firmwareCode === ErrorCode.TransferBusy
    );
}

/**
 * Three-phase `CMD_FILE_*` uploader: START → ACK-paced chunks → END with a
 * big-endian CRC32. One transfer at a time; `ERR_CRC` on END retries the file
 * once (the device keeps the last-good file until a rename succeeds).
 *
 * Every chunk payload is exactly `PAYLOAD_MAX` bytes: the final chunk is
 * zero-padded and the CRC covers the padded stream, matching what the fixed
 * 63-byte USB report delivers to the firmware.
 */
export class FileTransfer {
    private readonly usb: UsbCommandClient;
    private readonly crcRetries: number;
    private readonly crc: (bytes: Uint8Array) => Uint8Array;
    private readonly progressIntervalMs: number;
    private readonly now: () => number;
    private readonly lock: DeviceLock | undefined;
    private readonly listeners = new Set<(event: TransferProgressEvent) => void>();

    private statusValue: TransferState = "idle";
    private cancelled = false;
    /** True between an ACKed `CMD_FILE_START` and `CMD_FILE_END`. */
    private transferOpen = false;
    /** The upload in flight, so a caller can cancel it and wait for it to stop. */
    private activeUpload: Promise<void> | null = null;
    private currentIdentity = "";
    private currentTargetType: number = 0;
    private lastProgressAt = 0;

    constructor(usb: UsbCommandClient, options: FileTransferOptions = {}) {
        this.usb = usb;
        this.crcRetries = options.crcRetries ?? 1;
        this.crc = options.crc ?? crc32BigEndian;
        this.progressIntervalMs = options.progressIntervalMs ?? 100;
        this.now = options.now ?? (() => Date.now());
        this.lock = options.lock;
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
     * Upload `bytes` to the entity named by `identity` (`targetType` selects
     * page vs icon grammar). Resolves after the device ACKs `CMD_FILE_END`.
     */
    async upload(
        targetType: TargetType | number,
        identity: string,
        bytes: Uint8Array,
    ): Promise<void> {
        if (this.activeUpload !== null) {
            throw new FileTransferError(
                "A file transfer is already active",
                FileTransferErrorCodes.Busy,
            );
        }
        const run = this.performUpload(targetType, identity, bytes);
        this.activeUpload = run;
        try {
            await run;
        } finally {
            if (this.activeUpload === run) {
                this.activeUpload = null;
            }
        }
    }

    private async performUpload(
        targetType: TargetType | number,
        identity: string,
        bytes: Uint8Array,
    ): Promise<void> {
        if (this.statusValue === "active") {
            throw new FileTransferError(
                "A file transfer is already active",
                FileTransferErrorCodes.Busy,
            );
        }
        if (identity === "" || textBytes(identity).length + 1 > PAYLOAD_MAX) {
            throw new FileTransferError(
                `Invalid transfer identity: "${identity}"`,
                FileTransferErrorCodes.InvalidIdentity,
            );
        }
        if (bytes.length > FILE_TRANSFER_MAX_BYTES) {
            throw new FileTransferError(
                `File too large: ${bytes.length} > ${FILE_TRANSFER_MAX_BYTES} bytes`,
                FileTransferErrorCodes.TooLarge,
            );
        }
        // The firmware counts the padded bytes it receives against its budget.
        const wire = padToPayload(bytes);
        if (wire.length > FILE_TRANSFER_MAX_BYTES) {
            throw new FileTransferError(
                `File too large after HID padding: ${wire.length} > ${FILE_TRANSFER_MAX_BYTES} bytes`,
                FileTransferErrorCodes.TooLarge,
            );
        }
        if (this.lock !== undefined && !this.lock.beginTransfer()) {
            throw new DeviceLockError(this.lock.current() ?? "update");
        }

        this.statusValue = "active";
        this.cancelled = false;
        this.transferOpen = false;
        this.currentIdentity = identity;
        this.currentTargetType = targetType;
        this.lastProgressAt = 0;

        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    await this.runTransfer(targetType, identity, bytes, wire);
                    break;
                } catch (error) {
                    if (attempt < this.crcRetries && !this.cancelled && isCrcError(error)) {
                        log.warn(`[transfer] CRC mismatch for ${identity}; retrying the file once`);
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
            await this.clearOpenTransfer();
            this.emit("failed", 0, 0);
            throw error;
        } finally {
            this.currentIdentity = "";
            this.lock?.endTransfer();
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

    /**
     * Cancel a transfer this process owns, or one the deck still holds from an
     * earlier session, before the deck is handed to its ROM bootloader. A
     * running upload is waited out so no `CMD_FILE_*` frame follows `0x05`.
     */
    async cancelOpen(): Promise<void> {
        const active = this.activeUpload;
        if (active !== null) {
            await this.cancel();
            await active.catch(() => undefined);
            return;
        }
        if (this.usb.connected === false) {
            return;
        }
        try {
            await this.usb.command(HostCommand.FileCancel, new Uint8Array(), DeviceResponse.Ack);
        } catch (error) {
            if (isNoTransferError(error)) {
                return;
            }
            throw error;
        }
    }

    /**
     * Clear a transfer the deck still has open after a failed upload. Without
     * this the deck keeps the staging transfer and answers the next
     * `CMD_FILE_START` with `ERR_TRANSFER_BUSY`. Best effort: `ERR_NO_TRANSFER`
     * means the deck already closed it, and a dropped link needs no cleanup.
     */
    private async clearOpenTransfer(): Promise<void> {
        if (!this.transferOpen) {
            return;
        }
        this.transferOpen = false;
        if (this.usb.connected === false) {
            return;
        }
        try {
            await this.usb.command(HostCommand.FileCancel, new Uint8Array(), DeviceResponse.Ack);
        } catch (error) {
            if (isNoTransferError(error)) {
                return;
            }
            log.warn(`[transfer] could not clear the failed transfer: ${String(error)}`);
        }
    }

    /**
     * Start a transfer, clearing a staging transfer the deck still holds after
     * an interrupted session (app crash, dropped link). One retry only: the
     * second `ERR_TRANSFER_BUSY` is real and belongs to the caller.
     */
    private async startTransfer(payload: Uint8Array): Promise<void> {
        try {
            await this.send(HostCommand.FileStart, payload);
            return;
        } catch (error) {
            if (!isBusyError(error)) {
                throw error;
            }
            log.warn("[transfer] deck still holds a transfer; cancelling it before retrying");
            try {
                await this.send(HostCommand.FileCancel, new Uint8Array());
            } catch (cancelError) {
                if (!isNoTransferError(cancelError)) {
                    throw error;
                }
            }
            await this.send(HostCommand.FileStart, payload);
        }
    }

    private async runTransfer(
        targetType: TargetType | number,
        identity: string,
        bytes: Uint8Array,
        wire: Uint8Array,
    ): Promise<void> {
        const encodedIdentity = textBytes(identity);
        const startPayload = new Uint8Array(1 + encodedIdentity.length);
        startPayload[0] = targetType;
        startPayload.set(encodedIdentity, 1);

        this.assertNotCancelled();
        await this.startTransfer(startPayload);
        this.transferOpen = true;
        this.emit("start", 0, bytes.length);

        let sent = 0;
        while (sent < wire.length) {
            this.assertNotCancelled();
            const end = Math.min(sent + PAYLOAD_MAX, wire.length);
            await this.send(HostCommand.FileChunk, wire.subarray(sent, end));
            sent = end;
            this.maybeEmitChunkProgress(Math.min(sent, bytes.length), bytes.length);
        }

        this.assertNotCancelled();
        await this.send(HostCommand.FileEnd, this.crc(wire));
        this.transferOpen = false;
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
            targetType: this.currentTargetType,
            identity: this.currentIdentity,
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
