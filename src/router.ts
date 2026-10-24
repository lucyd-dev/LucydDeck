import { createRouter, createWebHashHistory } from "vue-router";
import DeckView from "@/views/DeckView.vue";
import DeckSidebar from "@/views/DeckSidebar.vue";
import DeviceView from "@/views/DeviceView.vue";
import DeviceSidebar from "@/views/DeviceSidebar.vue";
import PluginsView from "@/views/PluginsView.vue";
import PluginsSidebar from "@/views/PluginsSidebar.vue";
import SettingsView from "@/views/SettingsView.vue";
import SettingsSidebar from "@/views/SettingsSidebar.vue";

export default createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: "/",
            name: "deck",
            components: { default: DeckView, sidebar: DeckSidebar },
            meta: { inspector: true },
        },
        {
            path: "/plugins",
            name: "plugins",
            components: { default: PluginsView, sidebar: PluginsSidebar },
        },
        {
            path: "/device",
            name: "device",
            components: { default: DeviceView, sidebar: DeviceSidebar },
        },
        {
            path: "/settings",
            name: "settings",
            components: { default: SettingsView, sidebar: SettingsSidebar },
        },
        { path: "/:pathMatch(.*)*", redirect: "/" },
    ],
});
