// ---------------------------------------------------------------------------
// One owner of the deck at a time.
//
// A sync and a firmware update must never talk to the deck together: a sync
// writes pages and icons over the running firmware, and an update hands the
// deck to its ROM bootloader. A direct write — a delete, an upload, a profile
// command — is the same kind of owner: it sends whole commands, so it must not
// interleave with a sync or an update. A file transfer is the unit a sync is
// built from, so it may nest inside a sync or a direct write, but never inside
// an update.
//
// The lock is a plain object with no Electron or USB dependency: every service
// that owns the deck takes it, and the renderer never sees it directly.
// ---------------------------------------------------------------------------

export type DeckActivity = "sync" | "update" | "write" | "transfer";

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
    if (holder === "write") {
        return "The deck is busy with another change. Wait for it to finish, then try again.";
    }
    return "A firmware operation is already running. Wait for it to finish.";
}

/**
 * Owns mutual exclusion between a sync, a firmware update, a direct write and
 * their file transfers. `begin*` returns false when the deck is already busy; a
 * caller that started an operation must release it in a `finally`.
 */
export class DeviceLock {
    private owner: "sync" | "update" | "write" | null = null;
    private transfers = 0;

    /** True while a firmware operation owns the deck. */
    get updating(): boolean {
        return this.owner === "update";
    }

    /** True while a sync owns the deck. */
    get syncing(): boolean {
        return this.owner === "sync";
    }

    /** True while one direct deck write (delete, upload, profile command) runs. */
    get writing(): boolean {
        return this.owner === "write";
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
     * A direct write needs an idle deck: no sync, no update, no open transfer.
     * It owns the deck for its whole transaction, so a sync cannot start in the
     * middle of a delete.
     */
    beginWrite(): boolean {
        if (this.busy) {
            return false;
        }
        this.owner = "write";
        return true;
    }

    endWrite(): void {
        if (this.owner === "write") {
            this.owner = null;
        }
    }

    /**
     * A transfer may run on its own, or inside a sync's plan or a direct write
     * (an upload under the write lock), but an update must not be handed a deck
     * that is still receiving a file.
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
