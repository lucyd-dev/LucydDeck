import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
    savePage: vi.fn(),
    deletePage: vi.fn(),
    loadPage: vi.fn(),
    listPages: vi.fn(),
    listProfiles: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({ storageClient: mocks }));
vi.mock("@/ipc/events", () => ({
    on: () => 0,
    eventChannels: { toast: "toast", usb: "usb" },
}));

import { useProfileStore } from "./profileStore";
import type { PageConfig } from "@shared/types";

function setupStore(): ReturnType<typeof useProfileStore> {
    const store = useProfileStore();
    store.activeProfile = "main";
    store.pages = [
        { id: "0", mtimeMs: 1000 },
        { id: "1", mtimeMs: 2000 },
    ];
    store.currentPageId = "0";
    store.currentPageMtime = 1000;
    store.currentPage = { buttons: { "0": { click: [] } } };
    store.selectedKeys = [];
    store.selectKey("0");
    store.dirty = false;
    return store;
}

describe("profileStore autosave and history", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        setActivePinia(createPinia());
        mocks.savePage.mockReset().mockResolvedValue({ ok: true, data: undefined });
        mocks.loadPage.mockReset().mockResolvedValue({
            ok: true,
            data: { buttons: {} } satisfies PageConfig,
        });
        mocks.listPages.mockReset().mockResolvedValue({
            ok: true,
            data: [
                { id: "0", mtimeMs: 1000 },
                { id: "1", mtimeMs: 2000 },
            ],
        });
        mocks.listProfiles.mockReset().mockResolvedValue({ ok: true, data: [] });
        mocks.deletePage.mockReset().mockResolvedValue({ ok: true, data: undefined });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("writes once per typing burst", async () => {
        const store = setupStore();

        store.setLabel("A");
        store.setLabel("AB");
        store.setLabel("ABC");
        await vi.advanceTimersByTimeAsync(399);
        expect(mocks.savePage).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.savePage).toHaveBeenCalledTimes(1);
        const [profile, id, page] = mocks.savePage.mock.calls[0] as [string, string, PageConfig];
        expect(profile).toBe("main");
        expect(id).toBe("0");
        expect(page.buttons["0"]?.label).toBe("ABC");
        expect(store.saveState).toBe("saved");
    });

    it("undoes after a save and schedules another write", async () => {
        const store = setupStore();

        store.setLabel("A");
        await vi.advanceTimersByTimeAsync(400);
        expect(mocks.savePage).toHaveBeenCalledTimes(1);

        store.undo();
        await vi.advanceTimersByTimeAsync(400);
        expect(mocks.savePage).toHaveBeenCalledTimes(2);
        const [, , page] = mocks.savePage.mock.calls[1] as [string, string, PageConfig];
        expect(page.buttons["0"]?.label).toBeUndefined();
    });

    it("flushes a pending write before switching pages", async () => {
        const store = setupStore();

        store.setLabel("A");
        await store.selectPage("1");

        expect(mocks.savePage).toHaveBeenCalledTimes(1);
        expect(mocks.loadPage).toHaveBeenCalledWith("main", "1");
        expect(store.currentPageId).toBe("1");
    });

    it("blocks the write while a page has an invalid step", async () => {
        const store = setupStore();
        store.currentPage = { buttons: { "0": { click: ["HID_KEY:CTRL+FOO"] } } };
        store.selectKey("0");

        store.setLabel("A");
        await vi.advanceTimersByTimeAsync(400);

        expect(mocks.savePage).not.toHaveBeenCalled();
        expect(store.saveState).toBe("blocked");
        expect(store.dirty).toBe(true);
    });

    it("keeps a page with invalid steps in memory when switching away", async () => {
        const store = setupStore();
        store.currentPage = { buttons: { "0": { click: ["NOPE:x"] } } };
        store.selectKey("0");
        store.setLabel("A");

        await store.selectPage("1");
        expect(store.currentPageId).toBe("1");
        expect(mocks.savePage).not.toHaveBeenCalled();

        await store.selectPage("0");
        expect(store.currentPageId).toBe("0");
        expect(store.currentPage.buttons["0"]?.label).toBe("A");
        expect(store.dirty).toBe(true);
        expect(store.saveState).toBe("blocked");
    });

    it("records one history entry for a multi-key apply", () => {
        const store = setupStore();
        store.currentPage = { buttons: { "0": { click: [] }, "1": { click: [] } } };
        store.selectKey("0");
        store.selectKey("1", true);

        store.setSelectedBackgroundColor("#123456");
        expect(store.currentPage.buttons["0"]?.backgroundColor).toBe("#123456");
        expect(store.currentPage.buttons["1"]?.backgroundColor).toBe("#123456");

        store.undo();
        expect(store.currentPage.buttons["0"]?.backgroundColor).toBeUndefined();
        expect(store.currentPage.buttons["1"]?.backgroundColor).toBeUndefined();
    });

    it("does not report its own save as an external change", async () => {
        const store = setupStore();
        store.setLabel("A");
        await vi.advanceTimersByTimeAsync(400);

        await store.checkExternalChanges();
        expect(store.externalChange).toBeNull();
    });

    it("writes the in-memory page when keeping local over an external edit", async () => {
        const store = setupStore();
        mocks.listPages.mockResolvedValue({
            ok: true,
            data: [{ id: "0", mtimeMs: 9000 }],
        });
        await store.checkExternalChanges();
        expect(store.externalChange).not.toBeNull();

        store.keepLocalPage();
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.savePage).toHaveBeenCalledTimes(1);
    });

    it("deletes the open page and opens the lowest remaining one", async () => {
        const store = setupStore();
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "1", mtimeMs: 2000 }] });

        expect(await store.removePage("0")).toBe(true);
        expect(mocks.deletePage).toHaveBeenCalledWith("main", "0");
        expect(store.currentPageId).toBe("1");
        expect(mocks.loadPage).toHaveBeenLastCalledWith("main", "1");
    });

    it("leaves the editor empty when the last page is deleted", async () => {
        const store = setupStore();
        mocks.listPages.mockResolvedValue({ ok: true, data: [] });

        expect(await store.removePage("0")).toBe(true);
        expect(store.currentPageId).toBeNull();
        expect(store.currentPage).toEqual({ buttons: {} });
        expect(store.dirty).toBe(false);
    });

    it("keeps the open page when another one is deleted", async () => {
        const store = setupStore();

        expect(await store.removePage("1")).toBe(true);
        expect(store.currentPageId).toBe("0");
        expect(mocks.loadPage).not.toHaveBeenCalled();
    });

    it("does not autosave a deleted page back into the library", async () => {
        const store = setupStore();
        store.setLabel("A");

        await store.removePage("0");
        await vi.advanceTimersByTimeAsync(400);

        expect(mocks.savePage).not.toHaveBeenCalled();
    });

    it("reports a failed delete and keeps the page open", async () => {
        const store = setupStore();
        mocks.deletePage.mockResolvedValue({ ok: false, error: "Page not found" });

        expect(await store.removePage("0")).toBe(false);
        expect(store.currentPageId).toBe("0");
    });
});
