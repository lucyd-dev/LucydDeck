import { describe, expect, it, vi } from "vitest";
import {
    DeviceResponse,
    ErrorCode,
    FILE_TRANSFER_MAX_BYTES,
    HostCommand,
    PATH_PAGE,
    PAYLOAD_MAX,
    PathType,
    padToPayload,
} from "@shared/protocol";
import type { TransferProgressEvent } from "@shared/ipc";
import { crc32BigEndian } from "./usb/Crc32";
import {
    FileTransfer,
    FileTransferError,
    FileTransferErrorCodes,
    type UsbCommandClient,
} from "./FileTransfer";
import { UsbError, UsbErrorCodes } from "./UsbService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

interface Call {
    opcode: HostCommand;
    payload: Uint8Array;
    expect: DeviceResponse;
}

class MockUsb implements UsbCommandClient {
    readonly calls: Call[] = [];
    connected = true;
    handler: (opcode: HostCommand, payload: Uint8Array) => Promise<Uint8Array> = async () =>
        new Uint8Array();

    command(opcode: HostCommand, payload: Uint8Array, expect: DeviceResponse): Promise<Uint8Array> {
        this.calls.push({ opcode, payload, expect });
        return this.handler(opcode, payload);
    }

    payloads(opcode: HostCommand): Uint8Array[] {
        return this.calls.filter((call) => call.opcode === opcode).map((call) => call.payload);
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const PATH = "gaming/3.json";

function bytes(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => index % 256);
}

describe("FileTransfer chunking", () => {
    it("sends START, the right chunk count, then END", async () => {
        for (const [length, expectedChunks] of [
            [0, 0],
            [60, 1],
            [61, 2],
            [120, 2],
            [121, 3],
        ] as const) {
            const usb = new MockUsb();
            const transfer = new FileTransfer(usb);
            await transfer.upload(PATH_PAGE, PATH, bytes(length));
            expect(usb.payloads(HostCommand.FileStart)).toHaveLength(1);
            expect(usb.payloads(HostCommand.FileChunk)).toHaveLength(expectedChunks);
            expect(usb.payloads(HostCommand.FileEnd)).toHaveLength(1);
            expect(transfer.state).toBe("done");
        }
    });

    it("encodes START as [pathType, ...utf8(path)]", async () => {
        const usb = new MockUsb();
        await new FileTransfer(usb).upload(PathType.Icon, "emoji", bytes(4));
        const start = usb.payloads(HostCommand.FileStart)[0];
        expect(start[0]).toBe(PathType.Icon);
        expect(new TextDecoder().decode(start.slice(1))).toBe("emoji");
    });

    it("caps each chunk at the 60-byte wire payload", async () => {
        const usb = new MockUsb();
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, bytes(130));
        for (const chunk of usb.payloads(HostCommand.FileChunk)) {
            expect(chunk.length).toBeLessThanOrEqual(60);
        }
        // 130 bytes become three full payloads; the last 50 bytes are zero fill.
        expect(usb.payloads(HostCommand.FileChunk).map((chunk) => chunk.length)).toEqual([
            60, 60, 60,
        ]);
        expect(usb.payloads(HostCommand.FileChunk)[2].slice(10)).toEqual(new Uint8Array(50));
    });

    it("preserves order and paces on each ACK", async () => {
        const order: HostCommand[] = [];
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            order.push(opcode);
            return new Uint8Array();
        };
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, bytes(61));
        expect(order).toEqual([
            HostCommand.FileStart,
            HostCommand.FileChunk,
            HostCommand.FileChunk,
            HostCommand.FileEnd,
        ]);
    });
});

/**
 * The firmware's view of a chunk stream. The USB stack delivers every report
 * at its full 63-byte length (`wiki/USB-Protocol.md` §2), so the device always
 * receives a 60-byte payload: the chunk bytes followed by zero fill.
 */
function firmwareStream(chunks: Uint8Array[]): Uint8Array {
    const stream = new Uint8Array(chunks.length * PAYLOAD_MAX);
    chunks.forEach((chunk, index) =>
        stream.set(chunk.subarray(0, PAYLOAD_MAX), index * PAYLOAD_MAX),
    );
    return stream;
}

describe("FileTransfer CRC", () => {
    it("hashes the zero-padded stream the firmware receives (test vector 0x41)", async () => {
        const usb = new MockUsb();
        // One byte -> one 60-byte payload: 0x41 followed by 59 zero-fill bytes.
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, Uint8Array.from([0x41]));

        const wire = firmwareStream(usb.payloads(HostCommand.FileChunk));
        expect(wire).toHaveLength(PAYLOAD_MAX);
        expect(Array.from(usb.payloads(HostCommand.FileEnd)[0])).toEqual(
            Array.from(crc32BigEndian(wire)),
        );
        // CRC-32 (IEEE) of 0x41 + 59 * 0x00.
        expect(Array.from(usb.payloads(HostCommand.FileEnd)[0])).toEqual([0xa2, 0x4e, 0x47, 0x6b]);
    });

    it("sends the big-endian CRC32 of all bytes in exact order", async () => {
        const usb = new MockUsb();
        const data = bytes(137);
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, data);
        // 137 file bytes + 43 zero-fill bytes in the final payload.
        expect(Array.from(usb.payloads(HostCommand.FileEnd)[0])).toEqual(
            Array.from(crc32BigEndian(padToPayload(data))),
        );
    });

    it("retries the whole file once after ERR_CRC, then succeeds", async () => {
        const usb = new MockUsb();
        let endCalls = 0;
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileEnd) {
                endCalls++;
                if (endCalls === 1) {
                    throw new UsbError("crc", "ERR_CRC", ErrorCode.Crc);
                }
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);
        const phases: TransferProgressEvent["phase"][] = [];
        transfer.onEvent((event) => phases.push(event.phase));

        await transfer.upload(PATH_PAGE, PATH, bytes(10));

        expect(endCalls).toBe(2);
        expect(usb.payloads(HostCommand.FileStart)).toHaveLength(2);
        expect(phases).toContain("retry");
        expect(transfer.state).toBe("done");
    });

    it("surfaces a persistent ERR_CRC", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileEnd) {
                throw new UsbError("crc", "ERR_CRC", ErrorCode.Crc);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb, { crcRetries: 0 });
        await expect(transfer.upload(PATH_PAGE, PATH, bytes(10))).rejects.toBeInstanceOf(UsbError);
        expect(transfer.state).toBe("idle");
    });

    it("maps firmware errors straight through", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileChunk) {
                throw new UsbError("write failed", "ERR_WRITE", ErrorCode.Write);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);
        await expect(transfer.upload(PATH_PAGE, PATH, bytes(61))).rejects.toMatchObject({
            code: "ERR_WRITE",
            firmwareCode: ErrorCode.Write,
        });
    });
});

describe("FileTransfer control", () => {
    it("rejects a concurrent upload", async () => {
        const usb = new MockUsb();
        const startGate = deferred<Uint8Array>();
        usb.handler = (opcode) =>
            opcode === HostCommand.FileStart
                ? startGate.promise
                : Promise.resolve(new Uint8Array());
        const transfer = new FileTransfer(usb);
        const first = transfer.upload(PATH_PAGE, PATH, bytes(4));
        await expect(transfer.upload(PATH_PAGE, PATH, bytes(4))).rejects.toBeInstanceOf(
            FileTransferError,
        );
        startGate.resolve(new Uint8Array());
        await first;
    });

    it("sends CMD_FILE_CANCEL and rejects the active upload", async () => {
        const usb = new MockUsb();
        const startGate = deferred<Uint8Array>();
        usb.handler = (opcode) =>
            opcode === HostCommand.FileStart
                ? startGate.promise
                : Promise.resolve(new Uint8Array());
        const transfer = new FileTransfer(usb);
        const upload = transfer.upload(PATH_PAGE, PATH, bytes(120));

        await transfer.cancel();
        expect(usb.payloads(HostCommand.FileCancel)).toHaveLength(1);

        startGate.resolve(new Uint8Array());
        await expect(upload).rejects.toMatchObject({ code: FileTransferErrorCodes.Cancelled });
        expect(transfer.state).toBe("cancelled");
    });

    it("cancels the transfer the deck still holds after a failed upload", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileChunk) {
                throw new UsbError("no ack", UsbErrorCodes.Timeout);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);

        await expect(transfer.upload(PATH_PAGE, PATH, bytes(61))).rejects.toMatchObject({
            code: UsbErrorCodes.Timeout,
        });

        expect(usb.calls.map((call) => call.opcode)).toEqual([
            HostCommand.FileStart,
            HostCommand.FileChunk,
            HostCommand.FileCancel,
        ]);
        expect(transfer.state).toBe("idle");
    });

    it("keeps the original error when the deck has nothing to cancel", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileEnd) {
                throw new UsbError("crc", "ERR_CRC", ErrorCode.Crc);
            }
            if (opcode === HostCommand.FileCancel) {
                throw new UsbError("nothing open", "ERR_NO_TRANSFER", ErrorCode.NoTransfer);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb, { crcRetries: 0 });

        await expect(transfer.upload(PATH_PAGE, PATH, bytes(10))).rejects.toMatchObject({
            code: "ERR_CRC",
            firmwareCode: ErrorCode.Crc,
        });
        expect(usb.payloads(HostCommand.FileCancel)).toHaveLength(1);
    });

    it("does not cancel after a successful upload", async () => {
        const usb = new MockUsb();
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, bytes(10));
        expect(usb.payloads(HostCommand.FileCancel)).toHaveLength(0);
    });

    it("clears a stale transfer and retries the start once", async () => {
        const usb = new MockUsb();
        let startCalls = 0;
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileStart) {
                startCalls++;
                if (startCalls === 1) {
                    throw new UsbError("busy", "ERR_TRANSFER_BUSY", ErrorCode.TransferBusy);
                }
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);

        await transfer.upload(PATH_PAGE, PATH, bytes(61));

        expect(usb.calls.map((call) => call.opcode)).toEqual([
            HostCommand.FileStart,
            HostCommand.FileCancel,
            HostCommand.FileStart,
            HostCommand.FileChunk,
            HostCommand.FileChunk,
            HostCommand.FileEnd,
        ]);
        expect(usb.payloads(HostCommand.FileStart)[1]).toEqual(
            usb.payloads(HostCommand.FileStart)[0],
        );
        expect(transfer.state).toBe("done");
    });

    it("surfaces ERR_TRANSFER_BUSY when the deck is still busy after the clear", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileStart) {
                throw new UsbError("busy", "ERR_TRANSFER_BUSY", ErrorCode.TransferBusy);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);

        await expect(transfer.upload(PATH_PAGE, PATH, bytes(61))).rejects.toMatchObject({
            code: "ERR_TRANSFER_BUSY",
            firmwareCode: ErrorCode.TransferBusy,
        });
        expect(usb.payloads(HostCommand.FileStart)).toHaveLength(2);
    });

    it("keeps the busy error when the cancel itself fails", async () => {
        const usb = new MockUsb();
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileStart) {
                throw new UsbError("busy", "ERR_TRANSFER_BUSY", ErrorCode.TransferBusy);
            }
            if (opcode === HostCommand.FileCancel) {
                throw new UsbError("no ack", UsbErrorCodes.Timeout);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);

        await expect(transfer.upload(PATH_PAGE, PATH, bytes(61))).rejects.toMatchObject({
            code: "ERR_TRANSFER_BUSY",
        });
        expect(usb.payloads(HostCommand.FileStart)).toHaveLength(1);
    });

    it("aborts when the device disconnects", async () => {
        const usb = new MockUsb();
        usb.connected = false;
        usb.handler = async (opcode) => {
            if (opcode === HostCommand.FileChunk) {
                throw new UsbError("gone", UsbErrorCodes.NotConnected);
            }
            return new Uint8Array();
        };
        const transfer = new FileTransfer(usb);
        await expect(transfer.upload(PATH_PAGE, PATH, bytes(61))).rejects.toMatchObject({
            code: UsbErrorCodes.NotConnected,
        });
        expect(transfer.state).toBe("idle");
        // Nothing to clean up over a dropped link; the deck resets on replug.
        expect(usb.payloads(HostCommand.FileCancel)).toHaveLength(0);
    });
});

describe("FileTransfer limits and progress", () => {
    it("rejects files above the 4 MiB budget before transferring", async () => {
        const usb = new MockUsb();
        const transfer = new FileTransfer(usb);
        const oversized = new Uint8Array(FILE_TRANSFER_MAX_BYTES + 1);
        await expect(transfer.upload(PATH_PAGE, PATH, oversized)).rejects.toMatchObject({
            code: FileTransferErrorCodes.TooLarge,
        });
        expect(usb.calls).toHaveLength(0);
    });

    it("throttles chunk progress but always emits the final chunk", async () => {
        const usb = new MockUsb();
        const transfer = new FileTransfer(usb, { progressIntervalMs: 1000, now: () => 0 });
        const events: TransferProgressEvent[] = [];
        transfer.onEvent((event) => events.push(event));

        await transfer.upload(PATH_PAGE, PATH, bytes(200));

        const chunks = events.filter((event) => event.phase === "chunk");
        expect(chunks.map((event) => event.sent)).toEqual([200]);
        expect(events.at(-1)?.phase).toBe("end");
    });
});
