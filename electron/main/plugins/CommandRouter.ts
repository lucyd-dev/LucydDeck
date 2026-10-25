import log from "electron-log/main";
import { isPluginCommandName, isPluginHandle } from "@shared/plugins";
import type { PluginCommand, PluginStatus } from "@shared/plugins";
import type { UsbEventPayload } from "@shared/ipc";

/**
 * Route deck `0xA0` action bodies into plugin handlers.
 *
 * The firmware strips the `CMD:` prefix, so the host sees `<handle>:<command>`.
 * The deck never waits for a result: a failed handler is logged and forgotten.
 * `invoke()` is the one result-returning path, used by the Plugins view's Run
 * button so a manual run can show the handler's error.
 *
 * Handlers run serially per plugin. A queue of 16 holds pending commands and
 * the newest is dropped when it is full. A handler that exceeds ten seconds
 * frees the queue and logs; the process keeps working.
 */

export interface CommandTarget {
    status(handle: string): PluginStatus;
    commands(handle: string): PluginCommand[];
    invoke(handle: string, command: string): Promise<void>;
}

export interface CommandSource {
    onEvent(listener: (event: UsbEventPayload) => void): () => void;
}

export interface CommandRouterOptions {
    usb: CommandSource;
    target: CommandTarget;
    /** User-visible warning; rate-limited per message. */
    notify?: (level: "warning" | "error", message: string) => void;
    /** Test seam; defaults to electron-log. */
    logLine?: (handle: string, level: "info" | "warn" | "error", message: string) => void;
    handlerTimeoutMs?: number;
    queueLimit?: number;
    toastWindowMs?: number;
    now?: () => number;
}

interface Job {
    command: string;
    viaDeck: boolean;
    resolve: () => void;
    reject: (error: Error) => void;
}

const DEFAULTS = {
    handlerTimeoutMs: 10_000,
    queueLimit: 16,
    toastWindowMs: 5_000,
} as const;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

export class CommandRouter {
    private readonly usb: CommandSource;
    private readonly target: CommandTarget;
    private readonly notify: (level: "warning" | "error", message: string) => void;
    private readonly logLine: (
        handle: string,
        level: "info" | "warn" | "error",
        message: string,
    ) => void;
    private readonly handlerTimeoutMs: number;
    private readonly queueLimit: number;
    private readonly toastWindowMs: number;
    private readonly now: () => number;
    private readonly queues = new Map<string, Job[]>();
    private readonly draining = new Set<string>();
    private readonly lastToast = new Map<string, number>();
    private unsubscribe: (() => void) | null = null;

    constructor(options: CommandRouterOptions) {
        this.usb = options.usb;
        this.target = options.target;
        this.notify = options.notify ?? (() => undefined);
        this.handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULTS.handlerTimeoutMs;
        this.queueLimit = options.queueLimit ?? DEFAULTS.queueLimit;
        this.toastWindowMs = options.toastWindowMs ?? DEFAULTS.toastWindowMs;
        this.now = options.now ?? Date.now;
        this.logLine =
            options.logLine ??
            ((handle, level, message) => {
                const line = `[plugin:${handle}] ${message}`;
                if (level === "error") {
                    log.error(line);
                } else if (level === "warn") {
                    log.warn(line);
                } else {
                    log.info(line);
                }
            });
    }

    /** Start listening to the deck. Returns the unsubscribe function. */
    start(): () => void {
        if (this.unsubscribe !== null) {
            return this.unsubscribe;
        }
        this.unsubscribe = this.usb.onEvent((event) => {
            if (event.type === "action-triggered") {
                this.route(event.action);
            }
        });
        return this.unsubscribe;
    }

    /** Split a deck action body at the first colon and route it. */
    route(body: string): void {
        const separator = body.indexOf(":");
        if (separator <= 0 || separator === body.length - 1) {
            this.drop(body, `"${body}" is not a plugin command; expected handle:command`);
            return;
        }
        const handle = body.slice(0, separator);
        const command = body.slice(separator + 1);
        if (!isPluginHandle(handle)) {
            this.drop(body, `"${handle}" is not a valid plugin handle`);
            return;
        }
        if (!isPluginCommandName(command)) {
            this.drop(body, `"${command}" is not a valid plugin command name`);
            return;
        }

        const status = this.target.status(handle);
        if (status === "stopped" || status === "failed") {
            this.warn(
                `Plugin "${handle}" is ${status === "failed" ? "failed" : "not running"}, ` +
                    `so "${command}" was dropped.`,
            );
            this.logLine(handle, "warn", `dropped "${command}": plugin is ${status}`);
            return;
        }

        this.enqueue(handle, command, true).catch(() => undefined);
    }

    /** Run one command by hand and surface its failure to the caller. */
    async invoke(handle: string, command: string): Promise<void> {
        if (!isPluginHandle(handle) || !isPluginCommandName(command)) {
            throw new Error("Expected a plugin handle and a command name");
        }
        const status = this.target.status(handle);
        if (status === "stopped" || status === "failed") {
            throw new Error(
                `Plugin "${handle}" is ${status === "failed" ? "failed" : "not running"}`,
            );
        }
        await this.enqueue(handle, command, false);
    }

    /** Let a queue resume after its plugin changed status. */
    resume(handle: string): void {
        void this.drain(handle);
    }

    private enqueue(handle: string, command: string, viaDeck: boolean): Promise<void> {
        const queue = this.queues.get(handle) ?? [];
        if (queue.length >= this.queueLimit) {
            const message = `Plugin "${handle}" has too many pending commands; "${command}" was dropped.`;
            this.logLine(handle, "warn", message);
            if (viaDeck) {
                this.warn(message);
            }
            return Promise.reject(new Error(message));
        }
        return new Promise<void>((resolve, reject) => {
            queue.push({ command, viaDeck, resolve, reject });
            this.queues.set(handle, queue);
            void this.drain(handle);
        });
    }

    private async drain(handle: string): Promise<void> {
        if (this.draining.has(handle)) {
            return;
        }
        this.draining.add(handle);
        try {
            for (;;) {
                const queue = this.queues.get(handle);
                if (queue === undefined || queue.length === 0) {
                    break;
                }
                if (this.target.status(handle) !== "running") {
                    // A starting plugin will call resume(); a failed or
                    // stopped one must not leave the queue hanging forever.
                    if (this.target.status(handle) === "starting") {
                        break;
                    }
                    this.rejectQueue(handle, queue);
                    break;
                }
                const job = queue.shift()!;
                await this.run(handle, job);
            }
        } finally {
            this.draining.delete(handle);
        }
    }

    private rejectQueue(handle: string, queue: Job[]): void {
        const dropped = queue.splice(0, queue.length);
        const status = this.target.status(handle);
        for (const job of dropped) {
            const message = `Plugin "${handle}" is ${status === "failed" ? "failed" : "not running"}; "${job.command}" was dropped.`;
            this.logLine(handle, "warn", message);
            if (job.viaDeck) {
                this.warn(message);
                job.resolve();
            } else {
                job.reject(new Error(message));
            }
        }
    }

    private async run(handle: string, job: Job): Promise<void> {
        if (!this.target.commands(handle).some((item) => item.name === job.command)) {
            const message = `Plugin "${handle}" does not register "${job.command}".`;
            this.logLine(handle, "warn", message);
            if (job.viaDeck) {
                this.warn(message);
                job.resolve();
            } else {
                job.reject(new Error(message));
            }
            return;
        }

        try {
            await withTimeout(
                this.target.invoke(handle, job.command),
                this.handlerTimeoutMs,
                `"${job.command}" did not finish within ${this.handlerTimeoutMs / 1000} seconds`,
            );
            job.resolve();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("did not finish within")) {
                this.logLine(handle, "warn", message);
            } else {
                this.logLine(handle, "error", `command "${job.command}" failed: ${message}`);
            }
            // The deck is not listening; a manual run shows the error.
            if (job.viaDeck) {
                job.resolve();
            } else {
                job.reject(error instanceof Error ? error : new Error(message));
            }
        }
    }

    private drop(body: string, message: string): void {
        this.warn(message);
        log.warn(`[plugin] dropped deck action "${body}": ${message}`);
    }

    private warn(message: string): void {
        const now = this.now();
        const last = this.lastToast.get(message);
        if (last !== undefined && now - last < this.toastWindowMs) {
            return;
        }
        this.lastToast.set(message, now);
        this.notify("warning", message);
    }
}
