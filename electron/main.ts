import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
// import { createRequire } from 'node:module'
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AppSettings } from "@shared/settings";
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "@shared/settings";
import { StorageService } from "./main/services/StorageService";
import { UsbService } from "./main/services/UsbService";
import { FileTransfer } from "./main/services/FileTransfer";
import { DeviceService } from "./main/services/DeviceService";
import { ImagePipelineService } from "./main/services/ImagePipelineService";
import { SyncService } from "./main/services/SyncService";
import { createStorageDialogs } from "./main/ipc/dialogs";
import { registerIpcHandlers } from "./main/ipc/register";

// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

let win: BrowserWindow | null;
let storageService: StorageService | null = null;
let quitting = false;

/** Ask the renderer to flush a pending autosave; timeout keeps quit responsive. */
async function flushEditor(window: BrowserWindow): Promise<boolean> {
    try {
        const flushed = await Promise.race([
            window.webContents.executeJavaScript(
                "window.lucydEditorFlush?.() ?? true",
                true,
            ) as Promise<unknown>,
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500)),
        ]);
        return flushed === true;
    } catch (error) {
        log.warn(`[app] could not flush the editor before quitting: ${String(error)}`);
        return false;
    }
}

app.on("before-quit", (event) => {
    const window = win;
    if (quitting || window === null || window.isDestroyed()) {
        return;
    }
    event.preventDefault();
    quitting = true;
    void flushEditor(window)
        .then((flushed) => {
            if (!flushed) {
                log.warn("[app] quitting before the editor finished saving");
            }
        })
        .finally(() => app.quit());
});

async function createWindow(settings: AppSettings, storage: StorageService) {
    const window = new BrowserWindow({
        width: settings.window.width,
        height: settings.window.height,
        minWidth: WINDOW_MIN_WIDTH,
        minHeight: WINDOW_MIN_HEIGHT,
        show: false,
        title: "LucydDeck",
        webPreferences: {
            preload: path.join(__dirname, "preload.mjs"),
        },
    });
    win = window;

    // The renderer applies `data-theme` before mounting; waiting for
    // `ready-to-show` keeps the first visible frame on the correct theme.
    window.once("ready-to-show", () => {
        if (settings.window.maximized) {
            window.maximize();
        }
        window.show();
    });

    // Never leave the app invisible if the renderer fails before its first
    // paint; the window still opens so the error is visible.
    const showFallback = setTimeout(() => {
        if (!window.isDestroyed() && !window.isVisible()) {
            window.show();
        }
    }, 5000);
    window.on("closed", () => clearTimeout(showFallback));

    let closing = false;
    window.on("close", (event) => {
        if (window.isDestroyed()) {
            return;
        }
        try {
            const bounds = window.getBounds();
            storage.setAppSettings({
                window: {
                    width: bounds.width,
                    height: bounds.height,
                    maximized: window.isMaximized(),
                },
            });
        } catch (error) {
            log.warn(`[window] could not save window preferences: ${String(error)}`);
        }

        // Closing the window directly skips `before-quit`, so flush here too.
        if (quitting) {
            return;
        }
        if (closing) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        closing = true;
        void flushEditor(window)
            .then((flushed) => {
                if (!flushed) {
                    log.warn("[app] closing before the editor finished saving");
                }
            })
            .finally(() => window.destroy());
    });

    window.on("closed", () => {
        if (win === window) {
            win = null;
        }
    });

    if (VITE_DEV_SERVER_URL) {
        await window.loadURL(VITE_DEV_SERVER_URL);
    } else {
        await window.loadFile(path.join(RENDERER_DIST, "index.html"));
    }
}

app.on("window-all-closed", () => {
    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    if (process.platform !== "darwin") {
        app.quit();
        win = null;
    }
});

app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0 && storageService !== null) {
        void createWindow(storageService.getAppSettings(), storageService);
    }
});

app.whenReady().then(async () => {
    app.setName("LucydDeck");
    const storage = new StorageService({ dialogs: createStorageDialogs() });
    storageService = storage;

    // Route electron-log into the per-platform data dir before any service
    // writes (logs/ is part of the layout created below).
    log.transports.file.resolvePathFn = () => path.join(storage.dataDir, "logs", "main.log");
    log.initialize();

    storage.ensureLayout();

    const usb = new UsbService();
    const fileTransfer = new FileTransfer(usb);
    const device = new DeviceService(usb, fileTransfer);
    const imagePipeline = new ImagePipelineService(storage);
    const sync = new SyncService(storage, device, fileTransfer);
    registerIpcHandlers({ storage, usb, device, fileTransfer, imagePipeline, sync });

    await createWindow(storage.getAppSettings(), storage);
});
