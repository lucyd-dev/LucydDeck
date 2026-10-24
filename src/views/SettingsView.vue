<script setup lang="ts">
import { FolderOpen } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import { useSectionQuery } from "@/composables/useSectionQuery";
import { ACCENT_OPTIONS, THEME_OPTIONS, useSettingsStore } from "@/stores/settingsStore";
import { DEFAULT_SETTINGS_SECTION, SETTINGS_SECTION_IDS } from "@/views/settingsSections";

const settings = useSettingsStore();
const active = useSectionQuery("settings", SETTINGS_SECTION_IDS, DEFAULT_SETTINGS_SECTION);

const licenses = [
    { name: "LucydDeck", license: settings.license },
    { name: "Electron", license: "MIT" },
    { name: "Vue", license: "MIT" },
    { name: "node-hid", license: "MIT / Apache-2.0" },
    { name: "sharp", license: "Apache-2.0" },
    { name: "lucide", license: "ISC" },
];
</script>

<template>
    <section class="view settings-view">
        <header class="view-header">
            <div>
                <h1 class="view-header__title">Settings</h1>
                <p class="view-header__subtitle">
                    Appearance, data locations and build information.
                </p>
            </div>
        </header>

        <template v-if="active === 'appearance'">
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Theme</h2>
                </div>
                <p class="settings-section__intro">
                    System follows the operating system and switches live when it changes.
                </p>
                <div class="theme-options" role="radiogroup" aria-label="Theme">
                    <button
                        v-for="option in THEME_OPTIONS"
                        :key="option.id"
                        class="theme-option"
                        :class="{ 'theme-option--active': settings.theme === option.id }"
                        type="button"
                        role="radio"
                        :aria-checked="settings.theme === option.id"
                        @click="settings.setTheme(option.id)"
                    >
                        <span
                            class="theme-option__preview"
                            :class="`theme-option__preview--${option.id}`"
                            aria-hidden="true"
                        >
                            <span class="theme-option__preview-rail"></span>
                            <span class="theme-option__preview-body"></span>
                        </span>
                        <span class="theme-option__label">{{ option.label }}</span>
                    </button>
                </div>
            </div>

            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Accent</h2>
                </div>
                <p class="settings-section__intro">
                    The accent colours focus rings, selected views and primary actions.
                </p>
                <div class="accent-options" role="radiogroup" aria-label="Accent">
                    <button
                        v-for="option in ACCENT_OPTIONS"
                        :key="option.id"
                        class="accent-swatch"
                        :class="{ 'accent-swatch--active': settings.accent === option.id }"
                        :style="{ '--swatch': option.color }"
                        type="button"
                        role="radio"
                        :aria-checked="settings.accent === option.id"
                        :aria-label="option.label"
                        :title="option.label"
                        @click="settings.setAccent(option.id)"
                    ></button>
                </div>
            </div>
        </template>

        <template v-else-if="active === 'data'">
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Data folder</h2>
                </div>
                <p class="settings-section__intro">
                    Profiles, icons and settings live here. Back it up to keep your deck
                    configuration.
                </p>
                <div class="settings-row">
                    <div>
                        <p class="settings-row__label">Location</p>
                        <p class="settings-row__value">
                            {{ settings.dataDir || "Resolved at runtime" }}
                        </p>
                    </div>
                    <div class="settings-row__actions">
                        <Button size="sm" @click="settings.revealDataFolder()">
                            <FolderOpen :size="14" />
                            <span>Reveal folder</span>
                        </Button>
                    </div>
                </div>
                <div class="settings-row">
                    <div>
                        <p class="settings-row__label">Logs</p>
                        <p class="settings-row__value">
                            {{ settings.logsDir || "Resolved at runtime" }}
                        </p>
                    </div>
                    <div class="settings-row__actions">
                        <Button size="sm" @click="settings.openLogsFolder()">
                            <FolderOpen :size="14" />
                            <span>Open logs</span>
                        </Button>
                    </div>
                </div>
            </div>
        </template>

        <template v-else>
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">About LucydDeck</h2>
                </div>
                <div class="about-grid">
                    <div class="about-item">
                        <p class="about-item__label">Version</p>
                        <p class="about-item__value">{{ settings.version || "—" }}</p>
                    </div>
                    <div class="about-item">
                        <p class="about-item__label">License</p>
                        <p class="about-item__value">{{ settings.license }}</p>
                    </div>
                    <div class="about-item">
                        <p class="about-item__label">Repository</p>
                        <p class="about-item__value">
                            <a
                                v-if="settings.repository"
                                :href="settings.repository"
                                target="_blank"
                                rel="noreferrer"
                            >
                                {{ settings.repository }}
                            </a>
                            <span v-else>—</span>
                        </p>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Licenses</h2>
                </div>
                <ul class="about-licenses">
                    <li v-for="item in licenses" :key="item.name">
                        {{ item.name }} — {{ item.license }}
                    </li>
                </ul>
            </div>
        </template>
    </section>
</template>
