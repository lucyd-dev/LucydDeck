import { ACTION_NAMESPACES, CONTROL_KEYS, MOUSE_BUTTONS, buildActionString } from "@shared/actions";
import type { ActionNamespace } from "@shared/actions";

/**
 * Action-picker registry.
 *
 * `INTERNAL_ACTION_TYPES` covers the firmware's built-in namespaces and is
 * derived from `ACTION_NAMESPACES`, so the picker and the validator can never
 * drift. The reserved plugin hook (`setPluginCommandProvider`) lets Step 4
 * inject `plugins:listCommands` entries as `CMD:<handle>:<command>` steps
 * without this step knowing anything about the plugin system.
 */

export type ActionFieldKind = "text" | "number" | "select" | "textarea";

/** Inspector rail categories an action type belongs to. */
export type ActionSection = "system" | "lucyddeck" | "plugins";

export interface ActionFieldDef {
    key: string;
    label: string;
    kind: ActionFieldKind;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    optional?: boolean;
    default?: string;
    /** Span both columns in the inspector field grid. */
    wide?: boolean;
}

export interface ActionTypeDef {
    /** Stable id for the picker (unique per type/command). */
    id: string;
    namespace: string;
    label: string;
    section: ActionSection;
    fields: ActionFieldDef[];
    /** Build the canonical action string from the dynamic field values. */
    build: (values: Record<string, string>) => string;
}

export interface PluginCommand {
    handle: string;
    command: string;
    title?: string;
}

export type PluginCommandProvider = () => Promise<PluginCommand[]>;

const selectOptions = (values: readonly string[]) =>
    values.map((value) => ({ value, label: value }));

type ActionTypeSpec = Omit<ActionTypeDef, "id" | "namespace">;

/**
 * One spec per firmware namespace. `Record<ActionNamespace, …>` makes a missing
 * or extra namespace a compile error, keeping this in lockstep with
 * `shared/actions.ts`.
 */
const ACTION_TYPE_BY_NAMESPACE: Record<ActionNamespace, ActionTypeSpec> = {
    PAGE: {
        label: "Switch page",
        section: "lucyddeck",
        fields: [{ key: "id", label: "Page id", kind: "number", placeholder: "0", default: "0" }],
        build: (values) => buildActionString("PAGE", (values.id ?? "").trim()),
    },
    PROFILE: {
        label: "Switch profile",
        section: "lucyddeck",
        fields: [{ key: "name", label: "Profile name", kind: "text", placeholder: "main" }],
        build: (values) => buildActionString("PROFILE", values.name ?? ""),
    },
    HID_KEY: {
        label: "Keyboard shortcut",
        section: "system",
        fields: [
            {
                key: "keys",
                label: "Key combo",
                kind: "text",
                placeholder: "CTRL+C",
                default: "CTRL+C",
                wide: true,
            },
        ],
        build: (values) => buildActionString("HID_KEY", (values.keys ?? "").trim()),
    },
    CONTROL_KEY: {
        label: "Control key",
        section: "system",
        fields: [
            {
                key: "name",
                label: "Control",
                kind: "select",
                options: selectOptions(CONTROL_KEYS),
                default: CONTROL_KEYS[0],
            },
        ],
        build: (values) => buildActionString("CONTROL_KEY", values.name ?? ""),
    },
    MOUSE_MOVE: {
        label: "Mouse move",
        section: "system",
        fields: [
            { key: "x", label: "X", kind: "number", default: "0" },
            { key: "y", label: "Y", kind: "number", default: "0" },
            { key: "wheel", label: "Wheel", kind: "number", optional: true },
        ],
        build: (values) => {
            const x = (values.x ?? "0").trim();
            const y = (values.y ?? "0").trim();
            const wheel = (values.wheel ?? "").trim();
            return buildActionString(
                "MOUSE_MOVE",
                wheel === "" ? `${x},${y}` : `${x},${y},${wheel}`,
            );
        },
    },
    MOUSE_CLICK: {
        label: "Mouse click",
        section: "system",
        fields: [
            {
                key: "button",
                label: "Button",
                kind: "select",
                options: selectOptions(MOUSE_BUTTONS),
                default: "LEFT",
            },
            { key: "count", label: "Count", kind: "number", optional: true, placeholder: "1" },
        ],
        build: (values) => {
            const button = values.button ?? "LEFT";
            const count = (values.count ?? "").trim();
            return buildActionString("MOUSE_CLICK", count === "" ? button : `${button},${count}`);
        },
    },
    DELAY: {
        label: "Wait",
        section: "system",
        fields: [{ key: "ms", label: "Milliseconds", kind: "number", default: "100" }],
        build: (values) => buildActionString("DELAY", (values.ms ?? "").trim()),
    },
    TEXT: {
        label: "Type text",
        section: "system",
        fields: [
            {
                key: "text",
                label: "Text",
                kind: "textarea",
                placeholder: "Hello world",
                wide: true,
            },
        ],
        build: (values) => buildActionString("TEXT", values.text ?? ""),
    },
    CMD: {
        label: "Command",
        section: "system",
        fields: [
            {
                key: "command",
                label: "Command",
                kind: "text",
                placeholder: "explorer.exe",
                wide: true,
            },
        ],
        build: (values) => buildActionString("CMD", (values.command ?? "").trim()),
    },
};

export const INTERNAL_ACTION_TYPES: readonly ActionTypeDef[] = ACTION_NAMESPACES.map(
    (namespace) => ({
        id: namespace,
        namespace,
        ...ACTION_TYPE_BY_NAMESPACE[namespace],
    }),
);

let pluginCommandProvider: PluginCommandProvider | null = null;

/**
 * Reserved Step 4 hook: register a provider that returns plugin commands.
 * `ActionSidebar` calls `loadPluginCommandTypes()` on mount.
 */
export function setPluginCommandProvider(provider: PluginCommandProvider | null): void {
    pluginCommandProvider = provider;
}

/** Map a plugin command to a `CMD:<handle>:<command>` picker type. */
export function pluginCommandToType(command: PluginCommand): ActionTypeDef {
    const action = `${command.handle}:${command.command}`;
    return {
        id: `CMD:${action}`,
        namespace: "CMD",
        label: command.title ?? action,
        section: "plugins",
        fields: [],
        build: () => buildActionString("CMD", action),
    };
}

/** Load plugin-provided picker types; returns `[]` when no provider is set. */
export async function loadPluginCommandTypes(): Promise<ActionTypeDef[]> {
    if (pluginCommandProvider === null) {
        return [];
    }
    try {
        const commands = await pluginCommandProvider();
        return commands.map(pluginCommandToType);
    } catch {
        return [];
    }
}

/** Default field values for a type (used when the picker opens). */
export function defaultFieldValues(type: ActionTypeDef): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of type.fields) {
        values[field.key] = field.default ?? field.options?.[0]?.value ?? "";
    }
    return values;
}
