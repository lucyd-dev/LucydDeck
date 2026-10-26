import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { DeviceState } from "@shared/ipc";
import type { DeviceInfo, DeviceStatus, SyncProgressPayload } from "@shared/ipc";
import type { DiffPlan, SyncResult } from "@shared/sync";
import { usbClient, syncClient } from "@/ipc/client";
import { on } from "@/ipc/events";
import { eventChannels } from "@/ipc/events";
import { syncResultMessage } from "@/device/syncResult";
import { useAppStore } from "@/stores/appStore";

/** USB/HID store: connection lifecycle, device info, and delta-sync state. */
export const useUsbStore = defineStore("usb", () => {
    const status = ref<DeviceStatus>({ state: DeviceState.Disconnected, label: "Disconnected" });
    const deviceInfo = ref<DeviceInfo | null>(null);
    const busy = ref(false);
    const syncing = ref(false);
    const transferring = ref(false);
    const syncProgress = ref<SyncProgressPayload | null>(null);

    const connected = computed(() => status.value.state === DeviceState.Connected);

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
            syncProgress.value = null;
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

    /** Fetch the diff plan for the active profile. Returns `null` on error. */
    async function reconcile(activeProfile?: string): Promise<DiffPlan | null> {
        if (!connected.value) {
            useAppStore().pushToast("warning", "Connect a device before syncing");
            return null;
        }
        const result = await syncClient.reconcile(activeProfile);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return null;
        }
        return result.data;
    }

    /** Execute a plan, streaming `sync:progress` into `syncProgress`. */
    async function executePlan(
        plan: DiffPlan,
        options: { allowRemovals?: boolean } = {},
    ): Promise<SyncResult | null> {
        if (!connected.value) {
            useAppStore().pushToast("warning", "Device disconnected; sync aborted");
            return null;
        }
        syncing.value = true;
        syncProgress.value = { phase: "prepare", percent: 0 };
        try {
            const result = await syncClient.execute(plan, options);
            if (!result.ok) {
                useAppStore().pushToast("error", result.error);
                return null;
            }
            useAppStore().pushToast("success", syncResultMessage(result.data));
            return result.data;
        } catch (error) {
            useAppStore().pushToast(
                "error",
                error instanceof Error ? error.message : String(error),
            );
            return null;
        } finally {
            syncing.value = false;
            syncProgress.value = null;
        }
    }

    // Main-process push events.
    on(eventChannels.usb, (payload) => {
        if (payload.type === "transfer-progress") {
            transferring.value =
                payload.phase === "start" || payload.phase === "chunk" || payload.phase === "retry";
            return;
        }
        if (payload.type === "status") {
            setStatus(payload.status);
            if (payload.status.state !== DeviceState.Connected) {
                transferring.value = false;
            }
        }
    });
    on(eventChannels.syncProgress, (payload) => {
        syncProgress.value = payload;
    });

    return {
        status,
        deviceInfo,
        busy,
        syncing,
        transferring,
        syncProgress,
        connected,
        setStatus,
        refreshStatus,
        connect,
        disconnect,
        toggle,
        reconcile,
        executePlan,
    };
});
