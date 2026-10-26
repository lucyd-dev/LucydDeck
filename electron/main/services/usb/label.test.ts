import { describe, expect, it } from "vitest";
import { DEVICE_PIDS, DEVICE_VID } from "@shared/protocol";
import { DECK_PRODUCT, describeDevice } from "./label";

const PID = DEVICE_PIDS[1];

function deck(product?: string) {
    return { vendorId: DEVICE_VID, productId: PID, product };
}

describe("describeDevice", () => {
    it("keeps the product string the OS reports on Linux", () => {
        expect(describeDevice(deck("LucydDeck"), PID)).toBe("LucydDeck (0x303a:0x1001)");
    });

    it("substitutes the deck name for the generic Windows HID interface name", () => {
        expect(describeDevice(deck("TinyUSB HID"), PID)).toBe("LucydDeck (0x303a:0x1001)");
    });

    it("substitutes the deck name when the OS reports no product", () => {
        expect(describeDevice(deck(undefined), PID)).toBe("LucydDeck (0x303a:0x1001)");
    });

    it("keeps any other product string", () => {
        expect(describeDevice(deck("Some Other Device"), PID)).toBe(
            "Some Other Device (0x303a:0x1001)",
        );
    });

    it("uses the matched pid and vendor in the suffix", () => {
        const device = { vendorId: DEVICE_VID, productId: DEVICE_PIDS[0], product: DECK_PRODUCT };
        expect(describeDevice(device, DEVICE_PIDS[0])).toBe("LucydDeck (0x303a:0x822e)");
    });
});
