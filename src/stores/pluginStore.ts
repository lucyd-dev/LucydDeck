import { ref } from "vue";
import { defineStore } from "pinia";
import type { PluginMeta } from "@shared/ipc";

/** Plugin store shell — Step 4 implements the sandboxed plugin system. */
export const usePluginStore = defineStore("plugins", () => {
    const plugins = ref<PluginMeta[]>([]);

    return {
        plugins,
    };
});
