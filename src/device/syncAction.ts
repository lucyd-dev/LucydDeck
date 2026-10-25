// ---------------------------------------------------------------------------
// One reading of the sync control, derived from a single snapshot.
//
// The Device header renders exactly what this returns, and the store's
// `syncNow()` refuses when the reading is disabled, so the label, the hint and
// the guard can never disagree.
// ---------------------------------------------------------------------------

export interface SyncSnapshot {
    connected: boolean;
    stale: boolean;
    syncing: boolean;
    planLoaded: boolean;
    /** Pending uploads, profile creates, renames and the active-profile switch. */
    pendingChanges: number;
    /** Device-only items (pages, icons and profiles) the plan will remove. */
    plannedRemovals: number;
    /** Deck profiles among the removals; they ask for confirmation. */
    plannedProfileRemovals?: number;
}

export interface SyncReading {
    label: string;
    hint: string;
    disabled: boolean;
}

function changeCountLabel(count: number): string {
    return `${count} ${count === 1 ? "change" : "changes"}`;
}

function pendingChangeLabel(count: number): string {
    return `${count} pending ${count === 1 ? "change" : "changes"}`;
}

function itemCountLabel(count: number): string {
    return `${count} ${count === 1 ? "item" : "items"}`;
}

function removalHint(count: number): string {
    return `${itemCountLabel(count)} only on the deck will be removed.`;
}

/** Extra hint for a profile removal, which the Sync action confirms first. */
function profileRemovalHint(count: number | undefined): string {
    if (count === undefined || count <= 0) {
        return "";
    }
    return count === 1
        ? " 1 deck profile and its pages will be removed."
        : ` ${count} deck profiles and their pages will be removed.`;
}

/**
 * Read the header control for one snapshot. The order matters: a blocking
 * condition wins over a count, and "In sync" is reachable only when the plan
 * holds neither changes nor removals.
 */
export function syncAction(snapshot: SyncSnapshot): SyncReading {
    if (!snapshot.connected) {
        return { label: "Sync", hint: "Connect the deck before syncing", disabled: true };
    }
    if (snapshot.stale) {
        return {
            label: "Sync",
            hint: "Reconnect and refresh the inventory before syncing",
            disabled: true,
        };
    }
    if (snapshot.syncing) {
        return { label: "Syncing", hint: "A sync is already running", disabled: true };
    }
    if (!snapshot.planLoaded) {
        return { label: "Sync", hint: "The review has not loaded yet", disabled: true };
    }
    const profileHint = profileRemovalHint(snapshot.plannedProfileRemovals);
    if (snapshot.pendingChanges === 0 && snapshot.plannedRemovals === 0) {
        return {
            label: "In sync",
            hint: "Nothing to sync. Every page, icon and profile on the deck matches the library.",
            disabled: true,
        };
    }
    if (snapshot.pendingChanges === 0) {
        return {
            label: `Remove ${itemCountLabel(snapshot.plannedRemovals)}`,
            hint: `${removalHint(snapshot.plannedRemovals)}${profileHint}`,
            disabled: false,
        };
    }
    if (snapshot.plannedRemovals === 0) {
        return {
            label: `Sync ${changeCountLabel(snapshot.pendingChanges)}`,
            hint: `${pendingChangeLabel(snapshot.pendingChanges)} will be sent to the deck.`,
            disabled: false,
        };
    }
    return {
        label: `Sync ${changeCountLabel(snapshot.pendingChanges)}, remove ${
            snapshot.plannedRemovals
        }`,
        hint: `${pendingChangeLabel(snapshot.pendingChanges)} will be sent, ${itemCountLabel(
            snapshot.plannedRemovals,
        )} removed.${profileHint}`,
        disabled: false,
    };
}
