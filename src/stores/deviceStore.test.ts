import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DeviceState } from "@shared/ipc";
import { idleFirmwareState } from "@shared/firmware";
import { emptyDiffPlan } from "@shared/sync";
import type { SyncResult } from "@shared/sync";

const mocks = vi.hoisted(() => ({
    deleteFile: vi.fn(),
    deviceInfo: vi.fn(),
    listDeviceProfiles: vi.fn(),
    listImages: vi.fn(),
    listProfiles: vi.fn(),
    listPages: vi.fn(),
    deletePage: vi.fn(),
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
        deletePage: mocks.deletePage,
        loadPage: mocks.loadPage,
        savePage: mocks.savePage,
        scanReferences: mocks.scanReferences,
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
        mocks.deletePage.mockResolvedValue({ ok: true, data: undefined });
        mocks.deviceInfo.mockResolvedValue({ ok: true, data: null });
        mocks.listDeviceProfiles.mockResolvedValue({ ok: true, data: [] });
        mocks.listImages.mockResolvedValue({ ok: true, data: [] });
        mocks.listProfiles.mockResolvedValue({
            ok: true,
            data: [{ name: "main", isDefault: true }],
        });
        mocks.listPages.mockResolvedValue({ ok: true, data: [{ id: "0", mtimeMs: 1 }] });
        mocks.loadPage.mockResolvedValue({ ok: true, data: { buttons: {} } });
        mocks.savePage.mockResolvedValue({ ok: true, data: undefined });
        mocks.reconcile.mockResolvedValue({ ok: true, data: emptyDiffPlan() });
        mocks.iconList.mockResolvedValue({ ok: true, data: [] });
        mocks.iconRemove.mockResolvedValue({ ok: true, data: undefined });
    });

    it("deletes the deck copy before the library file, then refreshes", async () => {
        const { store } = setup();
        const confirm = useConfirmStore();
        vi.spyOn(confirm, "ask").mockResolvedValue(true);

        const order: string[] = [];
        mocks.deleteFile.mockImplementation(async () => {
            order.push("deck");
            return { ok: true, data: undefined };
        });
        mocks.deletePage.mockImplementation(async () => {
            order.push("library");
            return { ok: true, data: undefined };
        });

        await expect(store.deletePage("0")).resolves.toBe(true);

        expect(order).toEqual(["deck", "library"]);
        expect(mocks.deleteFile).toHaveBeenCalledWith({
            kind: "page",
            profile: "main",
            id: "0",
            allowMissing: true,
        });
        expect(mocks.scanReferences).toHaveBeenCalledWith({
            kind: "page",
            profile: "main",
            id: "0",
        });
        expect(mocks.deviceInfo).toHaveBeenCalledTimes(1);
    });

    it("leaves the library file alone when the deck delete fails", async () => {
        const { store } = setup();
        vi.spyOn(useConfirmStore(), "ask").mockResolvedValue(true);
        mocks.deleteFile.mockResolvedValue({ ok: false, error: "deck refused" });

        await expect(store.deletePage("0")).resolves.toBe(false);

        expect(mocks.deletePage).not.toHaveBeenCalled();
        expect(mocks.deviceInfo).not.toHaveBeenCalled();
    });

    it("removes only the library copy while the deck is disconnected", async () => {
        const { store, usb } = setup();
        usb.status = { state: DeviceState.Disconnected, label: "Disconnected" };
        const confirm = useConfirmStore();
        const ask = vi.spyOn(confirm, "ask").mockResolvedValue(true);

        await expect(store.deletePage("0")).resolves.toBe(true);

        expect(ask.mock.calls[0]?.[0].message).toContain(
            "The deck is disconnected, so its copy stays",
        );
        expect(mocks.deleteFile).not.toHaveBeenCalled();
        expect(mocks.deletePage).toHaveBeenCalledWith("main", "0");
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

        expect(mocks.deleteFile).not.toHaveBeenCalled();
        expect(mocks.deletePage).not.toHaveBeenCalled();
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
