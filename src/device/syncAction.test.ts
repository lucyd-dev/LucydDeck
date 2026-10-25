import { describe, expect, it } from "vitest";
import { syncAction } from "./syncAction";
import type { SyncSnapshot } from "./syncAction";

function snapshot(overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
    return {
        connected: true,
        stale: false,
        syncing: false,
        planLoaded: true,
        pendingChanges: 0,
        plannedRemovals: 0,
        ...overrides,
    };
}

describe("syncAction", () => {
    it("asks for a connection when the deck is offline", () => {
        expect(syncAction(snapshot({ connected: false }))).toEqual({
            label: "Sync",
            hint: "Connect the deck before syncing",
            disabled: true,
        });
    });

    it("asks for a reconnect and refresh when the inventory is stale", () => {
        expect(syncAction(snapshot({ stale: true }))).toEqual({
            label: "Sync",
            hint: "Reconnect and refresh the inventory before syncing",
            disabled: true,
        });
    });

    it("reports a running sync", () => {
        expect(syncAction(snapshot({ syncing: true }))).toEqual({
            label: "Syncing",
            hint: "A sync is already running",
            disabled: true,
        });
    });

    it("waits for the review plan", () => {
        expect(syncAction(snapshot({ planLoaded: false }))).toEqual({
            label: "Sync",
            hint: "The review has not loaded yet",
            disabled: true,
        });
    });

    it("reads In sync when nothing is planned in either direction", () => {
        expect(syncAction(snapshot())).toEqual({
            label: "In sync",
            hint: "Nothing to sync. Every page, icon and profile on the deck matches the library.",
            disabled: true,
        });
    });

    it("counts one pending change in the singular", () => {
        expect(syncAction(snapshot({ pendingChanges: 1 }))).toEqual({
            label: "Sync 1 change",
            hint: "1 pending change will be sent to the deck.",
            disabled: false,
        });
    });

    it("counts several pending changes", () => {
        expect(syncAction(snapshot({ pendingChanges: 4 }))).toEqual({
            label: "Sync 4 changes",
            hint: "4 pending changes will be sent to the deck.",
            disabled: false,
        });
    });

    it("counts one item to remove in the singular", () => {
        expect(syncAction(snapshot({ plannedRemovals: 1 }))).toEqual({
            label: "Remove 1 item",
            hint: "1 item only on the deck will be removed.",
            disabled: false,
        });
    });

    it("counts several items to remove", () => {
        expect(syncAction(snapshot({ plannedRemovals: 2 }))).toEqual({
            label: "Remove 2 items",
            hint: "2 items only on the deck will be removed.",
            disabled: false,
        });
    });

    it("names both directions when a sync uploads and removes", () => {
        expect(syncAction(snapshot({ pendingChanges: 4, plannedRemovals: 2 }))).toEqual({
            label: "Sync 4 changes, remove 2",
            hint: "4 pending changes will be sent, 2 items removed.",
            disabled: false,
        });
    });

    it("adds the profile clause to the hint without changing the count", () => {
        expect(
            syncAction(
                snapshot({
                    pendingChanges: 4,
                    plannedRemovals: 3,
                    plannedProfileRemovals: 1,
                }),
            ),
        ).toEqual({
            label: "Sync 4 changes, remove 3",
            hint:
                "4 pending changes will be sent, 3 items removed. 1 deck profile and its pages " +
                "will be removed.",
            disabled: false,
        });
    });

    it("uses the plural profile clause for several profiles", () => {
        expect(syncAction(snapshot({ plannedRemovals: 2, plannedProfileRemovals: 2 })).hint).toBe(
            "2 items only on the deck will be removed. 2 deck profiles and their pages will be " +
                "removed.",
        );
    });

    it("returns to a reading after the sync finishes", () => {
        expect(syncAction(snapshot({ syncing: true })).label).toBe("Syncing");
        expect(
            syncAction(snapshot({ syncing: false, pendingChanges: 0, plannedRemovals: 0 })).label,
        ).toBe("In sync");
        expect(syncAction(snapshot({ syncing: false, pendingChanges: 2 })).label).toBe(
            "Sync 2 changes",
        );
    });
});
