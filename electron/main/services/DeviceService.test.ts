import { describe, expect, it, vi } from "vitest";
import { ErrorCode, HostCommand, TARGET_ICON, TARGET_PAGE } from "@shared/protocol";
import { DeviceError, DeviceService } from "./DeviceService";
import { UsbError } from "./UsbService";
import type { FileTransfer, UsbCommandClient } from "./FileTransfer";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

class MockUsb implements UsbCommandClient {
    readonly calls: Array<{ opcode: HostCommand; payload: Uint8Array }> = [];
    response: Uint8Array = new Uint8Array();
    failError: Error | null = null;

    command(opcode: HostCommand, payload: Uint8Array): Promise<Uint8Array> {
        this.calls.push({ opcode, payload });
        if (this.failError !== null) {
            return Promise.reject(this.failError);
        }
        return Promise.resolve(this.response);
    }

    lastPayload(): Uint8Array {
        return this.calls.at(-1)?.payload ?? new Uint8Array();
    }
}

function encode(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
}

function makeService() {
    const usb = new MockUsb();
    const upload = vi.fn(async () => undefined);
    const transfer = { upload } as unknown as FileTransfer;
    const device = new DeviceService(usb, transfer);
    return { usb, upload, device };
}

describe("DeviceService queries", () => {
    it("normalizes RESP_DEVICE_INFO", async () => {
        const { usb, device } = makeService();
        usb.response = encode({
            fw_version: "v0.1.0",
            protocol_version: 1,
            board: "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3",
            free_space_kb: 1234,
        });
        await expect(device.getDeviceInfo()).resolves.toEqual({
            firmwareVersion: "v0.1.0",
            protocolVersion: "1",
            board: "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3",
            freeSpaceKb: 1234,
        });
        expect(usb.calls[0].opcode).toBe(HostCommand.GetDeviceInfo);
    });

    it("parses the image and profile lists", async () => {
        const { usb, device } = makeService();
        usb.response = encode([{ filename: "github.png", hash: 305419896 }]);
        await expect(device.listImages()).resolves.toEqual([
            { filename: "github.png", hash: 305419896 },
        ]);

        usb.response = encode([
            { name: "gaming", pages: [{ id: 3, filename: "3.json", hash: 1 }] },
        ]);
        await expect(device.listProfiles()).resolves.toEqual([
            { name: "gaming", pages: [{ id: 3, filename: "3.json", hash: 1 }] },
        ]);
    });

    it("rejects malformed JSON", async () => {
        const { usb, device } = makeService();
        usb.response = new TextEncoder().encode("{not json");
        await expect(device.getDeviceInfo()).rejects.toBeInstanceOf(DeviceError);
    });
});

describe("DeviceService mutations", () => {
    it("encodes profile commands per OpCodes.hpp", async () => {
        const { usb, device } = makeService();

        await device.createProfile("gaming");
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.ProfileCreate);
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("gaming");

        await device.renameProfile("gaming", "retro");
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.ProfileRename);
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("gaming:retro");

        await device.deleteProfile("retro");
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.ProfileDelete);

        await device.setActiveProfile("retro");
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.SetActiveProfile);

        await device.setActivePage(7);
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.SetActivePage);
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("7");
    });

    it("validates new names with the entity grammar and old names with path safety", async () => {
        const { usb, device } = makeService();
        await expect(device.createProfile("../evil")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.createProfile("v1.2")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.createProfile(" Gaming ")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.renameProfile("gaming", "Gaming: Room")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });

        // The old half is a lookup, so a profile from before the grammar still
        // renames, activates and deletes.
        await device.renameProfile("v1.2", "Gaming Room");
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("v1.2:Gaming Room");
        await expect(device.deleteProfile("v1.2")).resolves.toBeUndefined();
        await expect(device.setActiveProfile("v1.2")).resolves.toBeUndefined();

        await expect(device.setActivePage("300")).rejects.toMatchObject({
            code: "DEVICE_INVALID_PAGE_ID",
        });
        await expect(device.setActivePage("x")).rejects.toMatchObject({
            code: "DEVICE_INVALID_PAGE_ID",
        });
    });

    it("uploads a page by identity so the firmware appends .json", async () => {
        const { upload, device } = makeService();
        await device.uploadPage("gaming", 3, '{"buttons":{}}');
        expect(upload).toHaveBeenCalledWith(
            TARGET_PAGE,
            "gaming/3",
            new TextEncoder().encode('{"buttons":{}}'),
        );
    });

    it("uploads an icon by base name so the firmware appends .png", async () => {
        const { upload, device } = makeService();
        await device.uploadIcon("github.png", Uint8Array.from([1, 2, 3]));
        expect(upload).toHaveBeenCalledWith(TARGET_ICON, "github", Uint8Array.from([1, 2, 3]));
    });

    it("rejects a new icon name outside the entity grammar", async () => {
        const { device } = makeService();
        await expect(device.uploadIcon("v1.2", new Uint8Array())).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.uploadIcon("bad/name", new Uint8Array())).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
    });

    it("lets a legacy icon name be overwritten when the deck already has it", async () => {
        const { upload, device } = makeService();
        await device.uploadIcon("v1.2.png", Uint8Array.from([1]), { allowLegacyName: true });
        expect(upload).toHaveBeenCalledWith(TARGET_ICON, "v1.2", Uint8Array.from([1]));
    });
});

describe("DeviceService file deletion", () => {
    it("encodes CMD_PAGE_DELETE and CMD_ICON_DELETE with an identity payload", async () => {
        const { usb, device } = makeService();

        await device.deletePage("gaming", 3);
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.PageDelete);
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("gaming/3");

        await device.deleteIcon("github.png");
        expect(usb.calls.at(-1)?.opcode).toBe(HostCommand.IconDelete);
        expect(new TextDecoder().decode(usb.lastPayload())).toBe("github");
    });

    it("validates page ids, names and the one-frame identity limit", async () => {
        const { device } = makeService();
        await expect(device.deletePage("gaming", "300")).rejects.toMatchObject({
            code: "DEVICE_INVALID_PAGE_ID",
        });
        await expect(device.deleteIcon("bad/name")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.deleteIcon("x".repeat(61))).rejects.toMatchObject({
            code: "DEVICE_INVALID_IDENTITY",
        });
        await expect(device.deletePage("x".repeat(61), 3)).rejects.toMatchObject({
            code: "DEVICE_INVALID_IDENTITY",
        });
    });

    it("treats a missing deck file as success when asked", async () => {
        const { usb, device } = makeService();
        usb.failError = new UsbError(
            "CMD_ICON_DELETE failed: ERR_FILE_NOT_FOUND",
            "ERR_FILE_NOT_FOUND",
            ErrorCode.FileNotFound,
        );

        await expect(device.deleteIcon("github", { allowMissing: true })).resolves.toBeUndefined();
        await expect(
            device.deletePage("gaming", 3, { allowMissing: true }),
        ).resolves.toBeUndefined();

        // Without the flag the same answer stays an error.
        await expect(device.deleteIcon("github")).rejects.toMatchObject({
            code: "ERR_FILE_NOT_FOUND",
        });
    });

    it("treats a page in a profile the deck never received as already gone", async () => {
        const { usb, device } = makeService();
        usb.failError = new UsbError(
            "CMD_PAGE_DELETE failed: ERR_PROFILE_NOT_FOUND",
            "ERR_PROFILE_NOT_FOUND",
            ErrorCode.ProfileNotFound,
        );

        await expect(
            device.deletePage("draft", 0, { allowMissing: true }),
        ).resolves.toBeUndefined();
        await expect(device.deletePage("draft", 0)).rejects.toMatchObject({
            code: "ERR_PROFILE_NOT_FOUND",
        });
    });

    it("still reports other deck errors when missing files are allowed", async () => {
        const { usb, device } = makeService();
        usb.failError = new UsbError(
            "CMD_PAGE_DELETE failed: ERR_DELETE",
            "ERR_DELETE",
            ErrorCode.Delete,
        );

        await expect(device.deletePage("gaming", 3, { allowMissing: true })).rejects.toMatchObject({
            code: "ERR_DELETE",
        });
    });
});
