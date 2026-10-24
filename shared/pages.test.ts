import { describe, expect, it } from "vitest";
import { pageLabel } from "./pages";

describe("pageLabel", () => {
    it("shows one-based labels for numeric ids", () => {
        expect(pageLabel("0")).toBe("Page 1");
        expect(pageLabel(11)).toBe("Page 12");
        expect(pageLabel(255)).toBe("Page 256");
    });

    it("falls back to the raw id for non-numeric input", () => {
        expect(pageLabel("main")).toBe("Page main");
    });
});
