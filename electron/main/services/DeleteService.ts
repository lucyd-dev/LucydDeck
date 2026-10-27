import log from "electron-log/main";
import { isValidPageId } from "@shared/protocol";
import { iconBaseName } from "@shared/icons";
import {
    deleteResult,
    type DeckDeleteSide,
    type DeckDeleteStatus,
    type DeleteResult,
    type LibraryDeleteSide,
} from "@shared/delete";
import { DeviceLockError, type DeviceLock } from "./DeviceLock";
import { StorageError, validateName, type StorageService } from "./StorageService";

/** Minimal deck surface a delete needs (satisfied by `DeviceService`). */
export interface DeleteDeviceClient {
    deletePage(
        profile: string,
        id: string,
        options?: { allowMissing?: boolean },
    ): Promise<DeckDeleteStatus>;
    deleteIcon(name: string, options?: { allowMissing?: boolean }): Promise<DeckDeleteStatus>;
    deleteProfile(name: string, options?: { allowMissing?: boolean }): Promise<DeckDeleteStatus>;
}

export interface DeleteServiceOptions {
    storage: StorageService;
    device: DeleteDeviceClient;
    /** Shared deck ownership; the write is held across both sides. */
    lock: DeviceLock;
    /** Read once when the delete starts: a disconnected start takes the offline path. */
    isConnected: () => boolean;
}

/**
 * One main-side owner for a two-sided delete.
 *
 * A delete takes the deck write lock, deletes the deck copy first with a
 * missing file counting as success, then deletes the library copy, and reports
 * which copy remains. A deck failure aborts before the library copy so a retry
 * starts from a whole state; a library failure after the deck delete is a
 * partial delete and is reported, never rolled back. If the deck is
 * disconnected when the delete starts, only the library copy goes and the next
 * sync removes the deck copy.
 */
export class DeleteService {
    private readonly storage: StorageService;
    private readonly device: DeleteDeviceClient;
    private readonly lock: DeviceLock;
    private readonly isConnected: () => boolean;

    constructor(options: DeleteServiceOptions) {
        this.storage = options.storage;
        this.device = options.device;
        this.lock = options.lock;
        this.isConnected = options.isConnected;
    }

    /**
     * Delete one page from the deck and the library. Rejects with
     * `DEVICE_BUSY` while a sync or an update owns the deck, and with the
     * validation error for a name the app would never delete; otherwise it
     * resolves with the outcome of both sides.
     */
    async deletePage(profile: string, id: string): Promise<DeleteResult> {
        this.assertPageRequest(profile, id);
        return this.deleteCopies(
            `deck page ${profile}/${id}`,
            () => this.device.deletePage(profile, id, { allowMissing: true }),
            `library page ${profile}/${id}`,
            () => this.storage.deletePage(profile, id),
        );
    }

    /**
     * Delete one icon from the deck and the library, with the same rules as a
     * page delete: deck copy first, a missing deck file counted as success,
     * then the library file, and a partial result when the library side stays.
     */
    async deleteIcon(name: string): Promise<DeleteResult> {
        const base = this.iconRequestBase(name);
        return this.deleteCopies(
            `deck icon ${base}`,
            () => this.device.deleteIcon(base, { allowMissing: true }),
            `library icon ${base}`,
            () => this.storage.deleteIcon(base),
        );
    }

    /**
     * Delete one profile from the deck and the library, with the same rules as
     * a page delete: the deck profile goes first, a missing deck profile is
     * success, then the library profile and every page it holds.
     */
    async deleteProfile(name: string): Promise<DeleteResult> {
        this.assertProfileName(name);
        return this.deleteCopies(
            `deck profile ${name}`,
            () => this.device.deleteProfile(name, { allowMissing: true }),
            `library profile ${name}`,
            () => this.storage.deleteProfile(name),
        );
    }

    /**
     * One two-sided transaction: take the write lock, delete the deck copy,
     * then the library copy, and release the lock whichever side fails. A
     * disconnected start takes the offline path and leaves the deck copy to the
     * next sync.
     */
    private async deleteCopies(
        deckLabel: string,
        deleteDeck: () => Promise<DeckDeleteStatus>,
        libraryLabel: string,
        deleteLibrary: () => void,
    ): Promise<DeleteResult> {
        this.acquireWrite();
        try {
            if (!this.isConnected()) {
                return deleteResult(
                    { status: "skipped" },
                    await this.attemptLibrary(libraryLabel, deleteLibrary),
                );
            }

            const deck = await this.attemptDeck(deckLabel, deleteDeck);
            if (deck.status === "failed") {
                // The library copy is the retry source; leave it whole.
                return deleteResult(deck, { status: "skipped" });
            }
            const library = await this.attemptLibrary(libraryLabel, deleteLibrary);
            return deleteResult(deck, library);
        } finally {
            this.lock.endWrite();
        }
    }

    /** A request that never ran is an error, not a partial delete result. */
    private assertPageRequest(profile: string, id: string): void {
        this.assertProfileName(profile);
        if (!isValidPageId(id)) {
            throw new StorageError(`Invalid page id: "${id}"`);
        }
    }

    /** A profile name must be one the app could have created or kept. */
    private assertProfileName(name: string): void {
        if (!validateName(name)) {
            throw new StorageError(`Invalid profile name: "${name}"`);
        }
    }

    /** Validate the request and return the base name both copies address. */
    private iconRequestBase(name: string): string {
        const base = iconBaseName(name);
        if (!validateName(base)) {
            throw new StorageError(`Invalid icon name: "${base}"`);
        }
        return base;
    }

    private acquireWrite(): void {
        if (this.lock.beginWrite()) {
            return;
        }
        throw new DeviceLockError(this.lock.current() ?? "write");
    }

    /**
     * Run the deck side and keep its outcome. A side that throws has failed;
     * the caller decides whether the library side may still run.
     */
    private async attemptDeck(
        label: string,
        run: () => Promise<DeckDeleteStatus>,
    ): Promise<DeckDeleteSide> {
        try {
            return { status: await run() };
        } catch (error) {
            return this.failed(label, error);
        }
    }

    /** Run the library side; a call that returns deleted the library copy. */
    private async attemptLibrary(label: string, run: () => void): Promise<LibraryDeleteSide> {
        try {
            run();
            return { status: "deleted" };
        } catch (error) {
            return this.failed(label, error);
        }
    }

    /** One failed side, logged with the detail the result cannot carry. */
    private failed(label: string, error: unknown): { status: "failed"; error: string } {
        const message = errorMessage(error);
        log.warn(`[delete] ${label} stayed: ${message}`);
        return { status: "failed", error: message };
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
