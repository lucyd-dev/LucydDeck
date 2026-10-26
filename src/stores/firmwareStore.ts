import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import {
    FirmwareErrorCodes,
    idleFirmwareState,
    isFirmwareActive,
    isFirmwareBusy,
} from "@shared/firmware";
import type {
    FirmwareCheckRequest,
    FirmwareErrorCode,
    FlashProgressPayload,
    FirmwareImageInfo,
    FirmwareState,
} from "@shared/firmware";
import { eventChannels, on } from "@/ipc/events";
import { firmwareClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";

/**
 * Firmware section state. The main process owns the release check and the
 * flash; this store mirrors its state events and sends the user actions.
 */
export const useFirmwareStore = defineStore("firmware", () => {
    const state = shallowRef<FirmwareState>(idleFirmwareState());
    const progress = ref<FlashProgressPayload | null>(null);
    const picking = ref(false);
    const starting = ref(false);

    const isBusy = computed(() => isFirmwareBusy(state.value.phase));
    const isActive = computed(() => isFirmwareActive(state.value));
    const checking = computed(() => state.value.release.status === "checking");
    const updateAvailable = computed(() => state.value.release.status === "available");

    function apply(next: FirmwareState): void {
        state.value = next;
        if (!isFirmwareBusy(next.phase)) {
            progress.value = null;
        }
    }

    function fail(message: string, code?: string): void {
        state.value = {
            ...state.value,
            phase: "error",
            error: { code: (code as FirmwareErrorCode) ?? FirmwareErrorCodes.Failed, message },
        };
    }

    function failWithToast(message: string, code?: string): void {
        useAppStore().pushToast("error", message);
        fail(message, code);
    }

    function failCheck(message: string, code?: string): void {
        state.value = {
            ...state.value,
            release: {
                ...state.value.release,
                status: "error",
                error: {
                    code: (code as FirmwareErrorCode) ?? FirmwareErrorCodes.Failed,
                    message,
                },
            },
        };
    }

    async function refresh(): Promise<void> {
        const result = await firmwareClient.state();
        if (result.ok) {
            apply(result.data);
        } else {
            fail(result.error, result.code);
        }
    }

    /** Ask for the newest stable release. A launch check stays quiet on failure. */
    async function checkForUpdate(request: FirmwareCheckRequest = {}): Promise<void> {
        const silent = request.silent === true;
        if (isActive.value) {
            return;
        }
        const result = await firmwareClient.check(silent ? { silent: true } : {});
        if (!result.ok) {
            if (silent) {
                return;
            }
            useAppStore().pushToast("error", result.error);
            failCheck(result.error, result.code);
            return;
        }
        apply(result.data);
    }

    /** Install the release the last successful check offered. */
    async function installUpdate(): Promise<boolean> {
        if (starting.value || isActive.value) {
            return false;
        }
        starting.value = true;
        try {
            const result = await firmwareClient.update();
            if (!result.ok) {
                failWithToast(result.error, result.code);
                return false;
            }
            apply(result.data);
            return result.data.phase === "done";
        } finally {
            starting.value = false;
        }
    }

    /** Open the picker and validate; `null` when the user cancelled. */
    async function chooseLocal(): Promise<FirmwareImageInfo | null> {
        if (isActive.value || picking.value) {
            return null;
        }
        picking.value = true;
        try {
            const result = await firmwareClient.flashLocal({});
            if (!result.ok) {
                failWithToast(result.error, result.code);
                return null;
            }
            if (result.data === null) {
                // The picker was cancelled; leave the previous state alone.
                return null;
            }
            apply(result.data);
            return result.data.image;
        } finally {
            picking.value = false;
        }
    }

    /** Start the confirmed local write. Returns false when it could not start. */
    async function flashLocal(image: FirmwareImageInfo): Promise<boolean> {
        if (starting.value) {
            return false;
        }
        starting.value = true;
        try {
            const result = await firmwareClient.flashLocal({
                path: image.path,
                confirmed: true,
            });
            if (!result.ok) {
                failWithToast(result.error, result.code);
                return false;
            }
            if (result.data === null) {
                return false;
            }
            apply(result.data);
            return result.data.phase === "done";
        } finally {
            starting.value = false;
        }
    }

    async function cancel(): Promise<void> {
        const result = await firmwareClient.cancel();
        if (result.ok) {
            apply(result.data);
        }
    }

    // Main-process pushes.
    on(eventChannels.firmwareState, (payload) => apply(payload));
    // Phase comes from `firmware:state`; progress only carries the numbers.
    on(eventChannels.flashProgress, (payload) => {
        progress.value = payload;
    });

    return {
        state,
        progress,
        picking,
        starting,
        isBusy,
        isActive,
        checking,
        updateAvailable,
        refresh,
        checkForUpdate,
        installUpdate,
        chooseLocal,
        flashLocal,
        cancel,
    };
});
