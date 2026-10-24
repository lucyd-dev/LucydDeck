// ---------------------------------------------------------------------------
// Canonical action-string grammar (source of truth for host-side validation).
//
// Firmware wiki `Configuration-Schema.md` defines every button action as
// `namespace:args`, split on the FIRST colon only so `TEXT:`/`CMD:` keep any
// further colons verbatim. The device silently drops malformed/unknown
// strings, so the host validates before saving or uploading anything.
//
// This module is pure (no node/electron imports) so the renderer, main
// process, and tests all share one implementation.
// ---------------------------------------------------------------------------

/** Namespaces the firmware understands. */
export const ACTION_NAMESPACES = [
    "PAGE",
    "PROFILE",
    "HID_KEY",
    "CONTROL_KEY",
    "MOUSE_MOVE",
    "MOUSE_CLICK",
    "DELAY",
    "TEXT",
    "CMD",
] as const;

export type ActionNamespace = (typeof ACTION_NAMESPACES)[number];

/**
 * Keyboard usages accepted by `HID_KEY:KEY[+KEY...]`.
 *
 * Names follow the HID usage naming the firmware resolves (letters, digits,
 * function keys, modifiers, navigation, punctuation, keypad). A small set of
 * common aliases (`ESC`, `RETURN`, …) is accepted too. Kept as one exported
 * constant so a firmware revision that renames a usage is a one-line change.
 */
export const HID_KEYS: readonly string[] = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
    ..."0123456789".split(""),
    ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
    "LEFT_CTRL",
    "LEFT_SHIFT",
    "LEFT_ALT",
    "LEFT_GUI",
    "RIGHT_CTRL",
    "RIGHT_SHIFT",
    "RIGHT_ALT",
    "RIGHT_GUI",
    "ENTER",
    "ESCAPE",
    "BACKSPACE",
    "TAB",
    "SPACE",
    "CAPS_LOCK",
    "PRINT_SCREEN",
    "SCROLL_LOCK",
    "PAUSE",
    "INSERT",
    "HOME",
    "PAGE_UP",
    "DELETE",
    "END",
    "PAGE_DOWN",
    "RIGHT_ARROW",
    "LEFT_ARROW",
    "DOWN_ARROW",
    "UP_ARROW",
    "NUM_LOCK",
    "APPLICATION",
    "MENU",
    "POWER",
    "MINUS",
    "EQUALS",
    "LEFT_BRACKET",
    "RIGHT_BRACKET",
    "BACKSLASH",
    "SEMICOLON",
    "QUOTE",
    "GRAVE",
    "COMMA",
    "PERIOD",
    "SLASH",
    ...Array.from({ length: 10 }, (_, index) => `KP_${index}`),
    "KP_DOT",
    "KP_ENTER",
    "KP_PLUS",
    "KP_MINUS",
    "KP_MULTIPLY",
    "KP_DIVIDE",
    // Common aliases.
    "ESC",
    "RETURN",
    "DEL",
    "INS",
    "PGUP",
    "PGDN",
    "CTRL",
    "SHIFT",
    "ALT",
    "GUI",
];

/**
 * Control-key names accepted by `CONTROL_KEY:<NAME>`.
 *
 * These are firmware/consumer-control actions rather than HID keyboard usages
 * (media transport, system, device navigation). Exported for the picker and
 * for tests; adjust here if a firmware revision adds/renames one.
 */
export const CONTROL_KEYS: readonly string[] = [
    "VOLUME_UP",
    "VOLUME_DOWN",
    "MUTE",
    "PLAY_PAUSE",
    "NEXT_TRACK",
    "PREV_TRACK",
    "STOP",
    "BRIGHTNESS_UP",
    "BRIGHTNESS_DOWN",
    "SLEEP",
    "WAKE",
    "POWER",
    "CALCULATOR",
    "MAIL",
    "WWW_HOME",
    "WWW_SEARCH",
    "WWW_BACK",
    "WWW_FORWARD",
    "MEDIA_HOME",
    "SCREENSHOT",
    "RECORD",
    "RESET",
    "NEXT_PAGE",
    "PREV_PAGE",
    "TOGGLE_PROFILE",
];

const HID_KEY_SET = new Set(HID_KEYS);
const CONTROL_KEY_SET = new Set(CONTROL_KEYS);
const NAMESPACE_SET = new Set<string>(ACTION_NAMESPACES);

/** Mouse buttons accepted by `MOUSE_CLICK:<button>[,<count>]`. */
export const MOUSE_BUTTONS = ["LEFT", "RIGHT", "MIDDLE"] as const;

const MOUSE_BUTTON_SET = new Set<string>(MOUSE_BUTTONS);

/** Parsed `namespace:args` pair. `args` is everything after the first colon. */
export interface ParsedAction {
    namespace: string;
    args: string;
}

export interface ActionValidation {
    ok: boolean;
    /** Human-readable reason when `ok` is false. */
    reason?: string;
    parsed?: ParsedAction;
}

export interface ActionValidationOptions {
    /** Override the accepted HID key set (tests / future firmware). */
    hidKeys?: readonly string[];
    /** Override the accepted control key set (tests / future firmware). */
    controlKeys?: readonly string[];
}

const NON_NEGATIVE_INT = /^\d+$/;
const SIGNED_INT = /^-?\d+$/;

/**
 * Split `input` into `{namespace, args}` on the first colon. Returns `null`
 * when the input is not a string, has no colon, or has an empty namespace.
 * Never validates the namespace itself — see `validateActionString`.
 */
export function parseActionString(input: unknown): ParsedAction | null {
    if (typeof input !== "string") {
        return null;
    }
    const separator = input.indexOf(":");
    if (separator <= 0) {
        return null;
    }
    return {
        namespace: input.slice(0, separator),
        args: input.slice(separator + 1),
    };
}

/** Build the canonical `namespace:args` wire string. */
export function buildActionString(namespace: string, args: string): string {
    return `${namespace}:${args}`;
}

/**
 * Validate one action string against the firmware grammar. Returns the parsed
 * pair plus a reason when the string would be dropped on-device.
 */
export function validateActionString(
    input: unknown,
    options: ActionValidationOptions = {},
): ActionValidation {
    const parsed = parseActionString(input);
    if (parsed === null) {
        return { ok: false, reason: 'Expected "namespace:args"' };
    }
    const { namespace, args } = parsed;
    if (!NAMESPACE_SET.has(namespace)) {
        return { ok: false, reason: `Unknown action namespace "${namespace}"`, parsed };
    }

    const hidKeys = options.hidKeys ? new Set(options.hidKeys) : HID_KEY_SET;
    const controlKeys = options.controlKeys ? new Set(options.controlKeys) : CONTROL_KEY_SET;

    switch (namespace) {
        case "PAGE":
            if (!NON_NEGATIVE_INT.test(args)) {
                return {
                    ok: false,
                    reason: "PAGE expects a non-negative integer id (e.g. PAGE:3)",
                    parsed,
                };
            }
            return { ok: true, parsed };

        case "PROFILE":
            if (args.trim() === "") {
                return { ok: false, reason: "PROFILE expects a non-empty name", parsed };
            }
            return { ok: true, parsed };

        case "HID_KEY": {
            const keys = args.split("+");
            if (keys.length === 0 || keys.some((key) => key === "")) {
                return {
                    ok: false,
                    reason: "HID_KEY expects KEY[+KEY...] (e.g. HID_KEY:CTRL+C)",
                    parsed,
                };
            }
            const unknown = keys.find((key) => !hidKeys.has(key));
            if (unknown !== undefined) {
                return { ok: false, reason: `Unknown HID key "${unknown}"`, parsed };
            }
            return { ok: true, parsed };
        }

        case "CONTROL_KEY":
            if (!controlKeys.has(args)) {
                return { ok: false, reason: `Unknown control key "${args}"`, parsed };
            }
            return { ok: true, parsed };

        case "MOUSE_MOVE": {
            const parts = args.split(",");
            if (
                parts.length < 2 ||
                parts.length > 3 ||
                parts.some((part) => !SIGNED_INT.test(part))
            ) {
                return {
                    ok: false,
                    reason: "MOUSE_MOVE expects x,y[,wheel] integers (e.g. MOUSE_MOVE:10,-5)",
                    parsed,
                };
            }
            return { ok: true, parsed };
        }

        case "MOUSE_CLICK": {
            const parts = args.split(",");
            if (parts.length < 1 || parts.length > 2) {
                return {
                    ok: false,
                    reason: "MOUSE_CLICK expects BUTTON[,count] (e.g. MOUSE_CLICK:LEFT)",
                    parsed,
                };
            }
            const [button, count] = parts;
            if (!MOUSE_BUTTON_SET.has(button)) {
                return {
                    ok: false,
                    reason: `MOUSE_CLICK button must be ${MOUSE_BUTTONS.join("/")} (got "${button}")`,
                    parsed,
                };
            }
            if (count !== undefined) {
                const parsedCount = Number(count);
                if (!NON_NEGATIVE_INT.test(count) || parsedCount < 1 || parsedCount > 10) {
                    return {
                        ok: false,
                        reason: "MOUSE_CLICK count must be an integer 1..10",
                        parsed,
                    };
                }
            }
            return { ok: true, parsed };
        }

        case "DELAY":
            if (!NON_NEGATIVE_INT.test(args)) {
                return { ok: false, reason: "DELAY expects a non-negative integer of ms", parsed };
            }
            return { ok: true, parsed };

        case "TEXT":
            // Verbatim; an empty string is still a valid (if useless) payload.
            return { ok: true, parsed };

        case "CMD":
            if (args.trim() === "") {
                return { ok: false, reason: "CMD expects a non-empty command", parsed };
            }
            return { ok: true, parsed };

        default:
            return { ok: false, reason: `Unknown action namespace "${namespace}"`, parsed };
    }
}

/** True when `input` is a fully valid action string. */
export function isValidActionString(
    input: unknown,
    options: ActionValidationOptions = {},
): boolean {
    return validateActionString(input, options).ok;
}

/**
 * Filter a list of action strings, dropping invalid entries. Returns the
 * sanitized strings plus one reason per dropped entry (host-side validation
 * mirrors the firmware's silent drop).
 */
export function filterValidActions(
    actions: readonly unknown[],
    options: ActionValidationOptions = {},
): { actions: string[]; dropped: Array<{ value: unknown; reason: string }> } {
    const kept: string[] = [];
    const dropped: Array<{ value: unknown; reason: string }> = [];
    for (const action of actions) {
        const result = validateActionString(action, options);
        if (result.ok) {
            kept.push(action as string);
        } else {
            dropped.push({ value: action, reason: result.reason ?? "invalid action" });
        }
    }
    return { actions: kept, dropped };
}
