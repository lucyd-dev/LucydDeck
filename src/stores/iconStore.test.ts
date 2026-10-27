import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { IconMeta } from "@shared/ipc";

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    preview: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
    iconsClient: {
        list: mocks.list,
        preview: mocks.preview,
    },
}));

import { useIconStore } from "./iconStore";

function icon(name: string): IconMeta {
    return { name, hash: name };
}

describe("iconStore delete aftermath", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mocks.list.mockResolvedValue({ ok: true, data: [] });
        mocks.preview.mockResolvedValue({ ok: true, data: null });
    });

    it("drops the deleted icon's preview and recent entry, then re-lists", async () => {
        const store = useIconStore();
        store.icons = [icon("github"), icon("work")];
        store.previews.github = "data:image/png;base64,github";
        store.previews.work = "data:image/png;base64,work";
        store.recent = ["github", "work"];
        mocks.list.mockResolvedValue({ ok: true, data: [icon("work")] });

        await store.applyIconDeleted("github");

        expect(store.previews.github).toBeUndefined();
        expect(store.previews.work).toBe("data:image/png;base64,work");
        expect(store.recent).toEqual(["work"]);
        expect(store.icons).toEqual([icon("work")]);
        expect(mocks.list).toHaveBeenCalledTimes(1);
    });

    it("keeps the library listing until a delete is applied", async () => {
        const store = useIconStore();
        store.icons = [icon("github")];
        store.previews.github = "data:image/png;base64,github";
        store.recent = ["github"];

        expect(store.has("github")).toBe(true);
        expect(store.has("missing")).toBe(false);
        expect(store.preview("github")).toBe("data:image/png;base64,github");
        expect(store.recent).toEqual(["github"]);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});
