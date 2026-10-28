// ---------------------------------------------------------------------------
// IEEE / zlib CRC-32 (poly 0x04C11DB7, reflected, init 0xFFFFFFFF, final XOR
// 0xFFFFFFFF). The firmware uses bakercp/CRC32 with default parameters, which
// this matches byte-for-byte — required for `CMD_FILE_END` and the list hashes.
// ---------------------------------------------------------------------------

import { padToPayload } from "./protocol";
import type { Crc32 } from "./types";

const TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

/** CRC-32 of `bytes` as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): Crc32 {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
        crc = (TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Big-endian 4-byte rendering of a CRC-32 value (wire format). */
export function crc32ToBigEndian(value: Crc32): Uint8Array {
    return Uint8Array.from([
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
    ]);
}

/**
 * CRC-32 of the bytes the device receives for `bytes`: the file zero-padded to
 * whole 60-byte HID payloads. This is both the `CMD_FILE_END` check value and
 * the list hash of the file the firmware stores.
 */
export function crc32Upload(bytes: Uint8Array): Crc32 {
    return crc32(padToPayload(bytes));
}

/** CRC-32 of `bytes`, emitted big-endian (the `CMD_FILE_END` payload). */
export function crc32BigEndian(bytes: Uint8Array): Uint8Array {
    return crc32ToBigEndian(crc32(bytes));
}

/** Decode a big-endian 4-byte CRC from a wire payload. */
export function readCrc32BigEndian(bytes: Uint8Array): Crc32 | null {
    if (bytes.length < 4) {
        return null;
    }
    return (
        (((bytes[0] << 24) >>> 0) +
            ((bytes[1] << 16) >>> 0) +
            ((bytes[2] << 8) >>> 0) +
            (bytes[3] >>> 0)) >>>
        0
    );
}

/**
 * Read one hash from the firmware's list JSON, the one unchecked boundary.
 * The firmware writes `calculateFileCRC(f).finalize()`, a `uint32_t`, as a
 * plain unsigned JSON number (0, not a missing key, when a file is unreadable).
 * A decimal-digit string is tolerated for older serializers; anything else is
 * `null`, which the planner treats as "not on the deck" rather than risking a
 * malformed hash matching a local CRC.
 */
export function crc32FromWire(value: unknown): Crc32 | null {
    if (typeof value === "number") {
        return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
    }
    if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        const parsed = Number(value);
        return parsed <= 0xffffffff ? parsed : null;
    }
    return null;
}
