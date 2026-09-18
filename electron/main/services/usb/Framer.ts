// ---------------------------------------------------------------------------
// 64-byte HID report framing for the LucydDeck vendor pipe.
//
// Report layout: [Report ID 0x06][opcode][seqHi][seqLo][payload ≤60][zero pad]
// The 63-byte application frame excludes the report ID. Host→device frames
// zero-pad unused payload bytes; device→host reports always arrive as a full
// 63-byte frame, so callers must strip trailing NULs when reassembling.
// ---------------------------------------------------------------------------

import { FRAME_SIZE, M_BIT, PAYLOAD_MAX, REPORT_ID, SEQ_MASK } from "@shared/protocol";

export interface ParsedFrame {
    opcode: number;
    /** Raw 16-bit sequence word (may carry the M-bit). */
    seq: number;
    /** True when the M-bit (`0x8000`) is set: more frames follow. */
    mBit: boolean;
    /** Chunk index: `seq & 0x7FFF`. */
    index: number;
    /** Raw payload bytes, including any trailing zero padding. */
    payload: Uint8Array;
}

/** Build a 64-byte report (report ID + zero-padded frame). */
export function buildFrame(
    opcode: number,
    seq: number,
    payload: Uint8Array = new Uint8Array(),
): Uint8Array {
    if (!Number.isInteger(opcode) || opcode < 0 || opcode > 0xff) {
        throw new RangeError(`Invalid opcode: ${opcode}`);
    }
    if (!Number.isInteger(seq) || seq < 0 || seq > 0xffff) {
        throw new RangeError(`Invalid sequence: ${seq}`);
    }
    if (payload.length > PAYLOAD_MAX) {
        throw new RangeError(`Payload too large: ${payload.length} > ${PAYLOAD_MAX}`);
    }

    const report = new Uint8Array(1 + FRAME_SIZE);
    report[0] = REPORT_ID;
    report[1] = opcode & 0xff;
    report[2] = (seq >> 8) & 0xff;
    report[3] = seq & 0xff;
    report.set(payload, 4);
    return report;
}

/**
 * Parse a report into its frame. Accepts either a 64-byte report (with report
 * ID) or a bare 63-byte frame, so transports that strip the report ID keep
 * working.
 */
export function parseFrame(report: Uint8Array): ParsedFrame {
    if (report.length !== 1 + FRAME_SIZE && report.length !== FRAME_SIZE) {
        throw new RangeError(`Invalid report length: ${report.length}`);
    }
    let frame = report;
    if (report.length === 1 + FRAME_SIZE) {
        if (report[0] !== REPORT_ID) {
            throw new RangeError(
                `Unexpected report ID: 0x${report[0].toString(16).padStart(2, "0")}`,
            );
        }
        frame = report.subarray(1);
    }

    const opcode = frame[0];
    const seq = (frame[1] << 8) | frame[2];
    return {
        opcode,
        seq,
        mBit: (seq & M_BIT) !== 0,
        index: seq & SEQ_MASK,
        payload: frame.slice(3),
    };
}

/** Strip the zero padding a fixed-size frame carries after the real payload. */
export function trimTrailingZeros(payload: Uint8Array): Uint8Array {
    let end = payload.length;
    while (end > 0 && payload[end - 1] === 0x00) {
        end--;
    }
    return payload.subarray(0, end);
}

/** Compose a device→host sequence word from a 15-bit index and the M-bit. */
export function deviceSequence(index: number, more: boolean): number {
    return (index & SEQ_MASK) | (more ? M_BIT : 0);
}
