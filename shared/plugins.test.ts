import { describe, expect, it } from "vitest";
import {
    PLUGIN_API_VERSION,
    PLUGIN_HANDLE_PATTERN,
    isConfigKey,
    isPluginCommandName,
    isPluginHandle,
    isSemverCore,
    humanizePluginCommandName,
    pluginRowId,
    sanitizePluginConfig,
    validatePluginManifest,
} from "./plugins";
import type { PluginConfigField } from "./plugins";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        apiVersion: 1,
        handle: "hello",
        name: "Hello",
        version: "1.0.0",
        main: "main.mjs",
        ...overrides,
    };
}

describe("grammar helpers", () => {
    it("accepts 2 to 32 lower-case characters and rejects the rest", () => {
        expect(PLUGIN_HANDLE_PATTERN.test("obs")).toBe(true);
        expect(isPluginHandle("obs_studio-2")).toBe(true);
        expect(isPluginHandle("a")).toBe(false);
        expect(isPluginHandle("Obs")).toBe(false);
        expect(isPluginHandle("1obs")).toBe(false);
        expect(isPluginHandle("obs studio")).toBe(false);
        expect(isPluginHandle("a".repeat(32))).toBe(true);
        expect(isPluginHandle("a".repeat(33))).toBe(false);
        expect(isPluginHandle(null)).toBe(false);
    });

    it("applies the handle grammar to command names", () => {
        expect(isPluginCommandName("start_recording")).toBe(true);
        expect(isPluginCommandName("scene:next")).toBe(false);
        expect(isPluginCommandName("A")).toBe(false);
    });

    it("accepts exactly three numeric version parts", () => {
        expect(isSemverCore("1.0.0")).toBe(true);
        expect(isSemverCore("10.20.30")).toBe(true);
        expect(isSemverCore("1.0")).toBe(false);
        expect(isSemverCore("1.0.0-beta")).toBe(false);
        expect(isSemverCore("1.0.x")).toBe(false);
    });

    it("accepts safe config keys only", () => {
        expect(isConfigKey("greeting")).toBe(true);
        expect(isConfigKey("_hidden")).toBe(false);
        expect(isConfigKey("has space")).toBe(false);
        expect(isConfigKey("__proto__")).toBe(false);
        expect(isConfigKey("constructor")).toBe(false);
        expect(isConfigKey("prototype")).toBe(false);
    });

    it("prefixes picker row ids", () => {
        expect(pluginRowId("obs")).toBe("plugin:obs");
    });

    it("humanizes a command name when it has no title", () => {
        expect(humanizePluginCommandName("start_recording")).toBe("Start recording");
        expect(humanizePluginCommandName("scene-next")).toBe("Scene next");
        expect(humanizePluginCommandName("mute")).toBe("Mute");
    });
});

describe("validatePluginManifest", () => {
    it("accepts a minimal manifest and fills configFields", () => {
        const result = validatePluginManifest(manifest());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.handle).toBe("hello");
            expect(result.manifest.name).toBe("Hello");
            expect(result.manifest.configFields).toEqual([]);
        }
    });

    it("accepts the documented config field kinds", () => {
        const result = validatePluginManifest(
            manifest({
                configFields: [
                    { key: "text", label: "Text", kind: "text", default: "x" },
                    { key: "body", label: "Body", kind: "textarea" },
                    { key: "count", label: "Count", kind: "number", default: 3 },
                    { key: "on", label: "On", kind: "boolean", default: false },
                    {
                        key: "level",
                        label: "Level",
                        kind: "select",
                        options: [{ value: "a", label: "A" }],
                        default: "a",
                    },
                    { key: "token", label: "Token", kind: "secret" },
                ],
            }),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.configFields.map((field) => field.kind)).toEqual([
                "text",
                "textarea",
                "number",
                "boolean",
                "select",
                "secret",
            ]);
        }
    });

    it("refuses a newer apiVersion", () => {
        const result = validatePluginManifest(manifest({ apiVersion: PLUGIN_API_VERSION + 1 }));
        expect(result).toEqual({
            ok: false,
            error: `apiVersion 2 is newer than this build supports (1)`,
        });
    });

    it("requires every mandatory field", () => {
        for (const field of ["apiVersion", "handle", "name", "version", "main"]) {
            const value = manifest();
            delete value[field];
            expect(validatePluginManifest(value).ok).toBe(false);
        }
    });

    it("rejects a bad handle, name or version", () => {
        expect(validatePluginManifest(manifest({ handle: "Hello" })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ name: "  " })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ version: "1.0" })).ok).toBe(false);
    });

    it("rejects an entry that is not a relative .mjs file", () => {
        expect(validatePluginManifest(manifest({ main: "main.js" })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ main: "../main.mjs" })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ main: "/tmp/main.mjs" })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ icon: "C:/icon.png" })).ok).toBe(false);
    });

    it("checks each default against its field kind", () => {
        expect(
            validatePluginManifest(
                manifest({
                    configFields: [{ key: "count", label: "Count", kind: "number", default: "3" }],
                }),
            ).ok,
        ).toBe(false);
        expect(
            validatePluginManifest(
                manifest({
                    configFields: [{ key: "on", label: "On", kind: "boolean", default: "yes" }],
                }),
            ).ok,
        ).toBe(false);
        expect(
            validatePluginManifest(
                manifest({
                    configFields: [{ key: "name", label: "Name", kind: "text", default: 1 }],
                }),
            ).ok,
        ).toBe(false);
    });

    it("requires options for a select and rejects duplicate keys", () => {
        expect(
            validatePluginManifest(
                manifest({ configFields: [{ key: "level", label: "Level", kind: "select" }] }),
            ).ok,
        ).toBe(false);
        expect(
            validatePluginManifest(
                manifest({
                    configFields: [
                        { key: "one", label: "One", kind: "text" },
                        { key: "one", label: "Again", kind: "text" },
                    ],
                }),
            ).ok,
        ).toBe(false);
    });

    it("rejects a select default outside its options", () => {
        const field = (defaultValue: string) => ({
            key: "level",
            label: "Level",
            kind: "select",
            options: [{ value: "a", label: "A" }],
            default: defaultValue,
        });
        expect(validatePluginManifest(manifest({ configFields: [field("b")] })).ok).toBe(false);
        expect(validatePluginManifest(manifest({ configFields: [field("a")] })).ok).toBe(true);
    });

    it("rejects config keys that would poison an object", () => {
        expect(
            validatePluginManifest(
                manifest({ configFields: [{ key: "__proto__", label: "X", kind: "text" }] }),
            ).ok,
        ).toBe(false);
    });
});

describe("sanitizePluginConfig", () => {
    const fields: PluginConfigField[] = [
        { key: "greeting", label: "Greeting", kind: "text", default: "Hello" },
        { key: "count", label: "Count", kind: "number" },
        { key: "enabled", label: "Enabled", kind: "boolean", default: true },
    ];

    it("applies defaults and drops unknown keys", () => {
        const result = sanitizePluginConfig(fields, { stranger: "dropped" });
        expect(result.values).toEqual({ greeting: "Hello", enabled: true });
        expect(result.ok).toBe(true);
    });

    it("coerces form strings for number fields", () => {
        const result = sanitizePluginConfig(fields, { greeting: "Hi", count: "42" });
        expect(result.values.count).toBe(42);
    });

    it("reports a non-numeric number and a missing required value", () => {
        const required: PluginConfigField[] = [
            { key: "name", label: "Name", kind: "text", required: true },
            { key: "count", label: "Count", kind: "number" },
        ];
        const result = sanitizePluginConfig(required, { count: "many" });
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual(["Name is required", "Count must be a number"]);
    });

    it("treats a blank required text value as missing", () => {
        const result = sanitizePluginConfig(
            [{ key: "name", label: "Name", kind: "text", required: true }],
            { name: "   " },
        );
        expect(result.ok).toBe(false);
    });

    it("rejects a select value that is not one of its options", () => {
        const fields: PluginConfigField[] = [
            {
                key: "level",
                label: "Level",
                kind: "select",
                options: [
                    { value: "a", label: "A" },
                    { value: "b", label: "B" },
                ],
                default: "a",
            },
        ];
        expect(sanitizePluginConfig(fields, { level: "c" })).toMatchObject({
            ok: false,
            errors: ["Level must be one of a, b"],
        });
        expect(sanitizePluginConfig(fields, { level: "b" }).values).toEqual({ level: "b" });
        expect(sanitizePluginConfig(fields, {}).values).toEqual({ level: "a" });
    });
});
