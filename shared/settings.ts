// ---------------------------------------------------------------------------
// Application settings contract shared by the main process and the renderer.
// Pure data + validation: no node/electron imports, so both sides (and the
// tests) can load it.
// ---------------------------------------------------------------------------

export const THEME_PREFERENCES = ["system", "dark", "light"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const RESOLVED_THEMES = ["dark", "light"] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export const ACCENT_PRESETS = {
    violet: { label: "Violet", color: "#7c6cf0", contrast: "#ffffff" },
    blue: { label: "Blue", color: "#3b82f6", contrast: "#ffffff" },
    green: { label: "Green", color: "#16a34a", contrast: "#ffffff" },
    orange: { label: "Orange", color: "#ea8a1f", contrast: "#ffffff" },
    pink: { label: "Pink", color: "#db2777", contrast: "#ffffff" },
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;
export type AccentPresetDefinition = (typeof ACCENT_PRESETS)[AccentPreset];

export interface WindowSettings {
    width: number;
    height: number;
    maximized: boolean;
}

export interface AppSettings {
    theme: ThemePreference;
    accent: AccentPreset;
    window: WindowSettings;
}

export const WINDOW_MIN_WIDTH = 1024;
export const WINDOW_MIN_HEIGHT = 680;
export const WINDOW_DEFAULT_WIDTH = 1280;
export const WINDOW_DEFAULT_HEIGHT = 800;
const WINDOW_MAX_WIDTH = 7680;
const WINDOW_MAX_HEIGHT = 4320;

export const DEFAULT_APP_SETTINGS: AppSettings = {
    theme: "system",
    accent: "violet",
    window: {
        width: WINDOW_DEFAULT_WIDTH,
        height: WINDOW_DEFAULT_HEIGHT,
        maximized: false,
    },
};

const THEME_SET: ReadonlySet<string> = new Set(THEME_PREFERENCES);
const ACCENT_SET: ReadonlySet<string> = new Set(Object.keys(ACCENT_PRESETS));

export function isThemePreference(value: unknown): value is ThemePreference {
    return typeof value === "string" && THEME_SET.has(value);
}

export function isAccentPreset(value: unknown): value is AccentPreset {
    return typeof value === "string" && ACCENT_SET.has(value);
}

function clampDimension(value: unknown, min: number, max: number, fallback: number): number {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
}

function sanitizeWindowSettings(value: unknown): WindowSettings {
    const raw =
        typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
        width: clampDimension(raw.width, WINDOW_MIN_WIDTH, WINDOW_MAX_WIDTH, WINDOW_DEFAULT_WIDTH),
        height: clampDimension(
            raw.height,
            WINDOW_MIN_HEIGHT,
            WINDOW_MAX_HEIGHT,
            WINDOW_DEFAULT_HEIGHT,
        ),
        maximized: raw.maximized === true,
    };
}

/**
 * Normalize an untrusted settings object (settings.json or an IPC payload).
 * Unknown keys are dropped and invalid values fall back to the defaults, so a
 * corrupt file or a hostile renderer can never put the app in a bad state.
 */
export function sanitizeAppSettings(value: unknown): AppSettings {
    const raw =
        typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
        theme: isThemePreference(raw.theme) ? raw.theme : DEFAULT_APP_SETTINGS.theme,
        accent: isAccentPreset(raw.accent) ? raw.accent : DEFAULT_APP_SETTINGS.accent,
        window: sanitizeWindowSettings(raw.window),
    };
}

/** Merge a validated partial update over the current settings. */
export function mergeAppSettings(current: AppSettings, patch: unknown): AppSettings {
    const raw =
        typeof patch === "object" && patch !== null ? (patch as Record<string, unknown>) : {};
    return sanitizeAppSettings({
        theme: raw.theme ?? current.theme,
        accent: raw.accent ?? current.accent,
        window:
            raw.window === undefined
                ? current.window
                : { ...current.window, ...(raw.window as Record<string, unknown>) },
    });
}

/** Resolve the stored preference against the OS preference. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
    if (preference === "system") {
        return prefersDark ? "dark" : "light";
    }
    return preference;
}

/** CSS custom properties for one accent preset (applied on the root element). */
export function accentStyle(accent: AccentPreset): { accent: string; contrast: string } {
    const preset = ACCENT_PRESETS[accent];
    return { accent: preset.color, contrast: preset.contrast };
}
