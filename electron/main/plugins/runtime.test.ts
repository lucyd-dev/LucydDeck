import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log/main", () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface FakePort {
    messages: unknown[];
    send: (message: unknown) => void;
}

/**
 * The worker reads `process.parentPort` once at load. Install a fake before a
 * fresh import and the real runtime, setup, handlers and teardown all run.
 */
function installPort(): FakePort {
    const messages: unknown[] = [];
    let listener: ((event: { data: unknown }) => void) | null = null;
    const port = {
        on(_event: "message", handler: (event: { data: unknown }) => void) {
            listener = handler;
        },
        postMessage(message: unknown) {
            messages.push(message);
        },
    };
    (process as unknown as { parentPort?: typeof port }).parentPort = port;
    return {
        messages,
        send(message: unknown) {
            listener?.({ data: message });
        },
    };
}

function result(messages: unknown[], id: number): Record<string, unknown> | undefined {
    return messages.find(
        (message): message is Record<string, unknown> =>
            typeof message === "object" &&
            message !== null &&
            (message as { type?: unknown }).type === "result" &&
            (message as { id?: unknown }).id === id,
    );
}

describe("plugin runtime", () => {
    let dataDir = "";

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        delete (process as unknown as { parentPort?: unknown }).parentPort;
        vi.resetModules();
    });

    it("runs the example plugin: setup, both commands, then teardown", async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-runtime-test-"));
        const port = installPort();
        vi.resetModules();
        await import("./runtime");

        port.send({
            type: "init",
            handle: "hello",
            version: "1.0.0",
            name: "Hello",
            entryPath: path.resolve("examples/plugins/hello/main.mjs"),
            dataDir,
            config: { greeting: "Hi" },
        });

        await vi.waitFor(() => {
            expect(
                port.messages.some((message) => (message as { type?: unknown }).type === "ready"),
            ).toBe(true);
        });
        const ready = port.messages.find(
            (message) => (message as { type?: unknown }).type === "ready",
        ) as { commands: Array<{ name: string; title?: string }> };
        expect(ready.commands).toEqual([
            { name: "greet", title: "Say hello" },
            { name: "fail", title: "Throw an error" },
        ]);

        port.send({ type: "invoke", id: 1, command: "greet" });
        await vi.waitFor(() => expect(result(port.messages, 1)).toMatchObject({ ok: true }));
        expect(port.messages).toContainEqual({
            type: "log",
            level: "info",
            message: "Hi from the hello plugin",
        });

        port.send({ type: "invoke", id: 2, command: "fail" });
        await vi.waitFor(() =>
            expect(result(port.messages, 2)).toMatchObject({
                ok: false,
                error: "The hello plugin failed on purpose",
            }),
        );

        port.send({ type: "teardown" });
        await vi.waitFor(() =>
            expect(
                port.messages.some(
                    (message) => (message as { type?: unknown }).type === "teardown-done",
                ),
            ).toBe(true),
        );
    });

    it("fails setup when the entry does not export setup", async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-runtime-test-"));
        const pluginDir = path.join(dataDir, "plugin");
        fs.mkdirSync(pluginDir);
        fs.writeFileSync(path.join(pluginDir, "main.mjs"), "export const x = 1;\n");

        const port = installPort();
        vi.resetModules();
        await import("./runtime");
        port.send({
            type: "init",
            handle: "bad",
            version: "1.0.0",
            name: "Bad",
            entryPath: path.join(pluginDir, "main.mjs"),
            dataDir,
            config: {},
        });

        await vi.waitFor(() =>
            expect(
                port.messages.find(
                    (message) => (message as { type?: unknown }).type === "setup-error",
                ),
            ).toMatchObject({ message: expect.stringContaining("export setup") }),
        );
    });
});
