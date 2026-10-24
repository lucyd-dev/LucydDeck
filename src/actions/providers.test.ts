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
            commands: [{ command: "start_recording", title: "Start recording" }],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        const row = rows.find((item) => item.kind === "plugin");

        expect(row?.label).toBe("OBS Studio");
        expect(row?.actions.map((action) => action.id)).toEqual(["CMD:obs:start_recording"]);
    });

    it("keeps a row for an installed plugin with no commands", () => {
        const registration: PluginRegistration = {
            handle: "spotify",
            label: "Spotify",
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
            commands: [{ command: "record" }],
        };
        const discord: PluginRegistration = {
            handle: "discord",
            label: "Discord",
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
            commands: [],
        };
        const rows = buildProviders(typesFor(registration), [registration]);
        expect(rows.some((row) => row.label === "Other plugins")).toBe(false);
        expect(rows.map((row) => row.kind)).toEqual(["deck", "system", "plugin"]);
    });
});
