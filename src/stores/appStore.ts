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

/** Global app UI state: toasts, device status chip, and the settings overlay. */
export const useAppStore = defineStore("app", () => {
    const toasts = ref<Toast[]>([]);
    const deviceStatus = ref<DeviceStatus>({
        state: DeviceState.Disconnected,
        label: "Disconnected",
    });
    const settingsOpen = ref(false);
    const settingsSection = ref("general");

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

    function openSettings(section = "general"): void {
        settingsSection.value = section;
        settingsOpen.value = true;
    }

    function closeSettings(): void {
        settingsOpen.value = false;
    }

    // Main-process push events.
    on(eventChannels.toast, (payload) => pushToast(payload.level, payload.message));
    on(eventChannels.usb, (payload) => {
        if (payload.type === "status") {
            setDeviceStatus(payload.status);
        }
    });

    return {
        toasts,
        deviceStatus,
        settingsOpen,
        settingsSection,
        pushToast,
        dismissToast,
        setDeviceStatus,
        openSettings,
        closeSettings,
    };
});
