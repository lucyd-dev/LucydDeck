// ---------------------------------------------------------------------------
// Which serial port is the deck's ROM loader?
//
// The running deck and its ROM loader both report Espressif `303A:1001`, and
// the app's own CDC interface is a serial port too. A port is therefore
// selected by the identity recorded from the HID interface before the
// handoff, never by PID alone:
//
// - the USB serial number (the Arduino firmware and the ROM loader both derive
//   it from the chip's MAC, with different separators), and
// - the physical USB port path when the platform exposes it (Linux sysfs).
//
// A port that only shares the PID is not a match.
//
// Under usbipd the ROM device can re-enumerate on a different vhci path, so the
// path alone cannot be the identity there. The serial number survives that
// re-enumeration; the path is a corroborating match on native Linux.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import type { HidDescriptorLike } from "@shared/protocol";

export interface SerialPortInfoLike {
    /** OS path used to open the port (`/dev/ttyACM1`, `COM4`). */
    path: string;
    serialNumber?: string;
    locationId?: string;
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
    resolveUsbPath: (devicePath: string) => string | null = resolveLinuxUsbPath,
): DeckUsbFingerprint {
    return {
        serialNumber: normalizeSerialNumber(device.serialNumber),
        usbPath: device.path ? normalizeUsbPath(resolveUsbPath(device.path)) : null,
        product: device.product ?? null,
    };
}

/**
 * Pick the one serial port that carries the recorded identity.
 *
 * Both criteria are checked because either can be missing: Windows exposes the
 * serial number but no portable USB path, while a device without a serial
 * string still has a sysfs path. Under usbipd the ROM device lands on a
 * different vhci path, so a matching serial number is what carries the
 * identity across the re-enumeration. If two candidates match by different
 * criteria the answer is ambiguous and the caller gets `null` rather than a
 * guess.
 */
export function selectRomPort(
    fingerprint: DeckUsbFingerprint,
    ports: readonly SerialPortInfoLike[],
): SerialPortInfoLike | null {
    const serial = fingerprint.serialNumber;
    const usbPath = fingerprint.usbPath;
    if (serial === null && usbPath === null) {
        return null;
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
