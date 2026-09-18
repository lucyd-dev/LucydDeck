import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log/main";
import type { PageConfig, PageMeta, ProfileMeta } from "@shared/types";
import { isValidPageId } from "@shared/protocol";

export const DATA_DIR_ENV = "LUCYD_DECK_DATA_DIR";
export const APP_DIR_NAME = "LucydDeck";

export const SUB_DIRS = ["profiles", "icons", "plugins", "tools", "logs"] as const;
export const PROFILES_DIR = "profiles";

export const PAGE_FILE_PATTERN = /^(\d+)\.json$/;

export type PlatformName = string;

export interface ResolveDataDirOptions {
    platform?: PlatformName;
    env?: Record<string, string | undefined>;
    homeDir?: string;
}

/**
 * Resolve the application data directory.
 *
 * Order:
 * 1. `LUCYD_DECK_DATA_DIR` env override (used by tests and power users).
 * 2. Per-platform default:
 *    - Windows: `%APPDATA%\LucydDeck\`
 *    - Linux: `$XDG_CONFIG_HOME|~/.config` + `/LucydDeck/`
 *    - macOS: `~/Library/Application Support/LucydDeck/`
 */
export function resolveDataDir(options: ResolveDataDirOptions = {}): string {
    const env = options.env ?? process.env;
    const override = env[DATA_DIR_ENV];
    if (override && override.trim() !== "") {
        return path.resolve(override);
    }

    const platform = options.platform ?? process.platform;
    const homeDir = options.homeDir ?? os.homedir();

    switch (platform) {
        case "win32": {
            const appData = env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
            return path.join(appData, APP_DIR_NAME);
        }
        case "darwin":
            return path.join(homeDir, "Library", "Application Support", APP_DIR_NAME);
        default: {
            const configHome =
                env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
                    ? env.XDG_CONFIG_HOME
                    : path.join(homeDir, ".config");
            return path.join(configHome, APP_DIR_NAME);
        }
    }
}

/**
 * Mirror of the firmware `Storage::validateName` contract: non-empty, not
 * `.`/`..`, no `/` or `\` path separators, no control characters.
 *
 * Additionally rejects names that are hostile on Windows: trailing dots or
 * spaces (trimmed by the FS, causing collisions) and reserved device names
 * (`CON`, `NUL`, `AUX`, `COM1..9`, `LPT1..9`) whose creation raises raw OS
 * errors. Kept in sync with the renderer-side username checks.
 */
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function validateName(name: string): boolean {
    if (typeof name !== "string" || name.length === 0) {
        return false;
    }
    if (name === "." || name === "..") {
        return false;
    }
    if (/[. ]$/.test(name) || WINDOWS_RESERVED_NAME_PATTERN.test(name)) {
        return false;
    }
    for (let i = 0; i < name.length; i++) {
        const code = name.codePointAt(i)!;
        if (name[i] === "/" || name[i] === "\\") {
            return false;
        }
        if (code < 0x20 || code === 0x7f) {
            return false;
        }
    }
    return true;
}

export class StorageError extends Error {}

export interface StorageDialogs {
    /** Returns the destination directory the user picked, or null if cancelled. */
    pickExportDirectory: (defaultName: string) => Promise<string | null>;
    /** Returns the source directory the user picked, or null if cancelled. */
    pickImportDirectory: () => Promise<string | null>;
}

export interface StorageServiceOptions {
    /** Injectable data dir (defaults to resolveDataDir()). */
    dataDir?: string;
    /** Injectable dialog handles for the export/import flows. */
    dialogs?: StorageDialogs;
}

export class StorageService {
    readonly dataDir: string;
    private readonly dialogs?: StorageDialogs;

    constructor(options: StorageServiceOptions = {}) {
        this.dataDir = options.dataDir ?? resolveDataDir();
        this.dialogs = options.dialogs;
    }

    /** Create `profiles/ icons/ plugins/ tools/ logs/` under the data dir. */
    ensureLayout(): void {
        fs.mkdirSync(this.dataDir, { recursive: true });
        for (const sub of SUB_DIRS) {
            fs.mkdirSync(path.join(this.dataDir, sub), { recursive: true });
        }
        log.info(`[storage] layout ensured: ${this.dataDir}`);
    }

    validateName = validateName;

    /** Absolute path of the `icons/` directory. */
    iconsDir(): string {
        return path.join(this.dataDir, "icons");
    }

    // --- Profiles -------------------------------------------------------

    listProfiles(): ProfileMeta[] {
        const profilesDir = this.profilesDir();
        if (!fs.existsSync(profilesDir)) {
            return [];
        }
        return fs
            .readdirSync(profilesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && this.validateName(entry.name))
            .map((entry) => ({ name: entry.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    createProfile(name: string): ProfileMeta {
        if (!this.validateName(name)) {
            throw new StorageError(`Invalid profile name: "${name}"`);
        }
        const dir = this.profileDir(name);
        if (fs.existsSync(dir)) {
            throw new StorageError(`Profile already exists: "${name}"`);
        }
        fs.mkdirSync(dir, { recursive: true });
        log.info(`[storage] profile created: ${name}`);
        return { name };
    }

    renameProfile(oldName: string, newName: string): ProfileMeta {
        if (!this.validateName(oldName)) {
            throw new StorageError(`Invalid profile name: "${oldName}"`);
        }
        if (!this.validateName(newName)) {
            throw new StorageError(`Invalid profile name: "${newName}"`);
        }
        const oldDir = this.profileDir(oldName);
        if (!fs.existsSync(oldDir)) {
            throw new StorageError(`Profile not found: "${oldName}"`);
        }
        const newDir = this.profileDir(newName);
        if (fs.existsSync(newDir)) {
            throw new StorageError(`Profile already exists: "${newName}"`);
        }
        fs.renameSync(oldDir, newDir);
        log.info(`[storage] profile renamed: ${oldName} -> ${newName}`);
        return { name: newName };
    }

    deleteProfile(name: string): void {
        if (!this.validateName(name)) {
            throw new StorageError(`Invalid profile name: "${name}"`);
        }
        const dir = this.profileDir(name);
        if (!fs.existsSync(dir)) {
            throw new StorageError(`Profile not found: "${name}"`);
        }
        fs.rmSync(dir, { recursive: true, force: true });
        log.info(`[storage] profile deleted: ${name}`);
    }

    /** List page ids of a profile. Page files match `^[0-9]+\.json$`; the id is the leading digits. */
    listPages(profile: string): PageMeta[] {
        this.assertProfileExists(profile);
        return fs
            .readdirSync(this.profileDir(profile), { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => PAGE_FILE_PATTERN.exec(entry.name))
            .filter((match) => match !== null)
            .map((match) => ({ id: match![1] }))
            .sort((a, b) => Number(a.id) - Number(b.id));
    }

    // --- Pages ----------------------------------------------------------

    loadPage(profile: string, id: string): PageConfig {
        this.assertProfileExists(profile);
        this.assertPageId(id);
        const file = this.pageFile(profile, id);
        if (!fs.existsSync(file)) {
            throw new StorageError(`Page not found: "${profile}/${id}"`);
        }
        const raw = fs.readFileSync(file, "utf8");
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new StorageError(`Page is not valid JSON: "${profile}/${id}"`);
        }
        if (!isPageConfig(parsed)) {
            throw new StorageError(`Page has an invalid shape: "${profile}/${id}"`);
        }
        return parsed;
    }

    savePage(profile: string, id: string, page: PageConfig): void {
        this.assertProfileExists(profile);
        this.assertPageId(id);
        if (!isPageConfig(page)) {
            throw new StorageError("Page config has an invalid shape");
        }
        fs.writeFileSync(this.pageFile(profile, id), JSON.stringify(page, null, 2) + "\n");
        log.info(`[storage] page saved: ${profile}/${id}`);
    }

    // --- Export / import ------------------------------------------------

    /**
     * Export a profile directory. Shows a save dialog and copies the profile
     * dir into the chosen destination. Returns `null` when the user cancels.
     */
    async exportProfile(name: string): Promise<{ path: string } | null> {
        this.assertProfileExists(name);
        if (!this.dialogs) {
            throw new StorageError("No dialog provider configured");
        }
        const destDir = await this.dialogs.pickExportDirectory(name);
        if (destDir === null) {
            return null;
        }
        fs.cpSync(this.profileDir(name), destDir, { recursive: true });
        log.info(`[storage] profile exported: ${name} -> ${destDir}`);
        return { path: destDir };
    }

    /**
     * Import a profile directory chosen by the user. Shows a native
     * directory picker on the main process (never trusts a renderer-supplied
     * path) and copies the selection into `profiles/`. Returns `null` when
     * the user cancels.
     */
    async importProfile(): Promise<ProfileMeta | null> {
        if (!this.dialogs) {
            throw new StorageError("No dialog provider configured");
        }
        const srcDir = await this.dialogs.pickImportDirectory();
        if (srcDir === null) {
            return null;
        }
        return this.importProfileFrom(srcDir);
    }

    /**
     * Validate a source directory and copy it into `profiles/` as a new
     * profile. The source is expected to already be a user-chosen directory
     * (see `importProfile`); this method only guards the copy.
     */
    importProfileFrom(srcDir: string): ProfileMeta {
        if (!srcDir || srcDir.trim() === "") {
            throw new StorageError("No source directory selected");
        }
        const stat = fs.statSync(srcDir);
        if (!stat.isDirectory()) {
            throw new StorageError(`Not a directory: "${srcDir}"`);
        }
        const name = path.basename(srcDir);
        if (!this.validateName(name)) {
            throw new StorageError(`Invalid profile name: "${name}"`);
        }
        const dest = this.profileDir(name);
        if (fs.existsSync(dest)) {
            throw new StorageError(`Profile already exists: "${name}"`);
        }
        fs.cpSync(srcDir, dest, { recursive: true });
        log.info(`[storage] profile imported: ${name} <- ${srcDir}`);
        return { name };
    }

    // --- Internals ------------------------------------------------------

    private profilesDir(): string {
        return path.join(this.dataDir, PROFILES_DIR);
    }

    private profileDir(name: string): string {
        return path.join(this.profilesDir(), name);
    }

    private pageFile(profile: string, id: string): string {
        return path.join(this.profileDir(profile), `${id}.json`);
    }

    private assertProfileExists(profile: string): void {
        if (!this.validateName(profile)) {
            throw new StorageError(`Invalid profile name: "${profile}"`);
        }
        if (!fs.existsSync(this.profileDir(profile))) {
            throw new StorageError(`Profile not found: "${profile}"`);
        }
    }

    private assertPageId(id: string): void {
        if (typeof id !== "string" || !isValidPageId(id)) {
            throw new StorageError(`Invalid page id: "${id}"`);
        }
    }
}

export function isPageConfig(value: unknown): value is PageConfig {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const buttons = (value as PageConfig).buttons;
    return typeof buttons === "object" && buttons !== null && !Array.isArray(buttons);
}
