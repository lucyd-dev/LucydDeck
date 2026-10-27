import log from "electron-log/main";
import { isValidPageId } from "@shared/protocol";
import {
    deleteResult,
    type DeckDeleteStatus,
    type DeleteResult,
    type DeleteSide,
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
        this.acquireWrite();
        try {
            if (!this.isConnected()) {
                return deleteResult(
                    { status: "skipped" },
                    await this.attempt(`library page ${profile}/${id}`, () =>
                        this.storage.deletePage(profile, id),
                    ),
                );
            }

            const deck = await this.attempt(`deck page ${profile}/${id}`, () =>
                this.device.deletePage(profile, id, { allowMissing: true }),
            );
            if (deck.status === "failed") {
                // The library copy is the retry source; leave it whole.
                return deleteResult(deck, { status: "skipped" });
            }
            const library = await this.attempt(`library page ${profile}/${id}`, () =>
                this.storage.deletePage(profile, id),
            );
            return deleteResult(deck, library);
        } finally {
            this.lock.endWrite();
        }
    }

    /** A request that never ran is an error, not a partial delete result. */
    private assertPageRequest(profile: string, id: string): void {
        if (!validateName(profile)) {
            throw new StorageError(`Invalid profile name: "${profile}"`);
        }
        if (!isValidPageId(id)) {
            throw new StorageError(`Invalid page id: "${id}"`);
        }
    }

    private acquireWrite(): void {
        if (this.lock.beginWrite()) {
            return;
        }
        throw new DeviceLockError(this.lock.current() ?? "write");
    }

    /**
     * Run one side of the delete and keep its outcome. A side that throws has
     * failed; the caller decides whether the other side may still run.
     */
    private async attempt(
        label: string,
        run: () => void | DeckDeleteStatus | Promise<void | DeckDeleteStatus>,
    ): Promise<DeleteSide> {
        try {
            const status = await run();
            return { status: status ?? "deleted" };
        } catch (error) {
            const message = errorMessage(error);
            log.warn(`[delete] ${label} stayed: ${message}`);
            return { status: "failed", error: message };
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
