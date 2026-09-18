<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";
import { Settings, Blocks, Save, Plug, Zap, X } from "@lucide/vue";

const app = useAppStore();
const profile = useProfileStore();
const usb = useUsbStore();

const navItems = [
    { to: "/", label: "Board", icon: Blocks },
    { to: "/plugins", label: "Plugins", icon: Plug },
    { to: "/settings", label: "Settings", icon: Settings },
];

onMounted(() => {
    void profile.refreshProfiles();
    void usb.refreshStatus();
});

function changeProfile(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    profile.selectProfile(value);
}
</script>

<template>
    <div class="app-shell">
        <header class="app-shell__topbar app-shell__topbar--bem">
            <div class="topbar__brand">
                <span class="topbar__logo">LucydDeck</span>
            </div>

            <label class="topbar__profile">
                <span class="topbar__profile-label">Profile</span>
                <select
                    class="topbar__profile-select"
                    :value="profile.activeProfile"
                    @change="changeProfile"
                >
                    <option value="" disabled>Select profile…</option>
                    <option v-for="item in profile.profiles" :key="item.name" :value="item.name">
                        {{ item.name }}
                    </option>
                </select>
            </label>

            <button
                class="topbar__status"
                :class="`topbar__status--${app.deviceStatus.state}`"
                type="button"
                :disabled="usb.busy"
                :title="
                    app.deviceStatus.state === 'connected' ? 'Disconnect device' : 'Connect device'
                "
                @click="usb.toggle()"
            >
                <Zap :size="14" />
                <span class="topbar__status-label">{{ app.deviceStatus.label }}</span>
            </button>

            <button class="topbar__save" type="button" disabled title="Save (Step 3)">
                <Save :size="14" />
                <span>Save</span>
            </button>

            <nav class="topbar__nav">
                <router-link
                    v-for="item in navItems"
                    :key="item.to"
                    :to="item.to"
                    class="topbar__nav-link"
                >
                    <component :is="item.icon" :size="14" />
                    <span>{{ item.label }}</span>
                </router-link>
            </nav>
        </header>

        <main class="app-shell__content">
            <router-view />
        </main>

        <aside class="app-shell__inspector">
            <div class="inspector__header">
                <h2 class="inspector__title">Inspector</h2>
            </div>
            <p class="inspector__placeholder">The action sidebar (Step 3) will live here.</p>
        </aside>

        <div class="app-shell__toasts" aria-live="polite">
            <div
                v-for="toast in app.toasts"
                :key="toast.id"
                class="toast"
                :class="`toast--${toast.level}`"
            >
                <span class="toast__message">{{ toast.message }}</span>
                <button
                    class="toast__dismiss"
                    type="button"
                    aria-label="Dismiss"
                    @click="app.dismissToast(toast.id)"
                >
                    <X :size="12" />
                </button>
            </div>
        </div>
    </div>
</template>
