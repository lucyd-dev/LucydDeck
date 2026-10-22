// ---------------------------------------------------------------------------
// Page-config schema (3x5 board).
//
// Firmware wiki `Configuration-Schema.md` / `parsePageJson`:
// - `buttons` is an object whose keys are canonical `"0".."14"` (row-major,
//   index = row * COLS + col); an absent key is an empty slot;
// - each button is `{imageName?, backgroundColor?, label?, click[]}`;
// - malformed action strings are dropped (the device drops them silently), so
//   dropping is a warning, not a fatal error.
//
// Pure module: shared by renderer, main process, and tests.
// ---------------------------------------------------------------------------

import { filterValidActions } from "./actions";
import { normalizeIconName } from "./icons";
import type { ButtonConfig, PageConfig } from "./types";

/** Board geometry: 3 rows x 5 columns = 15 keys. */
export const BOARD_ROWS = 3;
export const BOARD_COLS = 5;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLS;

/** Canonical button-key pattern: `0`..`14` with no leading zeros. */
export const PAGE_INDEX_PATTERN = /^(0|[1-9]|1[0-4])$/;

/** True when `key` is a canonical board index string (`"0"`..`"14"`). */
export function isValidBoardIndex(key: string): boolean {
    return PAGE_INDEX_PATTERN.test(key);
}

/** Canonical key for a numeric board index. */
export function boardIndexToKey(index: number): string {
    return String(index);
}

/** A fresh, empty page. */
export function emptyPageConfig(): PageConfig {
    return { buttons: {} };
}

/** A fresh, empty button. */
export function emptyButtonConfig(): ButtonConfig {
    return { click: [] };
}

export interface PageValidation {
    /** False only for structural errors (or non-canonical/out-of-range keys). */
    ok: boolean;
    errors: string[];
    /** Sanitized config: canonical keys only, invalid actions dropped. */
    page: PageConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Validate and sanitize an unknown page config.
 *
 * - structural problems (not an object, `buttons` not an object, a button not
 *   an object, non-string fields) and non-canonical/out-of-range keys make the
 *   result `ok: false`;
 * - invalid action strings are dropped with an error message but do not fail
 *   validation (mirrors the firmware's silent drop).
 */
export function validatePageConfig(value: unknown): PageValidation {
    const errors: string[] = [];
    if (!isRecord(value)) {
        return { ok: false, errors: ["Page config must be an object"], page: emptyPageConfig() };
    }
    const rawButtons = (value as { buttons?: unknown }).buttons;
    if (!isRecord(rawButtons)) {
        return {
            ok: false,
            errors: ["Page config must have a `buttons` object"],
            page: emptyPageConfig(),
        };
    }

    let fatal = false;
    const buttons: Record<string, ButtonConfig> = {};

    for (const [key, rawButton] of Object.entries(rawButtons)) {
        if (!isValidBoardIndex(key)) {
            fatal = true;
            errors.push(`Button index "${key}" is out of range (expected 0..14)`);
            continue;
        }
        if (!isRecord(rawButton)) {
            fatal = true;
            errors.push(`Button "${key}" must be an object`);
            continue;
        }

        const click = collectActions(rawButton.click, key, errors);

        let imageName: string | undefined;
        if (rawButton.imageName !== undefined) {
            imageName = normalizeIconName(rawButton.imageName) ?? undefined;
            if (imageName === undefined && rawButton.imageName !== "") {
                fatal = true;
                errors.push(`Button "${key}" has an invalid imageName`);
            }
        }

        const backgroundColor = normalizeOptionalString(rawButton.backgroundColor);
        if (rawButton.backgroundColor !== undefined && typeof rawButton.backgroundColor !== "string") {
            fatal = true;
            errors.push(`Button "${key}" has an invalid backgroundColor`);
        }
        const label = normalizeOptionalString(rawButton.label);
        if (rawButton.label !== undefined && typeof rawButton.label !== "string") {
            fatal = true;
            errors.push(`Button "${key}" has an invalid label`);
        }

        const hasContent =
            imageName !== undefined ||
            backgroundColor !== undefined ||
            label !== undefined ||
            click.length > 0;
        if (!hasContent) {
            // Empty slot: absent key is the canonical representation.
            continue;
        }

        const button: ButtonConfig = { click };
        if (imageName !== undefined) {
            button.imageName = imageName;
        }
        if (backgroundColor !== undefined) {
            button.backgroundColor = backgroundColor;
        }
        if (label !== undefined) {
            button.label = label;
        }
        buttons[key] = button;
    }

    return { ok: !fatal, errors, page: { buttons } };
}

function collectActions(
    value: unknown,
    key: string,
    errors: string[],
): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        errors.push(`Button "${key}".click must be an array`);
        return [];
    }
    const { actions, dropped } = filterValidActions(value);
    for (const drop of dropped) {
        errors.push(`Button "${key}".click dropped "${String(drop.value)}": ${drop.reason}`);
    }
    return actions;
}

/**
 * Canonical, minimal page config: canonical keys in ascending order, only
 * non-empty buttons, invalid actions removed. Safe to `JSON.stringify` and
 * upload.
 */
export function serializePageConfig(page: PageConfig): PageConfig {
    const { page: sanitized } = validatePageConfig(page);
    const buttons: Record<string, ButtonConfig> = {};
    for (const key of Object.keys(sanitized.buttons).sort((a, b) => Number(a) - Number(b))) {
        buttons[key] = sanitized.buttons[key];
    }
    return { buttons };
}
