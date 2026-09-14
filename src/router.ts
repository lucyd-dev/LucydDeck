import { createRouter, createWebHashHistory } from "vue-router";
import BoardEditorView from "@/views/BoardEditorView.vue";
import PluginsView from "@/views/PluginsView.vue";
import SettingsView from "@/views/SettingsView.vue";

export default createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/", name: "board", component: BoardEditorView },
        { path: "/plugins", name: "plugins", component: PluginsView },
        { path: "/settings", name: "settings", component: SettingsView },
    ],
});
