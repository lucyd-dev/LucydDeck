// ---------------------------------------------------------------------------
// One page artifact: the page's wire identity, its canonical upload bytes and
// the CRC-32 of the padded stream the deck receives.
//
// A page used to be re-serialised and re-hashed wherever it was compared or
// sent, with "canonicalise exactly like SyncService so the CRC matches" as a
// comment rather than a type. This factory is the only place that validates,
// canonicalises, stringifies and hashes a page. Callers keep their own error
// type (storage, sync, the upload channel), but none of them derives the bytes
// or the hash again, so the bytes Review compared are the bytes that upload.
// ---------------------------------------------------------------------------

import { crc32Upload } from "./crc32";
import { pageIdentity, type IdentityReason, type PageIdentity } from "./identity";
import { serializePageConfig, validatePageConfig } from "./schema";
import type { Crc32, PageConfig } from "./types";

export interface PageArtifact {
    readonly identity: PageIdentity;
    /** The canonical page the bytes encode. */
    readonly page: PageConfig;
    /** Canonical JSON, unpadded. */
    readonly bytes: Uint8Array;
    /** CRC-32 of the padded stream the deck receives. */
    readonly crc32: Crc32;
}

/** Why the factory refused: the page config, or the identity it would carry. */
export type ArtifactFailure = "page" | "identity";

export type ArtifactResult =
    { ok: true; artifact: PageArtifact } | { ok: false; reason: ArtifactFailure; errors: string[] };

const encoder = new TextEncoder();

/**
 * Build the one artifact for `page` as `<profile>/<id>`.
 *
 * A structurally invalid page returns its validation errors; dropped actions
 * are not fatal (the firmware drops them too) and stay warnings in the caller's
 * save path. The identity is built for a file transfer, so it counts the target
 * byte the start payload prepends. An identity refusal is reported apart from a
 * config error: the page itself is valid, it just cannot be addressed.
 */
export function createPageArtifact(profile: string, id: string, page: unknown): ArtifactResult {
    const validation = validatePageConfig(page);
    if (!validation.ok) {
        return { ok: false, reason: "page", errors: validation.errors };
    }

    const identity = pageIdentity(profile, id, "transfer");
    if (!identity.ok) {
        return {
            ok: false,
            reason: "identity",
            errors: [identityError(identity.reason, identity.identity)],
        };
    }

    const canonical = serializePageConfig(validation.page);
    const bytes = encoder.encode(JSON.stringify(canonical));
    return {
        ok: true,
        artifact: {
            identity: identity.identity,
            page: canonical,
            bytes,
            crc32: crc32Upload(bytes),
        },
    };
}

function identityError(reason: IdentityReason, identity: string): string {
    switch (reason) {
        case "page-id":
            return `Invalid page id in "${identity}" (expected 0..255)`;
        case "too-long":
            return `Page identity is too long for one file-transfer frame: "${identity}"`;
        case "empty":
            return `Page identity is empty: "${identity}"`;
    }
}
