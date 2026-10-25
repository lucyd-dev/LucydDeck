import { describe, expect, it } from "vitest";
import { ENTITY_NAME_MAX_BYTES, isValidEntityName, sanitizeEntityName } from "./names";

describe("isValidEntityName", () => {
    it("accepts the firmware's entity-name set", () => {
        expect(isValidEntityName("Gaming Room")).toBe(true);
        expect(isValidEntityName("v12")).toBe(true);
        expect(isValidEntityName("github_icons-2")).toBe(true);
        expect(isValidEntityName("a".repeat(ENTITY_NAME_MAX_BYTES))).toBe(true);
    });

    it("matches the firmware's byte and edge-space limits", () => {
        expect(isValidEntityName("")).toBe(false);
        expect(isValidEntityName("a".repeat(ENTITY_NAME_MAX_BYTES + 1))).toBe(false);
        expect(isValidEntityName(` ${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)}`)).toBe(false);
        expect(isValidEntityName(`${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)} `)).toBe(false);
        expect(isValidEntityName("   ")).toBe(false);
    });

    it("rejects characters outside the firmware set without changing them", () => {
        for (const name of [
            "Gaming: Room",
            "v1.2",
            "logo.png",
            "a/b",
            "a\\b",
            "café",
            "emoji 🎨",
            "tab\there",
            "dot.",
        ]) {
            expect(isValidEntityName(name)).toBe(false);
        }
    });
});

describe("sanitizeEntityName", () => {
    it("trims leading and trailing spaces", () => {
        expect(sanitizeEntityName(" Gaming ")).toBe("Gaming");
        expect(sanitizeEntityName("\tGaming Room\n")).toBe("Gaming Room");
    });

    it("strips a trailing .png, case-insensitively and repeatedly", () => {
        expect(sanitizeEntityName("logo.png")).toBe("logo");
        expect(sanitizeEntityName("logo.PNG")).toBe("logo");
        expect(sanitizeEntityName("logo.png.png")).toBe("logo");
        expect(sanitizeEntityName("logo.png ")).toBe("logo");
    });

    it("drops bytes outside the firmware set", () => {
        expect(sanitizeEntityName("v1.2")).toBe("v12");
        expect(sanitizeEntityName("Gaming: Room")).toBe("Gaming Room");
        expect(sanitizeEntityName("café")).toBe("caf");
        expect(sanitizeEntityName("a/b")).toBe("ab");
    });

    it("collapses repeated spaces left by dropped characters", () => {
        expect(sanitizeEntityName("Gaming  :  Room")).toBe("Gaming Room");
        expect(sanitizeEntityName("a\t \tb")).toBe("a b");
    });

    it("clamps to 64 bytes without leaving a trailing space", () => {
        expect(sanitizeEntityName("a".repeat(70))).toBe("a".repeat(ENTITY_NAME_MAX_BYTES));
        expect(sanitizeEntityName(`${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)} b`)).toBe(
            "a".repeat(ENTITY_NAME_MAX_BYTES - 1),
        );
    });

    it("leaves a valid name unchanged", () => {
        for (const name of ["Gaming Room", "v12", "github_icons-2", "a".repeat(64)]) {
            expect(sanitizeEntityName(name)).toBe(name);
        }
    });

    it("returns an empty name when nothing usable survives", () => {
        expect(sanitizeEntityName("")).toBe("");
        expect(sanitizeEntityName("...")).toBe("");
        expect(sanitizeEntityName("🎨")).toBe("");
        expect(sanitizeEntityName(".png")).toBe("");
    });

    it("returns only names the firmware will accept", () => {
        for (const input of [
            " Gaming ",
            "v1.2",
            "Gaming: Room",
            "logo.png",
            "a".repeat(70),
            `${"a".repeat(63)} b`,
            "café",
            "..",
        ]) {
            const sanitized = sanitizeEntityName(input);
            if (sanitized !== "") {
                expect(isValidEntityName(sanitized)).toBe(true);
            }
        }
    });
});
