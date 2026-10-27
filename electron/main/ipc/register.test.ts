import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@shared/ipc";
import { emptyDiffPlan } from "@shared/sync";
import { DeleteService } from "../services/DeleteService";
import { DeviceLock } from "../services/DeviceLock";
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
        deletePage: ReturnType<typeof vi.fn>;
        deleteIcon: ReturnType<typeof vi.fn>;
        deleteProfile: ReturnType<typeof vi.fn>;
        setActiveProfile: ReturnType<typeof vi.fn>;
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
            deletePage: vi.fn(async () => "deleted"),
            deleteIcon: vi.fn(async () => "deleted"),
            deleteProfile: vi.fn(async () => "deleted"),
            setActiveProfile: vi.fn(async () => undefined),
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
            hold: (lock: DeviceLock) => lock.beginSync(),
            release: (lock: DeviceLock) => lock.endSync(),
        },
        {
            name: "update",
            hold: (lock: DeviceLock) => lock.beginUpdate(),
            release: (lock: DeviceLock) => lock.endUpdate(),
        },
    ];

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
