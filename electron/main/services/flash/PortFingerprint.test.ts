import { describe, expect, it } from "vitest";
import {
    deckUsbFingerprint,
    normalizeSerialNumber,
    normalizeUsbPath,
    portMatchesFingerprint,
    selectRomPort,
    usbBusPortFromSysfsPath,
} from "./PortFingerprint";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./PortFingerprint";

function fingerprint(overrides: Partial<DeckUsbFingerprint> = {}): DeckUsbFingerprint {
    return {
        serialNumber: "806599A5038C",
        usbPath: "1-2",
        product: "LucydDeck",
        bootloaderVendorId: 0x303a,
        bootloaderProductId: 0x1001,
        preHandoffPaths: [],
        ...overrides,
    };
}

function port(overrides: Partial<SerialPortInfoLike> = {}): SerialPortInfoLike {
    return {
        path: "/dev/ttyACM1",
        ...overrides,
    };
}

const WINDOWS_LOADER: SerialPortInfoLike = {
    path: "COM4",
    serialNumber: "7&3B2CBCB7&2&0000",
    pnpId: "USB\\VID_303A&PID_1001&MI_00\\7&3B2CBCB7&2&0000",
    vendorId: "303A",
    productId: "1001",
};

const WINDOWS_CDC: SerialPortInfoLike = {
    path: "COM9",
    serialNumber: "7&3B2CBCB7&2&0001",
    pnpId: "USB\\VID_303A&PID_1001&MI_00\\7&3B2CBCB7&2&0001",
    vendorId: "303A",
    productId: "1001",
};

function windowsFingerprint(overrides: Partial<DeckUsbFingerprint> = {}): DeckUsbFingerprint {
    return fingerprint({
        serialNumber: null,
        usbPath: null,
        preHandoffPaths: [WINDOWS_CDC.path],
        ...overrides,
    });
}

describe("normalizeSerialNumber", () => {
    it("matches the app's serial and the ROM loader's punctuated serial", () => {
        expect(normalizeSerialNumber("806599A5038C")).toBe("806599A5038C");
        expect(normalizeSerialNumber("80:65:99:A5:03:8C")).toBe("806599A5038C");
        expect(normalizeSerialNumber("  ")).toBeNull();
        expect(normalizeSerialNumber(undefined)).toBeNull();
    });
});

describe("usbBusPortFromSysfsPath", () => {
    it("takes the deck's own port, not a hub above it", () => {
        expect(
            usbBusPortFromSysfsPath(
                "/sys/devices/pci0000:00/usb2/2-1/2-1.3/2-1.3:1.0/0003:303A:1001.0012",
            ),
        ).toBe("2-1.3");
    });
});

describe("normalizeUsbPath", () => {
    it("lowercases and strips the device prefix", () => {
        expect(normalizeUsbPath("/dev/1-2")).toBe("1-2");
        expect(normalizeUsbPath(" 1-2 ")).toBe("1-2");
    });
});

describe("deckUsbFingerprint", () => {
    it("records the HID serial and the resolved USB path", () => {
        const recorded = deckUsbFingerprint(
            {
                vendorId: 0x303a,
                productId: 0x1001,
                path: "/dev/hidraw0",
                serialNumber: "806599A5038C",
                product: "LucydDeck",
            },
            () => "1-2",
            ["/dev/ttyACM0"],
            "linux",
        );
        expect(recorded).toEqual({
            serialNumber: "806599A5038C",
            usbPath: "1-2",
            product: "LucydDeck",
            bootloaderVendorId: 0x303a,
            bootloaderProductId: 0x1001,
            preHandoffPaths: ["/dev/ttyACM0"],
        });
    });

    it("records the bootloader identity when the HID serial is absent", () => {
        const recorded = deckUsbFingerprint(
            {
                vendorId: 0x303a,
                productId: 0x1001,
                path: "\\\\?\\hid#vid_303a&pid_1001",
                product: "LucydDeck",
                pnpId: "USB\\VID_303A&PID_1001&MI_00\\7&3B2CBCB7&2&0000",
            },
            () => null,
            ["COM9"],
            "win32",
        );
        expect(recorded).toMatchObject({
            serialNumber: null,
            usbPath: null,
            bootloaderVendorId: 0x303a,
            bootloaderProductId: 0x1001,
            preHandoffPaths: ["COM9"],
        });
    });

    it("ignores a non-null HID serial on Windows and selects the new COM port", () => {
        const recorded = deckUsbFingerprint(
            {
                vendorId: 0x303a,
                productId: 0x1001,
                path: "\\\\?\\hid#vid_303a&pid_1001",
                serialNumber: "806599A5038C",
                product: "LucydDeck",
            },
            () => null,
            [WINDOWS_CDC.path],
            "win32",
        );

        expect(recorded.serialNumber).toBeNull();
        expect(selectRomPort(recorded, [WINDOWS_CDC, WINDOWS_LOADER])).toBe(WINDOWS_LOADER);
        expect(selectRomPort(recorded, [WINDOWS_CDC])).toBeNull();
    });

    it("records the bootloader PID even when the HID matched the alternate app PID", () => {
        const recorded = deckUsbFingerprint(
            {
                vendorId: 0x303a,
                productId: 0x822e,
                path: "\\\\?\\hid#vid_303a&pid_822e",
                product: "LucydDeck",
            },
            () => null,
            ["COM9"],
            "linux",
        );
        expect(recorded).toMatchObject({
            bootloaderVendorId: 0x303a,
            bootloaderProductId: 0x1001,
        });
    });
});

describe("selectRomPort", () => {
    it("takes the port with the recorded serial, not the first matching PID", () => {
        const first = port({ path: "/dev/ttyACM0", serialNumber: "AAAAAAAAAAAA" });
        const deck = port({ path: "/dev/ttyACM1", serialNumber: "80:65:99:A5:03:8C" });
        expect(selectRomPort(fingerprint(), [first, deck])).toBe(deck);
    });

    it("falls back to the physical USB path when no serial is reported", () => {
        const other = port({ path: "/dev/ttyACM0", usbPath: "1-1" });
        const deck = port({ path: "/dev/ttyACM1", usbPath: "1-2" });
        expect(selectRomPort(fingerprint({ serialNumber: null }), [other, deck])).toBe(deck);
    });

    it("uses the path to break a shared serial", () => {
        const other = port({
            path: "/dev/ttyACM0",
            usbPath: "1-1",
            serialNumber: "806599A5038C",
        });
        const deck = port({
            path: "/dev/ttyACM1",
            usbPath: "1-2",
            serialNumber: "806599A5038C",
        });
        expect(selectRomPort(fingerprint(), [other, deck])).toBe(deck);
    });

    it("refuses a different serial even on the recorded path", () => {
        const other = port({
            path: "/dev/ttyACM1",
            usbPath: "1-2",
            serialNumber: "AAAAAAAAAAAA",
        });
        expect(selectRomPort(fingerprint(), [other])).toBeNull();
    });

    it("refuses a port that only shares 303A:1001", () => {
        const samePid = port({
            path: "/dev/ttyACM0",
            serialNumber: "AAAAAAAAAAAA",
            vendorId: "303A",
            productId: "1001",
        });
        expect(selectRomPort(fingerprint(), [samePid])).toBeNull();
    });

    it("refuses an ambiguous match rather than guessing", () => {
        const one = port({ path: "/dev/ttyACM0", serialNumber: "806599A5038C" });
        const two = port({ path: "/dev/ttyACM1", serialNumber: "806599A5038C" });
        expect(selectRomPort(fingerprint({ usbPath: null }), [one, two])).toBeNull();
    });

    it("selects the new Windows port by VID/PID", () => {
        expect(selectRomPort(windowsFingerprint(), [WINDOWS_CDC, WINDOWS_LOADER])).toBe(
            WINDOWS_LOADER,
        );
    });

    it("uses the pnpId when serialport omits vendor and product ids", () => {
        const pnpOnly = port({ path: "COM4", pnpId: WINDOWS_LOADER.pnpId });
        expect(selectRomPort(windowsFingerprint(), [WINDOWS_CDC, pnpOnly])).toMatchObject({
            path: "COM4",
        });
    });

    it("never selects a pre-existing port by PID", () => {
        expect(selectRomPort(windowsFingerprint(), [WINDOWS_CDC])).toBeNull();
    });

    it("refuses an ambiguous new Windows PID match", () => {
        const otherLoader = port({
            path: "COM5",
            vendorId: "303A",
            productId: "1001",
        });
        expect(selectRomPort(windowsFingerprint(), [WINDOWS_LOADER, otherLoader])).toBeNull();
    });

    it("refuses a new port with a different Windows VID/PID", () => {
        const other = port({ path: "COM5", vendorId: "1A86", productId: "7523" });
        expect(selectRomPort(windowsFingerprint(), [other])).toBeNull();
    });
});

describe("portMatchesFingerprint", () => {
    it("accepts the port that carries both the serial and the USB path", () => {
        expect(
            portMatchesFingerprint(
                fingerprint(),
                port({ serialNumber: "80:65:99:A5:03:8C", usbPath: "1-2" }),
            ),
        ).toBe(true);
    });

    it("rejects a different serial on the recorded path", () => {
        expect(
            portMatchesFingerprint(
                fingerprint(),
                port({ serialNumber: "AAAAAAAAAAAA", usbPath: "1-2" }),
            ),
        ).toBe(false);
    });

    it("rejects the right serial on a different path", () => {
        expect(
            portMatchesFingerprint(
                fingerprint(),
                port({ serialNumber: "806599A5038C", usbPath: "1-3" }),
            ),
        ).toBe(false);
    });

    it("accepts the new Windows loader and rejects the pre-existing CDC", () => {
        expect(portMatchesFingerprint(windowsFingerprint(), WINDOWS_LOADER)).toBe(true);
        expect(portMatchesFingerprint(windowsFingerprint(), WINDOWS_CDC)).toBe(false);
    });

    it("rejects a port without the recorded USB ids", () => {
        expect(
            portMatchesFingerprint(
                fingerprint({ serialNumber: null, usbPath: null }),
                port({ serialNumber: "806599A5038C", usbPath: "1-2" }),
            ),
        ).toBe(false);
    });
});
