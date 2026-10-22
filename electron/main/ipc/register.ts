import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain } from "electron";
import log from "electron-log/main";
import { channels, eventChannels } from "@shared/ipc";
import type {
    EventChannel,
    EventPayloadFor,
    IconMeta,
    IpcChannel,
    RequestFor,
} from "@shared/ipc";
import { serializePageConfig, validatePageConfig } from "@shared/schema";
import { iconBaseName } from "@shared/icons";
import type { StorageService } from "../services/StorageService";
import type { UsbService } from "../services/UsbService";
import type { DeviceService } from "../services/DeviceService";
import type { FileTransfer } from "../services/FileTransfer";
import type { ImagePipelineService } from "../services/ImagePipelineService";
import type { SyncService } from "../services/SyncService";

/** Broadcast a typed main-process event to all renderer windows. */
export function broadcastEvent<E extends EventChannel>(
    channel: E,
    payload: EventPayloadFor<E>,
): void {
    for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(channel, payload);
    }
}

type Handler<C extends IpcChannel> = (payload: RequestFor<C>) => unknown;

export interface IpcServices {
    storage: StorageService;
    usb: UsbService;
    device: DeviceService;
    fileTransfer: FileTransfer;
    imagePipeline: ImagePipelineService;
    sync: SyncService;
}

/**
 * Register every ipcMain.handle for the channels owned by `shared/ipc.ts`.
 * Handlers never throw across the bridge: failures become `{ ok: false, error }`
 * with a stable code where available.
 */
export function registerIpcHandlers(services: IpcServices): void {
    const { storage, usb, device, fileTransfer, imagePipeline, sync } = services;

    // Bridge service events to every renderer window.
    usb.onEvent((payload) => broadcastEvent(eventChannels.usb, payload));
    fileTransfer.onEvent((payload) => broadcastEvent(eventChannels.usb, payload));
    sync.onProgress((payload) => broadcastEvent(eventChannels.syncProgress, payload));

    const register = <C extends IpcChannel>(
        channel: C,
        handler: Handler<C>,
        toastOnError = false,
    ): void => {
        ipcMain.handle(channel, async (_event, rawPayload: unknown) => {
            try {
                return await handler(rawPayload as RequestFor<C>);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const code =
                    typeof error === "object" && error !== null && "code" in error
                        ? String((error as { code: unknown }).code)
                        : undefined;
                log.error(`[ipc] "${channel}" failed: ${message}`);
                if (toastOnError) {
                    broadcastEvent(eventChannels.toast, { level: "error", message });
                }
                return code ? { ok: false, error: message, code } : { ok: false, error: message };
            }
        });
    };

    const notImplemented = <C extends IpcChannel>(channel: C, step: string): void => {
        register(channel, () => ({ ok: false, error: `not implemented (Step ${step})` }));
    };

    // --- storage (real) ------------------------------------------------
    register(
        channels.storage.listProfiles,
        () => ({ ok: true, data: storage.listProfiles() }),
        true,
    );

    register(
        channels.storage.createProfile,
        ({ name }) => ({
            ok: true,
            data: storage.createProfile(name),
        }),
        true,
    );

    register(
        channels.storage.renameProfile,
        ({ oldName, newName }) => ({
            ok: true,
            data: storage.renameProfile(oldName, newName),
        }),
        true,
    );

    register(
        channels.storage.deleteProfile,
        ({ name }) => {
            storage.deleteProfile(name);
            return { ok: true, data: undefined };
        },
        true,
    );

    register(
        channels.storage.listPages,
        ({ name }) => ({
            ok: true,
            data: storage.listPages(name),
        }),
        true,
    );

    register(
        channels.storage.loadPage,
        ({ profile, id }) => ({
            ok: true,
            data: storage.loadPage(profile, id),
        }),
        true,
    );

    register(
        channels.storage.savePage,
        ({ profile, id, page }) => {
            const validation = validatePageConfig(page);
            if (!validation.ok) {
                throw new Error(
                    `Page config is invalid: ${
                        validation.errors.join("; ") || "unknown validation error"
                    }`,
                );
            }
            if (validation.errors.length > 0) {
                // Invalid actions are dropped (firmware behavior); warn without
                // blocking the save so pre-existing/imported pages stay editable.
                broadcastEvent(eventChannels.toast, {
                    level: "warning",
                    message: `Saved with dropped actions: ${validation.errors.join("; ")}`,
                });
            }
            storage.savePage(profile, id, serializePageConfig(validation.page));
            return { ok: true, data: undefined };
        },
        true,
    );

    register(
        channels.storage.exportProfile,
        async ({ name }) => ({
            ok: true,
            data: await storage.exportProfile(name),
        }),
        true,
    );

    register(
        channels.storage.importProfile,
        async () => ({
            ok: true,
            data: await storage.importProfile(),
        }),
        true,
    );

    register(
        channels.storage.getDefaultProfile,
        () => ({ ok: true, data: storage.getDefaultProfile() }),
        true,
    );

    register(
        channels.storage.setDefaultProfile,
        ({ name }) => {
            storage.setDefaultProfile(name);
            return { ok: true, data: undefined };
        },
        true,
    );

    // --- usb (HID engine) ----------------------------------------------
    register(channels.usb.status, () => ({ ok: true, data: usb.status() }));
    register(channels.usb.connect, async () => {
        await usb.connect();
        return { ok: true, data: undefined };
    });
    register(channels.usb.disconnect, async () => {
        await usb.disconnect();
        return { ok: true, data: undefined };
    });
    register(channels.usb.deviceInfo, async () => {
        if (!usb.connected) {
            return { ok: true, data: null };
        }
        return { ok: true, data: await device.getDeviceInfo() };
    });
    register(channels.usb.listImages, async () => ({
        ok: true,
        data: await device.listImages(),
    }));
    register(channels.usb.listProfiles, async () => ({
        ok: true,
        data: await device.listProfiles(),
    }));
    register(channels.usb.createProfile, async ({ name }) => {
        await device.createProfile(name);
        return { ok: true, data: undefined };
    });
    register(channels.usb.renameProfile, async ({ oldName, newName }) => {
        await device.renameProfile(oldName, newName);
        return { ok: true, data: undefined };
    });
    register(channels.usb.deleteProfile, async ({ name }) => {
        await device.deleteProfile(name);
        return { ok: true, data: undefined };
    });
    register(channels.usb.setActiveProfile, async ({ name }) => {
        await device.setActiveProfile(name);
        return { ok: true, data: undefined };
    });
    register(channels.usb.setActivePage, async ({ id }) => {
        await device.setActivePage(id);
        return { ok: true, data: undefined };
    });
    register(channels.usb.uploadPage, async ({ profile, id }) => {
        const page = storage.loadPage(profile, id);
        const validation = validatePageConfig(page);
        if (!validation.ok) {
            throw new Error(
                `Page config is invalid: ${validation.errors.join("; ") || "unknown validation error"}`,
            );
        }
        // Canonicalize exactly like SyncService so the device CRC matches the
        // locally computed hash (same bytes on both upload paths).
        await device.uploadPage(
            profile,
            id,
            JSON.stringify(serializePageConfig(validation.page)),
        );
        return { ok: true, data: undefined };
    });
    register(channels.usb.uploadIcon, async ({ name }) => {
        const file = resolveIconFile(storage, name);
        if (file === null) {
            throw new Error(`Icon not found: "${iconBaseName(name)}"`);
        }
        await device.uploadIcon(iconBaseName(name), new Uint8Array(fs.readFileSync(file)));
        return { ok: true, data: undefined };
    });

    // --- icons (local library; sharp pipeline) --------------------------
    register(channels.icons.list, () => ({ ok: true, data: listLocalIcons(storage) }));
    register(channels.icons.preview, ({ name }) => {
        const base = iconBaseName(name);
        const file = resolveIconFile(storage, base);
        if (file === null) {
            return { ok: true, data: null };
        }
        const bytes = fs.readFileSync(file);
        return {
            ok: true,
            data: { name: base, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` },
        };
    });
    register(channels.icons.import, async ({ paths }) => {
        let sources: string[];
        if (paths === undefined) {
            const picked = await pickIconSources();
            if (picked.length === 0) {
                return { ok: true, data: [] };
            }
            sources = validateIconSources(picked);
        } else {
            sources = validateIconSources(paths);
        }
        const imported: IconMeta[] = [];
        for (const src of sources) {
            const icon = await imagePipeline.importImage(src);
            imported.push({ name: icon.name, hash: String(icon.crc32) });
        }
        return { ok: true, data: imported };
    });
    register(channels.icons.importData, async ({ name, dataUrl }) => {
        const bytes = decodeImageDataUrl(dataUrl);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-crop-"));
        const temp = path.join(tempDir, "crop.png");
        try {
            fs.writeFileSync(temp, bytes);
            const icon = await imagePipeline.importImage(temp, name);
            return { ok: true, data: { name: icon.name, hash: String(icon.crc32) } };
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    register(channels.icons.remove, ({ name }) => {
        const base = iconBaseName(name);
        const file = resolveIconFile(storage, base);
        if (file !== null) {
            fs.rmSync(file);
        }
        return { ok: true, data: undefined };
    });

    // --- sync (Step 3 delta-sync engine) --------------------------------
    register(channels.sync.reconcile, async ({ activeProfile }) => ({
        ok: true,
        data: await sync.reconcile({ activeProfile }),
    }));
    register(channels.sync.execute, async ({ plan }) => ({
        ok: true,
        data: await sync.executePlan(plan),
    }));

    // --- stubs for later steps -----------------------------------------
    notImplemented(channels.plugins.list, "4");
    notImplemented(channels.plugins.setEnabled, "4");
    notImplemented(channels.plugins.remove, "4");
    notImplemented(channels.updater.state, "5");
    notImplemented(channels.updater.check, "5");
    notImplemented(channels.firmware.getState, "5");
    notImplemented(channels.firmware.update, "5");
}

/**
 * Resolve `<iconsDir>/<base>.png` after validating the name. Returns `null` when
 * the file is missing; throws for a name that fails `validateName`.
 */
function resolveIconFile(storage: StorageService, name: string): string | null {
    const base = iconBaseName(name);
    const file = storage.iconFilePath(base);
    return fs.existsSync(file) ? file : null;
}

const ICON_DIALOG_FILTERS = [
    { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
    { name: "All files", extensions: ["*"] },
];

/** Show a native multi-select picker for icon sources; `[]` when cancelled. */
async function pickIconSources(): Promise<string[]> {
    const result = await dialog.showOpenDialog({
        title: "Import icons",
        properties: ["openFile", "multiSelections"],
        filters: ICON_DIALOG_FILTERS,
    });
    return result.canceled ? [] : result.filePaths;
}

const ICON_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_ICON_IMPORTS = 20;
const MAX_ICON_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Validate renderer-supplied import paths: bounded count, absolute regular
 * files (no symlinks) with a supported image extension and a sane size. Source
 * paths are user-picked, so this hardens rather than allowlists them.
 */
function validateIconSources(paths: unknown): string[] {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_ICON_IMPORTS) {
        throw new Error(`Expected 1..${MAX_ICON_IMPORTS} import paths`);
    }
    return paths.map((value) => {
        if (typeof value !== "string" || value.trim() === "" || !path.isAbsolute(value)) {
            throw new Error(`Invalid import path: ${String(value)}`);
        }
        const resolved = path.resolve(value);
        const stats = fs.lstatSync(resolved);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new Error(`Not a regular file: ${resolved}`);
        }
        if (stats.size > MAX_ICON_SOURCE_BYTES) {
            throw new Error(`Image too large: ${resolved}`);
        }
        if (!ICON_SOURCE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
            throw new Error(`Unsupported image extension: ${resolved}`);
        }
        return resolved;
    });
}

const DATA_URL_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Decode a renderer-supplied base64 image data URL (canvas crop output) into
 * bytes, enforcing the same size cap as file imports.
 */
function decodeImageDataUrl(dataUrl: unknown): Buffer {
    if (typeof dataUrl !== "string") {
        throw new Error("Expected an image data URL");
    }
    const match = DATA_URL_IMAGE_PATTERN.exec(dataUrl.trim());
    if (match === null) {
        throw new Error("Expected a base64 PNG/JPEG/WebP data URL");
    }
    const bytes = Buffer.from(match[1].replace(/\s+/g, ""), "base64");
    if (bytes.length === 0) {
        throw new Error("Image data is empty");
    }
    if (bytes.length > MAX_ICON_SOURCE_BYTES) {
        throw new Error("Image is too large to import");
    }
    return bytes;
}

/** Cache of `<path> -> {mtimeMs, size, crc32}` so `icons:list` avoids re-hashing. */
const iconHashCache = new Map<string, { mtimeMs: number; size: number; crc32: number }>();

/** List `icons/*.png` as `{name (base), hash (decimal CRC32)}`. */
function listLocalIcons(storage: StorageService): IconMeta[] {
    const dir = storage.iconsDir();
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
        .map((entry) => {
            const base = iconBaseName(entry.name);
            const file = path.join(dir, entry.name);
            return { name: base, hash: String(cachedIconHash(storage, base, file)) };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** CRC-32 of an icon file (via the shared `StorageService.iconHash`), memoized by mtime + size. */
function cachedIconHash(storage: StorageService, base: string, file: string): number {
    const stats = fs.statSync(file);
    const cached = iconHashCache.get(file);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.crc32;
    }
    const hash = storage.iconHash(base) ?? 0;
    iconHashCache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, crc32: hash });
    return hash;
}
