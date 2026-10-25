import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { PluginEventPayload, PluginMeta } from "@shared/ipc";
import { pluginsClient } from "@/ipc/client";
import { usePluginStore } from "./pluginStore";

const mocks = vi.hoisted(() => ({
    listeners: new Map<string, (payload: unknown) => void>(),
    pushToast: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
    pluginsClient: {
        list: vi.fn(),
        inspect: vi.fn(),
        install: vi.fn(),
        setEnabled: vi.fn(),
        restart: vi.fn(),
        remove: vi.fn(),
        getConfig: vi.fn(),
        setConfig: vi.fn(),
        invoke: vi.fn(),
    },
}));

vi.mock("@/ipc/events", () => ({
    eventChannels: { plugin: "plugin:event" },
    on: (channel: string, handler: (payload: unknown) => void) => {
        mocks.listeners.set(channel, handler);
        return 1;
    },
}));

vi.mock("@/stores/appStore", () => ({
    useAppStore: () => ({ pushToast: mocks.pushToast }),
}));

function meta(overrides: Partial<PluginMeta> = {}): PluginMeta {
    return {
        handle: "hello",
        name: "Hello",
        description: "Example",
        version: "1.0.0",
        apiVersion: 1,
        iconDataUrl: null,
        enabled: true,
        status: "running",
        error: null,
        commands: [{ name: "greet", title: "Say hello" }],
        hasConfig: true,
        ...overrides,
    };
}

function emit(payload: PluginEventPayload): void {
    mocks.listeners.get("plugin:event")?.(payload);
}

describe("pluginStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mocks.listeners.clear();
        vi.resetAllMocks();
        vi.mocked(pluginsClient.list).mockResolvedValue({ ok: true, data: [meta()] });
    });

    it("loads the list and maps it to picker registrations", async () => {
        vi.mocked(pluginsClient.list).mockResolvedValue({
            ok: true,
            data: [meta({ iconDataUrl: "data:image/png;base64,AAAA" })],
        });
        const store = usePluginStore();
        await store.init();

        expect(store.plugins).toHaveLength(1);
        expect(store.registrations()).toEqual([
            {
                handle: "hello",
                label: "Hello",
                iconDataUrl: "data:image/png;base64,AAAA",
                commands: [{ command: "greet", title: "Say hello" }],
            },
        ]);
    });

    it("keeps a disabled plugin row with no commands", async () => {
        vi.mocked(pluginsClient.list).mockResolvedValue({
            ok: true,
            data: [meta({ enabled: false, status: "stopped" })],
        });
        const store = usePluginStore();
        await store.init();

        expect(store.registrations()).toEqual([
            { handle: "hello", label: "Hello", iconDataUrl: null, commands: [] },
        ]);
    });

    it("applies status pushes and clears commands until it runs again", async () => {
        const store = usePluginStore();
        await store.init();

        emit({ type: "status", handle: "hello", status: "failed", error: "boom" });
        expect(store.plugins[0]?.status).toBe("failed");
        expect(store.plugins[0]?.commands).toEqual([]);

        emit({ type: "registrations" });
        await vi.waitFor(() => expect(store.registrationRevision).toBe(1));
        expect(pluginsClient.list).toHaveBeenCalledTimes(2);
    });

    it("stores config snapshots and sends sanitized values", async () => {
        vi.mocked(pluginsClient.getConfig).mockResolvedValue({
            ok: true,
            data: { handle: "hello", fields: [], values: { greeting: "Hello" } },
        });
        vi.mocked(pluginsClient.setConfig).mockResolvedValue({
            ok: true,
            data: { handle: "hello", fields: [], values: { greeting: "Hi" } },
        });

        const store = usePluginStore();
        await store.init();
        await store.getConfig("hello");
        expect(store.configs.hello?.values).toEqual({ greeting: "Hello" });

        const saved = await store.setConfig("hello", { greeting: "Hi" });
        expect(saved?.values).toEqual({ greeting: "Hi" });
        expect(store.configs.hello?.values).toEqual({ greeting: "Hi" });
    });

    it("keeps a plugin log error on its row and out of the global banner", async () => {
        const store = usePluginStore();
        await store.init();

        emit({ type: "log", handle: "hello", level: "error", message: "handler exploded" });

        expect(store.logErrors.hello).toBe("handler exploded");
        expect(store.lastError).toBeNull();
    });

    it("clears a stale banner when the list refreshes", async () => {
        vi.mocked(pluginsClient.list).mockResolvedValueOnce({
            ok: false,
            error: "list failed",
        });
        const store = usePluginStore();
        await store.init();
        expect(store.lastError).toBe("list failed");

        await store.refresh();
        expect(store.lastError).toBeNull();
    });

    it("clears the banner and the row error after a successful run", async () => {
        vi.mocked(pluginsClient.invoke).mockResolvedValueOnce({ ok: false, error: "boom" });
        const store = usePluginStore();
        await store.init();
        await store.invoke("hello", "greet");
        expect(store.lastError).toBe("boom");

        emit({ type: "log", handle: "hello", level: "error", message: "log boom" });
        expect(store.logErrors.hello).toBe("log boom");

        vi.mocked(pluginsClient.invoke).mockResolvedValueOnce({ ok: true, data: undefined });
        await store.invoke("hello", "greet");
        expect(store.lastError).toBeNull();
        expect(store.logErrors.hello).toBeUndefined();
    });

    it("shows the handler error returned by a manual run", async () => {
        vi.mocked(pluginsClient.invoke).mockResolvedValue({ ok: false, error: "boom" });
        const store = usePluginStore();
        await store.init();

        expect(await store.invoke("hello", "greet")).toBe("boom");
        expect(store.lastError).toBe("boom");
    });

    it("names why a CMD step would do nothing", async () => {
        const store = usePluginStore();
        await store.init();

        expect(store.commandProblem("missing", "go")).toBe(
            "This action needs a plugin that is not installed.",
        );
        expect(store.commandProblem("hello", "unknown")).toBe(
            "Hello does not offer this action anymore.",
        );

        emit({ type: "status", handle: "hello", status: "stopped", error: null });
        expect(store.commandProblem("hello", "greet")).toBe(
            "This action needs Hello, which is not running.",
        );
    });
});
