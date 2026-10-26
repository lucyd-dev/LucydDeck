<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { LayoutGrid, Plug, Settings as SettingsIcon, Usb, Zap } from "@lucide/vue";
import ConfirmDialog from "@/components/ui/ConfirmDialog.vue";
import Toast from "@/components/ui/Toast.vue";
import Tooltip from "@/components/ui/Tooltip.vue";
import InspectorPanel from "@/components/inspector/InspectorPanel.vue";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useFirmwareStore } from "@/stores/firmwareStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";
import { NARROW_QUERY } from "@/layout";

const route = useRoute();
const app = useAppStore();
const confirm = useConfirmStore();
const firmware = useFirmwareStore();
const profile = useProfileStore();
const usb = useUsbStore();

const views = [
    { name: "deck", label: "Deck", icon: LayoutGrid, to: "/" },
    { name: "plugins", label: "Plugins", icon: Plug, to: "/plugins" },
    { name: "device", label: "Device", icon: Usb, to: "/device" },
    { name: "settings", label: "Settings", icon: SettingsIcon, to: "/settings" },
];

const showInspector = computed(
    () => route.meta.inspector === true && (!app.narrow || app.inspectorOpen),
);
const inspectorOverlay = computed(() => showInspector.value && app.narrow);

let media: MediaQueryList | null = null;

function onMediaChange(event: MediaQueryListEvent | MediaQueryList): void {
    app.setNarrow(event.matches);
}

function onWindowFocus(): void {
    void profile.checkExternalChanges();
}

onMounted(() => {
    void profile.initProfiles();
    void usb.refreshStatus();
    void firmware.checkForUpdate({ silent: true });
    media = window.matchMedia(NARROW_QUERY);
    onMediaChange(media);
    media.addEventListener("change", onMediaChange);
    window.addEventListener("focus", onWindowFocus);
});

onBeforeUnmount(() => {
    media?.removeEventListener("change", onMediaChange);
    window.removeEventListener("focus", onWindowFocus);
});

watch(
    () => route.fullPath,
    () => {
        if (app.narrow) {
            app.closeInspector();
        }
    },
);
</script>

<template>
    <div
        class="app-shell"
        :class="{
            'app-shell--with-inspector': showInspector,
            'app-shell--inspector-open': inspectorOverlay,
        }"
    >
        <aside class="sidebar">
            <div class="sidebar__brand">
                <span class="sidebar__brand-mark"><Zap :size="16" /></span>
                <span>LucydDeck</span>
            </div>

            <nav class="sidebar__views" aria-label="Views">
                <Tooltip v-for="view in views" :key="view.name" :text="view.label">
                    <RouterLink
                        class="sidebar__view"
                        :class="{ 'sidebar__view--active': route.name === view.name }"
                        :to="view.to"
                        :aria-label="
                            view.name === 'settings' && firmware.updateAvailable
                                ? 'Settings (firmware update available)'
                                : view.label
                        "
                        :aria-current="route.name === view.name ? 'page' : undefined"
                    >
                        <component :is="view.icon" :size="18" />
                        <span
                            v-if="view.name === 'settings' && firmware.updateAvailable"
                            class="sidebar__view-dot"
                            aria-hidden="true"
                        ></span>
                    </RouterLink>
                </Tooltip>
            </nav>

            <div class="sidebar__body">
                <RouterView name="sidebar" />
            </div>

            <footer class="sidebar__footer">
                <button
                    class="device-chip"
                    :class="`device-chip--${app.deviceStatus.state}`"
                    type="button"
                    :disabled="usb.busy || firmware.installing"
                    :title="usb.connected ? 'Disconnect the deck' : 'Connect the deck'"
                    @click="usb.toggle()"
                >
                    <span class="device-chip__dot" aria-hidden="true"></span>
                    <span class="device-chip__label">{{ app.deviceStatus.label }}</span>
                </button>
            </footer>
        </aside>

        <main class="app-shell__content">
            <RouterView />
        </main>

        <button
            v-if="inspectorOverlay"
            class="app-shell__scrim"
            type="button"
            aria-label="Close inspector"
            @click="app.closeInspector()"
        ></button>

        <aside v-if="showInspector" class="app-shell__inspector">
            <InspectorPanel />
        </aside>

        <TransitionGroup tag="div" name="toast" class="app-shell__toasts" aria-live="polite">
            <Toast
                v-for="toast in app.toasts"
                :key="toast.id"
                :level="toast.level"
                :message="toast.message"
                @dismiss="app.dismissToast(toast.id)"
            />
        </TransitionGroup>

        <ConfirmDialog
            v-if="confirm.request !== null"
            :title="confirm.request.title"
            :message="confirm.request.message"
            :confirm-label="confirm.request.confirmLabel"
            :cancel-label="confirm.request.cancelLabel"
            :danger="confirm.request.danger"
            @confirm="confirm.answer(true)"
            @cancel="confirm.answer(false)"
        />
    </div>
</template>
