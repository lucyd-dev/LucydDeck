import fs from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import { PLUGIN_API_VERSION, isPluginHandle, sanitizePluginConfig } from "@shared/plugins";
import type {
    PluginCommand,
    PluginConfigValues,
    PluginManifest,
    PluginStatus,
} from "@shared/plugins";
import type {
    PluginConfigSnapshot,
    PluginEventPayload,
    PluginInspectResult,
    PluginMeta,
} from "@shared/ipc";
import type { StorageService } from "../services/StorageService";
import { readInstalledIcon, readInstalledManifest, readPluginFolder } from "./manifest";

/**
 * Installed plugins as the app sees them: discovery, install, replace, remove,
 * config and the metadata the renderer paints. Process lifecycle is delegated
 * to `PluginHost`; the router calls the host directly to run commands.
 */

/** The slice of `PluginHost` the service uses; faked in unit tests. */
export interface PluginServiceHost {
    start(spec: {
        handle: string;
        entryPath: string;
        dataDir: string;
        version: string;
        name: string;
        config: PluginConfigValues;
    }): Promise<void>;
    stop(handle: string): Promise<void>;
    restart(spec: {
        handle: string;
        entryPath: string;
        dataDir: string;
        version: string;
        name: string;
        config: PluginConfigValues;
    }): Promise<void>;
    status(handle: string): PluginStatus;
    commands(handle: string): PluginCommand[];
    error(handle: string): string | null;
    onEvent(listener: (event: PluginServiceHostEvent) => void): () => void;
    stopAll(): Promise<void>;
}

export type PluginServiceHostEvent =
    | { type: "status"; handle: string; status: PluginStatus; error: string | null }
    | { type: "registrations"; handle: string }
    | { type: "log"; handle: string; level: "debug" | "info" | "warn" | "error"; message: string };

export interface PluginServiceDialogs {
    /** Native folder picker; `null` when cancelled. */
    pickPluginFolder: () => Promise<string | null>;
}

export interface PluginServiceOptions {
    storage: StorageService;
    host: PluginServiceHost;
    dialogs?: PluginServiceDialogs;
}

interface InstalledPlugin {
    handle: string;
    folder: string;
    manifest: PluginManifest | null;
    /** Why the manifest could not be used; the folder stays listed. */
    error: string | null;
    iconDataUrl: string | null;
    iconStamp: string | null;
}

const CONFIG_FILE = "config.json";
const DATA_DIR = "data";

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readJsonFile(file: string): unknown {
    if (!fs.existsSync(file)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        log.warn(`[plugin] ignoring unreadable config file: ${file}`);
        return {};
    }
}

export class PluginService {
    private readonly storage: StorageService;
    private readonly host: PluginServiceHost;
    private readonly dialogs: PluginServiceDialogs | undefined;
    private readonly entries = new Map<string, InstalledPlugin>();
    private readonly listeners = new Set<(event: PluginEventPayload) => void>();

    constructor(options: PluginServiceOptions) {
        this.storage = options.storage;
        this.host = options.host;
        this.dialogs = options.dialogs;
        this.host.onEvent((event) => {
            switch (event.type) {
                case "status":
                    this.emit({
                        type: "status",
                        handle: event.handle,
                        status: event.status,
                        error: event.error,
                    });
                    if (event.status !== "running") {
                        // Commands disappear on stop and on failure; a running
                        // plugin follows with its own registrations event.
                        this.emit({ type: "registrations" });
                    }
                    return;
                case "registrations":
                    this.emit({ type: "registrations" });
                    return;
                case "log":
                    this.emit({
                        type: "log",
                        handle: event.handle,
                        level: event.level,
                        message: event.message,
                    });
                    return;
                default:
                    return;
            }
        });
    }

    onEvent(listener: (event: PluginEventPayload) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** One meta per installed folder, invalid manifests included as failed. */
    list(): PluginMeta[] {
        this.discover();
        return [...this.entries.values()]
            .map((entry) => this.metaFor(entry))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /** Read a picked folder without touching disk; `null` when cancelled. */
    async inspect(requestPath?: string): Promise<PluginInspectResult | null> {
        let folder = requestPath;
        if (folder === undefined || folder.trim() === "") {
            const picked = await this.dialogs?.pickPluginFolder();
            if (picked === undefined || picked === null) {
                return null;
            }
            folder = picked;
        }
        try {
            const read = readPluginFolder(folder);
            this.discover();
            const installed = this.entries.get(read.manifest.handle);
            return {
                path: read.path,
                manifest: read.manifest,
                valid: true,
                error: null,
                installedVersion: installed?.manifest?.version ?? null,
                iconDataUrl: read.iconDataUrl,
            };
        } catch (error) {
            return {
                path: folder,
                manifest: null,
                valid: false,
                error: messageOf(error),
                installedVersion: null,
                iconDataUrl: null,
            };
        }
    }

    /**
     * Copy a validated folder into `plugins/<handle>/`, keeping config, data
     * and the enabled state when it replaces an installed handle. Starts the
     * plugin when it is enabled.
     */
    async install(request: { path: string; replace?: boolean }): Promise<PluginMeta> {
        const source = readPluginFolder(request.path);
        const handle = source.manifest.handle;
        const destination = this.storage.pluginDir(handle);
        const exists = fs.existsSync(destination);
        if (exists && request.replace !== true) {
            throw new Error(`"${source.manifest.name}" is already installed; replace it instead`);
        }
        if (exists) {
            await this.host.stop(handle);
        }

        const tempRoot = fs.mkdtempSync(path.join(this.storage.dataDir, ".plugin-install-"));
        const staged = path.join(tempRoot, handle);
        const backup = path.join(tempRoot, `${handle}.old`);
        // A failed restore must leave the backup on disk. Deleting it in the
        // cleanup below would destroy the only remaining copy.
        let preserveBackup = false;
        try {
            fs.cpSync(source.path, staged, {
                recursive: true,
                dereference: false,
                filter: (item) => {
                    try {
                        return !fs.lstatSync(item).isSymbolicLink();
                    } catch {
                        return false;
                    }
                },
            });
            if (exists) {
                this.keepPluginState(destination, staged);
                fs.renameSync(destination, backup);
            }
            try {
                fs.renameSync(staged, destination);
            } catch (error) {
                if (exists) {
                    try {
                        fs.renameSync(backup, destination);
                    } catch (restoreError) {
                        preserveBackup = true;
                        throw new Error(
                            `Could not install "${handle}" (${messageOf(error)}) and could not ` +
                                `restore the previous copy (${messageOf(restoreError)}). ` +
                                `The previous copy is kept at ${backup}.`,
                            { cause: restoreError },
                        );
                    }
                }
                throw error;
            }
        } finally {
            if (!preserveBackup) {
                fs.rmSync(tempRoot, { recursive: true, force: true });
            }
        }

        if (!exists) {
            this.storage.setPluginEnabled(handle, true);
        }
        log.info(
            `[plugin:${handle}] ${exists ? "replaced" : "installed"} version ${source.manifest.version}`,
        );
        this.discover();
        if (this.storage.isPluginEnabled(handle)) {
            await this.start(handle);
        }
        this.emit({ type: "registrations" });
        const entry = this.entries.get(handle);
        if (entry === undefined) {
            throw new Error("This plugin could not be listed after install");
        }
        return this.metaFor(entry);
    }

    /** Stop, delete the folder (config and data included), forget the state. */
    async remove(handle: string): Promise<void> {
        this.discover();
        if (!this.entries.has(handle)) {
            throw new Error("This plugin is not installed");
        }
        await this.host.stop(handle);
        fs.rmSync(this.storage.pluginDir(handle), { recursive: true, force: true });
        this.storage.removePluginEnabled(handle);
        this.entries.delete(handle);
        log.info(`[plugin:${handle}] removed`);
        this.emit({ type: "registrations" });
    }

    async setEnabled(handle: string, enabled: boolean): Promise<void> {
        this.discover();
        const entry = this.requireEntry(handle);
        if (enabled && entry.manifest === null) {
            throw new Error(entry.error ?? `Plugin "${handle}" has no valid manifest`);
        }
        this.storage.setPluginEnabled(handle, enabled);
        if (!enabled) {
            await this.host.stop(handle);
            return;
        }
        await this.start(handle);
    }

    /** Retry a failed plugin (or restart a running one). */
    async restart(handle: string): Promise<void> {
        this.discover();
        const entry = this.requireEntry(handle);
        if (entry.manifest === null) {
            throw new Error(entry.error ?? `Plugin "${handle}" has no valid manifest`);
        }
        if (!this.storage.isPluginEnabled(handle)) {
            throw new Error("This plugin is disabled");
        }
        await this.host.restart(this.specFor(entry));
    }

    getConfig(handle: string): PluginConfigSnapshot {
        this.discover();
        const entry = this.requireEntry(handle);
        return this.readConfig(entry);
    }

    /** Validate, persist and restart; a plugin reads config only at setup. */
    async setConfig(handle: string, values: unknown): Promise<PluginConfigSnapshot> {
        this.discover();
        const entry = this.requireEntry(handle);
        const fields = entry.manifest?.configFields ?? [];
        const sanitized = sanitizePluginConfig(fields, values);
        if (!sanitized.ok) {
            throw new Error(`Settings are invalid: ${sanitized.errors.join("; ")}`);
        }
        fs.writeFileSync(
            this.storage.pluginConfigPath(handle),
            JSON.stringify(sanitized.values, null, 2) + "\n",
        );
        log.info(`[plugin:${handle}] config saved`);
        if (this.storage.isPluginEnabled(handle) && entry.manifest !== null) {
            await this.host.restart(this.specFor(entry));
        }
        return { handle, fields, values: sanitized.values };
    }

    /** Start every enabled plugin; called once on `whenReady`. */
    async startAll(): Promise<void> {
        this.discover();
        for (const entry of this.entries.values()) {
            if (entry.manifest === null || !this.storage.isPluginEnabled(entry.handle)) {
                continue;
            }
            try {
                await this.start(entry.handle);
            } catch (error) {
                log.warn(`[plugin:${entry.handle}] could not start: ${messageOf(error)}`);
            }
        }
    }

    /** `handle:command` for every running plugin's registered commands. */
    registeredCommands(): string[] {
        this.discover();
        const commands: string[] = [];
        for (const entry of this.entries.values()) {
            if (entry.manifest === null || !this.storage.isPluginEnabled(entry.handle)) {
                continue;
            }
            // Only a running plugin's registrations count. A starting plugin
            // still carries its previous command snapshot, so its commands
            // are left out and read as missing until it is running again.
            if (this.host.status(entry.handle) !== "running") {
                continue;
            }
            for (const command of this.host.commands(entry.handle)) {
                commands.push(`${entry.handle}:${command.name}`);
            }
        }
        return commands.sort();
    }

    async stopAll(): Promise<void> {
        await this.host.stopAll();
    }

    /** Read `<pluginsDir>` and rebuild the entry map. */
    discover(): void {
        const dir = this.storage.pluginsDir();
        if (!fs.existsSync(dir)) {
            this.entries.clear();
            return;
        }
        const next = new Map<string, InstalledPlugin>();
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!item.isDirectory() || !isPluginHandle(item.name)) {
                continue;
            }
            const folder = path.join(dir, item.name);
            if (!fs.existsSync(path.join(folder, "plugin.json"))) {
                continue;
            }
            try {
                const installed = readInstalledManifest(folder);
                if (installed.manifest.handle !== item.name) {
                    log.warn(
                        `[plugin] ignoring folder "${item.name}": manifest handle is ` +
                            `"${installed.manifest.handle}"`,
                    );
                    continue;
                }
                const previous = this.entries.get(item.name);
                const entry: InstalledPlugin = {
                    handle: item.name,
                    folder,
                    manifest: installed.manifest,
                    error: null,
                    iconDataUrl: previous?.iconDataUrl ?? null,
                    iconStamp: previous?.iconStamp ?? null,
                };
                this.entries.set(item.name, entry);
                next.set(item.name, entry);
            } catch (error) {
                const entry: InstalledPlugin = {
                    handle: item.name,
                    folder,
                    manifest: null,
                    error: messageOf(error),
                    iconDataUrl: null,
                    iconStamp: null,
                };
                this.entries.set(item.name, entry);
                next.set(item.name, entry);
            }
        }
        this.entries.clear();
        for (const [handle, entry] of next) {
            this.entries.set(handle, entry);
        }
    }

    private requireEntry(handle: string): InstalledPlugin {
        if (!isPluginHandle(handle)) {
            throw new Error(`Invalid plugin handle: "${handle}"`);
        }
        const entry = this.entries.get(handle);
        if (entry === undefined) {
            throw new Error("This plugin is not installed");
        }
        return entry;
    }

    private async start(handle: string): Promise<void> {
        const entry = this.requireEntry(handle);
        if (entry.manifest === null) {
            throw new Error(entry.error ?? `Plugin "${handle}" has no valid manifest`);
        }
        await this.host.start(this.specFor(entry));
    }

    private specFor(entry: InstalledPlugin) {
        const manifest = entry.manifest as PluginManifest;
        const dataDir = path.join(entry.folder, DATA_DIR);
        fs.mkdirSync(dataDir, { recursive: true });
        return {
            handle: entry.handle,
            entryPath: path.join(entry.folder, manifest.main),
            dataDir,
            version: manifest.version,
            name: manifest.name,
            config: this.readConfig(entry).values,
        };
    }

    private readConfig(entry: InstalledPlugin): PluginConfigSnapshot {
        const fields = entry.manifest?.configFields ?? [];
        const values = sanitizePluginConfig(
            fields,
            readJsonFile(this.storage.pluginConfigPath(entry.handle)),
        ).values;
        return { handle: entry.handle, fields, values };
    }

    private metaFor(entry: InstalledPlugin): PluginMeta {
        const enabled = this.storage.isPluginEnabled(entry.handle);
        const status: PluginStatus =
            entry.manifest === null
                ? "failed"
                : enabled
                  ? this.host.status(entry.handle)
                  : "stopped";
        return {
            handle: entry.handle,
            name: entry.manifest?.name ?? entry.handle,
            description: entry.manifest?.description ?? "",
            version: entry.manifest?.version ?? "",
            apiVersion: entry.manifest?.apiVersion ?? PLUGIN_API_VERSION,
            iconDataUrl: this.iconDataUrlFor(entry),
            enabled,
            status,
            error: entry.error ?? this.host.error(entry.handle),
            commands: status === "running" ? this.host.commands(entry.handle) : [],
            hasConfig: (entry.manifest?.configFields.length ?? 0) > 0,
        };
    }

    private iconDataUrlFor(entry: InstalledPlugin): string | null {
        const manifest = entry.manifest;
        if (manifest?.icon === undefined) {
            return null;
        }
        const file = path.join(entry.folder, manifest.icon);
        let stamp: string;
        try {
            const stats = fs.statSync(file);
            stamp = `${stats.mtimeMs}:${stats.size}`;
        } catch {
            return null;
        }
        if (entry.iconStamp !== stamp) {
            entry.iconDataUrl = readInstalledIcon(entry.folder, manifest);
            entry.iconStamp = stamp;
        }
        return entry.iconDataUrl;
    }

    /** Move `config.json` and `data/` from the old install into the staged one. */
    private keepPluginState(from: string, to: string): void {
        const config = path.join(from, CONFIG_FILE);
        if (fs.existsSync(config)) {
            fs.copyFileSync(config, path.join(to, CONFIG_FILE));
        }
        const data = path.join(from, DATA_DIR);
        if (fs.existsSync(data)) {
            fs.cpSync(data, path.join(to, DATA_DIR), { recursive: true });
        }
    }

    private emit(event: PluginEventPayload): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (error) {
                log.warn(`[plugin] event listener failed: ${messageOf(error)}`);
            }
        }
    }
}
