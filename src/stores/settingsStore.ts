import { defineStore } from "pinia";

/** Application settings (shell only — Step 5 wires persistence). */
export const useSettingsStore = defineStore("settings", () => {
    const dataDir = "";

    return {
        dataDir,
    };
});
