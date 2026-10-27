import { describe, expect, it } from "vitest";
import { deleteRemaining, deleteResult } from "./delete";

describe("deleteRemaining", () => {
    it("reports no copy left when both sides went", () => {
        expect(deleteRemaining("deleted", "deleted")).toBe("none");
        expect(deleteRemaining("missing", "deleted")).toBe("none");
    });

    it("reports the library copy when only it is left", () => {
        expect(deleteRemaining("deleted", "failed")).toBe("library");
    });

    it("reports the deck copy when the deck was skipped", () => {
        expect(deleteRemaining("skipped", "deleted")).toBe("deck");
    });

    it("reports both copies when the deck failed before the library side", () => {
        expect(deleteRemaining("failed", "skipped")).toBe("both");
    });
});

describe("deleteResult", () => {
    it("derives the remaining copy from the two sides", () => {
        expect(
            deleteResult({ status: "deleted" }, { status: "failed", error: "no permission" }),
        ).toEqual({
            deck: { status: "deleted" },
            library: { status: "failed", error: "no permission" },
            remaining: "library",
        });
    });
});
