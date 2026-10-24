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

/** How long a toast lives before it dismisses itself. */
const TOAST_TTL_MS: Record<ToastPayload["level"], number> = {
    success: 4000,
    info: 4000,
    warning: 6000,
    error: 8000,
};

/** Oldest toasts fall off once this many are stacked. */
const TOAST_LIMIT = 4;

/** Global app UI state: toasts, the device chip and the responsive shell. */
export const useAppStore = defineStore("app", () => {
    const toasts = ref<Toast[]>([]);
    const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
    const deviceStatus = ref<DeviceStatus>({
        state: DeviceState.Disconnected,
        label: "Disconnected",
    });
    /** Window narrower than 1100px: the inspector becomes an overlay drawer. */
    const narrow = ref(typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches);
    const inspectorOpen = ref(false);

    function clearToastTimer(id: number): void {
        const timer = toastTimers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            toastTimers.delete(id);
        }
    }

    function scheduleDismiss(id: number, level: ToastPayload["level"]): void {
        clearToastTimer(id);
        toastTimers.set(
            id,
            setTimeout(() => dismissToast(id), TOAST_TTL_MS[level]),
        );
    }

    function pushToast(level: ToastPayload["level"], message: string): void {
        // A repeated message restarts the existing toast instead of stacking a
        // second copy; a sync loop should not paper the screen.
        const existing = toasts.value.find(
            (toast) => toast.level === level && toast.message === message,
        );
        if (existing !== undefined) {
            scheduleDismiss(existing.id, existing.level);
            return;
        }
        const toast: Toast = { id: nextToastId++, level, message };
        toasts.value.push(toast);
        while (toasts.value.length > TOAST_LIMIT) {
            const oldest = toasts.value[0];
            if (oldest === undefined) {
                break;
            }
            dismissToast(oldest.id);
        }
        scheduleDismiss(toast.id, level);
    }

    function dismissToast(id: number): void {
        clearToastTimer(id);
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
