import { defineStore } from "pinia";
import { DeviceState } from "@shared/ipc";
import type { DeviceStatus, ToastPayload } from "@shared/ipc";
import { on } from "@/ipc/events";
import { eventChannels } from "@/ipc/events";

export interface Toast {
    id: number;
    level: ToastPayload["level"];
    message: string;
}

let nextToastId = 1;

/** Global app UI state: toasts + device status chip. */
export const useAppStore = defineStore("app", () => {
    const toasts: Toast[] = [];
    const deviceStatus: DeviceStatus = { state: DeviceState.Disconnected, label: "Disconnected" };

    function pushToast(level: ToastPayload["level"], message: string): void {
        const toast: Toast = { id: nextToastId++, level, message };
        toasts.push(toast);
    }

    function dismissToast(id: number): void {
        const index = toasts.findIndex((toast) => toast.id === id);
        if (index >= 0) {
            toasts.splice(index, 1);
        }
    }

    function setDeviceStatus(status: DeviceStatus): void {
        deviceStatus.state = status.state;
        deviceStatus.label = status.label;
    }

    // Main-process push events.
    on(eventChannels.toast, (payload) => pushToast(payload.level, payload.message));
    on(eventChannels.usb, (payload) => setDeviceStatus(payload));

    return {
        toasts,
        deviceStatus,
        pushToast,
        dismissToast,
        setDeviceStatus,
    };
});
