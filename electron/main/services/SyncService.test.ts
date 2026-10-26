import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log/main";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceImageEntry, DevicePageEntry, DeviceProfileEntry } from "@shared/protocol";
import { serializePageConfig } from "@shared/schema";
import type { SyncProgressPayload } from "@shared/ipc";
import { type DiffPlan, emptyDiffPlan } from "@shared/sync";
import { crc32Upload } from "./usb/Crc32";
import { StorageService } from "./StorageService";
import { SyncService } from "./SyncService";
import type { SyncDeviceClient, SyncTransferClient } from "./SyncService";
import { DeviceLock } from "./DeviceLock";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const encoder = new TextEncoder();

function pageHash(page: { buttons: Record<string, unknown> }): number {
    return crc32Upload(encoder.encode(JSON.stringify(serializePageConfig(page as never))));
}

function deviceProfile(
    name: string,
    pages: Array<{ id: string | number; hash: number }>,
): DeviceProfileEntry {
    return {
        name,
        pages: pages.map((page) => ({
            id: page.id,
            filename: `${page.id}.json`,
            hash: page.hash,
        })),
    };
}

class MockDevice implements SyncDeviceClient {
    profiles: DeviceProfileEntry[] = [];
    images: DeviceImageEntry[] = [];
    calls: string[] = [];
    failOn: string | null = null;

    async listProfiles(): Promise<DeviceProfileEntry[]> {
        return this.profiles;
    }

    async listImages(): Promise<DeviceImageEntry[]> {
        return this.images;
    }

    async createProfile(name: string): Promise<void> {
        this.check("createProfile");
        this.calls.push(`create:${name}`);
    }

    async renameProfile(oldName: string, newName: string): Promise<void> {
        this.check("renameProfile");
        this.calls.push(`rename:${oldName}->${newName}`);
    }

    async setActiveProfile(name: string): Promise<void> {
        this.check("setActiveProfile");
        this.calls.push(`active:${name}`);
    }

    async uploadPage(
        profile: string,
        id: string | number,
        _json: string | Uint8Array,
    ): Promise<void> {
        void _json;
        this.check("uploadPage");
        this.calls.push(`page:${profile}/${id}`);
    }

    iconUploads: Array<{ name: string; options?: { allowLegacyName?: boolean } }> = [];

    async uploadIcon(
        name: string,
        _bytes: Uint8Array,
        options?: { allowLegacyName?: boolean },
    ): Promise<void> {
        void _bytes;
        this.check("uploadIcon");
        this.calls.push(`icon:${name}`);
        this.iconUploads.push({ name, options });
    }

    readonly deleteCalls: Array<{
        kind: "page" | "icon";
        target: string;
        options?: { allowMissing?: boolean };
    }> = [];

    async deletePage(
        profile: string,
        id: string | number,
        options?: { allowMissing?: boolean },
    ): Promise<void> {
        this.check("deletePage");
        this.calls.push(`del:page:${profile}/${id}`);
        this.deleteCalls.push({ kind: "page", target: `${profile}/${id}`, options });
    }

    async deleteIcon(name: string, options?: { allowMissing?: boolean }): Promise<void> {
        this.check("deleteIcon");
        this.calls.push(`del:icon:${name}`);
        this.deleteCalls.push({ kind: "icon", target: name, options });
    }

    readonly profileDeletes: Array<{ name: string; options?: { allowMissing?: boolean } }> = [];

    async deleteProfile(name: string, options?: { allowMissing?: boolean }): Promise<void> {
        this.check("deleteProfile");
        this.calls.push(`del:profile:${name}`);
        this.profileDeletes.push({ name, options });
    }

    private check(op: string): void {
        if (this.failOn === op) {
            throw new Error(`boom:${op}`);
        }
    }
}

const transfer: SyncTransferClient = {
    onEvent() {
        return () => undefined;
    },
};

describe("SyncService.reconcile", () => {
    let dataDir = "";
    let storage: StorageService;
    let device: MockDevice;
    let sync: SyncService;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-sync-test-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        device = new MockDevice();
        sync = new SyncService(storage, device, transfer);
        vi.mocked(log.warn).mockClear();
        vi.mocked(log.info).mockClear();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("plans nothing when local and device match", async () => {
        storage.createProfile("main");
        const page = { buttons: { "0": { label: "A", click: ["DELAY:5"] } } };
        storage.savePage("main", "0", page);
        device.profiles = [deviceProfile("main", [{ id: 0, hash: pageHash(page) }])];

        const plan = await sync.reconcile();
        expect(plan.profilesToCreate).toEqual([]);
        expect(plan.profileRenames).toEqual([]);
        expect(plan.profileRenameFallback).toBeNull();
        expect(plan.pagesToUpload).toEqual([]);
        expect(plan.iconsToUpload).toEqual([]);
        expect(plan.pagesToDelete).toEqual([]);
        expect(plan.iconsToDelete).toEqual([]);
        expect(plan.profilesToDelete).toEqual([]);
        expect(plan.setActiveProfile).toBeNull();
    });

    it("plans a page upload when the device hash differs (one-byte edit)", async () => {
        storage.createProfile("main");
        const page = { buttons: { "0": { label: "A", click: [] } } };
        storage.savePage("main", "0", page);
        device.profiles = [deviceProfile("main", [{ id: 0, hash: pageHash(page) ^ 1 }])];

        const plan = await sync.reconcile();
        expect(plan.pagesToUpload).toEqual([{ profile: "main", id: "0" }]);
    });

    it("plans profile creation before pages for a missing profile", async () => {
        storage.createProfile("new");
        storage.savePage("new", "0", { buttons: {} });
        device.profiles = [];

        const plan = await sync.reconcile();
        expect(plan.profilesToCreate).toEqual(["new"]);
        expect(plan.pagesToUpload).toEqual([{ profile: "new", id: "0" }]);
        expect(plan.profilesToDelete).toEqual([]);
    });

    it("maps device pages by id and falls back to the filename", async () => {
        storage.createProfile("main");
        const page = { buttons: { "7": { label: "A", click: [] } } };
        storage.savePage("main", "7", page);
        // id omitted: derive from `filename`.
        device.profiles = [
            {
                name: "main",
                pages: [
                    { id: 0, filename: "0.json", hash: pageHash({ buttons: {} }) },
                    { filename: "7.json", hash: pageHash(page) } as DevicePageEntry,
                ],
            },
        ];
        expect((await sync.reconcile()).pagesToUpload).toEqual([]);
    });

    it("plans icons by CRC-32 and strips the .png extension", async () => {
        fs.writeFileSync(path.join(storage.iconsDir(), "github.png"), Buffer.from([1, 2, 3]));
        device.images = [
            { filename: "github.png", hash: crc32Upload(Uint8Array.from([1, 2, 3])) },
            { filename: "stale.png", hash: 1 },
        ];

        const plan = await sync.reconcile();
        expect(plan.iconsToUpload).toEqual([]);
        expect(plan.iconsToDelete).toEqual([{ name: "stale" }]);
    });

    it("skips a local icon that cannot be created under the entity grammar", async () => {
        fs.writeFileSync(path.join(storage.iconsDir(), "v1.2.png"), Buffer.from([1]));
        device.images = [];

        const plan = await sync.reconcile();
        expect(plan.iconsToUpload).toEqual([]);
        expect(vi.mocked(log.warn)).toHaveBeenCalledWith(expect.stringContaining('icon "v1.2"'));
    });

    it("plans an overwrite for a legacy icon the deck already has", async () => {
        fs.writeFileSync(path.join(storage.iconsDir(), "v1.2.png"), Buffer.from([1, 2]));
        device.images = [{ filename: "v1.2.png", hash: crc32Upload(Uint8Array.from([9])) }];

        const plan = await sync.reconcile();
        expect(plan.iconsToUpload).toEqual([{ name: "v1.2" }]);

        await sync.executePlan(plan);
        expect(device.iconUploads).toEqual([{ name: "v1.2", options: { allowLegacyName: true } }]);
    });

    it("still syncs a profile created under the older name rule", async () => {
        const legacyDir = path.join(dataDir, "profiles", "v1.2");
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(
            path.join(legacyDir, "0.json"),
            `${JSON.stringify(serializePageConfig({ buttons: {} }))}\n`,
        );
        device.profiles = [deviceProfile("v1.2", [{ id: 0, hash: pageHash({ buttons: {} }) }])];

        const plan = await sync.reconcile();
        expect(plan.profilesToCreate).toEqual([]);
        expect(plan.pagesToUpload).toEqual([]);
        expect(plan.pagesToDelete).toEqual([]);
        expect(plan.profilesToDelete).toEqual([]);
    });

    it("plans remote-only pages/icons and reports missing icon references", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", {
            buttons: { "0": { imageName: "ghost", click: [] } },
        });
        device.profiles = [
            deviceProfile("main", [
                { id: 0, hash: pageHash({ buttons: { "0": {} } }) },
                { id: 9, hash: 42 },
            ]),
        ];

        const plan = await sync.reconcile();
        expect(plan.pagesToDelete).toEqual([{ profile: "main", id: "9" }]);
        expect(plan.missingIcons).toEqual([{ name: "ghost" }]);
    });

    it("includes setActiveProfile only when the profile exists and stays", async () => {
        storage.createProfile("main");
        device.profiles = [deviceProfile("main", [])];
        expect((await sync.reconcile({ activeProfile: "main" })).setActiveProfile).toBe("main");
        expect((await sync.reconcile({ activeProfile: "ghost" })).setActiveProfile).toBeNull();
    });

    it("rejects a locally corrupt page instead of uploading it", async () => {
        storage.createProfile("main");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "0.json"), "{not json");
        await expect(sync.reconcile()).rejects.toMatchObject({ code: "SYNC_INVALID_PAGE" });
    });

    it("aborts the whole plan when the library cannot be read", async () => {
        vi.spyOn(storage, "listProfiles").mockImplementation(() => {
            throw new Error("EACCES");
        });
        device.profiles = [deviceProfile("deck-only", [{ id: 0, hash: 1 }])];

        await expect(sync.reconcile()).rejects.toMatchObject({
            code: "SYNC_UNREADABLE_LIBRARY",
        });
        expect(device.calls).toEqual([]);
    });

    describe("profile pruning", () => {
        it("plans a deck profile with no local copy, under the looser name rule", async () => {
            storage.createProfile("main");
            device.profiles = [
                deviceProfile("main", []),
                deviceProfile("v1.2", [{ id: 0, hash: 1 }]),
            ];

            const plan = await sync.reconcile();
            expect(plan.profilesToDelete).toEqual(["v1.2"]);
            expect(plan.profileRenames).toEqual([]);
        });

        it("never prunes profiles from an empty library", async () => {
            device.profiles = [
                deviceProfile("work", [{ id: 0, hash: 1 }]),
                deviceProfile("game", [{ id: 0, hash: 2 }]),
            ];

            const plan = await sync.reconcile();
            expect(plan.profilesToDelete).toEqual([]);
            expect(vi.mocked(log.info)).toHaveBeenCalledWith(
                expect.stringContaining("the library has no profiles"),
            );
        });
    });

    describe("profile rename detection", () => {
        it("turns one deck-only and one library-only profile into a rename", async () => {
            storage.createProfile("renamed");
            const page = { buttons: { "0": { label: "A", click: [] } } };
            storage.savePage("renamed", "0", page);
            device.profiles = [deviceProfile("old", [{ id: 0, hash: pageHash(page) }])];

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([{ from: "old", to: "renamed" }]);
            expect(plan.profilesToCreate).toEqual([]);
            expect(plan.profilesToDelete).toEqual([]);
            expect(plan.pagesToUpload).toEqual([]);
            expect(plan.profileRenameFallback).toBeNull();
            expect(vi.mocked(log.info)).toHaveBeenCalledWith(
                expect.stringContaining('profile rename detected: "old" -> "renamed"'),
            );
        });

        it("uploads only the pages the deck profile does not already hold", async () => {
            storage.createProfile("renamed");
            const page = { buttons: { "0": { label: "A", click: [] } } };
            storage.savePage("renamed", "0", page);
            storage.savePage("renamed", "1", { buttons: { "1": { label: "new", click: [] } } });
            device.profiles = [deviceProfile("old", [{ id: 0, hash: pageHash(page) }])];

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([{ from: "old", to: "renamed" }]);
            expect(plan.pagesToUpload).toEqual([{ profile: "renamed", id: "1" }]);
            expect(plan.pagesToDelete).toEqual([]);
        });

        it("uses today's create plus remove when the pages do not correspond", async () => {
            storage.createProfile("renamed");
            storage.savePage("renamed", "0", {
                buttons: { "0": { label: "different", click: [] } },
            });
            device.profiles = [deviceProfile("old", [{ id: 0, hash: pageHash({ buttons: {} }) }])];

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([]);
            expect(plan.profileRenameFallback).toBeNull();
            expect(plan.profilesToCreate).toEqual(["renamed"]);
            expect(plan.profilesToDelete).toEqual(["old"]);
            expect(plan.pagesToUpload).toEqual([{ profile: "renamed", id: "0" }]);
        });

        it("falls back when another local profile matches the same deck pages", async () => {
            storage.createProfile("copy");
            const page = { buttons: { "0": { label: "A", click: [] } } };
            storage.savePage("copy", "0", page);
            device.profiles = [
                deviceProfile("copy", [{ id: 0, hash: pageHash(page) }]),
                deviceProfile("old", [{ id: 0, hash: pageHash(page) }]),
            ];
            storage.createProfile("renamed");
            storage.savePage("renamed", "0", page);

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([]);
            expect(plan.profileRenameFallback).toEqual(expect.stringContaining("not one-to-one"));
            expect(plan.profilesToCreate).toEqual(["renamed"]);
            expect(plan.profilesToDelete).toEqual(["old"]);
            expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
                expect.stringContaining("not guessing a rename"),
            );
        });

        it("falls back when two profiles could swap names", async () => {
            storage.createProfile("gamma");
            storage.savePage("gamma", "0", { buttons: { "0": { label: "B", click: [] } } });
            storage.createProfile("delta");
            storage.savePage("delta", "0", { buttons: { "0": { label: "A", click: [] } } });
            device.profiles = [
                deviceProfile("alpha", [
                    { id: 0, hash: pageHash({ buttons: { "0": { label: "A", click: [] } } }) },
                ]),
                deviceProfile("beta", [
                    { id: 0, hash: pageHash({ buttons: { "0": { label: "B", click: [] } } }) },
                ]),
            ];

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([]);
            expect(plan.profileRenameFallback).toEqual(expect.stringContaining("not one-to-one"));
            expect(plan.profilesToCreate).toEqual(["delta", "gamma"]);
            expect(plan.profilesToDelete).toEqual(["alpha", "beta"]);
        });

        it("does not rename when the deck profile has no pages to compare", async () => {
            storage.createProfile("renamed");
            storage.savePage("renamed", "0", { buttons: {} });
            device.profiles = [deviceProfile("old", [])];

            const plan = await sync.reconcile();
            expect(plan.profileRenames).toEqual([]);
            expect(plan.profilesToCreate).toEqual(["renamed"]);
            expect(plan.profilesToDelete).toEqual(["old"]);
        });
    });
});

describe("SyncService.executePlan", () => {
    let dataDir = "";
    let storage: StorageService;
    let device: MockDevice;
    let sync: SyncService;
    let progress: SyncProgressPayload[];

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-sync-exec-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        device = new MockDevice();
        progress = [];
        sync = new SyncService(storage, device, transfer, {
            onProgress: (payload) => progress.push(payload),
        });
        vi.mocked(log.info).mockClear();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function planWith(overrides: Partial<DiffPlan>): DiffPlan {
        return { ...emptyDiffPlan(), ...overrides };
    }

    it("refuses to run while a firmware update owns the deck", async () => {
        const lock = new DeviceLock();
        const guarded = new SyncService(storage, device, transfer, {
            onProgress: (payload) => progress.push(payload),
            lock,
        });
        lock.beginUpdate();

        await expect(guarded.executePlan(emptyDiffPlan())).rejects.toMatchObject({
            code: "DEVICE_BUSY",
            holder: "update",
        });
        expect(device.calls).toEqual([]);
        expect(progress).toEqual([]);

        lock.endUpdate();
    });

    it("holds the deck for the run and releases it after success or failure", async () => {
        const lock = new DeviceLock();
        const guarded = new SyncService(storage, device, transfer, { lock });

        await guarded.executePlan(emptyDiffPlan());
        expect(lock.busy).toBe(false);

        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: {} });
        const plan = await guarded.reconcile();
        device.failOn = "createProfile";

        await expect(guarded.executePlan(plan)).rejects.toThrow(/boom:createProfile/);
        expect(lock.busy).toBe(false);
    });

    it("is a no-op for an empty plan", async () => {
        const plan = await sync.reconcile();
        const result = await sync.executePlan(plan);
        expect(device.calls).toEqual([]);
        expect(result.createdProfiles).toEqual([]);
        expect(result.uploadedPages).toEqual([]);
        expect(progress.at(-1)).toMatchObject({ phase: "done", percent: 100 });
    });

    it("creates profiles before uploading pages", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: { "0": { label: "A", click: [] } } });
        const plan = await sync.reconcile({ activeProfile: "main" });

        await sync.executePlan(plan);
        expect(device.calls).toEqual(["create:main", "page:main/0", "active:main"]);
    });

    it("uploads icons and pages and reports counts", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: { "0": { label: "A", click: [] } } });
        fs.writeFileSync(path.join(storage.iconsDir(), "icon.png"), Buffer.from([9]));
        const plan = await sync.reconcile();
        const result = await sync.executePlan(plan);

        expect(device.calls).toEqual(["create:main", "icon:icon", "page:main/0"]);
        expect(result.uploadedIcons).toEqual([{ name: "icon" }]);
        expect(result.uploadedPages).toEqual([{ profile: "main", id: "0" }]);
    });

    it("aborts on the first device error and emits aborted", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: { "0": { label: "A", click: [] } } });
        const plan = await sync.reconcile();
        device.failOn = "createProfile";

        await expect(sync.executePlan(plan)).rejects.toThrow(/boom:createProfile/);
        expect(progress.at(-1)).toMatchObject({ phase: "aborted" });
    });

    it("removes device files and profiles when the sync is explicit", async () => {
        storage.createProfile("main");
        const plan = planWith({
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
            profilesToDelete: ["stale"],
        });
        const result = await sync.executePlan(plan, { allowRemovals: true });

        expect(result.removedPages).toEqual([{ profile: "main", id: "9" }]);
        expect(result.removedIcons).toEqual([{ name: "old" }]);
        expect(result.removedProfiles).toEqual(["stale"]);
        expect(device.calls).toEqual(["del:page:main/9", "del:icon:old", "del:profile:stale"]);
        expect(device.deleteCalls.map((call) => call.options)).toEqual([
            { allowMissing: true },
            { allowMissing: true },
        ]);
        expect(device.profileDeletes).toEqual([{ name: "stale", options: { allowMissing: true } }]);
    });

    it("skips every removal when the caller does not allow them", async () => {
        const plan = planWith({
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
            profilesToDelete: ["stale"],
        });
        const result = await sync.executePlan(plan);

        expect(device.calls).toEqual([]);
        expect(result.removedPages).toEqual([]);
        expect(result.removedIcons).toEqual([]);
        expect(result.removedProfiles).toEqual([]);
        expect(progress.at(0)).toMatchObject({ total: 0 });
        expect(vi.mocked(log.info)).toHaveBeenCalledWith(
            expect.stringContaining("skipping 3 removal(s)"),
        );
    });

    it("runs uploads, then renames, then pages, then icons, then profiles", async () => {
        storage.createProfile("renamed");
        storage.savePage("renamed", "0", { buttons: { "0": { label: "A", click: [] } } });
        fs.writeFileSync(path.join(storage.iconsDir(), "pic.png"), Buffer.from([1]));
        const plan = planWith({
            profilesToCreate: ["new"],
            profileRenames: [{ from: "old", to: "renamed" }],
            iconsToUpload: [{ name: "pic" }],
            pagesToUpload: [{ profile: "renamed", id: "0" }],
            pagesToDelete: [{ profile: "renamed", id: "9" }],
            iconsToDelete: [{ name: "gone" }],
            profilesToDelete: ["stale"],
            setActiveProfile: "renamed",
        });
        const result = await sync.executePlan(plan, { allowRemovals: true });

        expect(device.calls).toEqual([
            "create:new",
            "rename:old->renamed",
            "icon:pic",
            "page:renamed/0",
            "del:page:renamed/9",
            "del:icon:gone",
            "del:profile:stale",
            "active:renamed",
        ]);
        expect(result.renamedProfiles).toEqual([{ from: "old", to: "renamed" }]);
    });

    it("aborts on a failed removal", async () => {
        const plan = planWith({
            pagesToDelete: [{ profile: "main", id: "9" }],
        });
        device.failOn = "deletePage";

        await expect(sync.executePlan(plan, { allowRemovals: true })).rejects.toThrow(
            /boom:deletePage/,
        );
        expect(progress.at(-1)).toMatchObject({ phase: "aborted" });
    });

    it("aborts before page uploads when a rename fails", async () => {
        storage.createProfile("renamed");
        storage.savePage("renamed", "0", { buttons: {} });
        const plan = planWith({
            profileRenames: [{ from: "old", to: "renamed" }],
            pagesToUpload: [{ profile: "renamed", id: "0" }],
        });
        device.failOn = "renameProfile";

        await expect(sync.executePlan(plan)).rejects.toThrow(/boom:renameProfile/);
        expect(device.calls).toEqual([]);
    });
});

describe("SyncService plugin commands", () => {
    let dataDir = "";
    let storage: StorageService;
    let device: MockDevice;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-sync-plugin-test-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        device = new MockDevice();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function pageWithCommands(): { buttons: Record<string, unknown> } {
        return {
            buttons: {
                "0": {
                    label: "Go",
                    click: ["CMD:hello:greet", "CMD:hello:other", "DELAY:5"],
                },
            },
        };
    }

    it("reports only commands no enabled plugin registers", async () => {
        storage.createProfile("main");
        const page = pageWithCommands();
        storage.savePage("main", "0", page as never);
        device.profiles = [deviceProfile("main", [{ id: 0, hash: pageHash(page as never) }])];

        const sync = new SyncService(storage, device, transfer, {
            pluginCommands: () => ["hello:greet"],
        });
        const plan = await sync.reconcile();
        expect(plan.missingPluginCommands).toEqual(["hello:other"]);
    });

    it("reports every command when the plugin is disabled", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", pageWithCommands() as never);

        const sync = new SyncService(storage, device, transfer, { pluginCommands: () => [] });
        const plan = await sync.reconcile();
        expect(plan.missingPluginCommands).toEqual(["hello:greet", "hello:other"]);
    });
});
