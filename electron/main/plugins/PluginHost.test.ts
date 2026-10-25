import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginHost } from "./PluginHost";
import type { PluginProcess, PluginStartSpec } from "./PluginHost";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

class FakeProcess implements PluginProcess {
    readonly messages: unknown[] = [];
    killed = false;
    /** A real `utilityProcess.kill()` is asynchronous; tests can model that. */
    exitOnKill = true;
    private readonly messageListeners: Array<(message: unknown) => void> = [];
    private readonly exitListeners: Array<(code: number) => void> = [];

    postMessage(message: unknown): void {
        this.messages.push(message);
    }

    kill(): void {
        this.killed = true;
        if (this.exitOnKill) {
            this.exit(1);
        }
    }

    on(event: "message", listener: (message: unknown) => void): void;
    on(event: "exit", listener: (code: number) => void): void;
    on(
        event: "message" | "exit",
        listener: ((message: unknown) => void) | ((code: number) => void),
    ): void {
        if (event === "message") {
            this.messageListeners.push(listener as (message: unknown) => void);
        } else {
            this.exitListeners.push(listener as (code: number) => void);
        }
    }

    send(message: unknown): void {
        for (const listener of [...this.messageListeners]) {
            listener(message);
        }
    }

    exit(code = 0): void {
        for (const listener of [...this.exitListeners]) {
            listener(code);
        }
    }

    initMessage(): Record<string, unknown> | undefined {
        return this.messages.find(
            (message): message is Record<string, unknown> =>
                typeof message === "object" &&
                message !== null &&
                (message as { type?: unknown }).type === "init",
        );
    }
}

const spec: PluginStartSpec = {
    handle: "hello",
    entryPath: "/plugins/hello/main.mjs",
    dataDir: "/plugins/hello/data",
    version: "1.0.0",
    name: "Hello",
    config: { greeting: "Hello" },
};

describe("PluginHost", () => {
    let processes: FakeProcess[];
    let host: PluginHost;

    beforeEach(() => {
        vi.useFakeTimers();
        processes = [];
        host = new PluginHost({
            launcher: () => {
                const proc = new FakeProcess();
                processes.push(proc);
                return proc;
            },
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    function last(): FakeProcess {
        return processes[processes.length - 1]!;
    }

    it("sends the manifest entry and config to the worker", () => {
        host.start(spec);
        expect(host.status("hello")).toBe("starting");
        expect(last().initMessage()).toMatchObject({
            type: "init",
            handle: "hello",
            entryPath: "/plugins/hello/main.mjs",
            dataDir: "/plugins/hello/data",
            config: { greeting: "Hello" },
        });
    });

    it("fails and kills the process when setup exceeds five seconds", async () => {
        host.start(spec);
        await vi.advanceTimersByTimeAsync(5000);
        expect(host.status("hello")).toBe("failed");
        expect(host.error("hello")).toContain("did not start in time");
        expect(processes[0]?.killed).toBe(true);
    });

    it("reports a setup error as failed", () => {
        host.start(spec);
        last().send({ type: "setup-error", message: "boom" });
        expect(host.status("hello")).toBe("failed");
        expect(host.error("hello")).toBe("boom");
        expect(last().killed).toBe(true);
    });

    it("stores the registration snapshot on ready and filters bad names", () => {
        host.start(spec);
        last().send({
            type: "ready",
            commands: [
                { name: "go", title: "Go now" },
                { name: "also_ok" },
                { name: "Bad name" },
                { name: "go", title: "Duplicate" },
            ],
        });
        expect(host.status("hello")).toBe("running");
        expect(host.commands("hello")).toEqual([
            { name: "go", title: "Go now" },
            { name: "also_ok" },
        ]);
    });

    it("restarts an exited process at 1s, 2s and 4s, then fails", async () => {
        host.start(spec);

        processes[0]?.exit(1);
        expect(host.status("hello")).toBe("starting");
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(2);

        processes[1]?.exit(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(3);

        processes[2]?.exit(1);
        await vi.advanceTimersByTimeAsync(3000);
        expect(processes).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(4);

        processes[3]?.exit(1);
        expect(host.status("hello")).toBe("failed");
        expect(host.error("hello")).toContain("kept stopping");
        await vi.advanceTimersByTimeAsync(10_000);
        expect(processes).toHaveLength(4);
    });

    it("keeps the restart budget when a process exits soon after ready", async () => {
        host.start(spec);
        const delays = [1000, 2000, 4000];
        for (let exit = 0; exit < 4; exit += 1) {
            last().send({ type: "ready", commands: [] });
            expect(host.status("hello")).toBe("running");
            last().exit(1);
            if (exit < delays.length) {
                expect(host.status("hello")).toBe("starting");
                await vi.advanceTimersByTimeAsync(delays[exit]!);
            }
        }
        expect(host.status("hello")).toBe("failed");
        expect(host.error("hello")).toContain("kept stopping");
        expect(processes).toHaveLength(4);
    });

    it("starts a fresh restart budget after a minute of uptime", async () => {
        host.start(spec);
        processes[0]?.exit(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(2);

        last().send({ type: "ready", commands: [] });
        await vi.advanceTimersByTimeAsync(60_000);
        last().exit(1);

        expect(host.status("hello")).toBe("starting");
        // The budget reset, so the delay is the first one again.
        await vi.advanceTimersByTimeAsync(1000);
        expect(processes).toHaveLength(3);
    });

    it("ignores a late ready from a replaced process", async () => {
        host.start(spec);
        const first = last();
        first.exit(1);
        await vi.advanceTimersByTimeAsync(1000);
        const second = last();

        first.send({ type: "ready", commands: [{ name: "stale" }] });
        expect(host.status("hello")).toBe("starting");
        expect(host.commands("hello")).toEqual([]);

        second.send({ type: "ready", commands: [{ name: "go" }] });
        expect(host.status("hello")).toBe("running");
        expect(host.commands("hello")).toEqual([{ name: "go" }]);
    });

    it("ignores teardown-done from a process that was already replaced", async () => {
        host.start(spec);
        const first = last();
        first.send({ type: "ready", commands: [] });

        const stopping = host.stop("hello");
        await vi.advanceTimersByTimeAsync(2000);
        await stopping;
        await host.start(spec);
        const second = last();

        first.send({ type: "teardown-done" });
        expect(second.killed).toBe(false);
        expect(host.status("hello")).toBe("starting");
    });

    it("keeps a stop pending until the process really exits after teardown-done", async () => {
        host.start(spec);
        last().send({ type: "ready", commands: [] });
        const first = last();
        // Model `utilityProcess.kill()`: the kill request returns at once and
        // the exit event follows later.
        first.exitOnKill = false;

        const stopping = host.stop("hello");
        let settled = false;
        void stopping.then(() => {
            settled = true;
        });
        const starting = host.start(spec);

        first.send({ type: "teardown-done" });
        await vi.advanceTimersByTimeAsync(0);
        expect(first.killed).toBe(true);
        expect(settled).toBe(false);
        // Still inside the teardown deadline, but no replacement may start
        // while the old process is alive.
        await vi.advanceTimersByTimeAsync(1000);
        expect(settled).toBe(false);
        expect(processes).toHaveLength(1);

        first.exit(0);
        await stopping;
        await starting;
        expect(processes).toHaveLength(2);
        expect(host.status("hello")).toBe("starting");
    });

    it("makes a second stop await the first instead of sending another teardown", async () => {
        host.start(spec);
        last().send({ type: "ready", commands: [] });

        const first = host.stop("hello");
        const second = host.stop("hello");
        const teardowns = last().messages.filter(
            (message) => (message as { type?: unknown }).type === "teardown",
        );
        expect(teardowns).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(2000);
        await Promise.all([first, second]);
        expect(last().killed).toBe(true);
    });

    it("waits for a stop before starting the replacement process", async () => {
        host.start(spec);
        last().send({ type: "ready", commands: [] });

        const stopping = host.stop("hello");
        const starting = host.start(spec);
        await vi.advanceTimersByTimeAsync(2000);
        await Promise.all([stopping, starting]);

        expect(processes).toHaveLength(2);
        expect(processes[0]?.killed).toBe(true);
        expect(processes[1]?.killed).toBe(false);
        expect(host.status("hello")).toBe("starting");
    });

    it("kills a process whose teardown misses the deadline", async () => {
        host.start(spec);
        last().send({ type: "ready", commands: [{ name: "go" }] });
        const stopping = host.stop("hello");

        expect(host.status("hello")).toBe("stopped");
        expect(host.commands("hello")).toEqual([]);
        expect(last().messages).toContainEqual({ type: "teardown" });

        await vi.advanceTimersByTimeAsync(2000);
        await stopping;
        expect(processes[0]?.killed).toBe(true);
    });

    it("resolves the handler result and rejects a handler error", async () => {
        host.start(spec);
        last().send({ type: "ready", commands: [{ name: "go" }] });

        const ok = host.invoke("hello", "go");
        const okMessage = last().messages.find(
            (message) => (message as { type?: unknown }).type === "invoke",
        ) as { id: number };
        last().send({ type: "result", id: okMessage.id, ok: true });
        await expect(ok).resolves.toBeUndefined();

        const failure = host.invoke("hello", "go");
        const failMessage = last()
            .messages.filter((message) => (message as { type?: unknown }).type === "invoke")
            .pop() as { id: number };
        last().send({ type: "result", id: failMessage.id, ok: false, error: "nope" });
        await expect(failure).rejects.toThrow("nope");
    });

    it("refuses to invoke a plugin that is not running", async () => {
        await expect(host.invoke("hello", "go")).rejects.toThrow("not running");
    });

    it("stops every process on demand", async () => {
        host.start(spec);
        const other = { ...spec, handle: "other" };
        host.start(other);
        const stopping = host.stopAll();
        await vi.advanceTimersByTimeAsync(2000);
        await stopping;
        expect(host.status("hello")).toBe("stopped");
        expect(host.status("other")).toBe("stopped");
    });
});
