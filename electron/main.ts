import { app, BrowserWindow } from "electron";
import log from "electron-log/main";
// import { createRequire } from 'node:module'
import { fileURLToPath } from "node:url";
import path from "node:path";
import { StorageService } from "./main/services/StorageService";
import { UsbService } from "./main/services/UsbService";
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

async function createWindow() {
    win = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, "preload.mjs"),
        },
    });

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL);
    } else {
        win.loadFile(path.join(RENDERER_DIST, "index.html"));
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
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.whenReady().then(() => {
    const storage = new StorageService({ dialogs: createStorageDialogs() });

    // Route electron-log into the per-platform data dir before any service
    // writes (logs/ is part of the layout created below).
    log.transports.file.resolvePathFn = () => path.join(storage.dataDir, "logs", "main.log");
    log.initialize();

    storage.ensureLayout();

    const usb = new UsbService();
    registerIpcHandlers(storage, usb);

    createWindow();
});
