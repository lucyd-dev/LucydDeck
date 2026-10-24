// ---------------------------------------------------------------------------
// Action-picker provider rows.
//
// Deck and System always exist. Every installed plugin adds one row labelled by
// the plugin, even when it registers no commands; a command type is never shown
// outside its plugin's row. There is no catch-all row.
// ---------------------------------------------------------------------------

import type { ActionTypeDef, PluginRegistration } from "./registry";

export type ProviderKind = "deck" | "system" | "plugin";

export interface ProviderRow {
    /** `deck`, `system`, or the plugin handle. */
    id: string;
    kind: ProviderKind;
    label: string;
    hint: string;
    actions: readonly ActionTypeDef[];
}

/** Handle of a `CMD:<handle>:<command>` action type; `null` for other types. */
export function pluginHandleOf(type: ActionTypeDef): string | null {
    if (type.section !== "plugins") {
        return null;
    }
    const match = /^CMD:([^:]+):/.exec(type.id);
    return match?.[1] ?? null;
}

/** Build the picker rows from the internal types and installed plugins. */
export function buildProviders(
    types: readonly ActionTypeDef[],
    registrations: readonly PluginRegistration[],
): ProviderRow[] {
    const deck = types.filter((type) => type.section === "lucyddeck");
    const system = types.filter((type) => type.section === "system");
    const pluginTypes = types.filter((type) => type.section === "plugins");

    return [
        {
            id: "deck",
            kind: "deck",
            label: "Deck",
            hint: "Pages and profiles",
            actions: deck,
        },
        {
            id: "system",
            kind: "system",
            label: "System",
            hint: "Keyboard, mouse, text and timing",
            actions: system,
        },
        ...registrations.map((registration) => ({
            id: registration.handle,
            kind: "plugin" as const,
            label: registration.label,
            hint: "Installed plugin",
            actions: pluginTypes.filter((type) => pluginHandleOf(type) === registration.handle),
        })),
    ];
}
