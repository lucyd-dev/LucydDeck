import { describe, expect, it, vi } from "vitest";
import { RomPortLocator } from "./RomPortLocator";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./PortFingerprint";

const fingerprint: DeckUsbFingerprint = {
    serialNumber: "806599A5038C",
    usbPath: "1-2",
    product: "LucydDeck",
};

function loaderPort(): SerialPortInfoLike {
    return {
        path: "/dev/ttyACM1",
        serialNumber: "80:65:99:A5:03:8C",
        usbPath: "1-2",
    };
}

describe("RomPortLocator", () => {
    it("records the HID descriptor with the platform USB path", () => {
        const locator = new RomPortLocator({ resolveUsbPath: () => "1-2" });
        expect(
            locator.fingerprintFor({
                vendorId: 0x303a,
                productId: 0x1001,
                path: "/dev/hidraw0",
                serialNumber: "806599A5038C",
                product: "LucydDeck",
            }),
        ).toEqual(fingerprint);
    });

    it("finds the bootloader port once without waiting", async () => {
        const listPorts = vi
            .fn<() => Promise<SerialPortInfoLike[]>>()
            .mockResolvedValue([loaderPort()]);
        const locator = new RomPortLocator({
            listPorts,
            resolveUsbPath: () => null,
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
