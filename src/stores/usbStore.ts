import { ref } from "vue";
import { defineStore } from "pinia";
import { DeviceState } from "@shared/ipc";
import type { DeviceInfo, DeviceStatus } from "@shared/ipc";
import { usbClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";

/** USB/HID store: connect/disconnect control plus the cached device info. */
export const useUsbStore = defineStore("usb", () => {
    const status = ref<DeviceStatus>({ state: DeviceState.Disconnected, label: "Disconnected" });
    const deviceInfo = ref<DeviceInfo | null>(null);
    const busy = ref(false);

    function setStatus(next: DeviceStatus): void {
        status.value = { ...next };
        useAppStore().setDeviceStatus(next);
    }

    async function refreshStatus(): Promise<void> {
        const result = await usbClient.status();
        if (result.ok) {
            setStatus(result.data);
        }
    }

    async function connect(): Promise<void> {
        if (busy.value) {
            return;
        }
        busy.value = true;
        try {
            const result = await usbClient.connect();
            if (!result.ok) {
                useAppStore().pushToast("error", result.error);
            }
            await refreshStatus();
        } finally {
            busy.value = false;
        }
    }

    async function disconnect(): Promise<void> {
        if (busy.value) {
            return;
        }
        busy.value = true;
        try {
            await usbClient.disconnect();
            deviceInfo.value = null;
            await refreshStatus();
        } finally {
            busy.value = false;
        }
    }

    async function toggle(): Promise<void> {
        if (status.value.state === DeviceState.Connected) {
            await disconnect();
        } else {
            await connect();
        }
    }

    return {
        status,
        deviceInfo,
        busy,
        setStatus,
        refreshStatus,
        connect,
        disconnect,
        toggle,
    };
});
