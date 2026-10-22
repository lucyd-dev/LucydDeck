// ---------------------------------------------------------------------------
// Pure inventory builder for the Device view.
//
// Joins the device lists (`RESP_PROFILES_LIST`, `RESP_IMAGES_LIST`) with the
// local profile/page/icon state by CRC32, producing one row per profile, page
// and icon so the view can mark it in sync, local only, device only or changed.
// ---------------------------------------------------------------------------

import { iconBaseName } from "@shared/icons";
import { pageLabel } from "@shared/pages";

export type InventoryKind = "profile" | "page" | "icon";

export type InventoryState = "in-sync" | "local-only" | "device-only" | "out-of-sync";

export interface InventoryRow {
    /** Stable unique key for list rendering. */
    key: string;
    kind: InventoryKind;
    /** Display name: profile name, page label or icon base name. */
    name: string;
    profile?: string;
    pageId?: string;
    state: InventoryState;
    /** CRC32 of the local copy, decimal string; `null` when absent. */
    localHash: string | null;
    /** CRC32 reported by the device, decimal string; `null` when absent. */
    deviceHash: string | null;
}

export interface LocalPageSummary {
    id: string;
    hash?: number;
}

export interface LocalProfileSummary {
    name: string;
    pages: LocalPageSummary[];
}

export interface LocalInventory {
    profiles: LocalProfileSummary[];
    icons: Array<{ name: string; hash: string }>;
}

export interface DeviceProfileSummary {
    name: string;
    pages: Array<{ id: string; hash: number }>;
}

export interface DeviceInventory {
    profiles: DeviceProfileSummary[];
    icons: Array<{ filename: string; hash: number }>;
}

export interface InventorySummary {
    inSync: number;
    localOnly: number;
    deviceOnly: number;
    outOfSync: number;
    total: number;
}

function compareIds(a: string, b: string): number {
    return Number(a) - Number(b);
}

function hashString(value: number | undefined | null): string | null {
    return value === undefined || value === null || !Number.isFinite(value)
        ? null
        : String(value >>> 0);
}

function sameHash(local: string | null, device: string | null): boolean {
    return local !== null && device !== null && local === device;
}

function stateFor(local: string | null, device: string | null): InventoryState {
    if (local !== null && device !== null) {
        return sameHash(local, device) ? "in-sync" : "out-of-sync";
    }
    return local !== null ? "local-only" : "device-only";
}

function row(
    input: Omit<InventoryRow, "state" | "localHash" | "deviceHash"> & {
        localHash?: number | string | null;
        deviceHash?: number | string | null;
    },
): InventoryRow {
    const localHash =
        input.localHash === null || input.localHash === undefined ? null : String(input.localHash);
    const deviceHash =
        input.deviceHash === null || input.deviceHash === undefined
            ? null
            : String(input.deviceHash);
    return {
        key: input.key,
        kind: input.kind,
        name: input.name,
        profile: input.profile,
        pageId: input.pageId,
        localHash,
        deviceHash,
        state: stateFor(localHash, deviceHash),
    };
}

/**
 * Build the inventory rows. Profiles come first, then their pages, then the
 * icon library, each group sorted for a stable render.
 */
export function buildInventory(local: LocalInventory, device: DeviceInventory): InventoryRow[] {
    const rows: InventoryRow[] = [];
    const localProfiles = new Map(local.profiles.map((profile) => [profile.name, profile]));
    const deviceProfiles = new Map(device.profiles.map((profile) => [profile.name, profile]));
    const profileNames = [...new Set([...localProfiles.keys(), ...deviceProfiles.keys()])].sort(
        (a, b) => a.localeCompare(b),
    );

    for (const name of profileNames) {
        const localProfile = localProfiles.get(name);
        const deviceProfile = deviceProfiles.get(name);
        rows.push({
            key: `profile:${name}`,
            kind: "profile",
            name,
            state:
                localProfile !== undefined && deviceProfile !== undefined
                    ? "in-sync"
                    : localProfile !== undefined
                      ? "local-only"
                      : "device-only",
            localHash: null,
            deviceHash: null,
        });

        const localPages = new Map((localProfile?.pages ?? []).map((page) => [page.id, page.hash]));
        const devicePages = new Map(
            (deviceProfile?.pages ?? []).map((page) => [page.id, page.hash]),
        );
        const pageIds = [...new Set([...localPages.keys(), ...devicePages.keys()])].sort(
            compareIds,
        );
        for (const id of pageIds) {
            rows.push(
                row({
                    key: `page:${name}:${id}`,
                    kind: "page",
                    name: pageLabel(id),
                    profile: name,
                    pageId: id,
                    localHash: hashString(localPages.get(id)),
                    deviceHash: hashString(devicePages.get(id)),
                }),
            );
        }
    }

    const localIcons = new Map(local.icons.map((icon) => [icon.name, icon.hash]));
    const deviceIcons = new Map(
        device.icons.map((icon) => [iconBaseName(icon.filename), String(icon.hash >>> 0)]),
    );
    const iconNames = [...new Set([...localIcons.keys(), ...deviceIcons.keys()])].sort((a, b) =>
        a.localeCompare(b),
    );
    for (const name of iconNames) {
        rows.push(
            row({
                key: `icon:${name}`,
                kind: "icon",
                name,
                localHash: localIcons.get(name) ?? null,
                deviceHash: deviceIcons.get(name) ?? null,
            }),
        );
    }

    return rows;
}

export function summarizeInventory(rows: readonly InventoryRow[]): InventorySummary {
    const summary: InventorySummary = {
        inSync: 0,
        localOnly: 0,
        deviceOnly: 0,
        outOfSync: 0,
        total: rows.length,
    };
    for (const item of rows) {
        if (item.state === "in-sync") {
            summary.inSync++;
        } else if (item.state === "local-only") {
            summary.localOnly++;
        } else if (item.state === "device-only") {
            summary.deviceOnly++;
        } else {
            summary.outOfSync++;
        }
    }
    return summary;
}
