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
        ...overrides,
    };
}

function port(overrides: Partial<SerialPortInfoLike> = {}): SerialPortInfoLike {
    return {
        path: "/dev/ttyACM1",
        ...overrides,
    };
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
        );
        expect(recorded).toEqual({
            serialNumber: "806599A5038C",
            usbPath: "1-2",
            product: "LucydDeck",
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
        const samePid = port({ path: "/dev/ttyACM0", serialNumber: "AAAAAAAAAAAA" });
        expect(selectRomPort(fingerprint(), [samePid])).toBeNull();
    });

    it("refuses an ambiguous match rather than guessing", () => {
        const one = port({ path: "/dev/ttyACM0", serialNumber: "806599A5038C" });
        const two = port({ path: "/dev/ttyACM1", serialNumber: "806599A5038C" });
        expect(selectRomPort(fingerprint({ usbPath: null }), [one, two])).toBeNull();
    });

    it("has nothing to match without a serial or a path", () => {
        expect(
            selectRomPort(fingerprint({ serialNumber: null, usbPath: null }), [port()]),
        ).toBeNull();
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

    it("has nothing to match without a serial or a path", () => {
        expect(
            portMatchesFingerprint(
                fingerprint({ serialNumber: null, usbPath: null }),
                port({ serialNumber: "806599A5038C", usbPath: "1-2" }),
            ),
        ).toBe(false);
    });
});
