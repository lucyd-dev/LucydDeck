import { describe, expect, it } from "vitest";
import { buildInventory, summarizeInventory } from "./inventory";
import type { DeviceInventory, LocalInventory } from "./inventory";

const local: LocalInventory = {
    profiles: [
        {
            name: "main",
            pages: [
                { id: "0", hash: 111 },
                { id: "1", hash: 222 },
                { id: "2", hash: 333 },
            ],
        },
        { name: "work", pages: [] },
    ],
    icons: [
        { name: "github", hash: 444 },
        { name: "local-only", hash: 555 },
    ],
};

const device: DeviceInventory = {
    profiles: [
        {
            name: "main",
            pages: [
                { id: "0", hash: 111 },
                { id: "1", hash: 999 },
                { id: "3", hash: 777 },
            ],
        },
        { name: "gaming", pages: [{ id: "0", hash: 888 }] },
    ],
    icons: [
        { filename: "github.png", hash: 444 },
        { filename: "device-only.png", hash: 666 },
    ],
};

describe("device inventory", () => {
    it("marks profiles, pages and icons by presence and hash", () => {
        const rows = buildInventory(local, device);
        const byKey = new Map(rows.map((row) => [row.key, row]));

        expect(byKey.get("profile:main")?.state).toBe("in-sync");
        expect(byKey.get("profile:work")?.state).toBe("local-only");
        expect(byKey.get("profile:gaming")?.state).toBe("device-only");

        expect(byKey.get("page:main:0")?.state).toBe("in-sync");
        expect(byKey.get("page:main:1")?.state).toBe("out-of-sync");
        expect(byKey.get("page:main:2")?.state).toBe("local-only");
        expect(byKey.get("page:main:3")?.state).toBe("device-only");
        expect(byKey.get("page:gaming:0")?.state).toBe("device-only");

        expect(byKey.get("icon:github")?.state).toBe("in-sync");
        expect(byKey.get("icon:local-only")?.state).toBe("local-only");
        expect(byKey.get("icon:device-only")?.state).toBe("device-only");
    });

    it("exposes decimal CRC32 strings and stable keys", () => {
        const rows = buildInventory(local, device);
        const page = rows.find((row) => row.key === "page:main:1");
        expect(page).toMatchObject({
            kind: "page",
            name: "Page 2",
            profile: "main",
            pageId: "1",
            localHash: "222",
            deviceHash: "999",
        });
        const icon = rows.find((row) => row.key === "icon:github");
        expect(icon?.deviceHash).toBe("444");
    });

    it("summarizes each state", () => {
        expect(summarizeInventory(buildInventory(local, device))).toEqual({
            inSync: 3,
            localOnly: 3,
            deviceOnly: 4,
            outOfSync: 1,
            total: 11,
        });
    });

    it("treats an unreadable device hash as absent", () => {
        const rows = buildInventory(local, {
            ...device,
            profiles: [],
            icons: [{ filename: "github.png", hash: null }],
        });
        expect(rows.find((row) => row.key === "icon:github")).toMatchObject({
            localHash: "444",
            deviceHash: null,
            state: "local-only",
        });
    });
});
