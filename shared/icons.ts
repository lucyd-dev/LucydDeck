// ---------------------------------------------------------------------------
// Icon-name normalization shared by the renderer, main process, and tests.
//
// Firmware wiki `Storage-Structure.md` / `Configuration-Schema.md`: icons live
// at `/icons/<name>.png`, and `imageName` in page JSON is the base name without
// the extension. One implementation keeps every consumer (schema validation,
// stores, storage, sync, IPC) looking up the same name.
// ---------------------------------------------------------------------------

const PNG_EXTENSION = /\.png$/i;

/** Base name of an icon: `.png` stripped (case-insensitive) and trimmed. */
export function iconBaseName(name: string): string {
    return name.replace(PNG_EXTENSION, "").trim();
}

/** Normalize an unknown value to an icon base name; `null` when empty/invalid. */
export function normalizeIconName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const base = iconBaseName(value);
    return base === "" ? null : base;
}
