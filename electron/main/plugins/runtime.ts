// ---------------------------------------------------------------------------
// Worker entry for one plugin. `PluginHost` forks this file with the app's
// `utilityProcess`; the host sends `init`, `invoke` and `teardown` messages.
//
// Built as a second main-process entry (see vite.config.ts). Keep it free of
// Electron imports: it runs inside the utility process, not the app.
// ---------------------------------------------------------------------------

import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPluginCommandName } from "@shared/plugins";
import type { PluginCommand, PluginConfigValues } from "@shared/plugins";
import type { PluginLogLevel } from "@shared/ipc";

interface ParentPort {
    on(event: "message", listener: (event: { data: unknown }) => void): void;
    postMessage(message: unknown): void;
    /** MessagePortMain keeps messages queued until this is called. */
    start?: () => void;
}

interface InitMessage {
    type: "init";
    handle: string;
    version: string;
    name: string;
    entryPath: string;
    dataDir: string;
    config: PluginConfigValues;
}

interface InvokeMessage {
    type: "invoke";
    id: number;
    command: string;
}

interface TeardownMessage {
    type: "teardown";
}

type HostMessage = InitMessage | InvokeMessage | TeardownMessage;

type CommandHandler = () => unknown;

interface RegisterOptions {
    title?: string;
    handler: CommandHandler;
}

export interface PluginContext {
    readonly handle: string;
    readonly version: string;
    readonly dataDir: string;
    getConfig(): PluginConfigValues;
    registerCommand(name: string, options: RegisterOptions): void;
    log(level: PluginLogLevel, message: string): void;
}

interface PluginModule {
    setup?: (context: PluginContext) => unknown;
    teardown?: () => unknown;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

if (parentPort === undefined) {
    throw new Error("The plugin runtime must run inside an Electron utility process");
}

const port: ParentPort = parentPort;

let config: PluginConfigValues = {};
let setupActive = false;
let ready = false;
let pluginModule: PluginModule | null = null;
const handlers = new Map<string, CommandHandler>();
const titles = new Map<string, string>();

function post(message: unknown): void {
    port.postMessage(message);
}

function logToHost(level: PluginLogLevel, message: unknown): void {
    post({ type: "log", level, message: typeof message === "string" ? message : String(message) });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createContext(message: InitMessage): PluginContext {
    return {
        handle: message.handle,
        version: message.version,
        dataDir: message.dataDir,
        getConfig: () => ({ ...config }),
        registerCommand(name, options) {
            if (!setupActive) {
                throw new Error("registerCommand() may only be called during setup");
            }
            if (!isPluginCommandName(name)) {
                throw new Error(
                    `Invalid command name "${String(name)}"; expected ^[a-z][a-z0-9_-]{1,31}$`,
                );
            }
            if (handlers.has(name)) {
                throw new Error(`Command "${name}" is already registered`);
            }
            if (options === null || typeof options !== "object") {
                throw new Error(`Command "${name}" needs a handler`);
            }
            if (typeof options.handler !== "function") {
                throw new Error(`Command "${name}" needs a handler function`);
            }
            handlers.set(name, options.handler);
            if (typeof options.title === "string" && options.title.trim() !== "") {
                titles.set(name, options.title.trim());
            }
        },
        log: logToHost,
    };
}

async function runSetup(message: InitMessage): Promise<void> {
    config = { ...message.config };
    const entry = pathToFileURL(path.resolve(message.entryPath)).href;
    try {
        pluginModule = (await import(entry)) as PluginModule;
        if (typeof pluginModule.setup !== "function") {
            throw new Error("The plugin entry must export setup(context)");
        }
        setupActive = true;
        await pluginModule.setup(createContext(message));
        setupActive = false;
        ready = true;
        const commands: PluginCommand[] = [...handlers.keys()].map((name) => {
            const title = titles.get(name);
            return title === undefined ? { name } : { name, title };
        });
        post({ type: "ready", commands });
    } catch (error) {
        setupActive = false;
        post({ type: "setup-error", message: errorMessage(error) });
    }
}

async function runHandler(id: number, command: string): Promise<void> {
    const handler = handlers.get(command);
    if (!ready || handler === undefined) {
        post({ type: "result", id, ok: false, error: `Command "${command}" is not registered` });
        return;
    }
    try {
        await handler();
        post({ type: "result", id, ok: true });
    } catch (error) {
        logToHost("error", `A command failed: ${errorMessage(error)}`);
        post({ type: "result", id, ok: false, error: errorMessage(error) });
    }
}

async function runTeardown(): Promise<void> {
    try {
        if (pluginModule !== null && typeof pluginModule.teardown === "function") {
            await pluginModule.teardown();
        }
        post({ type: "teardown-done" });
    } catch (error) {
        logToHost("warn", `teardown failed: ${errorMessage(error)}`);
        post({ type: "teardown-done" });
    }
}

port.on("message", (event) => {
    const message = event.data as HostMessage | null;
    if (message === null || typeof message !== "object") {
        return;
    }
    switch (message.type) {
        case "init":
            void runSetup(message);
            return;
        case "invoke":
            void runHandler(message.id, message.command);
            return;
        case "teardown":
            void runTeardown();
            return;
        default:
            return;
    }
});
port.start?.();
