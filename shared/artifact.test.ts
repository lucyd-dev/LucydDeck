import { describe, expect, it } from "vitest";
import { createPageArtifact, type PageArtifact } from "./artifact";
import { crc32Upload } from "./crc32";

/**
 * One page frozen as the upload path produced it before the factory existed:
 * canonical JSON through `serializePageConfig`, then the CRC of the padded
 * stream. A change to either the canonical form or the hashing breaks parity
 * with every page already on a deck.
 */
const FIXTURE_CANONICAL =
    '{"buttons":{"0":{"click":["PAGE:1"],"imageName":"logo","label":"First"},"2":{"click":["HID_KEY:CTRL+C"],"backgroundColor":"#112233","label":"Second"}}}';
const FIXTURE_CRC32 = 4089531517;

function fixturePage() {
    return {
        buttons: {
            "2": { label: "Second", click: ["HID_KEY:CTRL+C"], backgroundColor: "#112233" },
            "0": { imageName: "logo.png", click: ["PAGE:1"], label: "First" },
            "12": { click: [] },
        },
    };
}

function artifactOf(page?: unknown): PageArtifact {
    const result = createPageArtifact("gaming", "3", page ?? fixturePage());
    if (!result.ok) {
        throw new Error(`expected an artifact, got: ${result.errors.join("; ")}`);
    }
    return result.artifact;
}

function text(artifact: PageArtifact): string {
    return new TextDecoder().decode(artifact.bytes);
}

describe("createPageArtifact", () => {
    it("keeps the fixture's canonical bytes and CRC from before the factory", () => {
        const artifact = artifactOf();
        expect(text(artifact)).toBe(FIXTURE_CANONICAL);
        expect(artifact.crc32).toBe(FIXTURE_CRC32);
        // The deck hashes the zero-padded HID payloads, so the list hash is the
        // CRC of the padded canonical JSON, not of the unpadded file.
        expect(crc32Upload(artifact.bytes)).toBe(FIXTURE_CRC32);
    });

    it("carries the page identity the firmware builds the path from", () => {
        const artifact = artifactOf();
        expect(artifact.identity).toEqual({
            kind: "page",
            profile: "gaming",
            pageId: "3",
            identity: "gaming/3",
        });
        expect(artifact.page).toEqual({
            buttons: {
                "0": { click: ["PAGE:1"], imageName: "logo", label: "First" },
                "2": {
                    click: ["HID_KEY:CTRL+C"],
                    backgroundColor: "#112233",
                    label: "Second",
                },
            },
        });
    });

    it("orders keys and drops a button with nothing in it", () => {
        const artifact = artifactOf({
            buttons: {
                "12": { click: [] },
                "2": { label: "B", click: [] },
                "0": { label: "A", click: [] },
            },
        });
        expect(text(artifact)).toBe(
            '{"buttons":{"0":{"click":[],"label":"A"},"2":{"click":[],"label":"B"}}}',
        );
    });

    it("drops an invalid action but keeps the valid ones", () => {
        const artifact = artifactOf({
            buttons: { "0": { click: ["HID_KEY:NOPE", "DELAY:5"] } },
        });
        expect(JSON.parse(text(artifact))).toEqual({
            buttons: { "0": { click: ["DELAY:5"] } },
        });
    });

    it("returns the validation errors of an invalid page", () => {
        const result = createPageArtifact("main", "0", { buttons: { "99": {} } });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("page");
            expect(result.errors.join(" ")).toContain("out of range");
        }
    });

    it("reports an identity refusal apart from a page error", () => {
        const result = createPageArtifact("main", "300", { buttons: {} });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe("identity");
            expect(result.errors.join(" ")).toContain("Invalid page id");
        }
    });

    it("counts the transfer target byte in the identity limit", () => {
        // 58 + "/" + 1 = 60 bytes: a command fits, a transfer start does not.
        expect(createPageArtifact("x".repeat(58), "3", { buttons: {} }).ok).toBe(false);
        expect(createPageArtifact("x".repeat(57), "3", { buttons: {} }).ok).toBe(true);
    });
});
