import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceImageEntry, DevicePageEntry, DeviceProfileEntry } from "@shared/protocol";
import { serializePageConfig } from "@shared/schema";
import type { SyncProgressPayload } from "@shared/ipc";
import type { DiffPlan } from "@shared/sync";
import { crc32 } from "./usb/Crc32";
import { StorageService } from "./StorageService";
import { SyncService } from "./SyncService";
import type { SyncDeviceClient, SyncTransferClient } from "./SyncService";

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
    return crc32(encoder.encode(JSON.stringify(serializePageConfig(page as never))));
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

    async setActiveProfile(name: string): Promise<void> {
        this.check("setActiveProfile");
        this.calls.push(`active:${name}`);
    }

    async uploadPage(profile: string, id: string | number, _json: string | Uint8Array): Promise<void> {
        void _json;
        this.check("uploadPage");
        this.calls.push(`page:${profile}/${id}`);
    }

    async uploadIcon(name: string, _bytes: Uint8Array): Promise<void> {
        void _bytes;
        this.check("uploadIcon");
        this.calls.push(`icon:${name}`);
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
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("plans nothing when local and device match", async () => {
        storage.createProfile("main");
        const page = { buttons: { "0": { label: "A", click: ["DELAY:5"] } } };
        storage.savePage("main", "0", page);
        device.profiles = [
            { name: "main", pages: [{ id: 0, filename: "0.json", hash: pageHash(page) }] },
        ];

        const plan = await sync.reconcile();
        expect(plan.profilesToCreate).toEqual([]);
        expect(plan.pagesToUpload).toEqual([]);
        expect(plan.iconsToUpload).toEqual([]);
        expect(plan.pagesToDelete).toEqual([]);
        expect(plan.iconsToDelete).toEqual([]);
        expect(plan.setActiveProfile).toBeNull();
    });

    it("plans a page upload when the device hash differs (one-byte edit)", async () => {
        storage.createProfile("main");
        const page = { buttons: { "0": { label: "A", click: [] } } };
        storage.savePage("main", "0", page);
        device.profiles = [
            { name: "main", pages: [{ id: 0, filename: "0.json", hash: pageHash(page) ^ 1 }] },
        ];

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
    });

    it("maps device pages by id and falls back to the filename", async () => {
        storage.createProfile("main");
        const page = { buttons: { "7": { label: "A", click: [] } } };
        storage.savePage("main", "7", page);
        // id omitted: derive from `filename`.
        device.profiles = [
            {
                name: "main",
                pages: [{ filename: "7.json", hash: pageHash(page) } as DevicePageEntry],
            },
        ];
        expect((await sync.reconcile()).pagesToUpload).toEqual([]);
    });

    it("plans icons by CRC-32 and strips the .png extension", async () => {
        fs.writeFileSync(path.join(storage.iconsDir(), "github.png"), Buffer.from([1, 2, 3]));
        device.images = [
            { filename: "github.png", hash: crc32(Uint8Array.from([1, 2, 3])) },
            { filename: "stale.png", hash: 1 },
        ];

        const plan = await sync.reconcile();
        expect(plan.iconsToUpload).toEqual([]);
        expect(plan.iconsToDelete).toEqual([{ name: "stale" }]);
    });

    it("plans remote-only pages/icons and reports missing icon references", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", {
            buttons: { "0": { imageName: "ghost", click: [] } },
        });
        device.profiles = [
            {
                name: "main",
                pages: [
                    { id: 0, filename: "0.json", hash: pageHash({ buttons: { "0": {} } }) },
                    { id: 9, filename: "9.json", hash: 42 },
                ],
            },
        ];

        const plan = await sync.reconcile();
        expect(plan.pagesToDelete).toEqual([{ profile: "main", id: "9" }]);
        expect(plan.missingIcons).toEqual([{ name: "ghost" }]);
    });

    it("includes setActiveProfile only when the profile exists", async () => {
        storage.createProfile("main");
        device.profiles = [{ name: "main", pages: [] }];
        expect((await sync.reconcile({ activeProfile: "main" })).setActiveProfile).toBe("main");
        expect((await sync.reconcile({ activeProfile: "ghost" })).setActiveProfile).toBeNull();
    });

    it("rejects a locally corrupt page instead of uploading it", async () => {
        storage.createProfile("main");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "0.json"), "{not json");
        await expect(sync.reconcile()).rejects.toMatchObject({ code: "SYNC_INVALID_PAGE" });
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
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
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

    it("reports pending deletions without inventing a delete opcode", async () => {
        storage.createProfile("main");
        const plan: DiffPlan = {
            profilesToCreate: [],
            pagesToUpload: [],
            iconsToUpload: [],
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
            missingIcons: [],
            setActiveProfile: null,
        };
        const result = await sync.executePlan(plan);
        expect(result.pendingDeletions).toBe(2);
        expect(device.calls).toEqual([]);
    });
});
