import { ref } from "vue";
import { defineStore } from "pinia";
import { DeviceState } from "@shared/ipc";
import type { DeviceStatus } from "@shared/ipc";

/** USB/HID store shell — Step 2 implements the engine and fills this in. */
export const useUsbStore = defineStore("usb", () => {
    const status = ref<DeviceStatus>({ state: DeviceState.Disconnected, label: "Disconnected" });

    return {
        status,
    };
});
