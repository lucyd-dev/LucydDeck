// ---------------------------------------------------------------------------
// Wait for the bootloader port after the deck's HID interface drops.
// ---------------------------------------------------------------------------

import { deckUsbFingerprint, resolveLinuxUsbPath, selectRomPort } from "./PortFingerprint";
import type { DeckUsbFingerprint, SerialPortInfoLike } from "./PortFingerprint";
import { listSerialPorts } from "./SerialPortAdapter";
import type { HidDescriptorLike } from "@shared/protocol";
import { delay } from "./delay";

export interface RomPortLocatorOptions {
    /** Test seam: available serial ports. */
    listPorts?: () => Promise<SerialPortInfoLike[]>;
    /** Test seam: physical USB path for a device node. */
    resolveUsbPath?: (devicePath: string) => string | null;
    /** How often to look for the bootloader port. */
    pollMs?: number;
    /** How long to wait for it. */
    timeoutMs?: number;
    /** Test seams for time. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Platform whose port serial rules apply; defaults to this process. */
    platform?: NodeJS.Platform;
}

/**
 * Records the running deck's identity and the serial ports present before the
 * handoff, then finds the one port that appears with that identity. On Linux
 * that is the serial number plus the sysfs path. On Windows the COM port's
 * serial is a PnP instance id, not the HID's USB serial, so the identity is the
 * pre-handoff snapshot plus the recorded `303A:1001` on a port that was absent
 * before the handoff. A pre-existing port is never chosen by PID, because the
 * app's own CDC interface shares that PID.
 */
export class RomPortLocator {
    private readonly listPorts: () => Promise<SerialPortInfoLike[]>;
    private readonly resolveUsbPath: (devicePath: string) => string | null;
    private readonly pollMs: number;
    private readonly timeoutMs: number;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly platform: NodeJS.Platform;

    constructor(options: RomPortLocatorOptions = {}) {
        this.listPorts = options.listPorts ?? listSerialPorts;
        this.resolveUsbPath = options.resolveUsbPath ?? resolveLinuxUsbPath;
        this.pollMs = options.pollMs ?? 250;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.now = options.now ?? Date.now;
        this.sleep = options.sleep ?? delay;
        this.platform = options.platform ?? process.platform;
    }

    /** Record the deck identity and every serial port present before the handoff. */
    async fingerprintFor(device: HidDescriptorLike): Promise<DeckUsbFingerprint> {
        const ports = await this.listPorts();
        return deckUsbFingerprint(
            device,
            this.resolveUsbPath,
            ports.map((port) => port.path),
            this.platform,
        );
    }

    /** Look for the bootloader port once, without waiting. */
    async find(fingerprint: DeckUsbFingerprint): Promise<SerialPortInfoLike | null> {
        return this.scan(fingerprint);
    }

    /** Poll until the bootloader port appears, or return `null` after the timeout. */
    async waitFor(fingerprint: DeckUsbFingerprint): Promise<SerialPortInfoLike | null> {
        const deadline = this.now() + this.timeoutMs;
        for (;;) {
            const match = await this.scan(fingerprint);
            if (match !== null) {
                return match;
            }
            if (this.now() >= deadline) {
                return null;
            }
            await this.sleep(this.pollMs);
        }
    }

    private async scan(fingerprint: DeckUsbFingerprint): Promise<SerialPortInfoLike | null> {
        const ports = await this.listPorts();
        const enriched = ports.map((port) => ({
            ...port,
            usbPath: port.usbPath ?? this.resolveUsbPath(port.path) ?? undefined,
        }));
        return selectRomPort(fingerprint, enriched);
    }
}
