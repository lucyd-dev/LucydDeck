import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCommand, PluginStatus } from "@shared/plugins";
import { CommandRouter } from "./CommandRouter";
import type { CommandTarget } from "./CommandRouter";

vi.mock("electron-log/main", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

class FakeTarget implements CommandTarget {
    readonly statuses = new Map<string, PluginStatus>();
    readonly commandMap = new Map<string, PluginCommand[]>();
    readonly calls: string[] = [];
    readonly handlers = new Map<string, () => Promise<void>>();

    status(handle: string): PluginStatus {
        return this.statuses.get(handle) ?? "stopped";
    }

    commands(handle: string): PluginCommand[] {
        return this.commandMap.get(handle) ?? [];
    }

    invoke(handle: string, command: string): Promise<void> {
        this.calls.push(`${handle}:${command}`);
        return this.handlers.get(`${handle}:${command}`)?.() ?? Promise.resolve();
    }

    serve(handle: string, ...names: string[]): void {
        this.statuses.set(handle, "running");
        this.commandMap.set(
            handle,
            names.map((name) => ({ name })),
        );
    }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve = (): void => undefined;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("CommandRouter", () => {
    const notify = vi.fn();
    const logLine = vi.fn();
    let target: FakeTarget;
    let router: CommandRouter;

    function create(now?: () => number): CommandRouter {
        target = new FakeTarget();
        return new CommandRouter({
            usb: { onEvent: () => () => undefined },
            target,
            notify,
            logLine,
            ...(now === undefined ? {} : { now }),
        });
    }

    afterEach(() => {
        notify.mockClear();
        logLine.mockClear();
        vi.useRealTimers();
    });

    it("routes handle:command to the target", async () => {
        router = create();
        target.serve("obs", "go");
        router.route("obs:go");
        await vi.waitFor(() => expect(target.calls).toEqual(["obs:go"]));
    });

    it("drops a body with no colon and reports it once", async () => {
        let clock = 0;
        router = create(() => clock);
        router.route("explorer.exe");
        router.route("explorer.exe");
        clock += 6000;
        router.route("explorer.exe");
        expect(notify).toHaveBeenCalledTimes(2);
        expect(target.calls).toEqual([]);
    });

    it("drops an unknown, disabled or failed plugin with a warning", () => {
        const clock = 0;
        router = create(() => clock);
        router.route("missing:go");
        expect(notify).toHaveBeenCalledWith("warning", expect.stringContaining("missing"));

        target.statuses.set("off", "stopped");
        router.route("off:go");
        target.statuses.set("bad", "failed");
        router.route("bad:go");

        expect(notify).toHaveBeenCalledWith("warning", expect.stringContaining("off"));
        expect(notify).toHaveBeenCalledWith("warning", expect.stringContaining("bad"));
        expect(target.calls).toEqual([]);
    });

    it("runs handlers one at a time", async () => {
        router = create();
        target.serve("hello", "one", "two");
        const first = deferred();
        target.handlers.set("hello:one", () => first.promise);

        router.route("hello:one");
        router.route("hello:two");
        await vi.waitFor(() => expect(target.calls).toEqual(["hello:one"]));

        first.resolve();
        await vi.waitFor(() => expect(target.calls).toEqual(["hello:one", "hello:two"]));
    });

    it("holds commands for a starting plugin and drains when it runs", async () => {
        router = create();
        target.statuses.set("hello", "starting");
        router.route("hello:go");
        expect(target.calls).toEqual([]);

        target.serve("hello", "go");
        router.resume("hello");
        await vi.waitFor(() => expect(target.calls).toEqual(["hello:go"]));
    });

    it("caps the queue at 16 and drops the newest", async () => {
        router = create();
        target.statuses.set("hello", "starting");
        const names = Array.from({ length: 17 }, (_, index) => `c${index + 1}`);
        for (const name of names) {
            router.route(`hello:${name}`);
        }
        expect(notify).toHaveBeenCalledWith("warning", expect.stringContaining("too many"));

        target.serve("hello", ...names);
        router.resume("hello");
        await vi.waitFor(() => expect(target.calls).toHaveLength(16));
        expect(target.calls).not.toContain("hello:c17");
    });

    it("drops a command the plugin did not register", async () => {
        router = create();
        target.serve("hello", "known");
        router.route("hello:unknown");
        await vi.waitFor(() =>
            expect(logLine).toHaveBeenCalledWith(
                "hello",
                "warn",
                expect.stringContaining("does not register"),
            ),
        );
        expect(target.calls).toEqual([]);
    });

    it("logs a deck handler error and does not notify", async () => {
        router = create();
        target.serve("hello", "go");
        target.handlers.set("hello:go", () => Promise.reject(new Error("boom")));
        router.route("hello:go");
        await vi.waitFor(() =>
            expect(logLine).toHaveBeenCalledWith("hello", "error", expect.stringContaining("boom")),
        );
        expect(notify).not.toHaveBeenCalled();
    });

    it("returns a manual handler error to the caller", async () => {
        router = create();
        target.serve("hello", "go");
        target.handlers.set("hello:go", () => Promise.reject(new Error("boom")));
        await expect(router.invoke("hello", "go")).rejects.toThrow("boom");
    });

    it("frees the queue after the ten second handler timeout", async () => {
        vi.useFakeTimers();
        router = create();
        target.serve("hello", "slow", "next");
        target.handlers.set("hello:slow", () => new Promise<void>(() => undefined));

        router.route("hello:slow");
        router.route("hello:next");
        await vi.advanceTimersByTimeAsync(0);
        expect(target.calls).toEqual(["hello:slow"]);

        await vi.advanceTimersByTimeAsync(10_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(target.calls).toEqual(["hello:slow", "hello:next"]);
        expect(logLine).toHaveBeenCalledWith(
            "hello",
            "warn",
            expect.stringContaining("did not finish"),
        );
    });
});
