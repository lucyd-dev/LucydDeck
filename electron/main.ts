import { app, BrowserWindow, dialog, utilityProcess } from "electron";
import log from "electron-log/main";
// import { createRequire } from 'node:module'
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AppSettings } from "@shared/settings";
import { WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "@shared/settings";
import { eventChannels } from "@shared/ipc";
import { LATEST_MANIFEST_URL } from "@shared/firmwareRelease";
import { StorageService } from "./main/services/StorageService";
import { UsbService } from "./main/services/UsbService";
import { FileTransfer } from "./main/services/FileTransfer";
import { DeviceService } from "./main/services/DeviceService";
import { ImagePipelineService } from "./main/services/ImagePipelineService";
import { SyncService } from "./main/services/SyncService";
import { FirmwareService } from "./main/services/FirmwareService";
import { EsptoolFlasher } from "./main/services/flash/EsptoolFlasher";
import { RomPortLocator } from "./main/services/flash/RomPortLocator";
import { QuitGuard } from "./main/services/flash/QuitGuard";
import { ReleaseSource, resolveManifestUrl } from "./main/services/ReleaseSource";
import { PluginHost } from "./main/plugins/PluginHost";
import { PluginService } from "./main/plugins/PluginService";
import { CommandRouter } from "./main/plugins/CommandRouter";
import { createStorageDialogs } from "./main/ipc/dialogs";
import { broadcastEvent, registerIpcHandlers } from "./main/ipc/register";

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

/**
 * `utilityProcess.fork` cannot read a file from `app.asar`, so the worker
 * entry and the chunk it shares with the app are unpacked; see
 * `config/electron-builder.json`.
 */
function pluginRuntimePath(): string {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "runtime.js");
    }
    return path.join(__dirname, "runtime.js");
}

let win: BrowserWindow | null;
let storageService: StorageService | null = null;
let pluginService: PluginService | null = null;
let firmwareService: FirmwareService | null = null;
let quitting = false;
const quitGuard = new QuitGuard();

/** Ask once per flash whether to quit while the deck is busy. */
async function askQuitDuringFlash(): Promise<boolean> {
    const options = {
        type: "warning" as const,
        title: "Firmware flash in progress",
        message: "A firmware flash is running right now.",
        detail: "Quitting now can leave the deck without a working firmware. Keep the app open until the flash finishes.",
        buttons: ["Keep flashing", "Quit anyway"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    };
    const result =
        win === null
            ? await dialog.showMessageBox(options)
            : await dialog.showMessageBox(win, options);
    return result.response === 1;
}

/**
 * Stop a quit or window close during a write. Returns true when the caller
 * must wait for the confirmation; a confirmed answer runs `proceed`.
 */
function blockQuitDuringFlash(event: { preventDefault: () => void }, proceed: () => void): boolean {
    if (firmwareService?.isBusy() !== true || quitGuard.isConfirmed()) {
        return false;
    }
    event.preventDefault();
    void quitGuard.confirm(askQuitDuringFlash).then((confirmed) => {
        if (confirmed) {
            proceed();
        }
    });
    return true;
}

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
    if (quitting) {
        return;
    }
    if (blockQuitDuringFlash(event, () => app.quit())) {
        return;
    }
    const window = win;
    quitting = true;
    // Hold the quit until the editor is flushed and every plugin has had its
    // teardown deadline. The queued `app.quit()` re-enters with quitting set.
    event.preventDefault();

    const finish = (): void => {
        const plugins = pluginService;
        if (plugins === null) {
            app.quit();
            return;
        }
        void plugins.stopAll().finally(() => app.quit());
    };

    const flush =
        window === null || window.isDestroyed()
            ? Promise.resolve(true)
            : flushEditor(window).then((flushed) => {
                  if (!flushed) {
                      log.warn("[app] quitting before the editor finished saving");
                  }
                  return flushed;
              });
    void flush.finally(finish);
});

/** Pick one local `.bin` image; the service validates the app-slot bound. */
async function pickFirmwareImage(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
        title: "Choose firmware image",
        properties: ["openFile"],
        filters: [{ name: "Firmware image", extensions: ["bin"] }],
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

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
        if (
            blockQuitDuringFlash(event, () => {
                if (!window.isDestroyed()) {
                    window.close();
                }
            })
        ) {
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
    const host = new PluginHost({
        launcher: () =>
            utilityProcess.fork(pluginRuntimePath(), [], {
                serviceName: "LucydDeck Plugin",
            }),
    });
    const plugins = new PluginService({
        storage,
        host,
        dialogs: {
            async pickPluginFolder() {
                const result = await dialog.showOpenDialog({
                    title: "Install plugin",
                    properties: ["openDirectory"],
                });
                return result.canceled || result.filePaths.length === 0
                    ? null
                    : result.filePaths[0];
            },
        },
    });
    pluginService = plugins;
    const commands = new CommandRouter({
        usb,
        target: host,
        notify: (level, message) => broadcastEvent(eventChannels.toast, { level, message }),
    });
    const sync = new SyncService(storage, device, fileTransfer, {
        pluginCommands: () => plugins.registeredCommands(),
    });
    // The override is a development aid and never applies to a packaged build.
    const manifestUrl = resolveManifestUrl({
        packaged: app.isPackaged,
        override: process.env.LUCYD_FIRMWARE_MANIFEST,
    });
    if (manifestUrl !== LATEST_MANIFEST_URL) {
        log.info(`[firmware] using development manifest ${manifestUrl}`);
    }
    const firmware = new FirmwareService({
        usb,
        device,
        flasher: new EsptoolFlasher(),
        locator: new RomPortLocator(),
        releaseSource: new ReleaseSource({ manifestUrl }),
        pickImage: () => pickFirmwareImage(),
        onState: (state) => {
            if (state.phase === "handoff") {
                quitGuard.beginFlash();
            }
            broadcastEvent(eventChannels.firmwareState, state);
        },
        onProgress: (progress) => broadcastEvent(eventChannels.flashProgress, progress),
    });
    firmwareService = firmware;
    registerIpcHandlers({
        storage,
        usb,
        device,
        fileTransfer,
        imagePipeline,
        sync,
        firmware,
        plugins,
        commands,
    });
    commands.start();

    await createWindow(storage.getAppSettings(), storage);
    // Start after the window exists so a plugin log line reaches a live log
    // file and a status event reaches the renderer.
    void plugins.startAll();
});
