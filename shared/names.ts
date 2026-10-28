// ---------------------------------------------------------------------------
// The one entity-name policy, shared by the main process and tests.
//
// `Storage::validateEntityName` in the firmware is the authority for a new
// name: a profile directory or icon file may be created under 1..64 bytes of
// ASCII letters, digits, space, `-` and `_`, with no leading or trailing
// space. Names that already exist on the card keep the older
// `Storage::validateName` rule, so a name from before the grammar stays
// listable, deletable, renamable and activatable.
// ---------------------------------------------------------------------------

/** `Storage::ENTITY_NAME_MAX_LENGTH` in the firmware. */
export const ENTITY_NAME_MAX_BYTES = 64;

/** One or more characters from the firmware's entity-name set. */
export const ENTITY_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

/**
 * Which rule applies. `"new"` may create a profile or icon on the deck and so
 * must pass the entity grammar; `"existing"` addresses something already
 * there and is only checked for path safety.
 */
export type EntityNameMode = "new" | "existing";

/** Why a name was refused. */
export type NameReason = "empty" | "charset" | "too-long" | "reserved" | "path";

export type NameResult = { ok: true; name: string } | { ok: false; reason: NameReason };

const DISALLOWED_ENTITY_CHARS = /[^A-Za-z0-9 _-]+/g;
const PNG_EXTENSION = /\.png$/i;
const encoder = new TextEncoder();

/**
 * Names that are hostile on Windows: the filesystem trims a trailing dot or
 * space (causing collisions) and reserved device names make creation raise raw
 * OS errors.
 */
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * True when `name` would pass the firmware's `validateEntityName` unchanged.
 *
 * Length is measured in UTF-8 bytes, as the firmware's Arduino `String` does;
 * the allowed set is ASCII, so a non-ASCII name is rejected either way.
 */
export function isEntityName(name: string): boolean {
    if (typeof name !== "string" || name === "") {
        return false;
    }
    if (encoder.encode(name).length > ENTITY_NAME_MAX_BYTES) {
        return false;
    }
    if (name.startsWith(" ") || name.endsWith(" ")) {
        return false;
    }
    return ENTITY_NAME_PATTERN.test(name);
}

/**
 * True when `name` is a safe single path component, under the old contract:
 * non-empty, not `.`/`..`, no `/` or `\` separators, no control characters,
 * and none of the host-only Windows hazards.
 *
 * This is the only rule an already-stored name needs; it deliberately accepts
 * a pre-grammar name such as `v1.2`, `Gaming: Room` or `logo.png`.
 */
export function isPathSafeName(name: string): boolean {
    if (typeof name !== "string" || name.length === 0) {
        return false;
    }
    if (name === "." || name === "..") {
        return false;
    }
    if (/[. ]$/.test(name) || WINDOWS_RESERVED_NAME_PATTERN.test(name)) {
        return false;
    }
    for (let i = 0; i < name.length; i++) {
        const code = name.codePointAt(i)!;
        if (name[i] === "/" || name[i] === "\\") {
            return false;
        }
        if (code < 0x20 || code === 0x7f) {
            return false;
        }
    }
    return true;
}

/**
 * Resolve a user-supplied or stored name under one of the two rules.
 *
 * `"new"` sanitises first (`" Gaming "` becomes `"Gaming"`, `v1.2` becomes
 * `v12`), then requires the entity grammar and path safety. `"existing"`
 * transforms nothing and checks path safety only, so a name from before the
 * grammar keeps working.
 */
export function resolveEntityName(input: string, mode: EntityNameMode): NameResult {
    if (mode === "existing") {
        if (typeof input !== "string" || input === "") {
            return { ok: false, reason: "empty" };
        }
        if (!isPathSafeName(input)) {
            return { ok: false, reason: pathReason(input) };
        }
        return { ok: true, name: input };
    }

    const name = sanitizeEntityName(input);
    const grammar = entityReason(name);
    if (grammar !== null) {
        return { ok: false, reason: grammar };
    }
    if (!isPathSafeName(name)) {
        return { ok: false, reason: pathReason(name) };
    }
    return { ok: true, name };
}

/**
 * The reason a name fails the firmware's entity grammar, or `null` when it
 * passes. `sanitizeEntityName` already removes both failures, so this is
 * defensive: it keeps the reason contract total if the sanitizer changes.
 */
function entityReason(name: string): NameReason | null {
    if (name === "") {
        return "empty";
    }
    if (encoder.encode(name).length > ENTITY_NAME_MAX_BYTES) {
        return "too-long";
    }
    if (!ENTITY_NAME_PATTERN.test(name) || name.startsWith(" ") || name.endsWith(" ")) {
        return "charset";
    }
    return null;
}

function pathReason(name: string): NameReason {
    return WINDOWS_RESERVED_NAME_PATTERN.test(name) ? "reserved" : "path";
}

/**
 * Turn a user-supplied name into a valid entity name.
 *
 * Trims, strips a trailing `.png`, drops characters outside the firmware set
 * (so `v1.2` becomes `v12`), collapses repeated spaces, and clamps the result
 * to 64 bytes. Returns `""` when nothing usable survives; callers reject that
 * rather than creating an unnamed profile or icon.
 *
 * A valid name is returned unchanged.
 */
export function sanitizeEntityName(input: string): string {
    let name = typeof input === "string" ? input.trim() : "";

    // An icon source filename arrives with its extension; the wire identity
    // never carries one. Strip repeated suffixes (`logo.png.png`).
    while (PNG_EXTENSION.test(name)) {
        name = name.slice(0, -".png".length).trimEnd();
    }

    // Treat every run of whitespace as one space before dropping punctuation,
    // so `Gaming:\tRoom` does not become a single word.
    name = name
        .replace(/\s+/g, " ")
        .replace(DISALLOWED_ENTITY_CHARS, "")
        .replace(/ {2,}/g, " ")
        .trim();

    // The set is ASCII-only, so a code unit is a byte. Clamping can expose a
    // trailing space at the 64th byte, which the firmware rejects.
    if (name.length > ENTITY_NAME_MAX_BYTES) {
        name = name.slice(0, ENTITY_NAME_MAX_BYTES).trimEnd();
    }

    return name;
}
