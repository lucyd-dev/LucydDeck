<script setup lang="ts">
import { computed, ref } from "vue";
import { Info, Plug, Settings as SettingsIcon, X } from "@lucide/vue";
import PluginsPanel from "@/components/settings/PluginsPanel.vue";
import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";

const emit = defineEmits<{ (event: "close"): void }>();

const app = useAppStore();
const settings = useSettingsStore();

const sections = [
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "plugins", label: "Plugins", icon: Plug },
    { id: "about", label: "About", icon: Info },
];

const active = ref(app.settingsSection || "general");

const activeLabel = computed(
    () => sections.find((section) => section.id === active.value)?.label ?? "Settings",
);
</script>

<template>
    <div class="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-dialog">
            <header class="settings-dialog__header">
                <h2 class="settings-dialog__title">Settings</h2>
                <button
                    class="settings-dialog__close"
                    type="button"
                    title="Close settings"
                    @click="emit('close')"
                >
                    <X :size="16" />
                </button>
            </header>

            <div class="settings-dialog__body">
                <nav class="settings-rail" aria-label="Settings sections">
                    <button
                        v-for="section in sections"
                        :key="section.id"
                        class="settings-rail__item"
                        :class="{ 'settings-rail__item--active': active === section.id }"
                        type="button"
                        @click="active = section.id"
                    >
                        <component :is="section.icon" :size="16" />
                        <span>{{ section.label }}</span>
                    </button>
                </nav>

                <section class="settings-panel">
                    <h3 class="settings-panel__title">{{ activeLabel }}</h3>

                    <template v-if="active === 'general'">
                        <p class="settings-panel__hint">
                            Preferences and the firmware updater ship in Step 5.
                        </p>
                        <p class="settings-panel__context">
                            Data directory: <code>{{ settings.dataDir || "resolved at runtime" }}</code>
                        </p>
                    </template>

                    <PluginsPanel v-else-if="active === 'plugins'" />

                    <template v-else>
                        <p class="settings-panel__hint">
                            LucydDeck host — an open-source, low-cost stream deck alternative.
                        </p>
                    </template>
                </section>
            </div>
        </div>
    </div>
</template>
