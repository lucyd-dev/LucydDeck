import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
    ACCENT_PRESETS,
    DEFAULT_APP_SETTINGS,
    accentStyle,
    mergeAppSettings,
    resolveTheme,
} from "@shared/settings";
import type { AccentPreset, AppSettings, ThemePreference } from "@shared/settings";
import type { SettingsSnapshot } from "@shared/ipc";
import { settingsClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";

export const THEME_OPTIONS: Array<{ id: ThemePreference; label: string }> = [
    { id: "system", label: "System" },
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" },
];

export const ACCENT_OPTIONS = (
    Object.entries(ACCENT_PRESETS) as Array<[AccentPreset, (typeof ACCENT_PRESETS)[AccentPreset]]>
).map(([id, preset]) => ({ id, ...preset }));

/**
 * Persisted appearance settings and the root-element theme application.
 *
 * `init()` runs before the app mounts, so `data-theme` and `data-accent` are on
 * `<html>` for the first paint. Changing a preference applies it immediately
 * and then persists it through `settings:set`.
 */
export const useSettingsStore = defineStore("settings", () => {
    const settings = ref<AppSettings>(DEFAULT_APP_SETTINGS);
    const snapshot = ref<SettingsSnapshot | null>(null);
    const ready = ref(false);
    let initialization: Promise<void> | null = null;
    let media: MediaQueryList | null = null;

    const theme = computed(() => settings.value.theme);
    const accent = computed(() => settings.value.accent);
    const dataDir = computed(() => snapshot.value?.dataDir ?? "");
    const logsDir = computed(() => snapshot.value?.logsDir ?? "");
    const version = computed(() => snapshot.value?.version ?? "");
    const repository = computed(() => snapshot.value?.repository ?? "");
    const license = computed(() => snapshot.value?.license ?? "MIT");

    function prefersDark(): boolean {
        return media?.matches ?? false;
    }

    function apply(): void {
        if (typeof document === "undefined") {
            return;
        }
        const root = document.documentElement;
        const resolved = resolveTheme(settings.value.theme, prefersDark());
        const accent = accentStyle(settings.value.accent);
        root.dataset.theme = resolved;
        root.dataset.accent = settings.value.accent;
        root.style.colorScheme = resolved;
        root.style.setProperty("--color-accent", accent.accent);
        root.style.setProperty("--color-accent-contrast", accent.contrast);
        try {
            localStorage.setItem("lucyd.theme", resolved);
            localStorage.setItem("lucyd.accent", settings.value.accent);
        } catch {
            // The cache is best-effort; the settings file remains authoritative.
        }
    }

    function watchSystemTheme(): void {
        if (media !== null || typeof window === "undefined") {
            return;
        }
        media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", () => {
            if (settings.value.theme === "system") {
                apply();
            }
        });
    }

    async function init(): Promise<void> {
        if (initialization !== null) {
            return initialization;
        }
        initialization = (async () => {
            watchSystemTheme();
            try {
                const result = await settingsClient.get();
                if (result.ok) {
                    snapshot.value = result.data;
                    settings.value = result.data.settings;
                } else {
                    useAppStore().pushToast("error", result.error);
                }
            } catch (error) {
                useAppStore().pushToast(
                    "error",
                    error instanceof Error ? error.message : String(error),
                );
            }
            apply();
            ready.value = true;
        })();
        return initialization;
    }

    async function persist(patch: Partial<AppSettings>): Promise<void> {
        const previous = settings.value;
        settings.value = mergeAppSettings(previous, patch);
        apply();
        try {
            const result = await settingsClient.set(patch);
            if (!result.ok) {
                settings.value = previous;
                apply();
                useAppStore().pushToast("error", result.error);
                return;
            }
            snapshot.value = result.data;
            settings.value = result.data.settings;
            apply();
        } catch (error) {
            settings.value = previous;
            apply();
            useAppStore().pushToast(
                "error",
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    function setTheme(next: ThemePreference): Promise<void> {
        return persist({ theme: next });
    }

    function setAccent(next: AccentPreset): Promise<void> {
        return persist({ accent: next });
    }

    async function revealDataFolder(): Promise<void> {
        const result = await settingsClient.revealDataFolder();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
        }
    }

    async function openLogsFolder(): Promise<void> {
        const result = await settingsClient.openLogsFolder();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
        }
    }

    return {
        settings,
        snapshot,
        ready,
        theme,
        accent,
        dataDir,
        logsDir,
        version,
        repository,
        license,
        init,
        apply,
        setTheme,
        setAccent,
        revealDataFolder,
        openLogsFolder,
    };
});
