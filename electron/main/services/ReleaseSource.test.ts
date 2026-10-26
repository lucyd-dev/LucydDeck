import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEST_MANIFEST_URL } from "@shared/firmwareRelease";
import type { FirmwareBoardEntry } from "@shared/firmwareRelease";
import { ReleaseSource, ReleaseSourceError, resolveManifestUrl } from "./ReleaseSource";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const MANIFEST_URL = "http://127.0.0.1:8765/firmware.json";
const IMAGE_PATH = "http://127.0.0.1:8765/LucydDeck-firmware-v0.4.0.bin";
const BYTES = new Uint8Array([0xe9, 0x01, 0x02, 0x03, 0x04]);
const SHA256 = crypto.createHash("sha256").update(BYTES).digest("hex");

function manifestBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        schemaVersion: 1,
        version: "0.4.0",
        releaseUrl: "https://github.com/lucyd-dev/LucydDeck-firmware/releases/tag/v0.4.0",
        boards: {
            WAVESHARE_ESP32_S3_TOUCH_LCD_4_3: {
                asset: "LucydDeck-firmware-v0.4.0.bin",
                size: BYTES.byteLength,
                sha256: SHA256,
                chip: "esp32s3",
                address: 65536,
                layout: "max_app_8MB",
            },
        },
        ...overrides,
    });
}

function entry(overrides: Partial<FirmwareBoardEntry> = {}): FirmwareBoardEntry {
    return {
        asset: "LucydDeck-firmware-v0.4.0.bin",
        size: BYTES.byteLength,
        sha256: SHA256,
        chip: "esp32s3",
        address: 65536,
        layout: "max_app_8MB",
        ...overrides,
    };
}

function response(body: BodyInit, init: ResponseInit = {}): Response {
    return new Response(body, { status: 200, ...init });
}

describe("ReleaseSource", () => {
    let tmpRoot: string;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-release-test-"));
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("reads and validates the latest manifest and its date", async () => {
        fetchMock.mockResolvedValue(
            response(manifestBody(), {
                headers: { "last-modified": "Mon, 26 Oct 2026 02:51:50 GMT" },
            }),
        );
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        const latest = await source.latest();

        expect(latest.manifest.version).toBe("0.4.0");
        expect(latest.publishedAt).toBe("2026-10-26T02:51:50.000Z");
        expect(fetchMock).toHaveBeenCalledWith(
            MANIFEST_URL,
            expect.objectContaining({ redirect: "follow" }),
        );
    });

    it("keeps the published manifest as the default path", async () => {
        fetchMock.mockResolvedValue(response(manifestBody()));
        const source = new ReleaseSource({ tmpRoot });

        await source.latest();

        expect(fetchMock).toHaveBeenCalledWith(
            LATEST_MANIFEST_URL,
            expect.objectContaining({ redirect: "follow" }),
        );
    });

    it("refuses a manifest the server answered with an error", async () => {
        fetchMock.mockResolvedValue(response("not found", { status: 404 }));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await expect(source.latest()).rejects.toMatchObject({
            name: "ReleaseSourceError",
            reason: "response",
        });
    });

    it("refuses a network failure without leaking the raw error", async () => {
        fetchMock.mockRejectedValue(new Error("getaddrinfo EAI_AGAIN github.com"));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await expect(source.latest()).rejects.toMatchObject({
            reason: "offline",
        });
    });

    it("refuses a body that is not a valid manifest", async () => {
        fetchMock.mockResolvedValue(response("{"));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await expect(source.latest()).rejects.toMatchObject({
            reason: "manifest",
        });
    });

    it("downloads, verifies and removes a staged image", async () => {
        fetchMock.mockResolvedValue(response(BYTES));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        const file = await source.download(entry());

        expect(fetchMock).toHaveBeenCalledWith(
            IMAGE_PATH,
            expect.objectContaining({ redirect: "follow" }),
        );
        expect(path.basename(file)).toBe("LucydDeck-firmware-v0.4.0.bin");
        expect(new Uint8Array(fs.readFileSync(file))).toEqual(BYTES);

        source.remove(file);
        expect(fs.existsSync(file)).toBe(false);
    });

    it("refuses a download whose size does not match the manifest", async () => {
        fetchMock.mockResolvedValue(response(BYTES));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await expect(source.download(entry({ size: BYTES.byteLength + 1 }))).rejects.toMatchObject({
            reason: "size",
        });
        expect(fs.readdirSync(tmpRoot)).toEqual([]);
    });

    it("refuses a download whose SHA-256 does not match the manifest", async () => {
        fetchMock.mockResolvedValue(response(BYTES));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await expect(source.download(entry({ sha256: "0".repeat(64) }))).rejects.toMatchObject({
            reason: "checksum",
        });
        expect(fs.readdirSync(tmpRoot)).toEqual([]);
    });

    it("leaves no staged file when the download is cancelled", async () => {
        fetchMock.mockImplementation(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => {
                        const error = new Error("aborted");
                        error.name = "AbortError";
                        reject(error);
                    });
                }),
        );
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });
        const controller = new AbortController();

        const download = source.download(entry(), controller.signal);
        controller.abort();

        await expect(download).rejects.toMatchObject({ name: "AbortError" });
        expect(fs.readdirSync(tmpRoot)).toEqual([]);
    });

    it("resolves the image from the same directory as a local manifest", async () => {
        fetchMock.mockResolvedValue(response(BYTES));
        const source = new ReleaseSource({ manifestUrl: MANIFEST_URL, tmpRoot });

        await source.download(entry());

        expect(fetchMock).toHaveBeenCalledWith(IMAGE_PATH, expect.anything());
    });
});

describe("resolveManifestUrl", () => {
    it("keeps the published manifest when no override is set", () => {
        expect(resolveManifestUrl({ packaged: false })).toBe(LATEST_MANIFEST_URL);
        expect(resolveManifestUrl({ packaged: true })).toBe(LATEST_MANIFEST_URL);
    });

    it("honours a development override in an unpackaged build", () => {
        expect(
            resolveManifestUrl({
                packaged: false,
                override: "http://127.0.0.1:8765/firmware.json",
            }),
        ).toBe("http://127.0.0.1:8765/firmware.json");
    });

    it("ignores the override in a packaged build", () => {
        expect(
            resolveManifestUrl({
                packaged: true,
                override: "http://127.0.0.1:8765/firmware.json",
            }),
        ).toBe(LATEST_MANIFEST_URL);
    });

    it("falls back for an invalid or non-HTTP override", () => {
        expect(resolveManifestUrl({ packaged: false, override: "not a url" })).toBe(
            LATEST_MANIFEST_URL,
        );
        expect(resolveManifestUrl({ packaged: false, override: "file:///tmp/firmware.json" })).toBe(
            LATEST_MANIFEST_URL,
        );
        expect(resolveManifestUrl({ packaged: false, override: "   " })).toBe(LATEST_MANIFEST_URL);
    });
});

describe("ReleaseSourceError", () => {
    it("carries the refusal reason", () => {
        const error = new ReleaseSourceError("broken", "checksum");
        expect(error).toBeInstanceOf(Error);
        expect(error.reason).toBe("checksum");
    });
});
