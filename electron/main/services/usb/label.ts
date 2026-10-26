// ---------------------------------------------------------------------------
// Status-chip label for the connected deck.
//
// Linux reports the USB device product (`LucydDeck`, set by the firmware), but
// node-hid on Windows reads the HID *interface* string instead. Arduino-ESP32
// 3.1.1 hardcodes that to `TinyUSB HID`, which would leave the chip reading
// `TinyUSB HID (0x303a:0x1001)`. Fall back to the deck name for that generic
// string and for no string at all; every other reported product is kept.
//
// Only a descriptor that already matched the deck's vendor/product ids reaches
// this helper, so the fallback cannot rename an unrelated device.
// ---------------------------------------------------------------------------

import type { HidDescriptorLike } from "@shared/protocol";

/** Product name used when the OS reports nothing useful. */
export const DECK_PRODUCT = "LucydDeck";

/** The generic HID interface name Arduino-ESP32 puts in the product field. */
const GENERIC_PRODUCT = "tinyusb hid";

function productLabel(reported: string | undefined): string {
    const product = reported?.trim();
    if (!product || product.toLowerCase() === GENERIC_PRODUCT) {
        return DECK_PRODUCT;
    }
    return product;
}

/** `"<product> (0x<vid>:0x<pid>)"` for the status chip. */
export function describeDevice(device: HidDescriptorLike, pid: number): string {
    const product = productLabel(device.product);
    return `${product} (0x${device.vendorId.toString(16)}:0x${pid.toString(16)})`;
}
