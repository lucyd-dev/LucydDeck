import { describe, expect, it } from "vitest";
import { FRAME_SIZE, PAYLOAD_MAX, REPORT_ID } from "@shared/protocol";
import { buildFrame, deviceSequence, parseFrame, trimTrailingZeros } from "./Framer";

describe("Framer.buildFrame", () => {
    it("emits a 64-byte report with the report ID and zero padding", () => {
        const report = buildFrame(0x01, 0x0001, Uint8Array.from([0x7b, 0x7d]));
        expect(report.length).toBe(1 + FRAME_SIZE);
        expect(report[0]).toBe(REPORT_ID);
        expect(report[1]).toBe(0x01);
        expect(report[2]).toBe(0x00);
        expect(report[3]).toBe(0x01);
        expect(Array.from(report.slice(4, 6))).toEqual([0x7b, 0x7d]);
        // Every unused payload byte is zero-filled.
        expect(report.slice(6).every((byte) => byte === 0x00)).toBe(true);
    });

    it("matches the wiki worked-example page-upload frame", () => {
        const path = new TextEncoder().encode("gaming/3.json");
        const report = buildFrame(0x30, 10, Uint8Array.from([0x01, ...path]));
        const expectedHead = [
            0x06, 0x30, 0x00, 0x0a, 0x01, 0x67, 0x61, 0x6d, 0x69, 0x6e, 0x67, 0x2f, 0x33, 0x2e,
            0x6a, 0x73, 0x6f, 0x6e,
        ];
        expect(Array.from(report.slice(0, expectedHead.length))).toEqual(expectedHead);
        expect(report[report.length - 1]).toBe(0x00);
    });

    it("writes the sequence big-endian", () => {
        const report = buildFrame(0x31, 0x1234, Uint8Array.from([0xaa]));
        expect(report[2]).toBe(0x12);
        expect(report[3]).toBe(0x34);
    });

    it("rejects oversized payloads and bad inputs", () => {
        expect(() => buildFrame(0x31, 1, new Uint8Array(PAYLOAD_MAX + 1))).toThrow(RangeError);
        expect(() => buildFrame(0x100, 1)).toThrow(RangeError);
        expect(() => buildFrame(0x31, 0x10000)).toThrow(RangeError);
    });
});

describe("Framer.parseFrame", () => {
    it("round-trips a frame", () => {
        const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
        const frame = parseFrame(buildFrame(0x31, 0x002a, payload));
        expect(frame.opcode).toBe(0x31);
        expect(frame.seq).toBe(0x002a);
        expect(frame.index).toBe(0x002a);
        expect(frame.mBit).toBe(false);
        expect(Array.from(frame.payload.slice(0, 4))).toEqual(Array.from(payload));
        expect(frame.payload.length).toBe(PAYLOAD_MAX);
    });

    it("masks the M-bit and index for device streams", () => {
        const frame = parseFrame(buildFrame(0x82, deviceSequence(0, true)));
        expect(frame.mBit).toBe(true);
        expect(frame.index).toBe(0);
        const last = parseFrame(buildFrame(0x82, deviceSequence(2, false)));
        expect(last.mBit).toBe(false);
        expect(last.index).toBe(2);
    });

    it("accepts 63-byte frames without the report ID", () => {
        const withId = buildFrame(0x01, 1, Uint8Array.from([0x7b, 0x7d]));
        const frame = parseFrame(withId.subarray(1));
        expect(frame.opcode).toBe(0x01);
        expect(frame.seq).toBe(1);
        expect(Array.from(frame.payload.slice(0, 2))).toEqual([0x7b, 0x7d]);
    });

    it("rejects wrong lengths and report IDs", () => {
        expect(() => parseFrame(new Uint8Array(10))).toThrow(RangeError);
        const wrongReportId = buildFrame(0x01, 1);
        wrongReportId[0] = 0x07;
        expect(() => parseFrame(wrongReportId)).toThrow(RangeError);
    });

    it("trims only the trailing zero padding", () => {
        const payload = Uint8Array.from([0x00, 0x41, 0x00]);
        expect(Array.from(trimTrailingZeros(payload))).toEqual([0x00, 0x41]);
    });
});
