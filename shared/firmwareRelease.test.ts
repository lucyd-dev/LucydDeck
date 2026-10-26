import { describe, expect, it } from "vitest";
import { APP_SLOT_ADDRESS, APP_SLOT_SIZE } from "./firmware";
import {
    compareVersions,
    evaluateRelease,
    manifestAssetBase,
    manifestFromText,
    normalizeVersion,
    parseFirmwareManifest,
    releaseAssetUrl,
} from "./firmwareRelease";
import type { FirmwareBoardEntry, FirmwareManifest } from "./firmwareRelease";

const BOARD = "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3";
const OTHER_BOARD = "FUTURE_BOARD";
const RELEASE_URL = "https://github.com/lucyd-dev/LucydDeck-firmware/releases/tag/v0.4.0";

function board(overrides: Partial<FirmwareBoardEntry> = {}): FirmwareBoardEntry {
    return {
        asset: "LucydDeck-firmware-v0.4.0.bin",
        size: 1174816,
        sha256: "a".repeat(64),
        chip: "esp32s3",
        address: APP_SLOT_ADDRESS,
        layout: "max_app_8MB",
        ...overrides,
    };
}

function manifest(
    overrides: Partial<Omit<FirmwareManifest, "boards">> & {
        boards?: Record<string, FirmwareBoardEntry>;
    } = {},
): FirmwareManifest {
    const { boards, ...rest } = overrides;
    return {
        schemaVersion: 1,
        version: "0.4.0",
        releaseUrl: RELEASE_URL,
        ...rest,
        boards: boards ?? { [BOARD]: board() },
    };
}

describe("parseFirmwareManifest", () => {
    it("accepts the published manifest and normalizes a leading v", () => {
        const parsed = parseFirmwareManifest({
            ...manifest(),
            version: "v0.4.0",
        });

        expect(parsed).toMatchObject({
            ok: true,
            manifest: { schemaVersion: 1, version: "0.4.0", releaseUrl: RELEASE_URL },
        });
        if (parsed.ok) {
            expect(parsed.manifest.boards[BOARD]).toEqual(board());
        }
    });

    it("refuses a body that is not an object", () => {
        expect(parseFirmwareManifest([])).toMatchObject({
            ok: false,
            reason: "malformed",
        });
        expect(parseFirmwareManifest("{}")).toMatchObject({
            ok: false,
            reason: "malformed",
        });
    });

    it("refuses a different schema version", () => {
        expect(parseFirmwareManifest({ ...manifest(), schemaVersion: 2 })).toMatchObject({
            ok: false,
            reason: "schema",
        });
    });

    it("refuses a malformed version", () => {
        expect(parseFirmwareManifest(manifest({ version: "0.4" }))).toMatchObject({
            ok: false,
            reason: "version",
        });
        expect(parseFirmwareManifest(manifest({ version: "0.4.0-beta.1" }))).toMatchObject({
            ok: false,
            reason: "version",
        });
    });

    it("refuses a release notes link that is not HTTP", () => {
        expect(parseFirmwareManifest(manifest({ releaseUrl: "file:///tmp/notes" }))).toMatchObject({
            ok: false,
            reason: "release-url",
        });
    });

    it("refuses a manifest with no board", () => {
        expect(parseFirmwareManifest(manifest({ boards: {} }))).toMatchObject({
            ok: false,
            reason: "board",
        });
    });

    it("refuses an image name that is a path", () => {
        expect(
            parseFirmwareManifest(
                manifest({ boards: { [BOARD]: board({ asset: "../firmware.bin" }) } }),
            ),
        ).toMatchObject({ ok: false, reason: "asset" });
    });

    it("refuses an empty or fractional image", () => {
        expect(
            parseFirmwareManifest(manifest({ boards: { [BOARD]: board({ size: 0 }) } })),
        ).toMatchObject({ ok: false, reason: "size" });
        expect(
            parseFirmwareManifest(manifest({ boards: { [BOARD]: board({ size: 1024.5 }) } })),
        ).toMatchObject({ ok: false, reason: "size" });
    });

    it("accepts any positive size and checks the app slot only for this deck", () => {
        const fits = parseFirmwareManifest(
            manifest({ boards: { [BOARD]: board({ size: APP_SLOT_SIZE }) } }),
        );
        const tooLarge = parseFirmwareManifest(
            manifest({ boards: { [BOARD]: board({ size: APP_SLOT_SIZE + 1 }) } }),
        );
        if (!fits.ok || !tooLarge.ok) {
            throw new Error("expected both manifests to parse");
        }

        expect(evaluateRelease(fits.manifest, BOARD, "0.3.0")).toMatchObject({
            status: "available",
        });
        expect(evaluateRelease(tooLarge.manifest, BOARD, "0.3.0")).toMatchObject({
            status: "incompatible",
            refusal: "size",
            entry: null,
        });
    });

    it("refuses a checksum that is not lowercase SHA-256", () => {
        expect(
            parseFirmwareManifest(
                manifest({ boards: { [BOARD]: board({ sha256: "A".repeat(64) }) } }),
            ),
        ).toMatchObject({ ok: false, reason: "checksum" });
        expect(
            parseFirmwareManifest(manifest({ boards: { [BOARD]: board({ sha256: "abc" }) } })),
        ).toMatchObject({ ok: false, reason: "checksum" });
    });

    it("refuses this deck's entry when its chip, address or layout is unknown", () => {
        const cases: Array<[Partial<FirmwareBoardEntry>, string]> = [
            [{ chip: "esp32" }, "chip"],
            [{ address: 0x0 }, "address"],
            [{ layout: "ota_8MB" }, "layout"],
        ];
        for (const [override, refusal] of cases) {
            const parsed = parseFirmwareManifest(
                manifest({ boards: { [BOARD]: board(override) } }),
            );
            if (!parsed.ok) {
                throw new Error(parsed.message);
            }
            expect(evaluateRelease(parsed.manifest, BOARD, "0.3.0")).toMatchObject({
                status: "incompatible",
                refusal,
                entry: null,
            });
        }
    });

    it("lets another board carry values this deck does not know", () => {
        const parsed = parseFirmwareManifest(
            manifest({
                boards: {
                    [BOARD]: board(),
                    [OTHER_BOARD]: board({
                        asset: "OtherBoard-firmware-v0.4.0.bin",
                        chip: "esp32c6",
                        address: 0x0,
                        layout: "ota_8MB",
                    }),
                },
            }),
        );
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }

        expect(evaluateRelease(parsed.manifest, BOARD, "0.3.0")).toMatchObject({
            status: "available",
            entry: { asset: "LucydDeck-firmware-v0.4.0.bin" },
        });
    });

    it("turns invalid JSON into a malformed release", () => {
        expect(manifestFromText("{")).toMatchObject({ ok: false, reason: "malformed" });
    });
});

describe("version policy", () => {
    it("normalizes a stable version without its leading v", () => {
        expect(normalizeVersion("v0.4.0")).toBe("0.4.0");
        expect(normalizeVersion("0.4.0")).toBe("0.4.0");
        expect(normalizeVersion("0.4")).toBeNull();
        expect(normalizeVersion(null)).toBeNull();
    });

    it("compares versions numerically", () => {
        expect(compareVersions("0.3.9", "0.4.0")).toBeLessThan(0);
        expect(compareVersions("v0.4.0", "0.4.0")).toBe(0);
        expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
        expect(compareVersions("new", "0.4.0")).toBeNull();
    });

    it("offers a newer release for this board", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, BOARD, "0.3.0")).toMatchObject({
            status: "available",
            installedVersion: "0.3.0",
            latestVersion: "0.4.0",
            entry: { asset: "LucydDeck-firmware-v0.4.0.bin" },
        });
    });

    it("reports an equal version as up to date", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, BOARD, "v0.4.0")).toMatchObject({
            status: "up-to-date",
            entry: null,
        });
    });

    it("reports an installed version newer than the release", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, BOARD, "0.5.0")).toMatchObject({
            status: "newer-installed",
            entry: null,
        });
    });

    it("refuses an unknown installed version", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, BOARD, "dev build")).toMatchObject({
            status: "unknown",
            installedVersion: null,
            entry: null,
        });
    });

    it("reports no firmware for an unknown board", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, "SOME_OTHER_BOARD", "0.3.0")).toMatchObject({
            status: "no-firmware",
            entry: null,
        });
    });

    it("reports an unreadable board separately from an unpublished one", () => {
        const parsed = parseFirmwareManifest(manifest());
        if (!parsed.ok) {
            throw new Error(parsed.message);
        }
        expect(evaluateRelease(parsed.manifest, null, "0.3.0")).toMatchObject({
            status: "no-board",
            entry: null,
        });
        expect(evaluateRelease(parsed.manifest, "", "0.3.0")).toMatchObject({
            status: "no-board",
        });
    });
});

describe("asset URL", () => {
    it("resolves the image beside the manifest", () => {
        const url =
            "https://github.com/lucyd-dev/LucydDeck-firmware/releases/latest/download/firmware.json";
        expect(manifestAssetBase(url)).toBe(
            "https://github.com/lucyd-dev/LucydDeck-firmware/releases/latest/download/",
        );
        expect(releaseAssetUrl("LucydDeck-firmware-v0.4.0.bin", url)).toBe(
            "https://github.com/lucyd-dev/LucydDeck-firmware/releases/latest/download/LucydDeck-firmware-v0.4.0.bin",
        );
    });

    it("resolves the image beside a local development manifest", () => {
        expect(releaseAssetUrl("fake.bin", "http://127.0.0.1:8765/firmware.json")).toBe(
            "http://127.0.0.1:8765/fake.bin",
        );
    });
});
