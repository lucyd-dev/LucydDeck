import fs from "node:fs";
import path from "node:path";
import { validatePluginManifest } from "@shared/plugins";
import type { PluginManifest } from "@shared/plugins";

/** A plugin folder is capped at 20 MB, counting every file it ships. */
export const MAX_PLUGIN_FOLDER_BYTES = 20 * 1024 * 1024;

/** The optional icon is a thumbnail, not an asset bundle. */
export const MAX_PLUGIN_ICON_BYTES = 256 * 1024;

const MANIFEST_FILE = "plugin.json";
const ICON_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
};

export class PluginManifestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginManifestError";
    }
}

export interface PluginFolder {
    /** Absolute path of the folder the user picked. */
    path: string;
    manifest: PluginManifest;
    /** Absolute path of the ESM entry, checked to exist inside the folder. */
    entryPath: string;
    iconDataUrl: string | null;
}

function inside(folder: string, relative: string): string {
    const resolved = path.resolve(folder, relative);
    if (resolved !== folder && !resolved.startsWith(folder + path.sep)) {
        throw new PluginManifestError(`"${relative}" points outside the plugin folder`);
    }
    return resolved;
}

function assertRegularFile(file: string, what: string): fs.Stats {
    let stats: fs.Stats;
    try {
        stats = fs.lstatSync(file);
    } catch {
        throw new PluginManifestError(`${what} not found: ${path.basename(file)}`);
    }
    if (stats.isSymbolicLink()) {
        throw new PluginManifestError(`${what} must not be a symlink: ${path.basename(file)}`);
    }
    if (!stats.isFile()) {
        throw new PluginManifestError(`${what} must be a file: ${path.basename(file)}`);
    }
    return stats;
}

/**
 * Walk the folder once: reject symlinks and native modules, and stop at the
 * size cap before copying anything. Returns the total byte count.
 */
function inspectTree(folder: string): number {
    let total = 0;
    const queue = [folder];
    while (queue.length > 0) {
        const dir = queue.pop()!;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) {
                throw new PluginManifestError(
                    `A plugin may not contain symlinks: ${path.relative(folder, file)}`,
                );
            }
            if (entry.isDirectory()) {
                queue.push(file);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (/\.node$/i.test(entry.name)) {
                throw new PluginManifestError(
                    `A plugin may not ship a native module: ${path.relative(folder, file)}`,
                );
            }
            total += fs.statSync(file).size;
            if (total > MAX_PLUGIN_FOLDER_BYTES) {
                throw new PluginManifestError("The plugin folder is larger than 20 MB");
            }
        }
    }
    return total;
}

function readIcon(folder: string, manifest: PluginManifest): string | null {
    if (manifest.icon === undefined) {
        return null;
    }
    const file = inside(folder, manifest.icon);
    const stats = assertRegularFile(file, "The icon");
    if (stats.size > MAX_PLUGIN_ICON_BYTES) {
        throw new PluginManifestError("The icon is larger than 256 KB");
    }
    const mime = ICON_MIME[path.extname(file).toLowerCase()];
    if (mime === undefined) {
        throw new PluginManifestError("The icon must be a PNG, JPEG or WebP image");
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

/**
 * Read and check a plugin folder without copying it. The renderer never
 * supplies a path for install; this runs on a folder the user picked.
 */
export function readPluginFolder(folder: string): PluginFolder {
    if (typeof folder !== "string" || folder.trim() === "" || !path.isAbsolute(folder)) {
        throw new PluginManifestError("Expected an absolute plugin folder path");
    }
    const resolved = path.resolve(folder);
    let stats: fs.Stats;
    try {
        stats = fs.lstatSync(resolved);
    } catch {
        throw new PluginManifestError(`Plugin folder not found: ${resolved}`);
    }
    if (stats.isSymbolicLink()) {
        throw new PluginManifestError("The plugin folder must not be a symlink");
    }
    if (!stats.isDirectory()) {
        throw new PluginManifestError(`Not a folder: ${resolved}`);
    }

    inspectTree(resolved);

    const manifestPath = path.join(resolved, MANIFEST_FILE);
    assertRegularFile(manifestPath, "plugin.json");
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PluginManifestError(`plugin.json is not valid JSON: ${message}`);
    }
    const validation = validatePluginManifest(parsed);
    if (!validation.ok) {
        throw new PluginManifestError(validation.error);
    }
    const manifest = validation.manifest;

    const entryPath = inside(resolved, manifest.main);
    assertRegularFile(entryPath, "The plugin entry");
    if (!/\.mjs$/i.test(entryPath)) {
        throw new PluginManifestError("The plugin entry must be an .mjs file");
    }

    return {
        path: resolved,
        manifest,
        entryPath,
        iconDataUrl: readIcon(resolved, manifest),
    };
}

/** Re-read an installed plugin's icon (the folder is already trusted). */
export function readInstalledIcon(folder: string, manifest: PluginManifest): string | null {
    try {
        return readIcon(folder, manifest);
    } catch {
        return null;
    }
}

export interface InstalledManifest {
    manifest: PluginManifest;
    entryPath: string;
}

/**
 * Read an already installed plugin's manifest without walking the tree. The
 * install path ran the full checks; discovery only needs to notice an edited
 * or broken `plugin.json` and a missing entry.
 */
export function readInstalledManifest(folder: string): InstalledManifest {
    const manifestPath = path.join(folder, MANIFEST_FILE);
    assertRegularFile(manifestPath, "plugin.json");
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PluginManifestError(`plugin.json is not valid JSON: ${message}`);
    }
    const validation = validatePluginManifest(parsed);
    if (!validation.ok) {
        throw new PluginManifestError(validation.error);
    }
    const manifest = validation.manifest;
    const entryPath = inside(path.resolve(folder), manifest.main);
    try {
        const stats = fs.lstatSync(entryPath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw new PluginManifestError("The plugin entry is not a regular file");
        }
    } catch (error) {
        if (error instanceof PluginManifestError) {
            throw error;
        }
        throw new PluginManifestError(`The plugin entry is missing: ${manifest.main}`);
    }
    return { manifest, entryPath };
}
