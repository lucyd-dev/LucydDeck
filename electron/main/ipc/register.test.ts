import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@shared/ipc";
import { emptyDiffPlan } from "@shared/sync";
import { DeleteService } from "../services/DeleteService";
import { DeviceLock, deviceBusyMessage } from "../services/DeviceLock";
import { FirmwareService } from "../services/FirmwareService";
import { StorageService } from "../services/StorageService";
import { SyncService } from "../services/SyncService";
import { registerIpcHandlers } from "./register";

const mocks = vi.hoisted(() => ({
    handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
    app: { getVersion: () => "0.0.0" },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: {
        handle: (
            channel: string,
            handler: (event: unknown, payload: unknown) => Promise<unknown>,
        ) => {
            mocks.handlers.set(channel, handler);
        },
    },
    shell: { openPath: vi.fn() },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

async function invoke(channel: string, payload: unknown): Promise<unknown> {
    const handler = mocks.handlers.get(channel);
    if (handler === undefined) {
        throw new Error(`No handler registered for ${channel}`);
    }
    return handler(undefined, payload);
}

describe("IPC deck ownership guards", () => {
    let dataDir = "";
    let storage: StorageService;
    let lock: DeviceLock;
    let device: {
        createProfile: ReturnType<typeof vi.fn>;
        renameProfile: ReturnType<typeof vi.fn>;
        setActiveProfile: ReturnType<typeof vi.fn>;
        setActivePage: ReturnType<typeof vi.fn>;
        uploadPage: ReturnType<typeof vi.fn>;
        uploadIcon: ReturnType<typeof vi.fn>;
        deletePage: ReturnType<typeof vi.fn>;
        deleteIcon: ReturnType<typeof vi.fn>;
        deleteProfile: ReturnType<typeof vi.fn>;
    };
    let usb: {
        connected: boolean;
        onEvent: () => () => void;
        connectWithScanning: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        mocks.handlers.clear();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-ipc-test-"));
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        storage.createProfile("main");
        fs.writeFileSync(path.join(storage.iconsDir(), "github.png"), "png");
        lock = new DeviceLock();
        device = {
            createProfile: vi.fn(async () => undefined),
            renameProfile: vi.fn(async () => undefined),
            setActiveProfile: vi.fn(async () => undefined),
            setActivePage: vi.fn(async () => undefined),
            uploadPage: vi.fn(async () => undefined),
            uploadIcon: vi.fn(async () => undefined),
            deletePage: vi.fn(async () => "deleted"),
            deleteIcon: vi.fn(async () => "deleted"),
            deleteProfile: vi.fn(async () => "deleted"),
        };
        usb = {
            connected: true,
            onEvent: () => () => undefined,
            connectWithScanning: vi.fn(async () => undefined),
        };

        const sync = new SyncService(
            storage,
            device as never,
            { onEvent: () => () => undefined },
            { lock },
        );
        const firmware = new FirmwareService({
            usb: { resumeScanning: vi.fn(), connected: true } as never,
            device: {} as never,
            flasher: {} as never,
            locator: {} as never,
            releaseSource: {} as never,
            pickImage: async () => null,
            lock,
        });
        const deletes = new DeleteService({
            storage,
            device: device as never,
            lock,
            isConnected: () => usb.connected,
        });

        registerIpcHandlers({
            storage,
            usb: usb as never,
            device: device as never,
            fileTransfer: { onEvent: () => () => undefined } as never,
            imagePipeline: {} as never,
            sync,
            firmware,
            deletes,
            plugins: { onEvent: () => () => undefined } as never,
            commands: {} as never,
            lock,
        });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("refuses deck writes and a sync while an update owns the deck", async () => {
        lock.beginUpdate();

        const write = await invoke(channels.usb.setActiveProfile, { name: "main" });
        expect(write).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
        expect(device.setActiveProfile).not.toHaveBeenCalled();

        const sync = await invoke(channels.sync.execute, { plan: emptyDiffPlan() });
        expect(sync).toMatchObject({ ok: false, code: "DEVICE_BUSY" });

        lock.endUpdate();
        const allowed = await invoke(channels.usb.setActiveProfile, { name: "main" });
        expect(allowed).toEqual({ ok: true, data: undefined });
        expect(device.setActiveProfile).toHaveBeenCalledWith("main");
    });

    it("refuses an update while a sync owns the deck", async () => {
        lock.beginSync();

        const update = await invoke(channels.firmware.update, undefined);

        expect(update).toMatchObject({
            ok: true,
            data: {
                phase: "error",
                error: { code: "FIRMWARE_BUSY" },
            },
        });
        const data = (update as { data: { error: { message: string } } }).data;
        expect(data.error.message).toContain("sync");
        expect(lock.syncing).toBe(true);

        lock.endSync();
    });

    const holders = [
        {
            name: "sync",
            activity: "sync" as const,
            hold: (lock: DeviceLock) => lock.beginSync(),
            release: (lock: DeviceLock) => lock.endSync(),
        },
        {
            name: "update",
            activity: "update" as const,
            hold: (lock: DeviceLock) => lock.beginUpdate(),
            release: (lock: DeviceLock) => lock.endUpdate(),
        },
    ];

    interface DeckWrite {
        name: string;
        channel: string;
        payload: unknown;
        method:
            | "createProfile"
            | "renameProfile"
            | "setActiveProfile"
            | "setActivePage"
            | "uploadPage"
            | "uploadIcon"
            | "deletePage"
            | "deleteIcon";
    }

    /** Every mutating channel except the three delete owners. */
    const deckWrites: DeckWrite[] = [
        {
            name: "profile create",
            channel: channels.usb.createProfile,
            payload: { name: "second" },
            method: "createProfile",
        },
        {
            name: "profile rename",
            channel: channels.usb.renameProfile,
            payload: { oldName: "main", newName: "renamed" },
            method: "renameProfile",
        },
        {
            name: "profile activation",
            channel: channels.usb.setActiveProfile,
            payload: { name: "main" },
            method: "setActiveProfile",
        },
        {
            name: "active-page switch",
            channel: channels.usb.setActivePage,
            payload: { id: "0" },
            method: "setActivePage",
        },
        {
            name: "page upload",
            channel: channels.usb.uploadPage,
            payload: { profile: "main", id: "0" },
            method: "uploadPage",
        },
        {
            name: "icon upload",
            channel: channels.usb.uploadIcon,
            payload: { name: "github" },
            method: "uploadIcon",
        },
        {
            name: "device page delete",
            channel: channels.usb.deleteFile,
            payload: { kind: "page", profile: "main", id: "0" },
            method: "deletePage",
        },
        {
            name: "device icon delete",
            channel: channels.usb.deleteFile,
            payload: { kind: "icon", name: "github" },
            method: "deleteIcon",
        },
    ];

    const deckWriteCases = holders.flatMap((holder) =>
        deckWrites.map((write) => ({
            ...write,
            holderName: holder.name,
            activity: holder.activity,
            hold: holder.hold,
            release: holder.release,
        })),
    );

    it.each(deckWriteCases)(
        "refuses $name with DEVICE_BUSY while $holderName owns the deck",
        async ({ activity, channel, payload, method, hold, release }) => {
            expect(hold(lock)).toBe(true);

            const refused = await invoke(channel, payload);

            expect(refused).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
            expect((refused as { error: string }).error).toBe(deviceBusyMessage(activity));
            expect(device[method]).not.toHaveBeenCalled();

            release(lock);
            const allowed = await invoke(channel, payload);
            expect(allowed).toEqual({ ok: true, data: undefined });
            expect(device[method]).toHaveBeenCalled();
            expect(lock.busy).toBe(false);
        },
    );

    it("holds the write lock for the whole device command", async () => {
        let writingDuringCall = false;
        device.uploadPage.mockImplementationOnce(async () => {
            writingDuringCall = lock.writing;
        });

        await invoke(channels.usb.uploadPage, { profile: "main", id: "0" });

        expect(writingDuringCall).toBe(true);
        expect(lock.busy).toBe(false);
    });

    it("releases the write lock after a failed write so the next write works", async () => {
        device.setActivePage.mockRejectedValueOnce(new Error("USB write failed"));

        const failed = await invoke(channels.usb.setActivePage, { id: "0" });

        expect(failed).toMatchObject({ ok: false, error: "USB write failed" });
        expect(lock.busy).toBe(false);

        const next = await invoke(channels.usb.setActiveProfile, { name: "main" });
        expect(next).toEqual({ ok: true, data: undefined });
        expect(device.setActiveProfile).toHaveBeenCalledWith("main");
        expect(lock.busy).toBe(false);
    });

    it("releases the write lock when a write refuses before it sends anything", async () => {
        const failed = await invoke(channels.usb.uploadIcon, { name: "missing" });

        expect(failed).toMatchObject({ ok: false });
        expect(lock.busy).toBe(false);

        const next = await invoke(channels.usb.setActiveProfile, { name: "main" });
        expect(next).toEqual({ ok: true, data: undefined });
    });

    it("refuses a sync while a direct write owns the deck", async () => {
        expect(lock.beginWrite()).toBe(true);

        const refused = await invoke(channels.sync.execute, { plan: emptyDiffPlan() });

        expect(refused).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
        expect((refused as { error: string }).error).toBe(deviceBusyMessage("write"));

        lock.endWrite();
        const allowed = await invoke(channels.sync.execute, { plan: emptyDiffPlan() });
        expect(allowed).toMatchObject({ ok: true });
        expect(lock.busy).toBe(false);
    });

    it("reports a missing Device → Files file as an error and releases the lock", async () => {
        device.deleteIcon.mockRejectedValueOnce(new Error("File not found"));

        const refused = await invoke(channels.usb.deleteFile, { kind: "icon", name: "gone" });

        expect(refused).toMatchObject({ ok: false, error: "File not found" });
        expect(device.deleteIcon).toHaveBeenCalledWith("gone", { allowMissing: false });
        expect(lock.busy).toBe(false);
    });

    it.each(holders)(
        "refuses a page delete with DEVICE_BUSY while a $name owns the deck",
        async ({ hold, release }) => {
            expect(hold(lock)).toBe(true);

            const refused = await invoke(channels.delete.page, { profile: "main", id: "0" });

            expect(refused).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
            expect(device.deletePage).not.toHaveBeenCalled();

            release(lock);
            const allowed = await invoke(channels.delete.page, { profile: "main", id: "0" });

            expect(allowed).toEqual({
                ok: true,
                data: {
                    deck: { status: "deleted" },
                    library: { status: "deleted" },
                    remaining: "none",
                },
            });
            expect(device.deletePage).toHaveBeenCalledWith("main", "0", { allowMissing: true });
        },
    );

    it.each(holders)(
        "refuses an icon delete with DEVICE_BUSY while a $name owns the deck",
        async ({ hold, release }) => {
            expect(hold(lock)).toBe(true);

            const refused = await invoke(channels.delete.icon, { name: "github" });

            expect(refused).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
            expect(device.deleteIcon).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(storage.iconsDir(), "github.png"))).toBe(true);

            release(lock);
            const allowed = await invoke(channels.delete.icon, { name: "github" });

            expect(allowed).toEqual({
                ok: true,
                data: {
                    deck: { status: "deleted" },
                    library: { status: "deleted" },
                    remaining: "none",
                },
            });
            expect(device.deleteIcon).toHaveBeenCalledWith("github", { allowMissing: true });
        },
    );

    it.each(holders)(
        "refuses a profile delete with DEVICE_BUSY while a $name owns the deck",
        async ({ hold, release }) => {
            expect(hold(lock)).toBe(true);

            const refused = await invoke(channels.delete.profile, { name: "main" });

            expect(refused).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
            expect(device.deleteProfile).not.toHaveBeenCalled();
            expect(fs.existsSync(path.join(dataDir, "profiles", "main"))).toBe(true);

            release(lock);
            const allowed = await invoke(channels.delete.profile, { name: "main" });

            expect(allowed).toEqual({
                ok: true,
                data: {
                    deck: { status: "deleted" },
                    library: { status: "deleted" },
                    remaining: "none",
                },
            });
            expect(device.deleteProfile).toHaveBeenCalledWith("main", { allowMissing: true });
            expect(fs.existsSync(path.join(dataDir, "profiles", "main"))).toBe(false);
        },
    );

    it("makes a chip connect keep scanning", async () => {
        const result = await invoke(channels.usb.connect, undefined);

        expect(result).toEqual({ ok: true, data: undefined });
        expect(usb.connectWithScanning).toHaveBeenCalledOnce();
    });
});
