import { describe, expect, it } from "vitest";
import {
    PARTIAL_SCAN_NOTE,
    deleteConfirmation,
    deleteOutcome,
    referenceSentence,
} from "./references";

describe("referenceSentence", () => {
    const hit = (profile: string, pageId: string) => ({ profile, pageId });

    it("names a single page and uses the singular verb", () => {
        expect(referenceSentence("icon", [hit("main", "0")], "main")).toBe(
            "1 page still uses this icon: main / Page 1.",
        );
    });

    it("names the profile on every icon reference, including the active one", () => {
        expect(referenceSentence("icon", [hit("main", "0"), hit("work", "3")], "main")).toBe(
            "2 pages still use this icon: main / Page 1, work / Page 4.",
        );
    });

    it("omits the active profile for a page reference only", () => {
        expect(referenceSentence("page", [hit("main", "4")], "main")).toBe(
            "1 page still steps to this page: Page 5.",
        );
        expect(referenceSentence("page", [hit("work", "4")], "main")).toBe(
            "1 page still steps to this page: work / Page 5.",
        );
    });

    it("lists at most three locations and totals the rest", () => {
        expect(
            referenceSentence(
                "profile",
                [
                    hit("main", "0"),
                    hit("main", "1"),
                    hit("main", "2"),
                    hit("main", "3"),
                    hit("main", "4"),
                ],
                "main",
            ),
        ).toBe(
            "5 pages still switch to this profile: main / Page 1, main / Page 2, main / Page 3 and 2 more.",
        );
    });

    it("stays silent with no hits", () => {
        expect(referenceSentence("page", [], "main")).toBeNull();
    });
});

describe("deleteConfirmation", () => {
    it("promises both copies go while the deck is connected", () => {
        expect(deleteConfirmation("Page 4", true)).toBe(
            "Page 4 is removed from the library and from the deck. This cannot be undone.",
        );
    });

    it("says the deck copy stays until the next sync while disconnected", () => {
        expect(deleteConfirmation("Icon “github”", false)).toBe(
            "Icon “github” is removed from the library. The deck is disconnected, so its copy stays, and the next sync removes it.",
        );
    });

    it("keeps the partial-scan note in one place", () => {
        expect(PARTIAL_SCAN_NOTE).toBe(
            "Some pages could not be read, so this list may be incomplete.",
        );
    });
});

describe("deleteOutcome", () => {
    it("reports a whole delete as success", () => {
        expect(
            deleteOutcome("Page 4", {
                deck: { status: "deleted" },
                library: { status: "deleted" },
                remaining: "none",
            }),
        ).toEqual({ level: "success", message: "Deleted Page 4" });
    });

    it("names the library copy that stayed after a partial delete", () => {
        expect(
            deleteOutcome("Page 4", {
                deck: { status: "deleted" },
                library: { status: "failed", error: "no permission" },
                remaining: "library",
            }),
        ).toEqual({
            level: "warning",
            message:
                "Deleted Page 4 from the deck, but the library copy could not be deleted. It is still in the library.",
        });
    });

    it("names the deck error and says nothing was deleted after a deck failure", () => {
        expect(
            deleteOutcome("Page 4", {
                deck: { status: "failed", error: "deck refused" },
                library: { status: "skipped" },
                remaining: "both",
            }),
        ).toEqual({
            level: "error",
            message: "Could not delete Page 4 from the deck: deck refused. Nothing was deleted.",
        });
    });

    it("says the deck copy stays when the delete started disconnected", () => {
        expect(
            deleteOutcome("Page 4", {
                deck: { status: "skipped" },
                library: { status: "deleted" },
                remaining: "deck",
            }),
        ).toEqual({
            level: "warning",
            message:
                "Deleted Page 4 from the library. The deck copy stays, and the next sync removes it.",
        });
    });

    it("does not claim the deck copy went when an offline library delete fails", () => {
        expect(
            deleteOutcome("Page 4", {
                deck: { status: "skipped" },
                library: { status: "failed", error: "Page not found" },
                remaining: "both",
            }),
        ).toEqual({
            level: "error",
            message:
                "Could not delete Page 4 from the library: Page not found. Nothing was deleted.",
        });
    });
});
