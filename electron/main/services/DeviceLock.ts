// ---------------------------------------------------------------------------
// One owner of the deck at a time.
//
// A sync and a firmware update must never talk to the deck together: a sync
// writes pages and icons over the running firmware, and an update hands the
// deck to its ROM bootloader. A file transfer is the unit a sync is built
// from, so it may nest inside a sync, but never inside an update.
//
// The lock is a plain object with no Electron or USB dependency: every service
// that owns the deck takes it, and the renderer never sees it directly.
// ---------------------------------------------------------------------------

export type DeckActivity = "sync" | "update" | "transfer";

/** Stable code for an operation refused because the deck is busy. */
export const DeviceLockErrorCodes = {
    Busy: "DEVICE_BUSY",
} as const;

/** Refused because another operation owns the deck. */
export class DeviceLockError extends Error {
    readonly code = DeviceLockErrorCodes.Busy;

    constructor(readonly holder: DeckActivity) {
        super(deviceBusyMessage(holder));
        this.name = "DeviceLockError";
    }
}

/** One sentence and a next step for a refused operation. */
export function deviceBusyMessage(holder: DeckActivity): string {
    if (holder === "sync") {
        return "A sync is running. Wait for it to finish, then try again.";
    }
    if (holder === "transfer") {
        return "A file is being sent to the deck. Wait for it to finish, then try again.";
    }
    return "A firmware operation is already running. Wait for it to finish.";
}

/**
 * Owns mutual exclusion between a sync, a firmware update and their file
 * transfers. `begin*` returns false when the deck is already busy; a caller
 * that started an operation must release it in a `finally`.
 */
export class DeviceLock {
    private owner: "sync" | "update" | null = null;
    private transfers = 0;

    /** True while a firmware operation owns the deck. */
    get updating(): boolean {
        return this.owner === "update";
    }

    /** True while a sync owns the deck. */
    get syncing(): boolean {
        return this.owner === "sync";
    }

    /** True while at least one file transfer is open. */
    get transferring(): boolean {
        return this.transfers > 0;
    }

    /** True while any operation or transfer owns the deck. */
    get busy(): boolean {
        return this.owner !== null || this.transfers > 0;
    }

    /** The operation that currently owns the deck. */
    current(): DeckActivity | null {
        if (this.owner !== null) {
            return this.owner;
        }
        return this.transfers > 0 ? "transfer" : null;
    }

    /** A sync needs an idle deck. */
    beginSync(): boolean {
        if (this.busy) {
            return false;
        }
        this.owner = "sync";
        return true;
    }

    endSync(): void {
        if (this.owner === "sync") {
            this.owner = null;
        }
    }

    /** An update needs an idle deck: no sync and no open transfer. */
    beginUpdate(): boolean {
        if (this.busy) {
            return false;
        }
        this.owner = "update";
        return true;
    }

    endUpdate(): void {
        if (this.owner === "update") {
            this.owner = null;
        }
    }

    /**
     * A transfer may run on its own, or inside a sync's plan, but an update
     * must not be handed a deck that is still receiving a file.
     */
    beginTransfer(): boolean {
        if (this.owner === "update") {
            return false;
        }
        this.transfers++;
        return true;
    }

    endTransfer(): void {
        if (this.transfers > 0) {
            this.transfers--;
        }
    }
}
