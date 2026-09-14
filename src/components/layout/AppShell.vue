<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useProfileStore } from "@/stores/profileStore";
import LucideIcon from "@/components/ui/LucideIcon.vue";

const app = useAppStore();
const profile = useProfileStore();

onMounted(() => {
    void profile.refreshProfiles();
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

            <div class="topbar__status" :class="`topbar__status--${app.deviceStatus.state}`">
                <LucideIcon name="zap" :size="14" />
                <span class="topbar__status-label">{{ app.deviceStatus.label }}</span>
            </div>

            <button class="topbar__save" type="button" disabled title="Save (Step 3)">
                <LucideIcon name="save" :size="14" />
                <span>Save</span>
            </button>

            <nav class="topbar__nav">
                <router-link
                    v-for="item in [
                        { to: '/', label: 'Board', icon: 'blocks' },
                        { to: '/plugins', label: 'Plugins', icon: 'plug' },
                        { to: '/settings', label: 'Settings', icon: 'settings' },
                    ]"
                    :key="item.to"
                    :to="item.to"
                    class="topbar__nav-link"
                >
                    <LucideIcon :name="item.icon" :size="14" />
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
                    <LucideIcon name="x" :size="12" />
                </button>
            </div>
        </div>
    </div>
</template>
