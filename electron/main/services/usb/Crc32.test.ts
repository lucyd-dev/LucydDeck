import { describe, expect, it } from "vitest";
import { crc32, crc32BigEndian, crc32ToBigEndian, readCrc32BigEndian } from "./Crc32";

function bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe("Crc32", () => {
    it("matches known IEEE/zlib check values", () => {
        expect(crc32(bytes(""))).toBe(0x00000000);
        expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
        expect(crc32(bytes("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
        expect(crc32(new Uint8Array([0x00]))).toBe(0xd202ef8d);
    });

    it("emits big-endian wire bytes", () => {
        expect(Array.from(crc32ToBigEndian(0x12345678))).toEqual([0x12, 0x34, 0x56, 0x78]);
        expect(Array.from(crc32BigEndian(bytes("123456789")))).toEqual([0xcb, 0xf4, 0x39, 0x26]);
    });

    it("round-trips through the big-endian helpers", () => {
        const value = crc32(bytes("lucyddeck"));
        expect(readCrc32BigEndian(crc32ToBigEndian(value))).toBe(value);
        expect(readCrc32BigEndian(new Uint8Array([0x01, 0x02]))).toBeNull();
    });
});
