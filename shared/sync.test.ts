import { describe, expect, it } from "vitest";
import {
    diffPlanDeletions,
    diffPlanOperations,
    emptyDiffPlan,
    isDiffPlanEmpty,
    planRemovesProfiles,
} from "./sync";
import type { DiffPlan } from "./sync";

function planWith(overrides: Partial<DiffPlan>): DiffPlan {
    return { ...emptyDiffPlan(), ...overrides };
}

describe("emptyDiffPlan", () => {
    it("starts with both directions empty, including profiles and renames", () => {
        expect(emptyDiffPlan()).toEqual({
            profilesToCreate: [],
            profileRenames: [],
            profileRenameFallback: null,
            pagesToUpload: [],
            iconsToUpload: [],
            pagesToDelete: [],
            iconsToDelete: [],
            profilesToDelete: [],
            missingIcons: [],
            setActiveProfile: null,
        });
        expect(isDiffPlanEmpty(emptyDiffPlan())).toBe(true);
    });
});

describe("diffPlanOperations", () => {
    it("counts creates, renames, uploads and the active switch", () => {
        const plan = planWith({
            profilesToCreate: ["new"],
            profileRenames: [{ from: "old", to: "renamed" }],
            pagesToUpload: [{ profile: "renamed", id: "0" }],
            iconsToUpload: [{ name: "pic" }],
            setActiveProfile: "renamed",
        });
        expect(diffPlanOperations(plan)).toBe(5);
    });

    it("does not count removals or a fallback note", () => {
        const plan = planWith({
            profileRenameFallback: "ambiguous",
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
            profilesToDelete: ["stale"],
        });
        expect(diffPlanOperations(plan)).toBe(0);
    });
});

describe("diffPlanDeletions", () => {
    it("counts pages, icons and profiles together", () => {
        const plan = planWith({
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
            profilesToDelete: ["stale"],
        });
        expect(diffPlanDeletions(plan)).toBe(3);
        expect(planRemovesProfiles(plan)).toBe(true);
        expect(isDiffPlanEmpty(plan)).toBe(false);
    });

    it("reports a plan with only page removals as not removing profiles", () => {
        const plan = planWith({ pagesToDelete: [{ profile: "main", id: "9" }] });
        expect(diffPlanDeletions(plan)).toBe(1);
        expect(planRemovesProfiles(plan)).toBe(false);
    });
});
