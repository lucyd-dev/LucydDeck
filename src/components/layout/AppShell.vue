<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { RefreshCw, Save, Settings, X, Zap } from "@lucide/vue";
import { diffPlanDeletions, isDiffPlanEmpty } from "@shared/sync";
import InspectorPanel from "@/components/inspector/InspectorPanel.vue";
import ProfileMenu from "@/components/layout/ProfileMenu.vue";
import SettingsDialog from "@/components/settings/SettingsDialog.vue";
import { useAppStore } from "@/stores/appStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";

const app = useAppStore();
const profile = useProfileStore();
const usb = useUsbStore();

const syncBusy = computed(() => usb.syncing);
const syncDisabled = computed(() => !usb.connected || syncBusy.value || profile.saving);
const syncPercent = computed(() => usb.syncProgress?.percent ?? 0);
const syncLabel = computed(() => {
    if (usb.syncing) {
        const progress = usb.syncProgress;
        if (progress?.message) {
            return progress.message;
        }
        if (progress?.current) {
            return `Syncing ${progress.current}`;
        }
        if (progress?.completed !== undefined && progress?.total !== undefined) {
            return `Syncing ${progress.completed}/${progress.total}…`;
        }
        return progress?.phase ?? "Syncing…";
    }
    return "Sync";
});
const saveDisabled = computed(
    () => !profile.dirty || !profile.hasPage || profile.saving || !profile.hasProfile,
);

onMounted(() => {
    void profile.initProfiles();
    void usb.refreshStatus();
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("beforeunload", onBeforeUnload);
});

onBeforeUnmount(() => {
    window.removeEventListener("focus", onWindowFocus);
    window.removeEventListener("beforeunload", onBeforeUnload);
});

function onWindowFocus(): void {
    void profile.checkExternalChanges();
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (profile.dirty) {
        event.preventDefault();
        event.returnValue = "";
    }
}

function save(): void {
    void profile.saveCurrentPage();
}

async function sync(): Promise<void> {
    if (!usb.connected) {
        app.pushToast("warning", "Connect a device before syncing");
        return;
    }
    const plan = await usb.reconcile(profile.activeProfile || undefined);
    if (plan === null) {
        return;
    }
    if (plan.missingIcons.length > 0) {
        app.pushToast(
            "warning",
            `Missing icon(s): ${plan.missingIcons.map((icon) => icon.name).join(", ")}`,
        );
    }
    const deletions = diffPlanDeletions(plan);
    if (isDiffPlanEmpty(plan) && deletions === 0) {
        app.pushToast("info", "Device is already up to date");
        return;
    }
    if (deletions > 0) {
        const confirmed = window.confirm(
            `Upload ${plan.pagesToUpload.length} page(s) and ${plan.iconsToUpload.length} icon(s)?\n\n` +
                `The device has ${deletions} file(s) with no local copy. Protocol v1 has no ` +
                "delete command, so they will be left on the device.",
        );
        if (!confirmed) {
            return;
        }
    }
    await usb.executePlan(plan);
}
</script>

<template>
    <div class="app-shell" :class="{ 'app-shell--settings': app.settingsOpen }">
        <header class="app-shell__topbar">
            <div class="topbar__left">
                <div class="topbar__brand">
                    <span class="topbar__logo">LucydDeck</span>
                </div>
                <ProfileMenu />
            </div>

            <div class="topbar__center">
                <button
                    class="topbar__status"
                    :class="`topbar__status--${app.deviceStatus.state}`"
                    type="button"
                    :disabled="usb.busy"
                    :title="
                        app.deviceStatus.state === 'connected'
                            ? 'Disconnect device'
                            : 'Connect device'
                    "
                    @click="usb.toggle()"
                >
                    <Zap :size="14" />
                    <span class="topbar__status-label">{{ app.deviceStatus.label }}</span>
                </button>
            </div>

            <div class="topbar__right">
                <div class="topbar__actions">
                    <button
                        class="topbar__sync"
                        type="button"
                        :disabled="syncDisabled"
                        :title="usb.connected ? 'Sync with device' : 'Connect a device to sync'"
                        @click="sync"
                    >
                        <RefreshCw :size="14" :class="{ 'is-spinning': syncBusy }" />
                        <span class="topbar__sync-label">{{ syncLabel }}</span>
                        <span
                            v-if="syncBusy"
                            class="topbar__sync-bar"
                            :style="{ width: `${syncPercent}%` }"
                        ></span>
                    </button>

                    <button
                        class="topbar__save"
                        type="button"
                        :disabled="saveDisabled"
                        :title="profile.dirty ? 'Save page' : 'No changes to save'"
                        @click="save"
                    >
                        <Save :size="14" />
                        <span>Save</span>
                        <span
                            v-if="profile.dirty"
                            class="topbar__dirty-dot"
                            title="Unsaved changes"
                        ></span>
                    </button>
                </div>

                <span class="topbar__divider" aria-hidden="true"></span>

                <button
                    class="topbar__settings"
                    type="button"
                    title="Settings"
                    aria-label="Settings"
                    @click="app.openSettings()"
                >
                    <Settings :size="16" />
                </button>
            </div>
        </header>

        <main class="app-shell__content">
            <router-view />
        </main>

        <aside v-if="!app.settingsOpen" class="app-shell__inspector">
            <InspectorPanel />
        </aside>

        <SettingsDialog v-if="app.settingsOpen" @close="app.closeSettings()" />

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
