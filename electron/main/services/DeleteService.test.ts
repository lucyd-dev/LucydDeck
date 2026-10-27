import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPageConfig } from "@shared/schema";
import type { DeckDeleteStatus } from "@shared/delete";
import { DeleteService } from "./DeleteService";
import type { DeleteDeviceClient } from "./DeleteService";
import { DeviceLock, DeviceLockError } from "./DeviceLock";
import { StorageError, StorageService } from "./StorageService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

/** A deck copy the test controls: a failure switch, a missing flag, a call log. */
class FakeDeck implements DeleteDeviceClient {
    connected = true;
    /** The deck already lost the file; a delete without `allowMissing` fails. */
    missing = false;
    failure: Error | null = null;
    readonly calls: Array<{
        profile: string;
        id: string;
        allowMissing: boolean;
        libraryFilePresent: boolean;
    }> = [];
    readonly iconCalls: Array<{
        name: string;
        allowMissing: boolean;
        libraryFilePresent: boolean;
    }> = [];
    /** Observed while the deck call runs, so the test can see the lock. */
    readonly lockStates: boolean[] = [];

    constructor(
        private readonly libraryFile: () => string,
        private readonly lock: DeviceLock,
    ) {}

    async deletePage(
        profile: string,
        id: string,
        options: { allowMissing?: boolean } = {},
    ): Promise<DeckDeleteStatus> {
        this.calls.push({
            profile,
            id,
            allowMissing: options.allowMissing === true,
            libraryFilePresent: fs.existsSync(this.libraryFile()),
        });
        this.lockStates.push(this.lock.writing);
        return this.delete(options);
    }

    async deleteIcon(
        name: string,
        options: { allowMissing?: boolean } = {},
    ): Promise<DeckDeleteStatus> {
        this.iconCalls.push({
            name,
            allowMissing: options.allowMissing === true,
            libraryFilePresent: fs.existsSync(this.libraryFile()),
        });
        this.lockStates.push(this.lock.writing);
        return this.delete(options);
    }

    private delete(options: { allowMissing?: boolean }): DeckDeleteStatus {
        if (this.failure !== null) {
            throw this.failure;
        }
        if (this.missing) {
            if (options.allowMissing !== true) {
                throw new Error("File not found");
            }
            return "missing";
        }
        // The fake deck now has no copy of the file, like a real one.
        this.missing = true;
        return "deleted";
    }
}

describe("DeleteService.deletePage", () => {
    let dataDir = "";
    let storage: StorageService;
    let lock: DeviceLock;
    let deck: FakeDeck;
    let service: DeleteService;

    const libraryFile = (id = "1"): string => path.join(dataDir, "profiles", "main", `${id}.json`);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-delete-test-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        storage.createProfile("main");
        storage.savePage("main", "1", emptyPageConfig());
        lock = new DeviceLock();
        deck = new FakeDeck(() => libraryFile(), lock);
        service = new DeleteService({
            storage,
            device: deck,
            lock,
            isConnected: () => deck.connected,
        });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("deletes the deck copy first, then the library copy", async () => {
        const result = await service.deletePage("main", "1");

        expect(result).toEqual({
            deck: { status: "deleted" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(deck.calls).toEqual([
            { profile: "main", id: "1", allowMissing: true, libraryFilePresent: true },
        ]);
        expect(fs.existsSync(libraryFile())).toBe(false);
    });

    it("counts a missing deck file as success", async () => {
        deck.missing = true;

        const result = await service.deletePage("main", "1");

        expect(deck.calls[0]?.allowMissing).toBe(true);
        expect(result).toEqual({
            deck: { status: "missing" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(fs.existsSync(libraryFile())).toBe(false);
    });

    it("leaves the library copy when the deck delete fails", async () => {
        deck.failure = new Error("deck refused");

        const result = await service.deletePage("main", "1");

        expect(result).toEqual({
            deck: { status: "failed", error: "deck refused" },
            library: { status: "skipped" },
            remaining: "both",
        });
        expect(fs.existsSync(libraryFile())).toBe(true);
    });

    it("reports a partial delete when the library copy fails after the deck delete", async () => {
        const deleteLibraryPage = vi.spyOn(storage, "deletePage").mockImplementation(() => {
            throw new StorageError("no permission");
        });

        const result = await service.deletePage("main", "1");

        expect(deleteLibraryPage).toHaveBeenCalledWith("main", "1");
        expect(result).toEqual({
            deck: { status: "deleted" },
            library: { status: "failed", error: "no permission" },
            remaining: "library",
        });
        expect(fs.existsSync(libraryFile())).toBe(true);
    });

    it("deletes only the library copy when the deck is disconnected at the start", async () => {
        deck.connected = false;

        const result = await service.deletePage("main", "1");

        expect(deck.calls).toEqual([]);
        expect(result).toEqual({
            deck: { status: "skipped" },
            library: { status: "deleted" },
            remaining: "deck",
        });
        expect(fs.existsSync(libraryFile())).toBe(false);
    });

    it("succeeds on a retry after a partial delete, treating the missing deck file as success", async () => {
        const failedLibraryDelete = vi.spyOn(storage, "deletePage").mockImplementationOnce(() => {
            throw new StorageError("disk full");
        });

        const partial = await service.deletePage("main", "1");
        expect(partial.remaining).toBe("library");
        expect(fs.existsSync(libraryFile())).toBe(true);

        failedLibraryDelete.mockRestore();
        const retry = await service.deletePage("main", "1");

        expect(retry).toEqual({
            deck: { status: "missing" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(deck.calls).toHaveLength(2);
        expect(deck.calls[1]?.allowMissing).toBe(true);
        expect(fs.existsSync(libraryFile())).toBe(false);
    });

    it("holds the write lock across the deck and library sides and releases it", async () => {
        const libraryLockStates: boolean[] = [];
        const realDeletePage = storage.deletePage.bind(storage);
        vi.spyOn(storage, "deletePage").mockImplementation((profile, id) => {
            libraryLockStates.push(lock.writing);
            realDeletePage(profile, id);
        });

        await service.deletePage("main", "1");

        expect(deck.lockStates).toEqual([true]);
        expect(libraryLockStates).toEqual([true]);
        expect(lock.busy).toBe(false);
    });

    it("releases the write lock after a deck failure and after a library failure", async () => {
        deck.failure = new Error("deck refused");
        await service.deletePage("main", "1");
        expect(lock.busy).toBe(false);

        deck.failure = null;
        vi.spyOn(storage, "deletePage").mockImplementation(() => {
            throw new StorageError("no permission");
        });
        await service.deletePage("main", "1");
        expect(lock.busy).toBe(false);
    });

    it("refuses the delete while a sync owns the deck", async () => {
        expect(lock.beginSync()).toBe(true);

        await expect(service.deletePage("main", "1")).rejects.toMatchObject({
            code: "DEVICE_BUSY",
        });

        expect(deck.calls).toEqual([]);
        expect(fs.existsSync(libraryFile())).toBe(true);
        lock.endSync();
    });

    it("refuses the delete while an update owns the deck", async () => {
        expect(lock.beginUpdate()).toBe(true);

        const refusal = service.deletePage("main", "1");

        await expect(refusal).rejects.toBeInstanceOf(DeviceLockError);
        expect(deck.calls).toEqual([]);
        expect(fs.existsSync(libraryFile())).toBe(true);
        lock.endUpdate();
    });

    it("refuses a sync while the delete holds the deck", async () => {
        deck.failure = new Error("slow deck");
        let syncStarted: boolean | null = null;
        const realDeletePage = deck.deletePage.bind(deck);
        vi.spyOn(deck, "deletePage").mockImplementation(async (profile, id, options) => {
            syncStarted = lock.beginSync();
            return realDeletePage(profile, id, options);
        });

        await service.deletePage("main", "1");

        expect(syncStarted).toBe(false);
        expect(lock.busy).toBe(false);
    });

    it("rejects an invalid page id without touching either copy", async () => {
        await expect(service.deletePage("main", "../x")).rejects.toBeInstanceOf(StorageError);

        expect(deck.calls).toEqual([]);
        expect(fs.existsSync(libraryFile())).toBe(true);
        expect(lock.busy).toBe(false);
    });
});

describe("DeleteService.deleteIcon", () => {
    let dataDir = "";
    let storage: StorageService;
    let lock: DeviceLock;
    let deck: FakeDeck;
    let service: DeleteService;

    const iconFile = (name = "github"): string => path.join(dataDir, "icons", `${name}.png`);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-delete-icon-test-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        fs.writeFileSync(iconFile(), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        lock = new DeviceLock();
        deck = new FakeDeck(() => iconFile(), lock);
        service = new DeleteService({
            storage,
            device: deck,
            lock,
            isConnected: () => deck.connected,
        });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("deletes the deck copy first, then the library file", async () => {
        const result = await service.deleteIcon("github");

        expect(result).toEqual({
            deck: { status: "deleted" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(deck.iconCalls).toEqual([
            { name: "github", allowMissing: true, libraryFilePresent: true },
        ]);
        expect(deck.lockStates).toEqual([true]);
        expect(fs.existsSync(iconFile())).toBe(false);
        expect(lock.busy).toBe(false);
    });

    it("addresses the base name when the request carries the extension", async () => {
        const result = await service.deleteIcon("github.png");

        expect(deck.iconCalls[0]?.name).toBe("github");
        expect(result.remaining).toBe("none");
    });

    it("counts a missing deck icon as success", async () => {
        deck.missing = true;

        const result = await service.deleteIcon("github");

        expect(result).toEqual({
            deck: { status: "missing" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(fs.existsSync(iconFile())).toBe(false);
    });

    it("leaves the library icon when the deck delete fails", async () => {
        deck.failure = new Error("deck refused");

        const result = await service.deleteIcon("github");

        expect(result).toEqual({
            deck: { status: "failed", error: "deck refused" },
            library: { status: "skipped" },
            remaining: "both",
        });
        expect(fs.existsSync(iconFile())).toBe(true);
    });

    it("reports a partial delete when the library file fails after the deck delete", async () => {
        const deleteLibraryIcon = vi.spyOn(storage, "deleteIcon").mockImplementation(() => {
            throw new StorageError("no permission");
        });

        const result = await service.deleteIcon("github");

        expect(deleteLibraryIcon).toHaveBeenCalledWith("github");
        expect(result).toEqual({
            deck: { status: "deleted" },
            library: { status: "failed", error: "no permission" },
            remaining: "library",
        });
        expect(fs.existsSync(iconFile())).toBe(true);
    });

    it("deletes only the library icon when the deck is disconnected at the start", async () => {
        deck.connected = false;

        const result = await service.deleteIcon("github");

        expect(deck.iconCalls).toEqual([]);
        expect(result).toEqual({
            deck: { status: "skipped" },
            library: { status: "deleted" },
            remaining: "deck",
        });
        expect(fs.existsSync(iconFile())).toBe(false);
    });

    it("succeeds on a retry after a partial delete, treating the missing deck icon as success", async () => {
        const failedLibraryDelete = vi.spyOn(storage, "deleteIcon").mockImplementationOnce(() => {
            throw new StorageError("disk full");
        });

        const partial = await service.deleteIcon("github");
        expect(partial.remaining).toBe("library");
        expect(fs.existsSync(iconFile())).toBe(true);

        failedLibraryDelete.mockRestore();
        const retry = await service.deleteIcon("github");

        expect(retry).toEqual({
            deck: { status: "missing" },
            library: { status: "deleted" },
            remaining: "none",
        });
        expect(deck.iconCalls).toHaveLength(2);
        expect(deck.iconCalls[1]?.allowMissing).toBe(true);
        expect(fs.existsSync(iconFile())).toBe(false);
    });

    it("refuses an invalid icon name without touching either copy", async () => {
        await expect(service.deleteIcon("../escape")).rejects.toBeInstanceOf(StorageError);

        expect(deck.iconCalls).toEqual([]);
        expect(fs.existsSync(iconFile())).toBe(true);
        expect(lock.busy).toBe(false);
    });
});
