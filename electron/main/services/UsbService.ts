import log from "electron-log/main";
import { DeviceState } from "@shared/ipc";
import type { DeviceInfo, DeviceStatus } from "@shared/ipc";

/**
 * USB placeholder for Step 1. Step 2 replaces the internals with the HID
 * engine; the renderer-facing surface (`status`, `connect`, `disconnect`,
 * `deviceInfo`) is stable from now on.
 */
export class UsbService {
    private readonly statusValue: DeviceStatus = {
        state: DeviceState.Disconnected,
        label: "No device connected",
    };

    status(): DeviceStatus {
        return { ...this.statusValue };
    }

    deviceInfo(): DeviceInfo | null {
        return null;
    }

    async connect(): Promise<void> {
        log.info("[usb] connect requested (stub — Step 2 implements the HID engine)");
    }

    async disconnect(): Promise<void> {
        log.info("[usb] disconnect requested (stub)");
    }
}
