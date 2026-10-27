import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DeviceState } from "@shared/ipc";
import { idleFirmwareState } from "@shared/firmware";
import { emptyDiffPlan } from "@shared/sync";
import type { SyncResult } from "@shared/sync";
import type { DeleteResult } from "@shared/delete";

const mocks = vi.hoisted(() => ({
    deleteFile: vi.fn(),
    deletePageRequest: vi.fn(),
    deviceInfo: vi.fn(),
    listDeviceProfiles: vi.fn(),
    listImages: vi.fn(),
    listProfiles: vi.fn(),
    listPages: vi.fn(),
    loadPage: vi.fn(),
    savePage: vi.fn(),
    scanReferences: vi.fn(),
    reconcile: vi.fn(),
    iconList: vi.fn(),
    iconRemove: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
    storageClient: {
        listProfiles: mocks.listProfiles,
        listPages: mocks.listPages,
        loadPage: mocks.loadPage,
        savePage: mocks.savePage,
        scanReferences: mocks.scanReferences,
    },
    deleteClient: {
        page: mocks.deletePageRequest,
    },
    iconsClient: {
        list: mocks.iconList,
        remove: mocks.iconRemove,
    },
    syncClient: {
        reconcile: mocks.reconcile,
    },
    usbClient: {
        deleteFile: mocks.deleteFile,
        deviceInfo: mocks.deviceInfo,
        listProfiles: mocks.listDeviceProfiles,
        listImages: mocks.listImages,
    },
    firmwareClient: {
        state: vi.fn(async () => ({ ok: true, data: idleFirmwareState() })),
    },
}));

vi.mock("@/ipc/events", () => ({
    on: () => 0,
    eventChannels: { toast: "toast", usb: "usb", syncProgress: "sync:progress" },
}));

import { useDeviceStore } from "./deviceStore";
import { useProfileStore } from "./profileStore";
import { useUsbStore } from "./usbStore";
import { useConfirmStore } from "./confirmStore";
import { useFirmwareStore } from "./firmwareStore";
import { useAppStore } from "./appStore";

function setup(): {
    store: ReturnType<typeof useDeviceStore>;
    usb: ReturnType<typeof useUsbStore>;
} {
    const store = useDeviceStore();
    const usb = useUsbStore();
    usb.status = { state: DeviceState.Connected, label: "Connected" };

    const profile = useProfileStore();
    profile.activeProfile = "main";
    profile.pages = [{ id: "0", mtimeMs: 1 }];
    profile.currentPageId = "0";
    profile.currentPage = { buttons: {} };
    return { store, usb };
}

describe("deviceStore two-sided delete", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mocks.scanReferences.mockResolvedValue({
            ok: true,
            data: { hits: [], partial: false },
        });
        mocks.deleteFile.mockResolvedValue({ ok: true, data: undefined });
        mocks.deletePageRequest.mockResolvedValue({ ok: true, data: deletedBoth() });
        mocks.deviceInfo.mockResolvedValue({ ok: true, data: null });
        mocks.listDeviceProfiles.mockResolvedValue({ ok: true, data: [] });
        mocks.listImages.mockResolvedValue({ ok: true, data: [] });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "main", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [] });
        mocks.loadPage.mockResolvedValue({ ok: true, data: { buttons: {} } });
        mocks.savePage.mockResolvedValue({ ok: true, data: undefined });
        mocks.reconcile.mockResolvedValue({ ok: true, data: emptyDiffPlan() });
        mocks.iconList.mockResolvedValue({ ok: true, data: [] });
        mocks.iconRemove.mockResolvedValue({ ok: true, data: undefined });
    });

    function deletedBoth(): DeleteResult {
        return {
            deck: { status: "deleted" },
            library: { status: "deleted" },
            remaining: "none",
        };
    }

    it("confirms once, asks for one delete and applies the aftermath on success", async () => {
        const { store } = setup();
        const profile = useProfileStore();
        const confirm = useConfirmStore();
        const ask = vi.spyOn(confirm, "ask").mockResolvedValue(true);
        const toast = vi.spyOn(useAppStore(), "pushToast");

        await expect(store.deletePage("0")).resolves.toBe(true);

        expect(ask).toHaveBeenCalledTimes(1);
        expect(mocks.deletePageRequest).toHaveBeenCalledTimes(1);
        expect(mocks.deletePageRequest).toHaveBeenCalledWith("main", "0");
        expect(mocks.deleteFile).not.toHaveBeenCalled();
        expect(mocks.scanReferences).toHaveBeenCalledWith({
            kind: "page",
            profile: "main",
            id: "0",
        });
        expect(toast).toHaveBeenCalledWith("success", "Deleted Page 1");
        // The library copy went, so the editor moves off the deleted page.
        expect(profile.currentPageId).toBeNull();
        expect(mocks.deviceInfo).toHaveBeenCalledTimes(1);
    });

    it("keeps the page and its editor state when the deck delete fails", async () => {
        const { store } = setup();
        const profile = useProfileStore();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        const toast = vi.spyOn(useAppStore(), "pushToast");
        mocks.deletePageRequest.mockResolvedValue({
            ok: true,
            data: {
                deck: { status: "failed", error: "deck refused" },
                library: { status: "skipped" },
                remaining: "both",
            },
        });

        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(toast).toHaveBeenCalledWith(
            "error",
            "Could not delete Page 1 from the deck: deck refused. Nothing was deleted.",
        );
        expect(profile.currentPageId).toBe("0");
        expect(mocks.listPages).not.toHaveBeenCalled();
        expect(mocks.deviceInfo).not.toHaveBeenCalled();
    });

    it("reports a library copy that stayed and keeps the page open", async () => {
        const { store } = setup();
        const profile = useProfileStore();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        const toast = vi.spyOn(useAppStore(), "pushToast");
        mocks.deletePageRequest.mockResolvedValue({
            ok: true,
            data: {
                deck: { status: "deleted" },
                library: { status: "failed", error: "no permission" },
                remaining: "library",
            },
        });

        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(toast).toHaveBeenCalledWith(
            "warning",
            "Deleted Page 1 from the deck, but the library copy could not be deleted. It is still in the library.",
        );
        expect(profile.currentPageId).toBe("0");
        expect(profile.pages).toHaveLength(1);
        expect(mocks.listPages).not.toHaveBeenCalled();
    });

    it("removes only the library copy when the deck is disconnected", async () => {
        const { store, usb } = setup();
        usb.status = { state: DeviceState.Disconnected, label: "Disconnected" };
        const confirm = useConfirmStore();
        const ask = vi.spyOn(confirm, "ask").mockResolvedValue(true);
        const toast = vi.spyOn(useAppStore(), "pushToast");
        mocks.deletePageRequest.mockResolvedValue({
            ok: true,
            data: {
                deck: { status: "skipped" },
                library: { status: "deleted" },
                remaining: "deck",
            },
        });

        await expect(store.deletePage("0")).resolves.toBe(true);

        expect(ask.mock.calls[0]?.[0].message).toContain(
            "The deck is disconnected, so its copy stays",
        );
        expect(mocks.deletePageRequest).toHaveBeenCalledWith("main", "0");
        expect(toast).toHaveBeenCalledWith(
            "warning",
            "Deleted Page 1 from the library. The deck copy stays, and the next sync removes it.",
        );
    });

    it("reports a refused delete when the deck is held by another operation", async () => {
        const { store } = setup();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        const toast = vi.spyOn(useAppStore(), "pushToast");
        mocks.deletePageRequest.mockResolvedValue({
            ok: false,
            code: "DEVICE_BUSY",
            error: "A sync is running. Wait for it to finish, then try again.",
        });

        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(toast).toHaveBeenCalledWith(
            "error",
            "A sync is running. Wait for it to finish, then try again.",
        );
    });

    it("settles a pending autosave before the delete", async () => {
        const { store } = setup();
        const profile = useProfileStore();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        profile.selectKey("0");
        profile.setLabel("A");
        const order: string[] = [];
        mocks.savePage.mockImplementation(async () => {
            order.push("save");
            return { ok: true, data: undefined };
        });
        mocks.deletePageRequest.mockImplementation(async () => {
            order.push("delete");
            return { ok: true, data: deletedBoth() };
        });

        await store.deletePage("0");

        expect(order).toEqual(["save", "delete"]);
    });

    it("is disabled while a sync owns the deck and shows the reason", async () => {
        const { store, usb } = setup();
        const confirm = useConfirmStore();
        const ask = vi.spyOn(confirm, "ask");
        const toast = vi.spyOn(useAppStore(), "pushToast");
        usb.syncing = true;

        expect(store.deleteDisabledReason).toBe("Wait for the sync to finish");
        expect(store.deckWriteBlockedReason).toBe("Wait for the sync to finish");
        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(ask).not.toHaveBeenCalled();
        expect(mocks.deletePageRequest).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith("warning", "Wait for the sync to finish");
    });

    it("is disabled while a firmware update owns the deck", async () => {
        const { store } = setup();
        const firmware = useFirmwareStore();
        firmware.state = { ...idleFirmwareState(), phase: "writing" };

        expect(store.canDelete).toBe(false);
        expect(store.deckWriteBlockedReason).toBe("Wait for the firmware update to finish");
    });

    it("deletes an icon from both sides in the same order", async () => {
        const { store } = setup();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);

        await expect(store.deleteIcon("github")).resolves.toBe(true);

        expect(mocks.deleteFile).toHaveBeenCalledWith({
            kind: "icon",
            name: "github",
            allowMissing: true,
        });
        expect(mocks.scanReferences).toHaveBeenCalledWith({ kind: "icon", name: "github" });
        expect(mocks.iconRemove).toHaveBeenCalledWith("github");
    });

    it("does nothing when the confirmation is declined", async () => {
        const { store } = setup();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(false);

        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(mocks.deletePageRequest).not.toHaveBeenCalled();
    });
});

describe("deviceStore sync reading", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mocks.deviceInfo.mockResolvedValue({ ok: true, data: null });
        mocks.listDeviceProfiles.mockResolvedValue({ ok: true, data: [] });
        mocks.listImages.mockResolvedValue({ ok: true, data: [] });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "main", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [] });
        mocks.reconcile.mockResolvedValue({ ok: true, data: emptyDiffPlan() });
        mocks.iconList.mockResolvedValue({ ok: true, data: [] });
    });

    function syncResult(overrides: Partial<SyncResult> = {}): SyncResult {
        return {
            createdProfiles: [],
            renamedProfiles: [],
            uploadedPages: [],
            uploadedIcons: [],
            removedPages: [],
            removedIcons: [],
            removedProfiles: [],
            activeProfile: null,
            ...overrides,
        };
    }

    it("runs the current plan explicitly and refreshes afterwards", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        const execute = vi
            .spyOn(usb, "executePlan")
            .mockResolvedValue(syncResult({ uploadedPages: [{ profile: "main", id: "0" }] }));
        const plan = {
            ...emptyDiffPlan(),
            pagesToUpload: [{ profile: "main", id: "0" }],
        };
        store.plan = plan;

        await expect(store.syncNow()).resolves.toBe(true);

        expect(execute).toHaveBeenCalledWith(plan, { allowRemovals: true });
        expect(mocks.deviceInfo).toHaveBeenCalledTimes(1);
    });

    it("refuses to run when the reading says In sync", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        const execute = vi.spyOn(usb, "executePlan");
        store.plan = emptyDiffPlan();

        expect(store.syncAction.label).toBe("In sync");
        await expect(store.syncNow()).resolves.toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it("refuses to sync while a firmware update owns the deck", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        const firmware = useFirmwareStore();
        const execute = vi.spyOn(usb, "executePlan");
        firmware.state = { ...idleFirmwareState(), phase: "writing" };
        store.plan = {
            ...emptyDiffPlan(),
            pagesToUpload: [{ profile: "main", id: "0" }],
        };

        expect(store.syncAction).toEqual({
            label: "Updating firmware",
            hint: "Wait for the firmware update to finish before syncing",
            disabled: true,
        });
        await expect(store.syncNow()).resolves.toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it("asks before a sync removes a deck profile", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        const execute = vi.spyOn(usb, "executePlan").mockResolvedValue(syncResult());
        const ask = vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        const plan = {
            ...emptyDiffPlan(),
            pagesToDelete: [{ profile: "main", id: "9" }],
            profilesToDelete: ["stale"],
        };
        store.plan = plan;

        await expect(store.syncNow()).resolves.toBe(true);

        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask.mock.calls[0]?.[0]).toMatchObject({
            title: "Remove a deck profile",
            danger: true,
        });
        expect(ask.mock.calls[0]?.[0].message).toContain("“stale”");
        expect(execute).toHaveBeenCalledWith(plan, { allowRemovals: true });
    });

    it("runs nothing when the profile removal is declined", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        const execute = vi.spyOn(usb, "executePlan");
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(false);
        store.plan = { ...emptyDiffPlan(), profilesToDelete: ["stale"] };

        await expect(store.syncNow()).resolves.toBe(false);

        expect(execute).not.toHaveBeenCalled();
        expect(mocks.deviceInfo).not.toHaveBeenCalled();
    });

    it("does not ask when only pages and icons are removed", async () => {
        const { store } = setup();
        const usb = useUsbStore();
        vi.spyOn(usb, "executePlan").mockResolvedValue(syncResult());
        const ask = vi.spyOn(useConfirmStore(), "ask");
        const plan = {
            ...emptyDiffPlan(),
            pagesToDelete: [{ profile: "main", id: "9" }],
            iconsToDelete: [{ name: "old" }],
        };
        store.plan = plan;

        await expect(store.syncNow()).resolves.toBe(true);

        expect(ask).not.toHaveBeenCalled();
    });
});
