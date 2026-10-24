import { describe, expect, it } from "vitest";
import {
    ACCENT_PRESETS,
    DEFAULT_APP_SETTINGS,
    WINDOW_MIN_HEIGHT,
    WINDOW_MIN_WIDTH,
    accentStyle,
    isAccentPreset,
    isThemePreference,
    mergeAppSettings,
    resolveTheme,
    sanitizeAppSettings,
} from "./settings";

describe("shared/settings", () => {
    it("falls back to defaults for missing or hostile values", () => {
        expect(sanitizeAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
        expect(sanitizeAppSettings({ theme: "neon", accent: "gold", window: "wide" })).toEqual(
            DEFAULT_APP_SETTINGS,
        );
    });

    it("keeps valid values and clamps the window size", () => {
        expect(
            sanitizeAppSettings({
                theme: "light",
                accent: "blue",
                window: { width: 100, height: 99999, maximized: true },
            }),
        ).toEqual({
            theme: "light",
            accent: "blue",
            window: { width: WINDOW_MIN_WIDTH, height: 4320, maximized: true },
        });
        expect(sanitizeAppSettings({ window: { height: 1 } }).window.height).toBe(
            WINDOW_MIN_HEIGHT,
        );
    });

    it("validates preference names", () => {
        expect(isThemePreference("system")).toBe(true);
        expect(isThemePreference("sepia")).toBe(false);
        expect(isAccentPreset("orange")).toBe(true);
        expect(isAccentPreset("teal")).toBe(false);
    });

    it("merges a partial patch without clobbering other fields", () => {
        const current = mergeAppSettings(DEFAULT_APP_SETTINGS, { theme: "dark" });
        expect(mergeAppSettings(current, { accent: "green" })).toEqual({
            ...DEFAULT_APP_SETTINGS,
            theme: "dark",
            accent: "green",
        });
        expect(mergeAppSettings(current, {})).toEqual(current);
    });

    it("resolves the system theme against the OS preference", () => {
        expect(resolveTheme("system", true)).toBe("dark");
        expect(resolveTheme("system", false)).toBe("light");
        expect(resolveTheme("dark", false)).toBe("dark");
        expect(resolveTheme("light", true)).toBe("light");
    });

    it("exposes a style for every accent preset", () => {
        for (const accent of Object.keys(ACCENT_PRESETS) as Array<keyof typeof ACCENT_PRESETS>) {
            expect(accentStyle(accent)).toEqual({
                accent: ACCENT_PRESETS[accent].color,
                contrast: ACCENT_PRESETS[accent].contrast,
            });
        }
    });
});
