<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { CheckCircle2, FolderOpen, Loader2, TriangleAlert, Upload } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import { useSectionQuery } from "@/composables/useSectionQuery";
import { ACCENT_OPTIONS, THEME_OPTIONS, useSettingsStore } from "@/stores/settingsStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useFirmwareStore } from "@/stores/firmwareStore";
import { useUsbStore } from "@/stores/usbStore";
import { DEFAULT_SETTINGS_SECTION, SETTINGS_SECTION_IDS } from "@/views/settingsSections";

const settings = useSettingsStore();
const usb = useUsbStore();
const firmware = useFirmwareStore();
const confirm = useConfirmStore();
const active = useSectionQuery("settings", SETTINGS_SECTION_IDS, DEFAULT_SETTINGS_SECTION);

const licenses = [
    { name: "LucydDeck", license: settings.license },
    { name: "Electron", license: "MIT" },
    { name: "Vue", license: "MIT" },
    { name: "node-hid", license: "MIT / Apache-2.0" },
    { name: "sharp", license: "Apache-2.0" },
    { name: "esptool-js", license: "Apache-2.0" },
    { name: "serialport", license: "MIT" },
    { name: "lucide", license: "ISC" },
];

const percent = computed(() => firmware.state.percent ?? 0);
const stageMessage = computed(() => firmware.progress?.message ?? "");
const showProgress = computed(
    () => firmware.isBusy || firmware.state.phase === "done" || firmware.state.error !== null,
);

function boardLabel(board: string | null): string {
    if (board === "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3") {
        return "Waveshare ESP32-S3 Touch LCD 4.3";
    }
    return board === null || board === "" ? "—" : "Unknown deck";
}

function fileSize(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

async function chooseImage(): Promise<void> {
    const image = await firmware.chooseLocal();
    if (image === null) {
        return;
    }
    const confirmed = await confirm.ask({
        title: "Flash local firmware?",
        message:
            `This writes ${image.name} (${fileSize(image.size)}) to the deck. ` +
            "Profiles, pages, icons and the active page stay on the deck. " +
            "Do not unplug the deck while it is writing.",
        confirmLabel: "Flash firmware",
        danger: true,
    });
    if (!confirmed) {
        await firmware.cancel();
        return;
    }
    await firmware.flashLocal(image);
}

onMounted(() => {
    void firmware.refresh();
});

watch(
    () => usb.connected,
    (connected) => {
        if (connected) {
            void firmware.refresh();
        }
    },
);
</script>

<template>
    <section class="view settings-view">
        <header class="view-header">
            <div>
                <h1 class="view-header__title">Settings</h1>
                <p class="view-header__subtitle">
                    Appearance, firmware, data locations and build information.
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

        <template v-else-if="active === 'firmware'">
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Deck firmware</h2>
                    <span
                        class="badge"
                        :class="usb.connected ? 'badge--success' : 'badge--warning'"
                    >
                        {{ usb.connected ? "Connected" : "Not connected" }}
                    </span>
                </div>
                <p class="settings-section__intro">
                    The version the deck reports for the firmware it is running.
                </p>
                <div class="about-grid">
                    <div class="about-item">
                        <p class="about-item__label">Deck firmware version</p>
                        <p class="about-item__value">
                            {{ firmware.state.installedVersion || "—" }}
                        </p>
                    </div>
                    <div class="about-item">
                        <p class="about-item__label">Deck</p>
                        <p class="about-item__value">
                            {{ boardLabel(firmware.state.board) }}
                        </p>
                    </div>
                </div>
                <p
                    v-if="!usb.connected"
                    class="settings-section__intro settings-section__intro--after"
                >
                    Connect the deck to read its firmware version.
                </p>
            </div>

            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Advanced</h2>
                </div>
                <p class="settings-section__intro">
                    Flash a local firmware image built for this deck. It writes only the firmware,
                    so your profiles, pages, icons and active page stay on the deck.
                </p>

                <div v-if="showProgress" class="firmware-progress">
                    <div class="firmware-progress__row">
                        <span class="firmware-progress__stage">
                            <CheckCircle2
                                v-if="firmware.state.phase === 'done'"
                                :size="14"
                                class="firmware-progress__icon firmware-progress__icon--success"
                            />
                            <TriangleAlert
                                v-else-if="firmware.state.error !== null"
                                :size="14"
                                class="firmware-progress__icon firmware-progress__icon--error"
                            />
                            <Loader2 v-else :size="14" class="is-spinning" aria-hidden="true" />
                            <span v-if="firmware.state.phase === 'done'">
                                Firmware written. The deck is on
                                {{ firmware.state.installedVersion || "the new version" }}.
                            </span>
                            <span v-else-if="firmware.state.error !== null">
                                {{ firmware.state.error.message }}
                            </span>
                            <span v-else>{{ stageMessage }}</span>
                        </span>
                        <span
                            v-if="firmware.state.phase === 'writing'"
                            class="firmware-progress__percent"
                        >
                            {{ percent }}%
                        </span>
                    </div>
                    <div
                        v-if="firmware.state.phase === 'writing'"
                        class="progress"
                        role="progressbar"
                        aria-label="Firmware write progress"
                        :aria-valuenow="percent"
                        aria-valuemin="0"
                        aria-valuemax="100"
                    >
                        <div class="progress__bar" :style="{ width: `${percent}%` }"></div>
                    </div>
                </div>

                <div class="settings-row">
                    <div>
                        <p class="settings-row__label">Local image</p>
                        <p class="settings-row__value">
                            {{
                                firmware.state.image === null
                                    ? "No image selected"
                                    : `${firmware.state.image.name} (${fileSize(firmware.state.image.size)})`
                            }}
                        </p>
                    </div>
                    <div class="settings-row__actions">
                        <Button
                            size="sm"
                            :loading="firmware.picking || firmware.starting"
                            :disabled="!usb.connected || firmware.isBusy"
                            @click="chooseImage()"
                        >
                            <Upload :size="14" />
                            <span>Flash local image…</span>
                        </Button>
                    </div>
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
