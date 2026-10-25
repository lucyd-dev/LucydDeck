// ---------------------------------------------------------------------------
// Plugin contract shared by the main process, the renderer and the worker
// runtime. Pure: no node or electron imports.
//
// A plugin is a folder with `plugin.json` and an ESM entry. Its handle is the
// only identity: the folder name, the IPC id and the first part of
// `CMD:<handle>:<command>` all use it. ADR 0007 records the trust decision.
// ---------------------------------------------------------------------------

/** Only API version this build understands. A newer manifest is refused. */
export const PLUGIN_API_VERSION = 1;

/** Handle and command grammar: 2 to 32 characters, starting with a letter. */
export const PLUGIN_HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

/** Three numeric parts, such as `1.2.3`. */
const SEMVER_CORE_PATTERN = /^\d+\.\d+\.\d+$/;

/** Config keys become object properties, so the grammar excludes odd names. */
const CONFIG_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const FORBIDDEN_CONFIG_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const PLUGIN_CONFIG_KINDS = [
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "secret",
] as const;

export type PluginConfigKind = (typeof PLUGIN_CONFIG_KINDS)[number];

export interface PluginConfigOption {
    value: string;
    label: string;
}

/** One value the Plugins view asks the user to fill in. */
export interface PluginConfigField {
    key: string;
    label: string;
    kind: PluginConfigKind;
    description?: string;
    required?: boolean;
    default?: PluginConfigValue;
    /** Required for `select`. */
    options?: PluginConfigOption[];
}

export type PluginConfigValue = string | number | boolean;

export type PluginConfigValues = Record<string, PluginConfigValue>;

/** `plugin.json` as the host reads it after validation. */
export interface PluginManifest {
    apiVersion: number;
    handle: string;
    name: string;
    version: string;
    description?: string;
    /** File name inside the plugin folder. */
    icon?: string;
    /** ESM entry file inside the plugin folder. */
    main: string;
    configFields: PluginConfigField[];
}

/** Where a plugin's process is. A failed plugin stays installed and enabled. */
export type PluginStatus = "stopped" | "starting" | "running" | "failed";

/** One command a plugin registered during `setup`. */
export interface PluginCommand {
    name: string;
    title?: string;
}

export type ManifestValidation =
    { ok: true; manifest: PluginManifest } | { ok: false; error: string };

export function isPluginHandle(value: unknown): value is string {
    return typeof value === "string" && PLUGIN_HANDLE_PATTERN.test(value);
}

/** Command names use the handle grammar. */
export function isPluginCommandName(value: unknown): value is string {
    return typeof value === "string" && PLUGIN_HANDLE_PATTERN.test(value);
}

export function isSemverCore(value: unknown): value is string {
    return typeof value === "string" && SEMVER_CORE_PATTERN.test(value);
}

export function isConfigKey(value: unknown): value is string {
    return (
        typeof value === "string" &&
        CONFIG_KEY_PATTERN.test(value) &&
        !FORBIDDEN_CONFIG_KEYS.has(value)
    );
}

/** Picker row id for a plugin; the prefix keeps it clear of the built-in rows. */
export function pluginRowId(handle: string): string {
    return `plugin:${handle}`;
}

/**
 * Human-readable fallback for a command with no title: separators become
 * spaces and the first letter is capitalised (`start_recording` reads
 * "Start recording"). The command name itself is never shown as an id.
 */
export function humanizePluginCommandName(name: string): string {
    const words = name.replace(/[_-]+/g, " ").trim();
    if (words === "") {
        return name;
    }
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relativeFileName(value: unknown): value is string {
    if (typeof value !== "string" || value.trim() === "") {
        return false;
    }
    if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
        return false;
    }
    return !value.split(/[\\/]/).includes("..");
}

function isConfigValueOfKind(kind: PluginConfigKind, value: unknown): value is PluginConfigValue {
    switch (kind) {
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "boolean":
            return typeof value === "boolean";
        default:
            return typeof value === "string";
    }
}

function validateConfigField(value: unknown, index: number): string | null {
    const where = `configFields[${index}]`;
    if (!isRecord(value)) {
        return `${where} must be an object`;
    }
    if (!isConfigKey(value.key)) {
        return `${where}.key must be 1 to 32 letters, digits or underscores, starting with a letter`;
    }
    if (typeof value.label !== "string" || value.label.trim() === "") {
        return `${where}.label must be a non-empty string`;
    }
    if (
        typeof value.kind !== "string" ||
        !(PLUGIN_CONFIG_KINDS as readonly string[]).includes(value.kind)
    ) {
        return `${where}.kind must be one of ${PLUGIN_CONFIG_KINDS.join(", ")}`;
    }
    const kind = value.kind as PluginConfigKind;
    if (value.description !== undefined && typeof value.description !== "string") {
        return `${where}.description must be a string`;
    }
    if (value.required !== undefined && typeof value.required !== "boolean") {
        return `${where}.required must be a boolean`;
    }
    if (kind === "select") {
        if (!Array.isArray(value.options) || value.options.length === 0) {
            return `${where}.options must list at least one option`;
        }
        for (const [optionIndex, option] of value.options.entries()) {
            if (
                !isRecord(option) ||
                typeof option.value !== "string" ||
                typeof option.label !== "string"
            ) {
                return `${where}.options[${optionIndex}] must have a string value and label`;
            }
        }
    }
    if (value.default !== undefined && !isConfigValueOfKind(kind, value.default)) {
        return `${where}.default must match a ${kind} value`;
    }
    if (kind === "select" && typeof value.default === "string") {
        const options = value.options as Array<{ value: string }>;
        if (!options.some((option) => option.value === value.default)) {
            return `${where}.default must be one of its options`;
        }
    }
    return null;
}

/**
 * Validate a parsed `plugin.json`. Filesystem facts (entry exists, size limit)
 * belong to the main-process manifest reader, not here.
 */
export function validatePluginManifest(value: unknown): ManifestValidation {
    if (!isRecord(value)) {
        return { ok: false, error: "plugin.json must be a JSON object" };
    }

    const apiVersion = value.apiVersion;
    if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion) || apiVersion < 1) {
        return { ok: false, error: "apiVersion must be a positive integer" };
    }
    if (apiVersion > PLUGIN_API_VERSION) {
        return {
            ok: false,
            error: `apiVersion ${apiVersion} is newer than this build supports (${PLUGIN_API_VERSION})`,
        };
    }

    if (!isPluginHandle(value.handle)) {
        return {
            ok: false,
            error: "handle must match ^[a-z][a-z0-9_-]{1,31}$",
        };
    }
    if (typeof value.name !== "string" || value.name.trim() === "") {
        return { ok: false, error: "name must be a non-empty string" };
    }
    if (value.name.length > 80) {
        return { ok: false, error: "name must be at most 80 characters" };
    }
    if (!isSemverCore(value.version)) {
        return { ok: false, error: "version must be three numeric parts, such as 1.2.3" };
    }
    if (value.description !== undefined && typeof value.description !== "string") {
        return { ok: false, error: "description must be a string" };
    }
    if (!relativeFileName(value.main)) {
        return { ok: false, error: "main must be a file path inside the plugin folder" };
    }
    if (!/\.mjs$/i.test(value.main)) {
        return { ok: false, error: "main must be an .mjs entry file" };
    }
    if (value.icon !== undefined && !relativeFileName(value.icon)) {
        return { ok: false, error: "icon must be a file path inside the plugin folder" };
    }

    const configFields: PluginConfigField[] = [];
    if (value.configFields !== undefined) {
        if (!Array.isArray(value.configFields)) {
            return { ok: false, error: "configFields must be an array" };
        }
        const keys = new Set<string>();
        for (const [index, field] of value.configFields.entries()) {
            const error = validateConfigField(field, index);
            if (error !== null) {
                return { ok: false, error };
            }
            const valid = field as PluginConfigField;
            if (keys.has(valid.key)) {
                return { ok: false, error: `configFields has a duplicate key "${valid.key}"` };
            }
            keys.add(valid.key);
            configFields.push({
                key: valid.key,
                label: valid.label,
                kind: valid.kind,
                ...(valid.description === undefined ? {} : { description: valid.description }),
                ...(valid.required === undefined ? {} : { required: valid.required }),
                ...(valid.default === undefined ? {} : { default: valid.default }),
                ...(valid.options === undefined
                    ? {}
                    : {
                          options: valid.options.map((option) => ({
                              value: option.value,
                              label: option.label,
                          })),
                      }),
            });
        }
    }

    return {
        ok: true,
        manifest: {
            apiVersion,
            handle: value.handle,
            name: value.name.trim(),
            version: value.version,
            ...(value.description === undefined ? {} : { description: value.description }),
            ...(value.icon === undefined ? {} : { icon: value.icon }),
            main: value.main,
            configFields,
        },
    };
}

export interface PluginConfigSanitizeResult {
    ok: boolean;
    values: PluginConfigValues;
    errors: string[];
}

function coerceConfigValue(
    field: PluginConfigField,
    raw: unknown,
): { value?: PluginConfigValue; error?: string } {
    switch (field.kind) {
        case "number": {
            if (typeof raw === "number" && Number.isFinite(raw)) {
                return { value: raw };
            }
            if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
                return { value: Number(raw) };
            }
            return { error: `${field.label} must be a number` };
        }
        case "boolean":
            return typeof raw === "boolean"
                ? { value: raw }
                : { error: `${field.label} must be true or false` };
        default:
            if (typeof raw !== "string") {
                return { error: `${field.label} must be text` };
            }
            if (field.kind === "select") {
                const options = field.options ?? [];
                if (!options.some((option) => option.value === raw)) {
                    return {
                        error: `${field.label} must be one of ${options
                            .map((option) => option.value)
                            .join(", ")}`,
                    };
                }
            }
            return { value: raw };
    }
}

/**
 * Normalize stored or submitted config against the manifest fields: drop
 * unknown keys, apply defaults, coerce form strings for `number` fields and
 * report a missing required value. Prototype-hazard keys never appear in
 * `fields` (manifest validation runs first), so building a plain object is safe.
 */
export function sanitizePluginConfig(
    fields: readonly PluginConfigField[],
    input: unknown,
): PluginConfigSanitizeResult {
    const source = isRecord(input) ? input : {};
    const values: PluginConfigValues = {};
    const errors: string[] = [];

    for (const field of fields) {
        const present = Object.prototype.hasOwnProperty.call(source, field.key);
        const raw = present ? source[field.key] : field.default;
        if (raw === undefined) {
            if (field.required === true) {
                errors.push(`${field.label} is required`);
            }
            continue;
        }
        const coerced = coerceConfigValue(field, raw);
        if (coerced.error !== undefined) {
            errors.push(coerced.error);
            continue;
        }
        if (
            field.required === true &&
            typeof coerced.value === "string" &&
            coerced.value.trim() === ""
        ) {
            errors.push(`${field.label} is required`);
            continue;
        }
        values[field.key] = coerced.value as PluginConfigValue;
    }

    return { ok: errors.length === 0, values, errors };
}
