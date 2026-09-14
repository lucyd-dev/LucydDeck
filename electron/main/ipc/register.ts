import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log/main";
import { channels } from "@shared/ipc";
import type {
    EventChannel,
    EventPayloadFor,
    IpcChannel,
    RequestFor,
    ResponseFor,
} from "@shared/ipc";
import type { StorageService } from "../services/StorageService";
import type { UsbService } from "../services/UsbService";

/** Broadcast a typed main-process event to all renderer windows. */
export function broadcastEvent<E extends EventChannel>(
    channel: E,
    payload: EventPayloadFor<E>,
): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
    }
}

type Handler<C extends IpcChannel> = (
    payload: RequestFor<C>,
) => ResponseFor<C> | Promise<ResponseFor<C>>;

/**
 * Register every ipcMain.handle for the channels owned by `shared/ipc.ts`.
 * Handlers never throw across the bridge: failures become `{ ok: false, error }`.
 */
export function registerIpcHandlers(storage: StorageService, usb: UsbService): void {
    const register = <C extends IpcChannel>(channel: C, handler: Handler<C>): void => {
        ipcMain.handle(channel, async (_event, rawPayload: unknown) => {
            try {
                return await handler(rawPayload as RequestFor<C>);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                log.error(`[ipc] "${channel}" failed: ${message}`);
                return { ok: false, error: message };
            }
        });
    };

    const notImplemented = <C extends IpcChannel>(channel: C, step: string): void => {
        register(channel, () => ({ ok: false, error: `not implemented (Step ${step})` }));
    };

    // --- storage (real) ------------------------------------------------
    register(channels.storage.listProfiles, () => ({ ok: true, data: storage.listProfiles() }));

    register(channels.storage.createProfile, ({ name }) => ({
        ok: true,
        data: storage.createProfile(name),
    }));

    register(channels.storage.renameProfile, ({ oldName, newName }) => ({
        ok: true,
        data: storage.renameProfile(oldName, newName),
    }));

    register(channels.storage.deleteProfile, ({ name }) => {
        storage.deleteProfile(name);
        return { ok: true, data: undefined };
    });

    register(channels.storage.listPages, ({ name }) => ({
        ok: true,
        data: storage.listPages(name),
    }));

    register(channels.storage.loadPage, ({ profile, id }) => ({
        ok: true,
        data: storage.loadPage(profile, id),
    }));

    register(channels.storage.savePage, ({ profile, id, page }) => {
        storage.savePage(profile, id, page);
        return { ok: true, data: undefined };
    });

    register(channels.storage.exportProfile, async ({ name }) => ({
        ok: true,
        data: await storage.exportProfile(name),
    }));

    register(channels.storage.importProfile, async ({ srcDir }) => ({
        ok: true,
        data: storage.importProfile(srcDir),
    }));

    // --- usb (placeholder) ---------------------------------------------
    register(channels.usb.status, () => ({ ok: true, data: usb.status() }));
    register(channels.usb.deviceInfo, () => ({ ok: true, data: usb.deviceInfo() }));
    register(channels.usb.connect, async () => {
        await usb.connect();
        return { ok: true, data: undefined };
    });
    register(channels.usb.disconnect, async () => {
        await usb.disconnect();
        return { ok: true, data: undefined };
    });

    // --- stubs for later steps -----------------------------------------
    notImplemented(channels.icons.list, "2");
    notImplemented(channels.icons.import, "2");
    notImplemented(channels.icons.remove, "2");
    notImplemented(channels.plugins.list, "4");
    notImplemented(channels.plugins.setEnabled, "4");
    notImplemented(channels.plugins.remove, "4");
    notImplemented(channels.updater.state, "5");
    notImplemented(channels.updater.check, "5");
    notImplemented(channels.firmware.getState, "5");
    notImplemented(channels.firmware.update, "5");
}
