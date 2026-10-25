import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginCommand, PluginStatus } from "@shared/plugins";
import { StorageService } from "../services/StorageService";
import { PluginService } from "./PluginService";
import type { PluginServiceHost, PluginServiceHostEvent } from "./PluginService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

interface StartSpec {
    handle: string;
    entryPath: string;
    dataDir: string;
    version: string;
    name: string;
    config: Record<string, string | number | boolean>;
}

class FakeHost implements PluginServiceHost {
    readonly started: StartSpec[] = [];
    readonly stopped: string[] = [];
    readonly restarted: StartSpec[] = [];
    readonly statuses = new Map<string, PluginStatus>();
    readonly commandMap = new Map<string, PluginCommand[]>();
    readonly errors = new Map<string, string>();
    private readonly listeners = new Set<(event: PluginServiceHostEvent) => void>();

    start(spec: StartSpec): Promise<void> {
        this.started.push(spec);
        this.statuses.set(spec.handle, "running");
        this.commandMap.set(spec.handle, [{ name: "greet", title: "Say hello" }]);
        return Promise.resolve();
    }

    async stop(handle: string): Promise<void> {
        this.stopped.push(handle);
        this.statuses.set(handle, "stopped");
        this.commandMap.delete(handle);
    }

    async restart(spec: StartSpec): Promise<void> {
        this.restarted.push(spec);
        await this.stop(spec.handle);
        this.start(spec);
    }

    status(handle: string): PluginStatus {
        return this.statuses.get(handle) ?? "stopped";
    }

    commands(handle: string): PluginCommand[] {
        return this.commandMap.get(handle) ?? [];
    }

    error(handle: string): string | null {
        return this.errors.get(handle) ?? null;
    }

    onEvent(listener: (event: PluginServiceHostEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async stopAll(): Promise<void> {
        await Promise.all([...this.statuses.keys()].map((handle) => this.stop(handle)));
    }
}

function writeSource(
    root: string,
    options: { handle?: string; version?: string; name?: string } = {},
): string {
    const handle = options.handle ?? "hello";
    const dir = path.join(root, `source-${handle}-${options.version ?? "1.0.0"}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, "plugin.json"),
        JSON.stringify(
            {
                apiVersion: 1,
                handle,
                name: options.name ?? "Hello",
                version: options.version ?? "1.0.0",
                description: "Example",
                icon: "icon.png",
                main: "main.mjs",
                configFields: [
                    {
                        key: "greeting",
                        label: "Greeting",
                        kind: "text",
                        default: "Hello",
                        required: true,
                    },
                ],
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(
        path.join(dir, "main.mjs"),
        "export async function setup(context) { context.registerCommand('greet', { handler: async () => {} }); }",
    );
    fs.writeFileSync(path.join(dir, "icon.png"), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    return dir;
}

describe("PluginService", () => {
    let root = "";
    let dataDir = "";
    let storage: StorageService;
    let host: FakeHost;
    let service: PluginService;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-plugin-test-"));
        dataDir = path.join(root, "data");
        storage = new StorageService({ dataDir });
        storage.ensureLayout();
        host = new FakeHost();
        service = new PluginService({ storage, host });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("inspects a folder without copying it", async () => {
        const source = writeSource(root);
        const result = await service.inspect(source);
        expect(result?.valid).toBe(true);
        expect(result?.manifest?.handle).toBe("hello");
        expect(result?.iconDataUrl?.startsWith("data:image/png;base64,")).toBe(true);
        expect(fs.existsSync(storage.pluginDir("hello"))).toBe(false);
        expect(host.started).toEqual([]);
    });

    it("refuses a folder with no manifest", async () => {
        const folder = path.join(root, "empty");
        fs.mkdirSync(folder);
        const result = await service.inspect(folder);
        expect(result?.valid).toBe(false);
        expect(result?.error).toContain("plugin.json");
    });

    it("installs, starts and lists the plugin", async () => {
        const source = writeSource(root);
        const meta = await service.install({ path: source });

        expect(meta.handle).toBe("hello");
        expect(meta.enabled).toBe(true);
        expect(meta.status).toBe("running");
        expect(meta.commands).toEqual([{ name: "greet", title: "Say hello" }]);
        expect(fs.existsSync(path.join(storage.pluginDir("hello"), "main.mjs"))).toBe(true);
        expect(host.started).toHaveLength(1);
        expect(host.started[0]?.config).toEqual({ greeting: "Hello" });
        expect(service.list().map((item) => item.handle)).toEqual(["hello"]);
    });

    it("refuses to overwrite an installed handle without replace", async () => {
        const source = writeSource(root);
        await service.install({ path: source });
        await expect(service.install({ path: source })).rejects.toThrow("already installed");
    });

    it("replaces code while keeping config, data and the enabled state", async () => {
        await service.install({ path: writeSource(root) });
        await service.setConfig("hello", { greeting: "Hi" });
        fs.mkdirSync(path.join(storage.pluginDir("hello"), "data"), { recursive: true });
        fs.writeFileSync(path.join(storage.pluginDir("hello"), "data", "state.txt"), "kept");
        await service.setEnabled("hello", false);

        const meta = await service.install({
            path: writeSource(root, { version: "2.0.0" }),
            replace: true,
        });

        expect(meta.version).toBe("2.0.0");
        expect(meta.enabled).toBe(false);
        expect(meta.status).toBe("stopped");
        expect(service.getConfig("hello").values.greeting).toBe("Hi");
        expect(
            fs.readFileSync(path.join(storage.pluginDir("hello"), "data", "state.txt"), "utf8"),
        ).toBe("kept");
        // A disabled plugin is not restarted by a replace.
        expect(host.started.filter((spec) => spec.version === "2.0.0")).toHaveLength(0);
    });

    it("stops a running plugin, swaps the code and starts it again", async () => {
        await service.install({ path: writeSource(root) });

        const meta = await service.install({
            path: writeSource(root, { version: "2.0.0" }),
            replace: true,
        });

        expect(host.stopped).toContain("hello");
        expect(host.started.map((spec) => spec.version)).toEqual(["1.0.0", "2.0.0"]);
        expect(meta.status).toBe("running");
        expect(meta.version).toBe("2.0.0");
        expect(service.getConfig("hello").values.greeting).toBe("Hello");
    });

    it("keeps the previous copy when the swap and the restore both fail", async () => {
        await service.install({ path: writeSource(root) });
        const destination = storage.pluginDir("hello");
        const replacement = writeSource(root, { version: "2.0.0" });

        const realRename = fs.renameSync.bind(fs);
        const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (String(to) === destination && String(from) !== destination) {
                throw new Error("rename failed");
            }
            realRename(from, to);
        });

        try {
            await expect(service.install({ path: replacement, replace: true })).rejects.toThrow(
                /previous copy is kept at/,
            );
        } finally {
            rename.mockRestore();
        }

        // The destination is gone, but the backup must still hold the plugin.
        expect(fs.existsSync(destination)).toBe(false);
        const tempDirs = fs
            .readdirSync(dataDir)
            .filter((name) => name.startsWith(".plugin-install-"));
        expect(tempDirs).toHaveLength(1);
        expect(fs.existsSync(path.join(dataDir, tempDirs[0]!, "hello.old", "plugin.json"))).toBe(
            true,
        );
    });

    it("removes the folder, config, data and the enabled entry", async () => {
        await service.install({ path: writeSource(root) });
        fs.mkdirSync(path.join(storage.pluginDir("hello"), "data"), { recursive: true });
        fs.writeFileSync(storage.pluginConfigPath("hello"), "{}");
        await service.setEnabled("hello", false);

        await service.remove("hello");

        expect(fs.existsSync(storage.pluginDir("hello"))).toBe(false);
        expect(storage.readPluginEnabled()).toEqual({});
        expect(host.stopped).toContain("hello");
        expect(service.list()).toEqual([]);
    });

    it("round-trips the enabled state and stops on disable", async () => {
        await service.install({ path: writeSource(root) });
        await service.setEnabled("hello", false);
        expect(storage.isPluginEnabled("hello")).toBe(false);
        expect(host.status("hello")).toBe("stopped");

        await service.setEnabled("hello", true);
        expect(storage.isPluginEnabled("hello")).toBe(true);
        expect(host.status("hello")).toBe("running");
    });

    it("lists a folder with an invalid manifest as failed so it can be removed", async () => {
        const folder = path.join(storage.pluginsDir(), "broken");
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "plugin.json"), JSON.stringify({ apiVersion: 1 }));
        fs.writeFileSync(path.join(folder, "main.mjs"), "export async function setup() {}");

        const meta = service.list().find((item) => item.handle === "broken");
        expect(meta?.status).toBe("failed");
        expect(meta?.error).toContain("handle");

        await service.remove("broken");
        expect(fs.existsSync(folder)).toBe(false);
    });

    it("ignores a folder whose manifest handle differs from its name", () => {
        const folder = path.join(storage.pluginsDir(), "other");
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(
            path.join(folder, "plugin.json"),
            JSON.stringify({
                apiVersion: 1,
                handle: "hello",
                name: "Hello",
                version: "1.0.0",
                main: "main.mjs",
            }),
        );
        fs.writeFileSync(path.join(folder, "main.mjs"), "export async function setup() {}");

        expect(service.list()).toEqual([]);
    });

    it("reads and validates config against the manifest fields", async () => {
        await service.install({ path: writeSource(root) });
        expect(service.getConfig("hello")).toMatchObject({
            handle: "hello",
            values: { greeting: "Hello" },
        });

        const saved = await service.setConfig("hello", { greeting: "Hi", extra: "dropped" });
        expect(saved.values).toEqual({ greeting: "Hi" });
        expect(host.restarted).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(storage.pluginConfigPath("hello"), "utf8"))).toEqual({
            greeting: "Hi",
        });

        await expect(service.setConfig("hello", { greeting: "" })).rejects.toThrow(
            "Greeting is required",
        );
    });

    it("reports commands for the sync warning set only while running", async () => {
        await service.install({ path: writeSource(root) });
        expect(service.registeredCommands()).toEqual(["hello:greet"]);

        host.statuses.set("hello", "starting");
        expect(host.commands("hello")).toEqual([{ name: "greet", title: "Say hello" }]);
        expect(service.registeredCommands()).toEqual([]);
    });

    it("finds local pages that run a plugin command", async () => {
        storage.createProfile("main");
        storage.savePage("main", "0", {
            buttons: {
                "0": { label: "Go", click: ["CMD:hello:greet", "DELAY:5"] },
                "1": { label: "Other", click: ["CMD:other:go"] },
            },
        } as never);

        const scan = storage.scanReferences({ kind: "plugin", handle: "hello" });
        expect(scan.hits).toEqual([{ profile: "main", pageId: "0" }]);
    });
});
