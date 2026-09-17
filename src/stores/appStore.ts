import { ref } from "vue";
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
    const toasts = ref<Toast[]>([]);
    const deviceStatus = ref<DeviceStatus>({
        state: DeviceState.Disconnected,
        label: "Disconnected",
    });

    function pushToast(level: ToastPayload["level"], message: string): void {
        const toast: Toast = { id: nextToastId++, level, message };
        toasts.value.push(toast);
    }

    function dismissToast(id: number): void {
        const index = toasts.value.findIndex((toast) => toast.id === id);
        if (index >= 0) {
            toasts.value.splice(index, 1);
        }
    }

    function setDeviceStatus(status: DeviceStatus): void {
        deviceStatus.value = { ...status };
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
