import { describe, expect, it, vi } from "vitest";
import { HostCommand, PATH_ICON, PATH_PAGE } from "@shared/protocol";
import { DeviceError, DeviceService } from "./DeviceService";
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

    command(opcode: HostCommand, payload: Uint8Array): Promise<Uint8Array> {
        this.calls.push({ opcode, payload });
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

    it("validates names and page ids", async () => {
        const { device } = makeService();
        await expect(device.createProfile("../evil")).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
        await expect(device.setActivePage("300")).rejects.toMatchObject({
            code: "DEVICE_INVALID_PAGE_ID",
        });
        await expect(device.setActivePage("x")).rejects.toMatchObject({
            code: "DEVICE_INVALID_PAGE_ID",
        });
    });

    it("uploads a page with the canonical <id>.json path", async () => {
        const { upload, device } = makeService();
        await device.uploadPage("gaming", 3, '{"buttons":{}}');
        expect(upload).toHaveBeenCalledWith(
            PATH_PAGE,
            "gaming/3.json",
            new TextEncoder().encode('{"buttons":{}}'),
        );
    });

    it("stores icons as <name>.png but exposes the base name", async () => {
        const { upload, device } = makeService();
        await device.uploadIcon("github.png", Uint8Array.from([1, 2, 3]));
        expect(upload).toHaveBeenCalledWith(PATH_ICON, "github.png", Uint8Array.from([1, 2, 3]));
    });

    it("rejects invalid icon names", async () => {
        const { device } = makeService();
        await expect(device.uploadIcon("bad/name", new Uint8Array())).rejects.toMatchObject({
            code: "DEVICE_INVALID_NAME",
        });
    });
});
