import { createApp } from "vue";
import { createPinia } from "pinia";
import router from "./router";
import App from "./App.vue";
import { useProfileStore } from "@/stores/profileStore";
import { useSettingsStore } from "@/stores/settingsStore";
import "./assets/scss/main.scss";

async function bootstrap(): Promise<void> {
    const pinia = createPinia();
    const app = createApp(App).use(pinia).use(router);

    // The main process calls this on quit so a write inside the 400 ms
    // debounce window still reaches disk.
    window.lucydEditorFlush = () => useProfileStore(pinia).flushPending();

    // Resolve the persisted theme before the first paint; AppShell mounts only
    // after `data-theme` and `data-accent` are on <html>.
    await useSettingsStore(pinia).init();

    app.mount("#app");
}

void bootstrap();
