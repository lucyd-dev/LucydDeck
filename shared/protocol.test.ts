import { describe, expect, it } from "vitest";
import type { HidDescriptorLike } from "./protocol";
import {
    ACK_TIMEOUT_MS,
    DEVICE_PIDS,
    DEVICE_USAGE,
    DEVICE_USAGE_PAGE,
    DEVICE_VID,
    DeviceResponse,
    ErrorCode,
    FRAME_SIZE,
    HostCommand,
    M_BIT,
    PATH_ICON,
    PATH_PAGE,
    PAYLOAD_MAX,
    PAGE_FILENAME_PATTERN,
    REPORT_ID,
    SEQ_MASK,
    STREAM_TIMEOUT_MS,
    capabilitiesFromDeviceInfo,
    describeErrorCode,
    fileDeleteUnsupportedReason,
    findUsbDevice,
    isDeviceOpcode,
    isErrorCode,
    isHostOpcode,
    isValidPageId,
    matchDevice,
    padToPayload,
    pageIdFromFilename,
    supportsFileDelete,
} from "./protocol";
import { buildFrame, parseFrame } from "../electron/main/services/usb/Framer";

describe("shared/protocol constants", () => {
    it("matches the wiki framing constants", () => {
        expect(REPORT_ID).toBe(0x06);
        expect(FRAME_SIZE).toBe(63);
        expect(PAYLOAD_MAX).toBe(60);
        expect(M_BIT).toBe(0x8000);
        expect(SEQ_MASK).toBe(0x7fff);
    });

    it("matches the wiki timeout constants", () => {
        expect(ACK_TIMEOUT_MS).toBe(2000);
        expect(STREAM_TIMEOUT_MS).toBe(3000);
    });

    it("maps path types", () => {
        expect(PATH_PAGE).toBe(0x01);
        expect(PATH_ICON).toBe(0x02);
    });
});

describe("padToPayload", () => {
    it("fills the last HID payload with zeros", () => {
        const padded = padToPayload(Uint8Array.from([0x41]));
        expect(padded).toHaveLength(PAYLOAD_MAX);
        expect(padded[0]).toBe(0x41);
        expect(padded.subarray(1)).toEqual(new Uint8Array(PAYLOAD_MAX - 1));
    });

    it("leaves whole payloads (and empty files) untouched", () => {
        const whole = new Uint8Array(PAYLOAD_MAX * 2);
        expect(padToPayload(whole)).toBe(whole);
        const empty = new Uint8Array(0);
        expect(padToPayload(empty)).toBe(empty);
    });

    it("pads to a caller-chosen payload size", () => {
        expect(padToPayload(Uint8Array.from([1, 2, 3]), 4)).toEqual(Uint8Array.from([1, 2, 3, 0]));
        expect(() => padToPayload(new Uint8Array(), 0)).toThrow(RangeError);
    });
});

describe("shared/protocol opcodes", () => {
    it("matches the OpCodes.hpp host table", () => {
        expect(HostCommand.Ping).toBe(0x00);
        expect(HostCommand.GetDeviceInfo).toBe(0x01);
        expect(HostCommand.GetImagesList).toBe(0x02);
        expect(HostCommand.GetProfilesList).toBe(0x03);
        expect(HostCommand.ProfileCreate).toBe(0x20);
        expect(HostCommand.ProfileRename).toBe(0x21);
        expect(HostCommand.ProfileDelete).toBe(0x22);
        expect(HostCommand.FileStart).toBe(0x30);
        expect(HostCommand.FileChunk).toBe(0x31);
        expect(HostCommand.FileEnd).toBe(0x32);
        expect(HostCommand.FileCancel).toBe(0x33);
        expect(HostCommand.FileDelete).toBe(0x34);
        expect(HostCommand.SetActiveProfile).toBe(0x40);
        expect(HostCommand.SetActivePage).toBe(0x41);
    });

    it("matches the OpCodes.hpp device table", () => {
        expect(DeviceResponse.DeviceInfo).toBe(0x80);
        expect(DeviceResponse.ImagesList).toBe(0x81);
        expect(DeviceResponse.ProfilesList).toBe(0x82);
        expect(DeviceResponse.ActionTriggered).toBe(0xa0);
        expect(DeviceResponse.Error).toBe(0xfe);
        expect(DeviceResponse.Ack).toBe(0xff);
    });

    it("classifies direction from bit 7", () => {
        expect(isHostOpcode(HostCommand.FileStart)).toBe(true);
        expect(isDeviceOpcode(HostCommand.FileStart)).toBe(false);
        expect(isDeviceOpcode(DeviceResponse.Ack)).toBe(true);
        expect(isHostOpcode(DeviceResponse.Ack)).toBe(false);
    });
});

describe("shared/protocol error codes", () => {
    it("matches the exhaustive Errors.hpp table", () => {
        expect(ErrorCode.Ok).toBe(0x00);
        expect(ErrorCode.Sequence).toBe(0x01);
        expect(ErrorCode.UnknownCommand).toBe(0x02);
        expect(ErrorCode.InvalidDirection).toBe(0x03);
        expect(ErrorCode.InvalidPath).toBe(0x10);
        expect(ErrorCode.InvalidPageName).toBe(0x11);
        expect(ErrorCode.ProfileNotFound).toBe(0x12);
        expect(ErrorCode.ProfileExists).toBe(0x13);
        expect(ErrorCode.Create).toBe(0x14);
        expect(ErrorCode.Rename).toBe(0x15);
        expect(ErrorCode.Delete).toBe(0x16);
        expect(ErrorCode.TransferBusy).toBe(0x20);
        expect(ErrorCode.InvalidPathType).toBe(0x21);
        expect(ErrorCode.FileOpen).toBe(0x22);
        expect(ErrorCode.ChunkTooLarge).toBe(0x23);
        expect(ErrorCode.FileNotOpen).toBe(0x24);
        expect(ErrorCode.Write).toBe(0x25);
        expect(ErrorCode.NoTransfer).toBe(0x26);
        expect(ErrorCode.CrcMissing).toBe(0x27);
        expect(ErrorCode.Crc).toBe(0x28);
        expect(ErrorCode.Finalize).toBe(0x29);
        expect(ErrorCode.FileNotFound).toBe(0x2a);
        expect(ErrorCode.UnknownAction).toBe(0x30);
        expect(ErrorCode.PageLoad).toBe(0x31);
        expect(ErrorCode.ProfileLoad).toBe(0x32);
    });

    it("describes known and unknown codes", () => {
        expect(describeErrorCode(ErrorCode.Crc)).toBe("ERR_CRC");
        expect(describeErrorCode(ErrorCode.FileNotFound)).toBe("ERR_FILE_NOT_FOUND");
        expect(isErrorCode(ErrorCode.Crc)).toBe(true);
        expect(isErrorCode(ErrorCode.FileNotFound)).toBe(true);
        expect(isErrorCode(0x99)).toBe(false);
        expect(describeErrorCode(0x99)).toBe("ERR_UNKNOWN(0x99)");
    });
});

describe("shared/protocol deletion capability", () => {
    it("enables deletion only on protocol 2 or newer", () => {
        expect(supportsFileDelete(1)).toBe(false);
        expect(supportsFileDelete("1")).toBe(false);
        expect(supportsFileDelete(2)).toBe(true);
        expect(supportsFileDelete("2")).toBe(true);
        expect(supportsFileDelete("v3")).toBe(true);
        expect(supportsFileDelete(undefined)).toBe(false);
        expect(supportsFileDelete("protocol-two")).toBe(false);
    });

    it("derives capability flags from device info", () => {
        expect(capabilitiesFromDeviceInfo(null)).toEqual({
            deleteFile: false,
            protocolVersion: null,
        });
        expect(capabilitiesFromDeviceInfo({ protocolVersion: 1 })).toEqual({
            deleteFile: false,
            protocolVersion: "1",
        });
        expect(capabilitiesFromDeviceInfo({ protocolVersion: "2" })).toEqual({
            deleteFile: true,
            protocolVersion: "2",
        });
    });

    it("returns one reason string for protocol 1 and null for 2", () => {
        expect(fileDeleteUnsupportedReason({ protocolVersion: 1 })).toContain("protocol 1");
        expect(fileDeleteUnsupportedReason({ protocolVersion: "2" })).toBeNull();
    });
});

describe("shared/protocol page ids", () => {
    it("accepts firmware page ids 0..255", () => {
        expect(isValidPageId(0)).toBe(true);
        expect(isValidPageId("0")).toBe(true);
        expect(isValidPageId("15")).toBe(true);
        expect(isValidPageId("255")).toBe(true);
    });

    it("rejects out-of-range, padded and non-numeric ids", () => {
        expect(isValidPageId("256")).toBe(false);
        expect(isValidPageId("1000")).toBe(false);
        expect(isValidPageId("01")).toBe(true); // firmware parses leading digits
        expect(isValidPageId("x")).toBe(false);
        expect(isValidPageId("")).toBe(false);
    });
});

describe("shared/protocol device matcher", () => {
    const base = {
        vendorId: DEVICE_VID,
        productId: DEVICE_PIDS[0],
        usagePage: DEVICE_USAGE_PAGE,
        usage: DEVICE_USAGE,
    };

    it("matches both documented PIDs", () => {
        for (const pid of DEVICE_PIDS) {
            expect(matchDevice({ ...base, productId: pid })).toEqual({ matched: true, pid });
        }
    });

    it("rejects a different vendor or PID", () => {
        expect(matchDevice({ ...base, vendorId: 0x1234 }).matched).toBe(false);
        expect(matchDevice({ ...base, productId: 0x9999 }).matched).toBe(false);
    });

    it("rejects a mismatched usage page when reported", () => {
        expect(matchDevice({ ...base, usagePage: 0x0001 }).matched).toBe(false);
        expect(matchDevice({ ...base, usage: 0x02 }).matched).toBe(false);
    });

    it("accepts descriptors without usage info", () => {
        expect(matchDevice({ vendorId: DEVICE_VID, productId: DEVICE_PIDS[1] })).toEqual({
            matched: true,
            pid: DEVICE_PIDS[1],
        });
    });

    it("finds the device and reports the matched PID", () => {
        const devices: HidDescriptorLike[] = [
            { vendorId: 0x046d, productId: 0xc52b },
            { ...base, productId: DEVICE_PIDS[1], path: "/dev/hidraw3" },
        ];
        expect(findUsbDevice(devices)?.pid).toBe(DEVICE_PIDS[1]);
        expect(findUsbDevice(devices)?.device.path).toBe("/dev/hidraw3");
        expect(findUsbDevice([{ vendorId: 0x046d, productId: 0xc52b }])).toBeNull();
    });
});

describe("shared/protocol ↔ Framer interop", () => {
    it("round-trips every host command through build/parse", () => {
        const payload = Uint8Array.from([0x7b, 0x7d]);
        for (const opcode of Object.values(HostCommand).filter(
            (value): value is HostCommand => typeof value === "number",
        )) {
            const report = buildFrame(opcode, 0x0007, payload);
            const frame = parseFrame(report);
            expect(frame.opcode).toBe(opcode);
            expect(frame.seq).toBe(0x0007);
            expect(frame.mBit).toBe(false);
            expect(frame.index).toBe(0x0007);
            expect(Array.from(frame.payload.slice(0, payload.length))).toEqual(Array.from(payload));
        }
    });

    it("keeps the payload cap shared with the framer", () => {
        expect(() =>
            buildFrame(HostCommand.FileChunk, 1, new Uint8Array(PAYLOAD_MAX + 1)),
        ).toThrow();
        expect(() =>
            buildFrame(HostCommand.FileChunk, 1, new Uint8Array(PAYLOAD_MAX)),
        ).not.toThrow();
    });
});

describe("pageIdFromFilename", () => {
    it("extracts valid leading-digit ids, including leading zeros", () => {
        expect(pageIdFromFilename("0.json")).toBe("0");
        expect(pageIdFromFilename("12.json")).toBe("12");
        expect(pageIdFromFilename("007.json")).toBe("007");
    });

    it("rejects non-page files, wrong case, and out-of-range ids", () => {
        expect(pageIdFromFilename("page.json")).toBeNull();
        expect(pageIdFromFilename(".json")).toBeNull();
        expect(pageIdFromFilename("5.JSON")).toBeNull();
        expect(pageIdFromFilename("300.json")).toBeNull();
    });

    it("keeps the canonical pattern shared with storage/sync", () => {
        expect(PAGE_FILENAME_PATTERN.exec("12.json")?.[1]).toBe("12");
        expect(PAGE_FILENAME_PATTERN.exec("12.JSON")).toBeNull();
    });
});
