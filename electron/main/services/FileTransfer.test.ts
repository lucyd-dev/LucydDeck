import { describe, expect, it, vi } from "vitest";
import {
    DeviceResponse,
    ErrorCode,
    FILE_TRANSFER_MAX_BYTES,
    HostCommand,
    PATH_PAGE,
    PathType,
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
        expect(usb.payloads(HostCommand.FileChunk).map((chunk) => chunk.length)).toEqual([
            60, 60, 10,
        ]);
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

describe("FileTransfer CRC", () => {
    it("sends the big-endian CRC32 of all bytes in exact order", async () => {
        const usb = new MockUsb();
        const data = bytes(137);
        await new FileTransfer(usb).upload(PATH_PAGE, PATH, data);
        expect(Array.from(usb.payloads(HostCommand.FileEnd)[0])).toEqual(
            Array.from(crc32BigEndian(data)),
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

    it("aborts when the device disconnects", async () => {
        const usb = new MockUsb();
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
