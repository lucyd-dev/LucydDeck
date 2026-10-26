// ---------------------------------------------------------------------------
// The hosted firmware release source.
//
// One manifest from the newest stable release, one image from the same
// directory, checked against the manifest's size and SHA-256 before the
// FirmwareService is allowed to hand the deck to its bootloader. All network
// and filesystem detail stays here so the state machine is tested with a fake.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log/main";
import { LATEST_MANIFEST_URL, manifestFromText, releaseAssetUrl } from "@shared/firmwareRelease";
import type { FirmwareBoardEntry, FirmwareManifest } from "@shared/firmwareRelease";

export type ReleaseSourceFailure =
    "offline" | "response" | "manifest" | "size" | "checksum" | "write";

export class ReleaseSourceError extends Error {
    readonly reason: ReleaseSourceFailure;

    constructor(message: string, reason: ReleaseSourceFailure) {
        super(message);
        this.name = "ReleaseSourceError";
        this.reason = reason;
    }
}

export interface LatestRelease {
    manifest: FirmwareManifest;
    /** ISO timestamp from the manifest response, when it has one. */
    publishedAt: string | null;
}

/** The seam `FirmwareService` uses; tests supply a fake. */
export interface FirmwareReleaseSource {
    latest(signal?: AbortSignal): Promise<LatestRelease>;
    /** Download, verify and stage the image; returns the staged file. */
    download(entry: FirmwareBoardEntry, signal?: AbortSignal): Promise<string>;
    /** Remove a staged file and its private temporary directory. */
    remove(file: string): void;
}

export interface ReleaseSourceOptions {
    /** Defaults to the newest stable release's manifest. */
    manifestUrl?: string;
    fetchImpl?: typeof fetch;
    /** Directory under which a download gets its own staging directory. */
    tmpRoot?: string;
}

/**
 * Resolve the manifest URL. `LUCYD_FIRMWARE_MANIFEST` is a development-only
 * override: it is honoured only in an unpackaged build, and an invalid value
 * falls back to the published release so a typo cannot break the normal path.
 */
export function resolveManifestUrl(options: {
    packaged: boolean;
    override?: string | undefined;
}): string {
    const override = options.override?.trim();
    if (options.packaged || override === undefined || override === "") {
        return LATEST_MANIFEST_URL;
    }
    try {
        const url = new URL(override);
        return url.protocol === "http:" || url.protocol === "https:"
            ? url.toString()
            : LATEST_MANIFEST_URL;
    } catch {
        return LATEST_MANIFEST_URL;
    }
}

export class ReleaseSource implements FirmwareReleaseSource {
    private readonly manifestUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly tmpRoot: string;
    /** Directories this source created and may remove. */
    private readonly staged = new Set<string>();

    constructor(options: ReleaseSourceOptions = {}) {
        this.manifestUrl = options.manifestUrl ?? LATEST_MANIFEST_URL;
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.tmpRoot = options.tmpRoot ?? os.tmpdir();
    }

    async latest(signal?: AbortSignal): Promise<LatestRelease> {
        const response = await this.request(this.manifestUrl, signal);
        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            throw new ReleaseSourceError(
                "The firmware release server did not finish sending the manifest.",
                "response",
            );
        }
        const parsed = manifestFromText(text);
        if (!parsed.ok) {
            throw new ReleaseSourceError(parsed.message, "manifest");
        }
        // The manifest has no date, and the app makes no GitHub API call, so the
        // manifest response's Last-Modified header is the only release date.
        return {
            manifest: parsed.manifest,
            publishedAt: isoTimestamp(response.headers.get("last-modified")),
        };
    }

    async download(entry: FirmwareBoardEntry, signal?: AbortSignal): Promise<string> {
        const url = releaseAssetUrl(entry.asset, this.manifestUrl);
        const response = await this.request(url, signal);
        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(await response.arrayBuffer());
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            throw new ReleaseSourceError(
                "The firmware image did not finish downloading.",
                "response",
            );
        }
        if (bytes.byteLength !== entry.size) {
            throw new ReleaseSourceError(
                `The firmware image is ${bytes.byteLength} bytes, not the published ${entry.size}.`,
                "size",
            );
        }
        const digest = crypto.createHash("sha256").update(bytes).digest("hex");
        if (digest !== entry.sha256) {
            throw new ReleaseSourceError(
                "The firmware image does not match the published SHA-256.",
                "checksum",
            );
        }

        let directory: string | null = null;
        try {
            fs.mkdirSync(this.tmpRoot, { recursive: true });
            directory = fs.mkdtempSync(path.join(this.tmpRoot, "lucyddeck-firmware-"));
            const file = path.join(directory, entry.asset);
            fs.writeFileSync(file, bytes);
            this.staged.add(directory);
            return file;
        } catch {
            if (directory !== null) {
                fs.rmSync(directory, { recursive: true, force: true });
            }
            throw new ReleaseSourceError("The update could not be saved for flashing.", "write");
        }
    }

    remove(file: string): void {
        const directory = path.dirname(file);
        if (this.staged.delete(directory)) {
            fs.rmSync(directory, { recursive: true, force: true });
            return;
        }
        fs.rmSync(file, { force: true });
    }

    private async request(url: string, signal?: AbortSignal): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetchImpl(url, {
                redirect: "follow",
                cache: "no-store",
                signal,
            });
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            log.warn(`[firmware] release request failed: ${String(error)}`);
            throw new ReleaseSourceError("Could not reach the firmware release server.", "offline");
        }
        if (!response.ok) {
            log.warn(`[firmware] release server answered ${response.status} for ${url}`);
            throw new ReleaseSourceError(
                `The firmware release server answered ${response.status}.`,
                "response",
            );
        }
        return response;
    }
}

export function isAbortError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("name" in error)) {
        return false;
    }
    const name = String((error as { name: unknown }).name);
    return name === "AbortError" || name === "TimeoutError";
}

function isoTimestamp(value: string | null): string | null {
    if (value === null) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
