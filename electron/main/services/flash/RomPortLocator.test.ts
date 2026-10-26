import { describe, expect, it, vi } from "vitest";
import { RomPortLocator } from "./RomPortLocator";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./PortFingerprint";

const fingerprint: DeckUsbFingerprint = {
    serialNumber: "806599A5038C",
    usbPath: "1-2",
    product: "LucydDeck",
    bootloaderVendorId: 0x303a,
    bootloaderProductId: 0x1001,
    preHandoffPaths: [],
};

function loaderPort(): SerialPortInfoLike {
    return {
        path: "/dev/ttyACM1",
        serialNumber: "80:65:99:A5:03:8C",
        usbPath: "1-2",
    };
}

describe("RomPortLocator", () => {
    it("records the HID descriptor, the platform USB path and pre-handoff ports", async () => {
        const locator = new RomPortLocator({
            listPorts: async () => [{ path: "/dev/ttyACM0" }],
            resolveUsbPath: () => "1-2",
            platform: "linux",
        });
        await expect(
            locator.fingerprintFor({
                vendorId: 0x303a,
                productId: 0x1001,
                path: "/dev/hidraw0",
                serialNumber: "806599A5038C",
                product: "LucydDeck",
            }),
        ).resolves.toEqual({ ...fingerprint, preHandoffPaths: ["/dev/ttyACM0"] });
    });

    it("excludes the running CDC and finds the new Windows loader", async () => {
        const com9: SerialPortInfoLike = {
            path: "COM9",
            vendorId: "303A",
            productId: "1001",
        };
        const com4: SerialPortInfoLike = {
            path: "COM4",
            serialNumber: "7&3B2CBCB7&2&0000",
            pnpId: "USB\\VID_303A&PID_1001&MI_00\\7&3B2CBCB7&2&0000",
            vendorId: "303A",
            productId: "1001",
        };
        const listPorts = vi
            .fn<() => Promise<SerialPortInfoLike[]>>()
            .mockResolvedValueOnce([com9])
            .mockResolvedValueOnce([com9, com4]);
        const locator = new RomPortLocator({
            listPorts,
            resolveUsbPath: () => null,
            platform: "win32",
        });

        const recorded = await locator.fingerprintFor({
            vendorId: 0x303a,
            productId: 0x1001,
            path: "\\\\?\\hid#vid_303a&pid_1001",
            serialNumber: "806599A5038C",
            product: "LucydDeck",
        });

        expect(recorded).toMatchObject({
            serialNumber: null,
            usbPath: null,
            bootloaderVendorId: 0x303a,
            bootloaderProductId: 0x1001,
            preHandoffPaths: ["COM9"],
        });
        await expect(locator.find(recorded)).resolves.toMatchObject(com4);
    });

    it("finds the bootloader port once without waiting", async () => {
        const listPorts = vi
            .fn<() => Promise<SerialPortInfoLike[]>>()
            .mockResolvedValue([loaderPort()]);
        const locator = new RomPortLocator({
            listPorts,
            resolveUsbPath: () => null,
            platform: "linux",
        });

        await expect(locator.find(fingerprint)).resolves.toEqual(loaderPort());
        expect(listPorts).toHaveBeenCalledTimes(1);
    });

    it("returns no port when the fingerprint no longer matches", async () => {
        const locator = new RomPortLocator({
            listPorts: async () => [
                {
                    path: "/dev/ttyACM1",
                    serialNumber: "11:22:33:44:55:66",
                    usbPath: "1-2",
                },
            ],
            resolveUsbPath: () => null,
            platform: "linux",
        });

        await expect(locator.find(fingerprint)).resolves.toBeNull();
    });

    it("polls until the bootloader port appears on the recorded fingerprint", async () => {
        const listPorts = vi
            .fn<() => Promise<SerialPortInfoLike[]>>()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([loaderPort()]);
        let clock = 0;
        const locator = new RomPortLocator({
            listPorts,
            resolveUsbPath: () => null,
            platform: "linux",
            pollMs: 100,
            timeoutMs: 1000,
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
        });

        await expect(locator.waitFor(fingerprint)).resolves.toEqual(loaderPort());
        expect(listPorts).toHaveBeenCalledTimes(2);
    });

    it("gives up after the timeout", async () => {
        let clock = 0;
        const locator = new RomPortLocator({
            listPorts: async () => [],
            resolveUsbPath: () => null,
            platform: "linux",
            pollMs: 100,
            timeoutMs: 300,
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
        });

        await expect(locator.waitFor(fingerprint)).resolves.toBeNull();
        expect(clock).toBeGreaterThanOrEqual(300);
    });
});
