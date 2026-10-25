import { describe, expect, it } from "vitest";
import type { SyncResult } from "@shared/sync";
import { syncResultMessage } from "./syncResult";

function result(overrides: Partial<SyncResult> = {}): SyncResult {
    return {
        createdProfiles: [],
        renamedProfiles: [],
        uploadedPages: [],
        uploadedIcons: [],
        removedPages: [],
        removedIcons: [],
        removedProfiles: [],
        activeProfile: null,
        ...overrides,
    };
}

describe("syncResultMessage", () => {
    it("says only that the device synced when nothing was removed", () => {
        expect(syncResultMessage(result())).toBe("Device synced");
    });

    it("reports pages, icons and profiles removed", () => {
        expect(
            syncResultMessage(
                result({
                    removedPages: [{ profile: "main", id: "0" }],
                    removedIcons: [{ name: "old" }],
                    removedProfiles: ["stale"],
                }),
            ),
        ).toBe("Synced: removed 1 page, 1 icon and 1 profile from the deck.");
    });

    it("reports a single profile removal", () => {
        expect(syncResultMessage(result({ removedProfiles: ["stale"] }))).toBe(
            "Synced: removed 1 profile from the deck.",
        );
    });

    it("reports a rename by its new name", () => {
        expect(
            syncResultMessage(result({ renamedProfiles: [{ from: "old", to: "renamed" }] })),
        ).toBe("Synced: renamed “renamed”.");
    });

    it("reports removals and renames together", () => {
        expect(
            syncResultMessage(
                result({
                    removedPages: [{ profile: "main", id: "0" }],
                    removedProfiles: ["stale"],
                    renamedProfiles: [{ from: "old", to: "renamed" }],
                }),
            ),
        ).toBe("Synced: removed 1 page and 1 profile from the deck and renamed “renamed”.");
    });
});
