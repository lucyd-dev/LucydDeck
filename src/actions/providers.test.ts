import { describe, expect, it } from "vitest";
import { INTERNAL_ACTION_TYPES, pluginRegistrationsToTypes } from "@/actions/registry";
import type { PluginRegistration } from "@/actions/registry";
import { buildProviders } from "./providers";

function typesFor(...registrations: PluginRegistration[]) {
    return [...INTERNAL_ACTION_TYPES, ...pluginRegistrationsToTypes(registrations)];
}

describe("buildProviders", () => {
    it("shows only Deck and System while no plugin is installed", () => {
        const rows = buildProviders(typesFor(), []);
        expect(rows.map((row) => [row.kind, row.label])).toEqual([
            ["deck", "Deck"],
            ["system", "System"],
        ]);
    });

    it("labels a plugin row with the registration label and keeps its commands", () => {
        const registration: PluginRegistration = {
            handle: "obs",
            label: "OBS Studio",
            iconDataUrl: "data:image/png;base64,AAAA",
            commands: [{ command: "start_recording", title: "Start recording" }],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        const row = rows.find((item) => item.kind === "plugin");

        expect(row?.id).toBe("plugin:obs");
        expect(row?.label).toBe("OBS Studio");
        expect(row?.iconDataUrl).toBe("data:image/png;base64,AAAA");
        expect(row?.actions.map((action) => action.id)).toEqual(["CMD:obs:start_recording"]);
    });

    it("humanizes a command label when the registration has no title", () => {
        const registration: PluginRegistration = {
            handle: "obs",
            label: "OBS",
            iconDataUrl: null,
            commands: [{ command: "start_recording" }],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        const row = rows.find((item) => item.kind === "plugin");

        expect(row?.actions.map((action) => action.label)).toEqual(["Start recording"]);
    });

    it("hides the generic CMD row but keeps the type for editing old steps", () => {
        const cmd = INTERNAL_ACTION_TYPES.find((type) => type.namespace === "CMD");
        expect(cmd?.hidden).toBe(true);

        const rows = buildProviders(INTERNAL_ACTION_TYPES, []);
        const ids = rows.flatMap((row) => row.actions.map((action) => action.id));
        expect(ids).not.toContain("CMD");
        expect(rows.map((row) => row.kind)).toEqual(["deck", "system"]);
    });

    it("keeps a row for an installed plugin with no commands", () => {
        const registration: PluginRegistration = {
            handle: "spotify",
            label: "Spotify",
            iconDataUrl: null,
            commands: [],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        const row = rows.find((item) => item.kind === "plugin");

        expect(row?.label).toBe("Spotify");
        expect(row?.actions).toEqual([]);
    });

    it("never puts a plugin command in another provider's row", () => {
        const obs: PluginRegistration = {
            handle: "obs",
            label: "OBS",
            iconDataUrl: null,
            commands: [{ command: "record" }],
        };
        const discord: PluginRegistration = {
            handle: "discord",
            label: "Discord",
            iconDataUrl: null,
            commands: [{ command: "mute" }],
        };
        const rows = buildProviders(typesFor(obs, discord), [obs, discord]);

        const idsByPlugin = rows
            .filter((row) => row.kind === "plugin")
            .map((row) => [row.label, row.actions.map((action) => action.id)]);
        expect(idsByPlugin).toEqual([
            ["OBS", ["CMD:obs:record"]],
            ["Discord", ["CMD:discord:mute"]],
        ]);

        const deckAndSystem = rows
            .filter((row) => row.kind !== "plugin")
            .flatMap((row) => row.actions.map((action) => action.id));
        expect(deckAndSystem.some((id) => id.startsWith("CMD:"))).toBe(false);
    });

    it("has no catch-all Other plugins row", () => {
        const registration: PluginRegistration = {
            handle: "obs",
            label: "OBS",
            iconDataUrl: null,
            commands: [],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        expect(rows.some((row) => row.label === "Other plugins")).toBe(false);
        expect(rows.map((row) => row.kind)).toEqual(["deck", "system", "plugin"]);
    });
});
