// ---------------------------------------------------------------------------
// Typed action steps for the board editor.
//
// The firmware stores one wire string per step (`PAGE:3`, `HID_KEY:CTRL+C`,
// `CMD:obs:start_recording`). The editor works with the parsed form so it can
// describe, edit and round-trip a step without ever showing the raw grammar in
// the sequence list. `shared/actions.ts` remains the single source of truth for
// what the firmware accepts.
// ---------------------------------------------------------------------------

import { buildActionString, parseActionString, validateActionString } from "@shared/actions";
import { pageLabel } from "@shared/pages";

/** Visual grouping the inspector uses for a step. */
export type StepCategory =
    "deck" | "keyboard" | "mouse" | "text" | "timing" | "commands" | "plugins";

/** One step in the editor. `raw` is retained verbatim for repair and saving. */
export interface ActionStep {
    namespace: string;
    args: string;
    raw: string;
}

export interface StepDescription {
    label: string;
    detail: string;
    category: StepCategory;
    /** Present when the firmware would drop this step. */
    invalid?: string;
}

const MAX_LABEL = 44;
const MAX_DETAIL = 64;

const KEY_LABELS: Record<string, string> = {
    CTRL: "Ctrl",
    LEFT_CTRL: "Left Ctrl",
    RIGHT_CTRL: "Right Ctrl",
    SHIFT: "Shift",
    LEFT_SHIFT: "Left Shift",
    RIGHT_SHIFT: "Right Shift",
    ALT: "Alt",
    LEFT_ALT: "Left Alt",
    RIGHT_ALT: "Right Alt",
    GUI: "Super",
    LEFT_GUI: "Left Super",
    RIGHT_GUI: "Right Super",
    ESC: "Esc",
    ESCAPE: "Esc",
    RETURN: "Enter",
    ENTER: "Enter",
    BACKSPACE: "Backspace",
    TAB: "Tab",
    SPACE: "Space",
    DELETE: "Delete",
    DEL: "Delete",
    INSERT: "Insert",
    INS: "Insert",
    HOME: "Home",
    END: "End",
    PAGE_UP: "Page Up",
    PAGE_DOWN: "Page Down",
    PGUP: "Page Up",
    PGDN: "Page Down",
    UP_ARROW: "↑",
    DOWN_ARROW: "↓",
    LEFT_ARROW: "←",
    RIGHT_ARROW: "→",
    MINUS: "−",
    EQUALS: "=",
    LEFT_BRACKET: "[",
    RIGHT_BRACKET: "]",
    BACKSLASH: "\\",
    SEMICOLON: ";",
    QUOTE: "'",
    GRAVE: "`",
    COMMA: ",",
    PERIOD: ".",
    SLASH: "/",
    PRINT_SCREEN: "Print Screen",
    CAPS_LOCK: "Caps Lock",
    NUM_LOCK: "Num Lock",
    SCROLL_LOCK: "Scroll Lock",
    PAUSE: "Pause",
    APPLICATION: "Menu",
    MENU: "Menu",
};

const CONTROL_LABELS: Record<string, string> = {
    VOLUME_UP: "Volume up",
    VOLUME_DOWN: "Volume down",
    MUTE: "Mute",
    PLAY_PAUSE: "Play / pause",
    NEXT_TRACK: "Next track",
    PREV_TRACK: "Previous track",
    STOP: "Stop media",
    BRIGHTNESS_UP: "Brightness up",
    BRIGHTNESS_DOWN: "Brightness down",
    SLEEP: "Sleep",
    WAKE: "Wake",
    POWER: "Power",
    CALCULATOR: "Calculator",
    MAIL: "Mail",
    WWW_HOME: "Browser home",
    WWW_SEARCH: "Browser search",
    WWW_BACK: "Browser back",
    WWW_FORWARD: "Browser forward",
    MEDIA_HOME: "Media home",
    SCREENSHOT: "Screenshot",
    RECORD: "Record",
    RESET: "Reset",
    NEXT_PAGE: "Next page",
    PREV_PAGE: "Previous page",
    TOGGLE_PROFILE: "Toggle profile",
};

const MOUSE_LABELS: Record<string, string> = {
    LEFT: "Left",
    RIGHT: "Right",
    MIDDLE: "Middle",
};

function clip(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function prettyKey(name: string): string {
    if (KEY_LABELS[name] !== undefined) {
        return KEY_LABELS[name];
    }
    if (/^F\d+$/.test(name) || /^KP_\d$/.test(name)) {
        return name;
    }
    return name
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/^\w/, (letter) => letter.toUpperCase());
}

/** The panel grouping for a namespace (unknown namespaces read as commands). */
export function stepCategory(namespace: string): StepCategory {
    switch (namespace) {
        case "PAGE":
        case "PROFILE":
            return "deck";
        case "HID_KEY":
        case "CONTROL_KEY":
            return "keyboard";
        case "MOUSE_MOVE":
        case "MOUSE_CLICK":
            return "mouse";
        case "TEXT":
            return "text";
        case "DELAY":
            return "timing";
        default:
            return "commands";
    }
}

/** Parse a saved action string, keeping the original text for round-tripping. */
export function parseStep(raw: string): ActionStep | null {
    const parsed = parseActionString(raw);
    if (parsed === null) {
        return null;
    }
    return { namespace: parsed.namespace, args: parsed.args, raw };
}

/** Serialize a step back to the firmware's `namespace:args` form. */
export function formatStep(step: ActionStep): string {
    return buildActionString(step.namespace, step.args);
}

/**
 * Turn a wire action into the label and detail the panel shows. Every
 * user-facing step goes through here, so no raw action string reaches the
 * sequence list. Malformed steps stay readable: they report the reason and the
 * original text is kept on `ActionStep.raw`.
 */
export function describeStep(raw: string): StepDescription {
    const step = parseStep(raw);
    if (step === null) {
        const reason = 'Expected "namespace:args"';
        return {
            label: "Invalid step",
            detail: reason,
            category: "commands",
            invalid: reason,
        };
    }

    const validation = validateActionString(raw);
    if (!validation.ok) {
        const reason = validation.reason ?? "Invalid action";
        return {
            label: "Invalid step",
            detail: reason,
            category: stepCategory(step.namespace),
            invalid: reason,
        };
    }

    const { namespace, args } = step;

    switch (namespace) {
        case "PAGE": {
            const label = pageLabel(args);
            return {
                label: clip(`Switch to ${label.toLowerCase()}`, MAX_LABEL),
                detail: label,
                category: "deck",
            };
        }

        case "PROFILE":
            return {
                label: clip(`Switch to profile ${args}`, MAX_LABEL),
                detail: "Deck profile",
                category: "deck",
            };

        case "HID_KEY": {
            const keys = args.split("+").filter(Boolean).map(prettyKey);
            return {
                label: clip(`Press ${keys.join(" + ")}`, MAX_LABEL),
                detail: "Keyboard shortcut",
                category: "keyboard",
            };
        }

        case "CONTROL_KEY":
            return {
                label: clip(CONTROL_LABELS[args] ?? prettyKey(args), MAX_LABEL),
                detail: "Control key",
                category: "keyboard",
            };

        case "MOUSE_MOVE": {
            const [x, y, wheel] = args.split(",");
            return {
                label: "Move cursor",
                detail: clip(
                    `to ${x}, ${y}${wheel !== undefined ? ` · wheel ${wheel}` : ""}`,
                    MAX_DETAIL,
                ),
                category: "mouse",
            };
        }

        case "MOUSE_CLICK": {
            const [button, count] = args.split(",");
            const clicks = Number(count ?? "1");
            const label = clicks === 2 ? "Double-click" : clicks > 2 ? `Click ${clicks}×` : "Click";
            return {
                label,
                detail: `${MOUSE_LABELS[button ?? "LEFT"] ?? prettyKey(button ?? "LEFT")} button`,
                category: "mouse",
            };
        }

        case "DELAY":
            return {
                label: `Wait ${args} ms`,
                detail: "Pause the sequence",
                category: "timing",
            };

        case "TEXT":
            return {
                label: clip(`Type “${clip(args || "…", 30)}”`, MAX_LABEL),
                detail: "Text",
                category: "text",
            };

        case "CMD": {
            const inner = args.indexOf(":");
            if (inner > 0) {
                const handle = args.slice(0, inner);
                const command = args.slice(inner + 1).replace(/_/g, " ");
                return {
                    label: clip(`Run ${handle} · ${command}`, MAX_LABEL),
                    detail: "Plugin command",
                    category: "plugins",
                };
            }
            return {
                label: "Run command",
                detail: clip(args, MAX_DETAIL),
                category: "commands",
            };
        }

        default:
            return {
                label: "Invalid step",
                detail: `Unknown action namespace "${namespace}"`,
                category: "commands",
                invalid: `Unknown action namespace "${namespace}"`,
            };
    }
}

/**
 * Map a parsed step onto the action-picker field names. `null` means the step
 * cannot be edited as typed fields and needs the raw editor.
 */
export function stepValues(step: ActionStep): Record<string, string> | null {
    if (!validateActionString(step.raw).ok) {
        return null;
    }

    switch (step.namespace) {
        case "PAGE":
            return { id: step.args };
        case "PROFILE":
            return { name: step.args };
        case "HID_KEY":
            return { keys: step.args };
        case "CONTROL_KEY":
            return { name: step.args };
        case "MOUSE_MOVE": {
            const [x, y, wheel] = step.args.split(",");
            return { x: x ?? "", y: y ?? "", wheel: wheel ?? "" };
        }
        case "MOUSE_CLICK": {
            const [button, count] = step.args.split(",");
            return { button: button ?? "", count: count ?? "" };
        }
        case "DELAY":
            return { ms: step.args };
        case "TEXT":
            return { text: step.args };
        case "CMD":
            return { command: step.args };
        default:
            return null;
    }
}
