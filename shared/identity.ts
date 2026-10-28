// ---------------------------------------------------------------------------
// One device identity union for every name the wire carries.
//
// The firmware expects a page as `<profile>/<id>`, an icon as `<name>`, a
// profile as `<name>` and a rename as `old:new`. Building those strings at a
// call site lets the spelling drift and hides the two different length limits,
// so every caller goes through a builder here. The one-byte target of a file
// transfer sits outside the identity; its start payload has one byte less room.
//
// Name policy stays in `shared/names.ts`: a caller validates the profile, icon
// or profile half before it asks for an identity. The builders own only the
// page-id rule, the `old:new` split and the payload limit.
// ---------------------------------------------------------------------------

import { PAYLOAD_MAX, isValidPageId } from "./protocol";

/** Every identity the wire carries, tagged by the entity it names. */
export type DeviceIdentity =
    | { kind: "page"; profile: string; pageId: string; identity: string }
    | { kind: "icon"; name: string; identity: string }
    | { kind: "profile"; name: string; identity: string }
    | { kind: "profileRename"; from: string; to: string; identity: string };

/** The identity of one page file: `<profile>/<id>`. */
export type PageIdentity = Extract<DeviceIdentity, { kind: "page" }>;
/** The identity of one icon file: `<name>`. */
export type IconIdentity = Extract<DeviceIdentity, { kind: "icon" }>;
/** The identity of one profile directory: `<name>`. */
export type ProfileIdentity = Extract<DeviceIdentity, { kind: "profile" }>;
/** A rename command: `old:new`. */
export type ProfileRenameIdentity = Extract<DeviceIdentity, { kind: "profileRename" }>;

/**
 * What a file transfer may carry. The firmware takes a page or an icon here; a
 * profile identity is a command/delete payload, so the type keeps it out.
 */
export type TransferIdentity = PageIdentity | IconIdentity;

/** What a delete command may carry. A rename is not a deletable entity. */
export type DeleteIdentity = PageIdentity | IconIdentity | ProfileIdentity;

/** Why a builder refused to produce an identity. */
export type IdentityReason = "empty" | "too-long" | "page-id";

/**
 * A refusal keeps the string it would have sent, so the caller can report the
 * offending identity without rebuilding it.
 */
export type IdentityResult<T extends DeviceIdentity = DeviceIdentity> =
    { ok: true; identity: T } | { ok: false; reason: IdentityReason; identity: string };

/**
 * How much payload room the identity has. A command or delete carries the
 * identity alone in a frame; a file-transfer start prepends its target byte.
 */
export type IdentityScope = "command" | "transfer";

const encoder = new TextEncoder();

/** `CMD_FILE_START` carries `[target][identity]` in one `PAYLOAD_MAX` payload. */
const TRANSFER_IDENTITY_MAX = PAYLOAD_MAX - 1;

function fits(identity: string, scope: IdentityScope): boolean {
    const max = scope === "transfer" ? TRANSFER_IDENTITY_MAX : PAYLOAD_MAX;
    return encoder.encode(identity).length <= max;
}

/**
 * Build `<profile>/<id>` for a page command, delete or transfer.
 *
 * `pageId` is checked against the firmware's 0..255 rule. `profile` is a name
 * the caller has already resolved; the builder never rewrites it.
 */
export function pageIdentity(
    profile: string,
    pageId: string | number,
    scope: IdentityScope = "command",
): IdentityResult<PageIdentity> {
    const id = String(pageId);
    const identity = `${profile}/${id}`;
    if (profile === "" || id === "") {
        return { ok: false, reason: "empty", identity };
    }
    if (!isValidPageId(id)) {
        return { ok: false, reason: "page-id", identity };
    }
    if (!fits(identity, scope)) {
        return { ok: false, reason: "too-long", identity };
    }
    return { ok: true, identity: { kind: "page", profile, pageId: id, identity } };
}

/**
 * Build the identity of an icon, which is its base name with no extension.
 * A name that already carries `.png` must be reduced by the caller, because
 * only the storage boundary knows how an icon is quoted.
 */
export function iconIdentity(
    name: string,
    scope: IdentityScope = "command",
): IdentityResult<IconIdentity> {
    if (name === "") {
        return { ok: false, reason: "empty", identity: name };
    }
    if (!fits(name, scope)) {
        return { ok: false, reason: "too-long", identity: name };
    }
    return { ok: true, identity: { kind: "icon", name, identity: name } };
}

/**
 * Build the identity of a profile directory. Create, delete and activation all
 * address a profile by its bare name.
 */
export function profileIdentity(name: string): IdentityResult<ProfileIdentity> {
    if (name === "") {
        return { ok: false, reason: "empty", identity: name };
    }
    if (!fits(name, "command")) {
        return { ok: false, reason: "too-long", identity: name };
    }
    return { ok: true, identity: { kind: "profile", name, identity: name } };
}

/**
 * Build `old:new` for `CMD_PROFILE_RENAME`.
 *
 * The firmware splits on the first colon, so an old name that itself contains
 * one is unaddressable. The builder keeps the plain `old:new` form anyway: a
 * different encoding would address a different profile, or none.
 */
export function profileRenameIdentity(
    from: string,
    to: string,
): IdentityResult<ProfileRenameIdentity> {
    const identity = `${from}:${to}`;
    if (from === "" || to === "") {
        return { ok: false, reason: "empty", identity };
    }
    if (!fits(identity, "command")) {
        return { ok: false, reason: "too-long", identity };
    }
    return { ok: true, identity: { kind: "profileRename", from, to, identity } };
}
