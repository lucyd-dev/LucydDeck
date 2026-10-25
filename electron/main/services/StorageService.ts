import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log/main";
import type { PageConfig, PageMeta, ProfileMeta } from "@shared/types";
import { PAGE_FILENAME_PATTERN, isValidPageId, pageIdFromFilename } from "@shared/protocol";
import { emptyPageConfig, serializePageConfig, validatePageConfig } from "@shared/schema";
import { iconBaseName } from "@shared/icons";
import { mergeAppSettings, sanitizeAppSettings } from "@shared/settings";
import type { AppSettings } from "@shared/settings";
import type { ReferenceHit, ReferenceQuery, ReferenceScanResult } from "@shared/ipc";
import { crc32Upload } from "./usb/Crc32";

export const DATA_DIR_ENV = "LUCYD_DECK_DATA_DIR";
export const APP_DIR_NAME = "LucydDeck";

export const SUB_DIRS = ["profiles", "icons", "plugins", "tools", "logs"] as const;
export const PROFILES_DIR = "profiles";
export const SETTINGS_FILE = "settings.json";

/** Persisted app-level settings (kept outside the profile dirs). */
export interface StorageSettings {
    /** Name of the profile to open on boot; absent = first profile. */
    defaultProfile?: string;
    /** Appearance + window preferences (`shared/settings.ts` shape, untrusted). */
    app?: unknown;
}

/** @deprecated Use `PAGE_FILENAME_PATTERN` from `@shared/protocol` (single source). */
export const PAGE_FILE_PATTERN = PAGE_FILENAME_PATTERN;

export type PlatformName = string;

const encoder = new TextEncoder();

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

    /**
     * Absolute path of `<iconsDir>/<base>.png` after validating the base name.
     * Throws `StorageError` for names that fail `validateName`.
     */
    iconFilePath(name: string): string {
        const base = iconBaseName(name);
        if (!this.validateName(base)) {
            throw new StorageError(`Invalid icon name: "${base}"`);
        }
        return path.join(this.iconsDir(), `${base}.png`);
    }

    /**
     * CRC-32 of a stored icon file (matches the device list hash), or `null`
     * when the file does not exist. Single hashing helper for `icons:list` and
     * `SyncService` so the algorithm cannot drift.
     */
    iconHash(name: string): number | null {
        const file = this.iconFilePath(name);
        if (!fs.existsSync(file)) {
            return null;
        }
        return crc32Upload(new Uint8Array(fs.readFileSync(file)));
    }

    /** List stored `icons/*.png` as `{name (base), path}`, sorted by name. */
    listIconFiles(): Array<{ name: string; path: string }> {
        const dir = this.iconsDir();
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
            .map((entry) => ({
                name: iconBaseName(entry.name),
                path: path.join(dir, entry.name),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // --- Profiles -------------------------------------------------------

    /** Read `settings.json`; returns `{}` when missing or unreadable. */
    readSettings(): StorageSettings {
        const file = path.join(this.dataDir, SETTINGS_FILE);
        if (!fs.existsSync(file)) {
            return {};
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
            return typeof parsed === "object" && parsed !== null ? (parsed as StorageSettings) : {};
        } catch {
            log.warn(`[storage] unreadable settings file: ${file}`);
            return {};
        }
    }

    /** Write `settings.json` (pretty-printed, trailing newline). */
    writeSettings(settings: StorageSettings): void {
        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.writeFileSync(
            path.join(this.dataDir, SETTINGS_FILE),
            JSON.stringify(settings, null, 2) + "\n",
        );
    }

    /** Normalized app settings from `settings.json` (defaults when absent). */
    getAppSettings(): AppSettings {
        const { app } = this.readSettings();
        return sanitizeAppSettings(app);
    }

    /**
     * Merge a partial settings update into `settings.json` and return the
     * normalized result. Invalid fields fall back to the current/default value;
     * `defaultProfile` and any future keys are preserved.
     */
    setAppSettings(patch: unknown): AppSettings {
        const settings = this.readSettings();
        const next = mergeAppSettings(this.getAppSettings(), patch);
        settings.app = next;
        this.writeSettings(settings);
        log.info(
            `[storage] settings updated: theme=${next.theme} accent=${next.accent} ` +
                `window=${next.window.width}x${next.window.height}`,
        );
        return next;
    }

    /** Absolute path of the `logs/` directory. */
    logsDir(): string {
        return path.join(this.dataDir, "logs");
    }

    /** Persisted default profile name, or `null` when unset/invalid. */
    getDefaultProfile(): string | null {
        const { defaultProfile } = this.readSettings();
        if (typeof defaultProfile !== "string" || !this.validateName(defaultProfile)) {
            return null;
        }
        return fs.existsSync(this.profileDir(defaultProfile)) ? defaultProfile : null;
    }

    /** Set (or clear with `null`) the persistent default profile. */
    setDefaultProfile(name: string | null): void {
        const settings = this.readSettings();
        if (name === null) {
            delete settings.defaultProfile;
        } else {
            if (!this.validateName(name)) {
                throw new StorageError(`Invalid profile name: "${name}"`);
            }
            if (!fs.existsSync(this.profileDir(name))) {
                throw new StorageError(`Profile not found: "${name}"`);
            }
            settings.defaultProfile = name;
        }
        this.writeSettings(settings);
        log.info(`[storage] default profile: ${name ?? "(none)"}`);
    }

    listProfiles(): ProfileMeta[] {
        const profilesDir = this.profilesDir();
        if (!fs.existsSync(profilesDir)) {
            return [];
        }
        const defaultProfile = this.getDefaultProfile();
        return fs
            .readdirSync(profilesDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && this.validateName(entry.name))
            .map((entry) => ({
                name: entry.name,
                isDefault: entry.name === defaultProfile,
            }))
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
        // Every profile starts with one page; write it the way a page save
        // does, so the listing and the file agree from the first read.
        this.savePage(name, "0", serializePageConfig(emptyPageConfig()));
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
        if (this.readSettings().defaultProfile === oldName) {
            this.setDefaultProfile(newName);
        }
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
        if (this.readSettings().defaultProfile === name) {
            const settings = this.readSettings();
            delete settings.defaultProfile;
            this.writeSettings(settings);
        }
        log.info(`[storage] profile deleted: ${name}`);
    }

    /** List page ids of a profile. Page files match `^[0-9]+\.json$`; the id is the leading digits. */
    listPages(profile: string): PageMeta[] {
        this.assertProfileExists(profile);
        const dir = this.profileDir(profile);
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => ({ entry, id: pageIdFromFilename(entry.name) }))
            .filter((item) => item.id !== null)
            .map((item) => ({
                id: item.id!,
                mtimeMs: safeMtimeMs(path.join(dir, item.entry.name)),
                hash: this.pageHash(profile, item.id!) ?? undefined,
            }))
            .sort((a, b) => Number(a.id) - Number(b.id));
    }

    /**
     * Find every library page that references an icon, a page or a profile.
     *
     * The renderer only holds the active profile, so this walks all profiles in
     * the main process. One hit per referencing page. An unreadable or invalid
     * page is skipped and logged; the response reports itself partial so the
     * delete dialog can say the list may be incomplete.
     */
    scanReferences(query: ReferenceQuery): ReferenceScanResult {
        const hits: ReferenceHit[] = [];
        let partial = false;
        for (const profile of this.listProfiles()) {
            // A page reference only counts inside the page's own profile, and
            // a profile reference never counts the pages that go with it.
            if (query.kind === "page" && profile.name !== query.profile) {
                continue;
            }
            if (query.kind === "profile" && profile.name === query.name) {
                continue;
            }
            for (const page of this.listPages(profile.name)) {
                // The page being deleted is not a reference to itself; naming it
                // would be noise in the confirmation.
                if (query.kind === "page" && page.id === query.id) {
                    continue;
                }
                let config: PageConfig;
                try {
                    config = this.loadPage(profile.name, page.id);
                } catch (error) {
                    partial = true;
                    log.warn(
                        `[storage] reference scan skipped ${profile.name}/${page.id}.json: ${String(
                            error,
                        )}`,
                    );
                    continue;
                }
                if (pageReferences(config, query)) {
                    hits.push({ profile: profile.name, pageId: page.id });
                }
            }
        }
        hits.sort(
            (a, b) => a.profile.localeCompare(b.profile) || Number(a.pageId) - Number(b.pageId),
        );
        return { hits, partial };
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

    deletePage(profile: string, id: string): void {
        this.assertProfileExists(profile);
        this.assertPageId(id);
        const file = this.pageFile(profile, id);
        if (!fs.existsSync(file)) {
            throw new StorageError(`Page not found: "${profile}/${id}"`);
        }
        fs.rmSync(file);
        log.info(`[storage] page deleted: ${profile}/${id}`);
    }

    /**
     * CRC-32 of the canonical upload bytes for a page (the same bytes
     * `SyncService` hashes), or `null` when the page is missing/invalid.
     */
    pageHash(profile: string, id: string): number | null {
        let page: PageConfig;
        try {
            page = this.loadPage(profile, id);
        } catch {
            return null;
        }
        const validation = validatePageConfig(page);
        if (!validation.ok) {
            return null;
        }
        return crc32Upload(encoder.encode(JSON.stringify(serializePageConfig(validation.page))));
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

/** True when one page's keys or steps reference the query. */
function pageReferences(page: PageConfig, query: ReferenceQuery): boolean {
    const buttons = Object.values(page.buttons ?? {}) as Array<
        { imageName?: unknown; click?: unknown } | null | undefined
    >;
    if (query.kind === "icon") {
        const icon = iconBaseName(query.name);
        return buttons.some(
            (button) =>
                typeof button?.imageName === "string" && iconBaseName(button.imageName) === icon,
        );
    }
    const needle = query.kind === "page" ? `PAGE:${query.id}` : `PROFILE:${query.name}`;
    return buttons.some((button) => Array.isArray(button?.click) && button.click.includes(needle));
}

/** File mtime in ms, or `undefined` when the file disappeared between calls. */
function safeMtimeMs(file: string): number | undefined {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return undefined;
    }
}
