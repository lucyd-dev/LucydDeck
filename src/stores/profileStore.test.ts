import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";

const mocks = vi.hoisted(() => ({
    savePage: vi.fn(),
    loadPage: vi.fn(),
    listPages: vi.fn(),
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    renameProfile: vi.fn(),
    deleteProfile: vi.fn(),
    setDefaultProfile: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({ storageClient: mocks }));
vi.mock("@/ipc/events", () => ({
    on: () => 0,
    eventChannels: { toast: "toast", usb: "usb" },
}));

import { useAppStore } from "./appStore";
import { AUTOSAVE_DELAY_MS, useProfileStore } from "./profileStore";
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
        mocks.createProfile.mockReset().mockResolvedValue({ ok: true, data: { name: "new" } });
        mocks.renameProfile.mockReset().mockResolvedValue({ ok: true, data: { name: "renamed" } });
        mocks.deleteProfile.mockReset().mockResolvedValue({ ok: true, data: undefined });
        mocks.setDefaultProfile.mockReset().mockResolvedValue({ ok: true, data: undefined });
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

    it("opens the lowest remaining page after the open page's library copy went", async () => {
        const store = setupStore();
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "1", mtimeMs: 2000 }] });

        await store.applyPageDeleted("main", "0");

        expect(store.currentPageId).toBe("1");
        expect(mocks.loadPage).toHaveBeenLastCalledWith("main", "1");
    });

    it("leaves the editor empty when the last page is deleted", async () => {
        const store = setupStore();
        mocks.listPages.mockResolvedValue({ ok: true, data: [] });

        await store.applyPageDeleted("main", "0");

        expect(store.currentPageId).toBeNull();
        expect(store.currentPage).toEqual({ buttons: {} });
        expect(store.dirty).toBe(false);
    });

    it("keeps the open page when another one is deleted", async () => {
        const store = setupStore();

        await store.applyPageDeleted("main", "1");

        expect(store.currentPageId).toBe("0");
        expect(mocks.loadPage).not.toHaveBeenCalled();
    });

    it("does not autosave a deleted page back into the library", async () => {
        const store = setupStore();
        store.setLabel("A");

        await store.applyPageDeleted("main", "0");
        await vi.advanceTimersByTimeAsync(400);

        expect(mocks.savePage).not.toHaveBeenCalled();
    });

    it("leaves the editor alone when the delete belonged to another profile", async () => {
        const store = setupStore();

        await store.applyPageDeleted("work", "1");

        expect(store.currentPageId).toBe("0");
        expect(mocks.listPages).not.toHaveBeenCalled();
    });

    it("opens a newly created profile without carrying the previous page id", async () => {
        const store = setupStore();
        store.activeProfile = "Default";
        store.profiles = [
            { name: "Default", isDefault: true },
            { name: "Gaming Room", isDefault: false },
        ];
        store.currentPageId = "1";
        mocks.createProfile.mockResolvedValue({ ok: true, data: { name: "Gaming Room" } });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [
                { name: "Default", isDefault: true },
                { name: "Gaming Room", isDefault: false },
            ],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 3000 }] });

        // The switch must be atomic: when the new profile becomes active, the
        // previous profile's page "1" is already gone.
        const switches: Array<{ profile: string; pageId: string | null }> = [];
        const stop = watch(
            () => store.activeProfile,
            () => switches.push({ profile: store.activeProfile, pageId: store.currentPageId }),
            { flush: "sync" },
        );
        expect(await store.createProfile("Gaming Room")).toBe(true);
        stop();

        expect(switches).toEqual([{ profile: "Gaming Room", pageId: null }]);
        expect(store.activeProfile).toBe("Gaming Room");
        expect(store.currentPageId).toBe("0");
        expect(mocks.loadPage).toHaveBeenCalledWith("Gaming Room", "0");
        expect(mocks.loadPage).not.toHaveBeenCalledWith("Gaming Room", "1");
        expect(useAppStore().toasts).toEqual([]);
    });

    it("opens the first page of a newly created profile", async () => {
        const store = useProfileStore();
        mocks.createProfile.mockResolvedValue({ ok: true, data: { name: "main" } });
        mocks.listProfiles
            .mockResolvedValueOnce({ ok: true, data: [{ name: "main", isDefault: false }] })
            .mockResolvedValue({ ok: true, data: [{ name: "main", isDefault: true }] });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 1000 }] });

        expect(await store.createProfile("main")).toBe(true);

        expect(mocks.setDefaultProfile).toHaveBeenCalledWith("main");
        expect(store.activeProfile).toBe("main");
        expect(store.currentPageId).toBe("0");
        expect(mocks.loadPage).toHaveBeenCalledWith("main", "0");
    });

    it("reports a failed create and leaves the open profile alone", async () => {
        const store = setupStore();
        store.profiles = [{ name: "main", isDefault: true }];
        mocks.createProfile.mockResolvedValue({
            ok: false,
            error: 'Profile already exists: "main"',
        });

        expect(await store.createProfile("main")).toBe(false);

        expect(store.activeProfile).toBe("main");
        expect(mocks.loadPage).not.toHaveBeenCalled();
        expect(useAppStore().toasts).toContainEqual(
            expect.objectContaining({ level: "error", message: 'Profile already exists: "main"' }),
        );
    });

    it("opens a profile under the sanitized name the service returns", async () => {
        const store = setupStore();
        mocks.createProfile.mockResolvedValue({ ok: true, data: { name: "v12" } });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "v12", isDefault: false }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 3000 }] });

        expect(await store.createProfile("v1.2")).toBe(true);

        expect(mocks.setDefaultProfile).toHaveBeenCalledWith("v12");
        expect(store.activeProfile).toBe("v12");
        expect(store.currentPageId).toBe("0");
        expect(mocks.loadPage).toHaveBeenCalledWith("v12", "0");
        expect(useAppStore().toasts).toContainEqual(
            expect.objectContaining({ level: "info", message: 'Profile name saved as "v12"' }),
        );
    });

    it("renames to the sanitized name the service returns", async () => {
        const store = setupStore();
        store.activeProfile = "v1.2";
        store.profiles = [{ name: "v1.2", isDefault: true }];
        mocks.renameProfile.mockResolvedValue({
            ok: true,
            data: { name: "Gaming Room" },
        });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "Gaming Room", isDefault: true }],
        });

        await store.renameProfile("v1.2", "Gaming: Room");

        expect(store.activeProfile).toBe("Gaming Room");
        expect(mocks.setDefaultProfile).toHaveBeenCalledWith("Gaming Room");
        expect(useAppStore().toasts).toContainEqual(
            expect.objectContaining({
                level: "info",
                message: 'Profile name saved as "Gaming Room"',
            }),
        );
    });

    it("falls back to the default profile when the active profile is deleted", async () => {
        const store = setupStore();
        store.activeProfile = "Gaming Room";
        store.profiles = [
            { name: "Default", isDefault: true },
            { name: "Gaming Room", isDefault: false },
        ];
        store.pages = [{ id: "0", mtimeMs: 3000 }];
        store.currentPageId = "0";
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "Default", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "3", mtimeMs: 4000 }] });

        await store.deleteProfile("Gaming Room");

        expect(mocks.deleteProfile).toHaveBeenCalledWith("Gaming Room");
        expect(store.activeProfile).toBe("Default");
        expect(store.currentPageId).toBe("3");
        expect(mocks.loadPage).toHaveBeenCalledWith("Default", "3");
        expect(mocks.setDefaultProfile).not.toHaveBeenCalled();
    });

    it("promotes the next profile when the active default is deleted", async () => {
        const store = setupStore();
        store.activeProfile = "Default";
        store.profiles = [
            { name: "Default", isDefault: true },
            { name: "Gaming Room", isDefault: false },
        ];
        store.pages = [{ id: "0", mtimeMs: 3000 }];
        mocks.listProfiles
            .mockResolvedValueOnce({
                ok: true,
                data: [{ name: "Gaming Room", isDefault: false }],
            })
            .mockResolvedValue({
                ok: true,
                data: [{ name: "Gaming Room", isDefault: true }],
            });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 5000 }] });

        await store.deleteProfile("Default");

        expect(mocks.setDefaultProfile).toHaveBeenCalledWith("Gaming Room");
        expect(store.activeProfile).toBe("Gaming Room");
        expect(store.defaultProfile).toBe("Gaming Room");
    });

    it("never writes to a profile after deleting it", async () => {
        const store = setupStore();
        store.activeProfile = "Gaming Room";
        store.profiles = [
            { name: "Default", isDefault: true },
            { name: "Gaming Room", isDefault: false },
        ];
        store.pages = [{ id: "0", mtimeMs: 3000 }];
        store.currentPageId = "0";
        store.currentPage = { buttons: { "0": { click: [] } } };
        store.selectKey("0");
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "Default", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 5000 }] });

        let finishDelete: (value: { ok: true; data: undefined }) => void = () => {};
        mocks.deleteProfile.mockReturnValue(
            new Promise((resolve) => {
                finishDelete = resolve;
            }),
        );

        store.setLabel("A");
        const deletion = store.deleteProfile("Gaming Room");
        // The autosave would fire here, while the delete is still in flight.
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100);
        finishDelete({ ok: true, data: undefined });
        await deletion;
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 100);

        const writesToDeleted = mocks.savePage.mock.calls.filter(
            ([profile]) => profile === "Gaming Room",
        );
        expect(writesToDeleted).toHaveLength(0);
        expect(store.activeProfile).toBe("Default");
        expect(store.dirty).toBe(false);
    });

    it("settles an in-flight save before deleting the active profile", async () => {
        const store = setupStore();
        store.activeProfile = "Gaming Room";
        store.profiles = [
            { name: "Default", isDefault: true },
            { name: "Gaming Room", isDefault: false },
        ];
        store.pages = [{ id: "0", mtimeMs: 3000 }];
        store.currentPageId = "0";
        store.currentPage = { buttons: { "0": { click: [] } } };
        store.selectKey("0");
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "Default", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 5000 }] });

        let finishSave: (value: { ok: true; data: undefined }) => void = () => {};
        mocks.savePage.mockReturnValue(
            new Promise((resolve) => {
                finishSave = resolve;
            }),
        );

        store.setLabel("A");
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        expect(mocks.savePage).toHaveBeenCalledTimes(1);

        const deletion = store.deleteProfile("Gaming Room");
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.deleteProfile).not.toHaveBeenCalled();

        finishSave({ ok: true, data: undefined });
        await deletion;
        expect(mocks.deleteProfile).toHaveBeenCalledWith("Gaming Room");
        expect(store.activeProfile).toBe("Default");
    });
});
