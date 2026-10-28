import { describe, expect, it } from "vitest";
import {
    crc32,
    crc32BigEndian,
    crc32FromWire,
    crc32ToBigEndian,
    crc32Upload,
    readCrc32BigEndian,
} from "./crc32";

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

    it("hashes the padded 60-byte stream the firmware receives", () => {
        // 0x41 is one byte on disk but 0x41 + 59 * 0x00 on the wire.
        expect(crc32Upload(new Uint8Array([0x41]))).toBe(0xa24e476b);
        // A whole payload needs no fill, so it matches the plain CRC.
        const whole = bytes("1234567890".repeat(6));
        expect(whole).toHaveLength(60);
        expect(crc32Upload(whole)).toBe(crc32(whole));
        expect(Array.from(crc32BigEndian(Uint8Array.from([0x41])))).toEqual([
            0xd3, 0xd9, 0x9e, 0x8b,
        ]);
    });

    it("emits big-endian wire bytes", () => {
        expect(Array.from(crc32ToBigEndian(0xdeadbeef))).toEqual([0xde, 0xad, 0xbe, 0xef]);
        expect(Array.from(crc32BigEndian(bytes("123456789")))).toEqual([0xcb, 0xf4, 0x39, 0x26]);
    });

    it("round-trips through the big-endian helpers", () => {
        const value = crc32(bytes("lucyddeck"));
        expect(readCrc32BigEndian(crc32ToBigEndian(value))).toBe(value);
        expect(readCrc32BigEndian(new Uint8Array([0x01, 0x02]))).toBeNull();
    });

    it("reads an unsigned integer list hash", () => {
        expect(crc32FromWire(0)).toBe(0);
        expect(crc32FromWire(0x89abcdef)).toBe(0x89abcdef);
        expect(crc32FromWire(0xffffffff)).toBe(0xffffffff);
        // A decimal-digit string is tolerated for older serializers.
        expect(crc32FromWire("305419896")).toBe(305419896);
    });

    it("returns null for a hash outside the uint32 range", () => {
        expect(crc32FromWire(null)).toBeNull();
        expect(crc32FromWire(undefined)).toBeNull();
        expect(crc32FromWire("")).toBeNull();
        expect(crc32FromWire("   ")).toBeNull();
        expect(crc32FromWire("not-a-hash")).toBeNull();
        expect(crc32FromWire(Number.NaN)).toBeNull();
        expect(crc32FromWire(Number.POSITIVE_INFINITY)).toBeNull();
        expect(crc32FromWire({ hash: 1 })).toBeNull();
        expect(crc32FromWire(-1)).toBeNull();
        expect(crc32FromWire(4.9)).toBeNull();
        expect(crc32FromWire(2 ** 32)).toBeNull();
        expect(crc32FromWire(2 ** 32 + 7)).toBeNull();
        expect(crc32FromWire("0x1f")).toBeNull();
        expect(crc32FromWire("1e3")).toBeNull();
        expect(crc32FromWire("-1")).toBeNull();
        expect(crc32FromWire("4.9")).toBeNull();
        expect(crc32FromWire("4294967296")).toBeNull();
    });
});
