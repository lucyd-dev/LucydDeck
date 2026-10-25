// ---------------------------------------------------------------------------
// The firmware's entity-name grammar, shared by the main process and tests.
//
// `Storage::validateEntityName` in the firmware is the authority: a profile
// directory or icon file may be created under 1..64 bytes of ASCII letters,
// digits, space, `-` and `_`, with no leading or trailing space. Names that
// already exist on the card keep the older `Storage::validateName` rule.
// ---------------------------------------------------------------------------

/** `Storage::ENTITY_NAME_MAX_LENGTH` in the firmware. */
export const ENTITY_NAME_MAX_BYTES = 64;

/** One or more characters from the firmware's entity-name set. */
export const ENTITY_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

const DISALLOWED_ENTITY_CHARS = /[^A-Za-z0-9 _-]+/g;
const PNG_EXTENSION = /\.png$/i;
const encoder = new TextEncoder();

/**
 * True when `name` would pass the firmware's `validateEntityName` unchanged.
 *
 * Length is measured in UTF-8 bytes, as the firmware's Arduino `String` does;
 * the allowed set is ASCII, so a non-ASCII name is rejected either way.
 */
export function isValidEntityName(name: string): boolean {
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
