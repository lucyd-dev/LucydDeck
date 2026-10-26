// ---------------------------------------------------------------------------
// Which serial port is the deck's bootloader port?
//
// The running deck and its bootloader both report Espressif `303A:1001`, and
// the app's own CDC interface is a serial port too. The locator records the
// deck's identity and the serial ports present **before** the handoff, then
// accepts only a port that was not there before:
//
// - on Linux, match the USB serial number and the physical port path resolved
//   from sysfs;
// - when the HID interface exposes neither a usable serial number nor a path
//   (as on Windows), match the bootloader's vendor/product IDs on a port that
//   appeared after the handoff. A port that existed before the handoff is never
//   selected by PID.
//
// Under usbipd the bootloader can re-enumerate on a different vhci path, so the
// path alone cannot be the identity there. The serial number survives that
// re-enumeration; the path is a corroborating match on native Linux.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { BOOTLOADER_PID } from "@shared/protocol";
import type { HidDescriptorLike } from "@shared/protocol";

export interface SerialPortInfoLike {
    /** OS path used to open the port (`/dev/ttyACM1`, `COM4`). */
    path: string;
    serialNumber?: string;
    locationId?: string;
    pnpId?: string;
    /** USB vendor/product IDs as serialport reports them (`"303A"`, `"1001"`). */
    vendorId?: string;
    productId?: string;
    /** Filled by the locator from `resolveUsbPath` when the platform knows it. */
    usbPath?: string;
}

export interface DeckUsbFingerprint {
    /** Normalized USB serial number, e.g. `806599A5038C`. */
    serialNumber: string | null;
    /** Physical USB port path, e.g. `1-2`, when the platform exposes it. */
    usbPath: string | null;
    /** HID product string, for the log only. */
    product: string | null;
    /** USB vendor/product IDs the ROM bootloader re-enumerates with. */
    bootloaderVendorId: number;
    bootloaderProductId: number;
    /** Serial port paths present before the handoff; never PID candidates. */
    preHandoffPaths: readonly string[];
}

/** Strip separators and case from a USB serial number. */
export function normalizeSerialNumber(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.replace(/[^0-9a-z]/gi, "").toUpperCase();
    return normalized === "" ? null : normalized;
}

/** Normalize a physical USB path (`1-2`) or a Windows location id. */
export function normalizeUsbPath(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/^\/dev\//, "");
    return normalized === "" ? null : normalized;
}

/** Parse serialport's hex USB id strings (`"303A"`, `"0x1001"`). */
function parseUsbId(value: string | undefined): number | null {
    if (typeof value !== "string") {
        return null;
    }
    const hex = value.trim().replace(/^0x/i, "");
    if (hex === "" || !/^[0-9a-f]+$/i.test(hex)) {
        return null;
    }
    return Number.parseInt(hex, 16);
}

function portUsbIds(port: SerialPortInfoLike): { vendorId: number; productId: number } | null {
    const vendorId = parseUsbId(port.vendorId);
    const productId = parseUsbId(port.productId);
    if (vendorId !== null && productId !== null) {
        return { vendorId, productId };
    }
    const match = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(port.pnpId ?? "");
    if (match === null) {
        return null;
    }
    return {
        vendorId: Number.parseInt(match[1]!, 16),
        productId: Number.parseInt(match[2]!, 16),
    };
}

function portMatchesBootloaderIds(
    fingerprint: DeckUsbFingerprint,
    port: SerialPortInfoLike,
): boolean {
    const ids = portUsbIds(port);
    return (
        ids !== null &&
        ids.vendorId === fingerprint.bootloaderVendorId &&
        ids.productId === fingerprint.bootloaderProductId
    );
}

/** A PID match is only accepted on a port that was absent before the handoff. */
function isNewDeckPort(fingerprint: DeckUsbFingerprint, port: SerialPortInfoLike): boolean {
    return (
        !fingerprint.preHandoffPaths.includes(port.path) &&
        portMatchesBootloaderIds(fingerprint, port)
    );
}

const USB_BUS_PORT = /(?:^|\/)(\d+-[\d.]+)(?=\/|$)/g;

/**
 * Resolve a `/dev/hidrawN` or `/dev/ttyACMN` node to its physical USB bus-port
 * path through sysfs (`1-2`). Returns `null` on platforms without sysfs or when
 * the path is not a USB device.
 */
export function usbBusPortFromSysfsPath(resolved: string): string | null {
    const matches = [...resolved.matchAll(USB_BUS_PORT)];
    return matches.at(-1)?.[1] ?? null;
}

export function resolveLinuxUsbPath(devicePath: string): string | null {
    if (process.platform !== "linux" || !devicePath.startsWith("/dev/")) {
        return null;
    }
    const name = path.basename(devicePath);
    const classDir = name.startsWith("hidraw")
        ? "hidraw"
        : name.startsWith("ttyACM") || name.startsWith("ttyUSB")
          ? "tty"
          : null;
    if (classDir === null) {
        return null;
    }
    try {
        const resolved = fs.realpathSync(`/sys/class/${classDir}/${name}/device`);
        return usbBusPortFromSysfsPath(resolved);
    } catch {
        return null;
    }
}

/** Record what makes this deck's loader distinguishable from any other port. */
export function deckUsbFingerprint(
    device: HidDescriptorLike,
    resolveUsbPath: (devicePath: string) => string | null,
    preHandoffPaths: readonly string[],
): DeckUsbFingerprint {
    return {
        serialNumber: normalizeSerialNumber(device.serialNumber),
        usbPath: device.path ? normalizeUsbPath(resolveUsbPath(device.path)) : null,
        product: device.product ?? null,
        bootloaderVendorId: device.vendorId,
        bootloaderProductId: BOOTLOADER_PID,
        preHandoffPaths: [...preHandoffPaths],
    };
}

/** Does this port still carry the identity recorded from the deck's HID interface? */
export function portMatchesFingerprint(
    fingerprint: DeckUsbFingerprint,
    port: SerialPortInfoLike,
): boolean {
    const serial = fingerprint.serialNumber;
    const usbPath = fingerprint.usbPath;
    if (serial === null && usbPath === null) {
        return isNewDeckPort(fingerprint, port);
    }
    if (serial !== null && normalizeSerialNumber(port.serialNumber) !== serial) {
        return false;
    }
    if (usbPath !== null && normalizeUsbPath(port.usbPath ?? port.locationId) !== usbPath) {
        return false;
    }
    return true;
}

/**
 * Pick the one serial port that carries the recorded identity.
 *
 * On Linux the serial number and the sysfs path carry the identity, and either
 * can be missing. On Windows both are missing from the HID descriptor, so the
 * fallback is the recorded VID/PID on a port that was not present before the
 * handoff. A pre-existing port is never accepted by PID, because the running
 * deck's own CDC interface shares `303A:1001`. If two candidates match by
 * different criteria the answer is ambiguous and the caller gets `null` rather
 * than a guess.
 */
export function selectRomPort(
    fingerprint: DeckUsbFingerprint,
    ports: readonly SerialPortInfoLike[],
): SerialPortInfoLike | null {
    const serial = fingerprint.serialNumber;
    const usbPath = fingerprint.usbPath;

    if (serial === null && usbPath === null) {
        const matches = ports.filter((port) => isNewDeckPort(fingerprint, port));
        return matches.length === 1 ? matches[0] : null;
    }

    const candidates = ports.map((port) => ({
        port,
        serialMatch: serial !== null && normalizeSerialNumber(port.serialNumber) === serial,
        pathMatch:
            usbPath !== null && normalizeUsbPath(port.usbPath ?? port.locationId) === usbPath,
    }));

    if (serial !== null) {
        // A known serial number is authoritative. The path cannot carry the
        // identity across usbipd, and a different serial on the same path is a
        // different device.
        const serialMatches = candidates.filter((entry) => entry.serialMatch);
        const only = serialMatches.length === 1 ? serialMatches[0] : undefined;
        if (only !== undefined) {
            return only.port;
        }
        if (serialMatches.length > 1) {
            const both = serialMatches.filter((entry) => entry.pathMatch);
            return both.length === 1 ? both[0].port : null;
        }
        return null;
    }

    const pathMatches = candidates.filter((entry) => entry.pathMatch);
    return pathMatches.length === 1 ? pathMatches[0].port : null;
}
