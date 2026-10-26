// ---------------------------------------------------------------------------
// Firmware release contract shared by the main process and the renderer.
//
// The app reads the newest stable release's manifest, checks it against the one
// layout the deck has, and offers an update only when the release is newer than
// the version the deck reports. Pure data + validation: no node/electron
// imports, so the renderer and the tests can load it too.
// ---------------------------------------------------------------------------

import { APP_SLOT_ADDRESS, APP_SLOT_SIZE } from "./firmware";

export const FIRMWARE_REPOSITORY = "lucyd-dev/LucydDeck-firmware";
const LATEST_RELEASE_URL = `https://github.com/${FIRMWARE_REPOSITORY}/releases/latest/download/`;

/** Newest stable release's manifest. Pre-releases never appear here. */
export const LATEST_MANIFEST_URL = `${LATEST_RELEASE_URL}firmware.json`;

/** The only chip the updater flashes. */
export const KNOWN_CHIP = "esp32s3";

/** The only partition layout the app slot address and size describe. */
export const KNOWN_LAYOUT = "max_app_8MB";

export interface FirmwareBoardEntry {
    /** File name of the image on the same release, never a path. */
    asset: string;
    /** Byte length of the asset. */
    size: number;
    /** Lowercase SHA-256 of the asset. */
    sha256: string;
    chip: string;
    address: number;
    layout: string;
}

export interface FirmwareManifest {
    schemaVersion: 1;
    /** Normalized `MAJOR.MINOR.PATCH`; a leading `v` is stripped. */
    version: string;
    releaseUrl: string;
    /** Keyed by the board string the deck reports. */
    boards: Record<string, FirmwareBoardEntry>;
}

export type ManifestRefusalReason =
    | "malformed"
    | "schema"
    | "version"
    | "release-url"
    | "board"
    | "chip"
    | "layout"
    | "address"
    | "size"
    | "checksum"
    | "asset";

export type ManifestCheck =
    | { ok: true; manifest: FirmwareManifest }
    | { ok: false; reason: ManifestRefusalReason; message: string };

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_PATTERN = /^[^/\\]+\.bin$/i;

function refusal(reason: ManifestRefusalReason, message: string): ManifestCheck {
    return { ok: false, reason, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

/** `MAJOR.MINOR.PATCH` without build metadata or a pre-release suffix. */
export function normalizeVersion(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const match = VERSION_PATTERN.exec(value.trim());
    return match === null ? null : `${match[1]}.${match[2]}.${match[3]}`;
}

function versionParts(value: string): [number, number, number] | null {
    const normalized = normalizeVersion(value);
    if (normalized === null) {
        return null;
    }
    const [major, minor, patch] = normalized.split(".").map(Number);
    return [major, minor, patch];
}

/**
 * Compare two stable versions. Returns a negative number when `left` is older,
 * zero when equal, a positive number when newer, and `null` when either side is
 * not a version the updater can read.
 */
export function compareVersions(left: string, right: string): number | null {
    const a = versionParts(left);
    const b = versionParts(right);
    if (a === null || b === null) {
        return null;
    }
    for (let index = 0; index < 3; index++) {
        if (a[index] !== b[index]) {
            return a[index] < b[index] ? -1 : 1;
        }
    }
    return 0;
}

/**
 * Validate the shape every board entry must have. Chip, address, layout and the
 * app-slot size are checked against this deck only in `evaluateRelease`, so a
 * release may publish another board with values this app does not know.
 */
function boardEntry(
    board: string,
    value: unknown,
):
    | { ok: true; entry: FirmwareBoardEntry }
    | { ok: false; reason: ManifestRefusalReason; message: string } {
    if (board.trim() === "" || !isRecord(value)) {
        return {
            ok: false,
            reason: "board",
            message: "The latest firmware release has no usable board entry.",
        };
    }
    if (typeof value.asset !== "string" || !ASSET_PATTERN.test(value.asset)) {
        return {
            ok: false,
            reason: "asset",
            message: "The latest firmware release names an image the updater cannot use.",
        };
    }
    if (typeof value.size !== "number" || !Number.isInteger(value.size) || value.size <= 0) {
        return {
            ok: false,
            reason: "size",
            message: "The latest firmware release has no usable image size.",
        };
    }
    if (typeof value.sha256 !== "string" || !CHECKSUM_PATTERN.test(value.sha256)) {
        return {
            ok: false,
            reason: "checksum",
            message: "The latest firmware release has no valid SHA-256.",
        };
    }
    const chip = typeof value.chip === "string" ? value.chip : "";
    if (chip === "") {
        return {
            ok: false,
            reason: "chip",
            message: "The latest firmware release does not name its chip.",
        };
    }
    const address = typeof value.address === "number" ? value.address : Number.NaN;
    if (!Number.isInteger(address) || address < 0) {
        return {
            ok: false,
            reason: "address",
            message: "The latest firmware release has no usable flash address.",
        };
    }
    const layout = typeof value.layout === "string" ? value.layout : "";
    if (layout === "") {
        return {
            ok: false,
            reason: "layout",
            message: "The latest firmware release does not name its flash layout.",
        };
    }
    return {
        ok: true,
        entry: {
            asset: value.asset,
            size: value.size,
            sha256: value.sha256,
            chip,
            address,
            layout,
        },
    };
}

/** Validate a parsed manifest object before anything is downloaded. */
export function parseFirmwareManifest(raw: unknown): ManifestCheck {
    if (!isRecord(raw)) {
        return refusal("malformed", "The latest firmware release could not be read.");
    }
    if (raw.schemaVersion !== 1) {
        return refusal(
            "schema",
            "The latest firmware release uses a manifest version this app does not know.",
        );
    }
    const version = normalizeVersion(typeof raw.version === "string" ? raw.version : null);
    if (version === null) {
        return refusal("version", "The latest firmware release has no readable version.");
    }
    if (!isHttpUrl(raw.releaseUrl)) {
        return refusal("release-url", "The latest firmware release has no release notes page.");
    }
    if (!isRecord(raw.boards) || Object.keys(raw.boards).length === 0) {
        return refusal("board", "The latest firmware release publishes no board.");
    }

    const boards: Record<string, FirmwareBoardEntry> = Object.create(null);
    for (const [board, value] of Object.entries(raw.boards)) {
        const checked = boardEntry(board, value);
        if (!checked.ok) {
            return { ok: false, reason: checked.reason, message: checked.message };
        }
        boards[board] = checked.entry;
    }

    return {
        ok: true,
        manifest: {
            schemaVersion: 1,
            version,
            releaseUrl: raw.releaseUrl,
            boards,
        },
    };
}

/** Parse and validate the manifest body. A syntax error is a malformed release. */
export function manifestFromText(text: string): ManifestCheck {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return refusal("malformed", "The latest firmware release could not be read.");
    }
    return parseFirmwareManifest(raw);
}

/** The directory the manifest was read from; release assets sit beside it. */
export function manifestAssetBase(manifestUrl: string): string {
    return new URL(".", manifestUrl).toString();
}

export function releaseAssetUrl(asset: string, manifestUrl: string): string {
    return new URL(asset, manifestAssetBase(manifestUrl)).toString();
}

/** The board entry for this deck, or `null` when the release publishes none. */
export function selectBoardEntry(
    manifest: FirmwareManifest,
    board: string | null,
): FirmwareBoardEntry | null {
    if (board === null || board === "") {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(manifest.boards, board)
        ? manifest.boards[board]
        : null;
}

export type ReleaseEligibilityStatus =
    | "available"
    | "up-to-date"
    | "newer-installed"
    | "no-board"
    | "no-firmware"
    | "incompatible"
    | "unknown";

export type BoardEntryRefusal = "chip" | "layout" | "address" | "size";

export interface ReleaseEligibility {
    status: ReleaseEligibilityStatus;
    installedVersion: string | null;
    latestVersion: string;
    entry: FirmwareBoardEntry | null;
    /** Why this deck cannot install the selected entry, when `incompatible`. */
    refusal: BoardEntryRefusal | null;
}

/** Check one board's entry against the layout this deck knows. */
export function boardEntryRefusal(entry: FirmwareBoardEntry): BoardEntryRefusal | null {
    if (entry.size > APP_SLOT_SIZE) {
        return "size";
    }
    if (entry.chip !== KNOWN_CHIP) {
        return "chip";
    }
    if (entry.address !== APP_SLOT_ADDRESS) {
        return "address";
    }
    if (entry.layout !== KNOWN_LAYOUT) {
        return "layout";
    }
    return null;
}

/**
 * Decide what a manifest means for one deck. Only a version newer than the
 * installed one is installable; an unreadable version, a board without an entry
 * or an entry built for another chip/layout is never offered.
 */
export function evaluateRelease(
    manifest: FirmwareManifest,
    board: string | null,
    installedVersion: string | null,
): ReleaseEligibility {
    const installed = normalizeVersion(installedVersion);
    if (board === null || board === "") {
        return {
            status: "no-board",
            installedVersion: installed,
            latestVersion: manifest.version,
            entry: null,
            refusal: null,
        };
    }
    const entry = selectBoardEntry(manifest, board);
    if (entry === null) {
        return {
            status: "no-firmware",
            installedVersion: installed,
            latestVersion: manifest.version,
            entry: null,
            refusal: null,
        };
    }
    const refusal = boardEntryRefusal(entry);
    if (refusal !== null) {
        return {
            status: "incompatible",
            installedVersion: installed,
            latestVersion: manifest.version,
            entry: null,
            refusal,
        };
    }
    const comparison = installed === null ? null : compareVersions(installed, manifest.version);
    const status: ReleaseEligibilityStatus =
        comparison === null
            ? "unknown"
            : comparison < 0
              ? "available"
              : comparison === 0
                ? "up-to-date"
                : "newer-installed";
    return {
        status,
        installedVersion: installed,
        latestVersion: manifest.version,
        entry: status === "available" ? entry : null,
        refusal: null,
    };
}
