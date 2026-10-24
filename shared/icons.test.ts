import { describe, expect, it } from "vitest";
import { iconBaseName, normalizeIconName } from "./icons";

describe("iconBaseName", () => {
    it("strips a case-insensitive .png and trims whitespace", () => {
        expect(iconBaseName("github.png")).toBe("github");
        expect(iconBaseName("Github.PNG")).toBe("Github");
        expect(iconBaseName("  spaced  ")).toBe("spaced");
        expect(iconBaseName("icon")).toBe("icon");
    });
});

describe("normalizeIconName", () => {
    it("returns the base name for non-empty strings", () => {
        expect(normalizeIconName("github.png")).toBe("github");
        expect(normalizeIconName("  github  ")).toBe("github");
    });

    it("returns null for empty, whitespace, or non-string values", () => {
        expect(normalizeIconName("")).toBeNull();
        expect(normalizeIconName("   ")).toBeNull();
        expect(normalizeIconName(".png")).toBeNull();
        expect(normalizeIconName(42)).toBeNull();
        expect(normalizeIconName(null)).toBeNull();
    });
});
