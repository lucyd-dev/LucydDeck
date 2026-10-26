import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channels } from "@shared/ipc";
import { emptyDiffPlan } from "@shared/sync";
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
    let lock: DeviceLock;
    let device: { deleteProfile: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mocks.handlers.clear();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-ipc-test-"));
        const storage = new StorageService({ dataDir });
        storage.ensureLayout();
        lock = new DeviceLock();
        device = { deleteProfile: vi.fn(async () => undefined) };

        const sync = new SyncService(
            storage,
            device as never,
            { onEvent: () => () => undefined },
            { lock },
        );
        const firmware = new FirmwareService({
            usb: {} as never,
            device: {} as never,
            flasher: {} as never,
            locator: {} as never,
            releaseSource: {} as never,
            pickImage: async () => null,
            lock,
        });

        registerIpcHandlers({
            storage,
            usb: { onEvent: () => () => undefined, connected: true } as never,
            device: device as never,
            fileTransfer: { onEvent: () => () => undefined } as never,
            imagePipeline: {} as never,
            sync,
            firmware,
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

        const write = await invoke(channels.usb.deleteProfile, { name: "main" });
        expect(write).toMatchObject({ ok: false, code: "DEVICE_BUSY" });
        expect(device.deleteProfile).not.toHaveBeenCalled();

        const sync = await invoke(channels.sync.execute, { plan: emptyDiffPlan() });
        expect(sync).toMatchObject({ ok: false, code: "DEVICE_BUSY" });

        lock.endUpdate();
        const allowed = await invoke(channels.usb.deleteProfile, { name: "main" });
        expect(allowed).toEqual({ ok: true, data: undefined });
        expect(device.deleteProfile).toHaveBeenCalledWith("main");
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
});
