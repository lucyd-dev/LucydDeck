import log from "electron-log/main";
import { isPluginCommandName } from "@shared/plugins";
import type { PluginCommand, PluginConfigValues, PluginStatus } from "@shared/plugins";
import type { PluginLogLevel } from "@shared/ipc";

/**
 * One process per enabled plugin, supervised from the main process. The host
 * owns process lifecycle only: registration snapshots, setup and teardown
 * deadlines, restart backoff and message correlation. Command serialization
 * and the handler timeout live in `CommandRouter`.
 *
 * The launcher is injected so Vitest can run the whole lifecycle without
 * Electron; `electron/main.ts` passes `utilityProcess.fork`.
 */

export interface PluginProcess {
    postMessage(message: unknown): void;
    kill(): void;
    on(event: "message", listener: (message: unknown) => void): void;
    on(event: "exit", listener: (code: number) => void): void;
}

export type PluginProcessLauncher = () => PluginProcess;

export interface PluginStartSpec {
    handle: string;
    /** Absolute path of the ESM entry inside the installed folder. */
    entryPath: string;
    /** Absolute path of `plugins/<handle>/data/`, created by the service. */
    dataDir: string;
    version: string;
    name: string;
    config: PluginConfigValues;
}

export type PluginHostEvent =
    | { type: "status"; handle: string; status: PluginStatus; error: string | null }
    | { type: "registrations"; handle: string }
    | { type: "log"; handle: string; level: PluginLogLevel; message: string };

export interface PluginHostOptions {
    launcher: PluginProcessLauncher;
    setupTimeoutMs?: number;
    teardownTimeoutMs?: number;
    /** Delays before each restart after an unexpected exit. */
    restartDelaysMs?: readonly number[];
    /** A process that lived this long starts a fresh restart budget. */
    healthyUptimeMs?: number;
}

const DEFAULTS = {
    setupTimeoutMs: 5_000,
    teardownTimeoutMs: 2_000,
    restartDelaysMs: [1_000, 2_000, 4_000],
    healthyUptimeMs: 60_000,
} as const;

const LOG_LEVELS = new Set<PluginLogLevel>(["debug", "info", "warn", "error"]);

interface PendingRequest {
    resolve: () => void;
    reject: (error: Error) => void;
}

interface HostEntry {
    spec: PluginStartSpec | null;
    proc: PluginProcess | null;
    status: PluginStatus;
    error: string | null;
    commands: PluginCommand[];
    /** Restarts scheduled since the last explicit start or healthy run. */
    restarts: number;
    /** When the current process reported ready; `null` before then. */
    readyAt: number | null;
    intentionalStop: boolean;
    setupTimer: ReturnType<typeof setTimeout> | null;
    teardownTimer: ReturnType<typeof setTimeout> | null;
    restartTimer: ReturnType<typeof setTimeout> | null;
    /** In-flight stop; a second stop awaits this instead of starting another. */
    stopping: Promise<void> | null;
    finishStop: (() => void) | null;
    requests: Map<number, PendingRequest>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizeCommands(value: unknown): PluginCommand[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const commands: PluginCommand[] = [];
    for (const item of value) {
        if (!isRecord(item) || !isPluginCommandName(item.name) || seen.has(item.name)) {
            continue;
        }
        seen.add(item.name);
        commands.push({
            name: item.name,
            ...(typeof item.title === "string" && item.title.trim() !== ""
                ? { title: item.title.trim() }
                : {}),
        });
    }
    return commands;
}

export class PluginHost {
    private readonly launcher: PluginProcessLauncher;
    private readonly setupTimeoutMs: number;
    private readonly teardownTimeoutMs: number;
    private readonly restartDelaysMs: readonly number[];
    private readonly healthyUptimeMs: number;
    private readonly entries = new Map<string, HostEntry>();
    private readonly listeners = new Set<(event: PluginHostEvent) => void>();
    private nextRequestId = 1;

    constructor(options: PluginHostOptions) {
        this.launcher = options.launcher;
        this.setupTimeoutMs = options.setupTimeoutMs ?? DEFAULTS.setupTimeoutMs;
        this.teardownTimeoutMs = options.teardownTimeoutMs ?? DEFAULTS.teardownTimeoutMs;
        this.restartDelaysMs = options.restartDelaysMs ?? DEFAULTS.restartDelaysMs;
        this.healthyUptimeMs = options.healthyUptimeMs ?? DEFAULTS.healthyUptimeMs;
    }

    onEvent(listener: (event: PluginHostEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    status(handle: string): PluginStatus {
        return this.entries.get(handle)?.status ?? "stopped";
    }

    commands(handle: string): PluginCommand[] {
        return [...(this.entries.get(handle)?.commands ?? [])];
    }

    error(handle: string): string | null {
        return this.entries.get(handle)?.error ?? null;
    }

    /**
     * Start a stopped or failed plugin. A start issued while a stop is still
     * finishing waits for that process, so a quick disable then enable cannot
     * leave two processes (or kill the new one with the old timer).
     */
    async start(spec: PluginStartSpec): Promise<void> {
        const pending = this.entries.get(spec.handle);
        if (pending !== undefined && pending.stopping !== null) {
            await pending.stopping;
        }

        const existing = this.entries.get(spec.handle);
        if (
            existing !== undefined &&
            (existing.status === "starting" || existing.status === "running")
        ) {
            throw new Error(`Plugin ${spec.handle} is already running`);
        }
        const entry: HostEntry = existing ?? {
            spec: null,
            proc: null,
            status: "stopped",
            error: null,
            commands: [],
            restarts: 0,
            readyAt: null,
            intentionalStop: false,
            setupTimer: null,
            teardownTimer: null,
            restartTimer: null,
            stopping: null,
            finishStop: null,
            requests: new Map(),
        };
        entry.spec = spec;
        entry.error = null;
        entry.commands = [];
        entry.restarts = 0;
        entry.readyAt = null;
        entry.intentionalStop = false;
        this.entries.set(spec.handle, entry);
        this.launch(entry);
    }

    private launch(entry: HostEntry): void {
        const spec = entry.spec;
        if (spec === null) {
            return;
        }
        this.clearTimer(entry, "restartTimer");
        entry.status = "starting";
        entry.error = null;
        entry.readyAt = null;
        entry.intentionalStop = false;
        this.emitStatus(entry, spec.handle);

        let proc: PluginProcess;
        try {
            proc = this.launcher();
        } catch (error) {
            this.markFailed(
                entry,
                spec.handle,
                `The plugin could not be started: ${messageOf(error)}`,
            );
            return;
        }
        entry.proc = proc;
        proc.on("message", (message) => this.onMessage(entry, proc, spec.handle, message));
        proc.on("exit", (code) => this.onExit(entry, proc, spec.handle, code));

        try {
            proc.postMessage({
                type: "init",
                handle: spec.handle,
                version: spec.version,
                name: spec.name,
                entryPath: spec.entryPath,
                dataDir: spec.dataDir,
                config: { ...spec.config },
            });
        } catch (error) {
            this.failProcess(
                entry,
                proc,
                spec.handle,
                `The plugin could not be started: ${messageOf(error)}`,
            );
            return;
        }

        const timer = setTimeout(() => {
            if (entry.setupTimer !== timer) {
                return;
            }
            entry.setupTimer = null;
            this.failProcess(entry, proc, spec.handle, "The plugin did not start in time.");
        }, this.setupTimeoutMs);
        entry.setupTimer = timer;
    }

    private onMessage(
        entry: HostEntry,
        proc: PluginProcess,
        handle: string,
        message: unknown,
    ): void {
        // A message from a process that has been replaced must never change
        // the current process's state.
        if (entry.proc !== proc || !isRecord(message)) {
            return;
        }
        switch (message.type) {
            case "log": {
                const level = LOG_LEVELS.has(message.level as PluginLogLevel)
                    ? (message.level as PluginLogLevel)
                    : "info";
                const text =
                    typeof message.message === "string" ? message.message : String(message.message);
                this.writeLog(handle, level, text);
                this.emit({ type: "log", handle, level, message: text });
                return;
            }
            case "ready": {
                if (entry.status !== "starting") {
                    return;
                }
                this.clearTimer(entry, "setupTimer");
                entry.commands = normalizeCommands(message.commands);
                entry.readyAt = Date.now();
                entry.error = null;
                entry.status = "running";
                this.emitStatus(entry, handle);
                this.emit({ type: "registrations", handle });
                return;
            }
            case "setup-error": {
                if (entry.status !== "starting") {
                    return;
                }
                const text =
                    typeof message.message === "string" && message.message.trim() !== ""
                        ? message.message
                        : "setup failed";
                this.failProcess(entry, proc, handle, text);
                return;
            }
            case "result": {
                const id = typeof message.id === "number" ? message.id : -1;
                const pending = entry.requests.get(id);
                if (pending === undefined) {
                    return;
                }
                entry.requests.delete(id);
                if (message.ok === true) {
                    pending.resolve();
                } else {
                    pending.reject(
                        new Error(
                            typeof message.error === "string" && message.error !== ""
                                ? message.error
                                : "Command failed",
                        ),
                    );
                }
                return;
            }
            case "teardown-done": {
                if (entry.stopping === null) {
                    // Only a stop may end the process this way.
                    return;
                }
                // The process still exists until `exit`: keep it (and the
                // deadline) so a replacement cannot start or a folder swap
                // cannot race the old one on a locked file.
                proc.kill();
                return;
            }
            default:
                return;
        }
    }

    private onExit(
        entry: HostEntry,
        proc: PluginProcess,
        handle: string,
        code: number | undefined,
    ): void {
        if (entry.proc !== proc) {
            return;
        }
        entry.proc = null;
        this.clearTimer(entry, "setupTimer");
        this.clearTimer(entry, "teardownTimer");
        this.rejectPending(entry, "The plugin stopped");
        const readyAt = entry.readyAt;
        entry.readyAt = null;
        this.settleStop(entry);

        if (entry.intentionalStop || entry.status === "stopped") {
            entry.status = "stopped";
            entry.commands = [];
            this.emitStatus(entry, handle);
            return;
        }
        if (entry.status === "failed") {
            return;
        }

        // A plugin that has stayed up for a minute earns a fresh budget; a
        // start-then-crash loop keeps consuming the three restarts.
        if (readyAt !== null && Date.now() - readyAt >= this.healthyUptimeMs) {
            entry.restarts = 0;
        }

        if (entry.restarts < this.restartDelaysMs.length) {
            const delay = this.restartDelaysMs[entry.restarts] ?? 0;
            entry.restarts += 1;
            entry.status = "starting";
            entry.error = null;
            this.emitStatus(entry, handle);
            this.writeLog(
                handle,
                "warn",
                `process exited${typeof code === "number" ? ` (code ${code})` : ""}; ` +
                    `restarting in ${delay} ms`,
            );
            entry.restartTimer = setTimeout(() => {
                entry.restartTimer = null;
                this.launch(entry);
            }, delay);
            return;
        }

        this.markFailed(entry, handle, "The plugin kept stopping and will not be started again.");
    }

    private onTeardownTimeout(entry: HostEntry, proc: PluginProcess, handle: string): void {
        if (entry.proc !== proc) {
            return;
        }
        entry.teardownTimer = null;
        this.writeLog(
            handle,
            "warn",
            `teardown did not finish within ${this.teardownTimeoutMs / 1000} seconds; killing it`,
        );
        // Drop the entry's handle on the process before killing it, so a late
        // exit or message from this process is ignored by design.
        entry.proc = null;
        proc.kill();
        this.settleStop(entry);
    }

    private failProcess(
        entry: HostEntry,
        proc: PluginProcess,
        handle: string,
        message: string,
    ): void {
        if (entry.proc !== proc) {
            return;
        }
        entry.proc = null;
        this.markFailed(entry, handle, message);
        proc.kill();
    }

    private markFailed(entry: HostEntry, handle: string, message: string): void {
        this.clearTimer(entry, "setupTimer");
        this.clearTimer(entry, "restartTimer");
        entry.status = "failed";
        entry.error = message;
        entry.commands = [];
        entry.readyAt = null;
        entry.intentionalStop = false;
        this.rejectPending(entry, message);
        this.emitStatus(entry, handle);
        this.writeLog(handle, "error", message);
    }

    /** Stop a plugin and wait for its process to end (or be killed). */
    stop(handle: string): Promise<void> {
        const entry = this.entries.get(handle);
        if (entry === undefined) {
            return Promise.resolve();
        }
        if (entry.stopping !== null) {
            return entry.stopping;
        }
        entry.intentionalStop = true;
        entry.status = "stopped";
        entry.error = null;
        entry.commands = [];
        entry.readyAt = null;
        this.clearTimer(entry, "setupTimer");
        this.clearTimer(entry, "restartTimer");
        this.emitStatus(entry, handle);

        const proc = entry.proc;
        if (proc === null) {
            return Promise.resolve();
        }
        this.rejectPending(entry, "The plugin stopped");
        const stopping = new Promise<void>((resolve) => {
            entry.finishStop = resolve;
        });
        entry.stopping = stopping;
        try {
            proc.postMessage({ type: "teardown" });
        } catch {
            // The process is already gone; the exit handler or the deadline
            // below settles the wait.
        }
        const timer = setTimeout(
            () => this.onTeardownTimeout(entry, proc, handle),
            this.teardownTimeoutMs,
        );
        entry.teardownTimer = timer;
        return stopping;
    }

    private settleStop(entry: HostEntry): void {
        const resolve = entry.finishStop;
        entry.finishStop = null;
        entry.stopping = null;
        resolve?.();
    }

    /** Stop then start on the same spec, resetting the restart budget. */
    async restart(spec: PluginStartSpec): Promise<void> {
        await this.stop(spec.handle);
        await this.start(spec);
    }

    /** Stop every process; used on quit. */
    async stopAll(): Promise<void> {
        await Promise.all([...this.entries.keys()].map((handle) => this.stop(handle)));
    }

    /** Reject a pending command with the handler's error. */
    invoke(handle: string, command: string): Promise<void> {
        const entry = this.entries.get(handle);
        if (
            entry === undefined ||
            entry.proc === null ||
            entry.stopping !== null ||
            entry.status !== "running"
        ) {
            return Promise.reject(new Error(`Plugin ${handle} is not running`));
        }
        const proc = entry.proc;
        const id = this.nextRequestId++;
        return new Promise<void>((resolve, reject) => {
            entry.requests.set(id, { resolve, reject });
            try {
                proc.postMessage({ type: "invoke", id, command });
            } catch (error) {
                entry.requests.delete(id);
                reject(new Error(`Could not reach plugin ${handle}: ${messageOf(error)}`));
            }
        });
    }

    private rejectPending(entry: HostEntry, message: string): void {
        const pending = [...entry.requests.values()];
        entry.requests.clear();
        for (const request of pending) {
            request.reject(new Error(message));
        }
    }

    private clearTimer(
        entry: HostEntry,
        timer: "setupTimer" | "teardownTimer" | "restartTimer",
    ): void {
        const handle = entry[timer];
        if (handle !== null) {
            clearTimeout(handle);
            entry[timer] = null;
        }
    }

    private emitStatus(entry: HostEntry, handle: string): void {
        this.emit({
            type: "status",
            handle,
            status: entry.status,
            error: entry.error,
        });
    }

    private writeLog(handle: string, level: PluginLogLevel, message: string): void {
        const line = `[plugin:${handle}] ${message}`;
        if (level === "error") {
            log.error(line);
        } else if (level === "warn") {
            log.warn(line);
        } else if (level === "debug") {
            log.debug(line);
        } else {
            log.info(line);
        }
    }

    private emit(event: PluginHostEvent): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            } catch (error) {
                log.warn(`[plugin] host listener failed: ${messageOf(error)}`);
            }
        }
    }
}
