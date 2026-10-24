import { ref } from "vue";
import { defineStore } from "pinia";
import { DeviceState } from "@shared/ipc";
import type { DeviceStatus, ToastPayload } from "@shared/ipc";
import { on } from "@/ipc/events";
import { eventChannels } from "@/ipc/events";
import { NARROW_QUERY } from "@/layout";

export interface Toast {
    id: number;
    level: ToastPayload["level"];
    message: string;
}

let nextToastId = 1;

/** Global app UI state: toasts, the device chip and the responsive shell. */
export const useAppStore = defineStore("app", () => {
    const toasts = ref<Toast[]>([]);
    const deviceStatus = ref<DeviceStatus>({
        state: DeviceState.Disconnected,
        label: "Disconnected",
    });
    /** Window narrower than 1100px: the inspector becomes an overlay drawer. */
    const narrow = ref(typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches);
    const inspectorOpen = ref(false);

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

    function setNarrow(value: boolean): void {
        narrow.value = value;
        if (!value) {
            inspectorOpen.value = false;
        }
    }

    function toggleInspector(): void {
        inspectorOpen.value = !inspectorOpen.value;
    }

    function closeInspector(): void {
        inspectorOpen.value = false;
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
        narrow,
        inspectorOpen,
        pushToast,
        dismissToast,
        setDeviceStatus,
        setNarrow,
        toggleInspector,
        closeInspector,
    };
});
