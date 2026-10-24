import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { DeviceInfo, ReferenceQuery, ReferenceScanResult } from "@shared/ipc";
import { diffPlanDeletions, diffPlanOperations } from "@shared/sync";
import type { DiffPlan } from "@shared/sync";
import { pageLabel } from "@shared/pages";
import { iconsClient, storageClient, syncClient, usbClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useIconStore } from "@/stores/iconStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";
import {
    buildInventory,
    iconInventoryKey,
    pageInventoryKey,
    summarizeInventory,
} from "@/device/inventory";
import type {
    DeviceInventory,
    InventoryRow,
    LocalInventory,
    LocalProfileSummary,
} from "@/device/inventory";
import { deleteConfirmation, referenceNotes } from "@/device/references";
import { syncAction as readSyncAction } from "@/device/syncAction";

/**
 * Device view state: the last device info and inventory, the sync review plan,
 * and a stale marker. A disconnect keeps the last inventory and marks it stale
 * (sync and cleanup are disabled) instead of blanking the view.
 */
export const useDeviceStore = defineStore("device", () => {
    const usb = useUsbStore();
    const profile = useProfileStore();
    const icons = useIconStore();
    const confirm = useConfirmStore();

    const info = ref<DeviceInfo | null>(null);
    const inventory = ref<InventoryRow[]>([]);
    // Last device lists, kept so the library side can be re-read while the
    // deck is offline (a disconnected delete still changes the local files).
    const lastDevice = shallowRef<DeviceInventory | null>(null);
    // Shallow on purpose: the plan is replaced wholesale and goes straight over
    // IPC, and a deep ref would make it a Proxy that Electron cannot clone.
    const plan = shallowRef<DiffPlan | null>(null);
    const loading = ref(false);
    const stale = ref(false);
    const deletingKey = ref<string | null>(null);

    const summary = computed(() => summarizeInventory(inventory.value));
    const operations = computed(() => (plan.value === null ? 0 : diffPlanOperations(plan.value)));
    const plannedDeletions = computed(() =>
        plan.value === null ? 0 : diffPlanDeletions(plan.value),
    );
    const canDelete = computed(() => usb.connected && !stale.value);
    const deleteDisabledReason = computed<string | undefined>(() => {
        if (!usb.connected) {
            return "Connect the deck to delete device files";
        }
        if (stale.value) {
            return "Reconnect and refresh the inventory first";
        }
        return undefined;
    });
    const syncAction = computed(() =>
        readSyncAction({
            connected: usb.connected,
            stale: stale.value,
            syncing: usb.syncing,
            planLoaded: plan.value !== null,
            pendingChanges: operations.value,
            plannedRemovals: plannedDeletions.value,
        }),
    );

    watch(
        () => usb.connected,
        (connected) => {
            if (!connected && inventory.value.length > 0) {
                stale.value = true;
            }
        },
    );

    async function loadLocalInventory(): Promise<LocalInventory | null> {
        const profilesResult = await storageClient.listProfiles();
        if (!profilesResult.ok) {
            useAppStore().pushToast("error", profilesResult.error);
            return null;
        }
        const iconsResult = await iconsClient.list();
        if (!iconsResult.ok) {
            useAppStore().pushToast("error", iconsResult.error);
            return null;
        }

        const profiles: LocalProfileSummary[] = [];
        for (const item of profilesResult.data) {
            const pagesResult = await storageClient.listPages(item.name);
            if (!pagesResult.ok) {
                useAppStore().pushToast("error", pagesResult.error);
                return null;
            }
            profiles.push({
                name: item.name,
                pages: pagesResult.data.map((page) => ({ id: page.id, hash: page.hash })),
            });
        }
        return {
            profiles,
            icons: iconsResult.data.map((icon) => ({ name: icon.name, hash: icon.hash })),
        };
    }

    /** Re-read device info, both inventories and the sync plan. Keeps stale data on failure. */
    async function refresh(): Promise<void> {
        if (!usb.connected) {
            stale.value = inventory.value.length > 0;
            const local = await loadLocalInventory();
            if (local !== null && lastDevice.value !== null) {
                inventory.value = buildInventory(local, lastDevice.value);
            }
            return;
        }
        loading.value = true;
        try {
            const [infoResult, profilesResult, imagesResult, local] = await Promise.all([
                usbClient.deviceInfo(),
                usbClient.listProfiles(),
                usbClient.listImages(),
                loadLocalInventory(),
            ]);
            if (!usb.connected) {
                stale.value = inventory.value.length > 0;
                return;
            }
            const failure = [infoResult, profilesResult, imagesResult].find((result) => !result.ok);
            if (failure !== undefined && !failure.ok) {
                useAppStore().pushToast("error", failure.error);
                stale.value = inventory.value.length > 0;
                return;
            }
            if (!infoResult.ok || !profilesResult.ok || !imagesResult.ok) {
                return;
            }
            if (local === null) {
                return;
            }
            info.value = infoResult.data;

            const device: DeviceInventory = {
                profiles: profilesResult.data.map((entry) => ({
                    name: entry.name,
                    pages: (entry.pages ?? []).map((page) => ({
                        id: String(page.id || page.filename.replace(/\.json$/i, "")),
                        hash: Number(page.hash),
                    })),
                })),
                icons: imagesResult.data.map((image) => ({
                    filename: image.filename,
                    hash: Number(image.hash),
                })),
            };
            inventory.value = buildInventory(local, device);
            lastDevice.value = device;

            const planResult = await syncClient.reconcile(profile.activeProfile || undefined);
            if (planResult.ok) {
                plan.value = planResult.data;
            } else {
                useAppStore().pushToast("error", planResult.error);
                plan.value = null;
            }
            stale.value = false;
        } finally {
            loading.value = false;
        }
    }

    /** Push the current review plan, then refresh the inventory and plan. */
    async function syncNow(): Promise<boolean> {
        if (syncAction.value.disabled || plan.value === null) {
            return false;
        }
        const result = await usb.executePlan(plan.value);
        if (result !== null) {
            await refresh();
        }
        return result !== null;
    }

    /**
     * Delete one device-only file. Returns false when the call failed.
     */
    async function remove(row: InventoryRow): Promise<boolean> {
        if (!canDelete.value || (row.kind !== "page" && row.kind !== "icon")) {
            return false;
        }
        const request =
            row.kind === "page"
                ? { kind: "page" as const, profile: row.profile ?? "", id: row.pageId ?? "" }
                : { kind: "icon" as const, name: row.name };
        deletingKey.value = row.key;
        try {
            const result = await usbClient.deleteFile(request);
            if (!result.ok) {
                useAppStore().pushToast("error", result.error);
                return false;
            }
            useAppStore().pushToast("success", `Deleted "${row.name}" from the device`);
            await refresh();
            return true;
        } finally {
            deletingKey.value = null;
        }
    }

    /** Ask the main process where a page, icon or profile is still referenced. */
    async function scanReferences(query: ReferenceQuery): Promise<ReferenceScanResult | null> {
        const result = await storageClient.scanReferences(query);
        return result.ok ? result.data : null;
    }

    /**
     * Two-sided delete: the deck copy first with a missing file treated as
     * success, then the library copy, then a refresh. A deck error other than a
     * missing file aborts before the library copy goes.
     */
    async function deleteTarget(
        request: { kind: "page"; profile: string; id: string } | { kind: "icon"; name: string },
        noun: string,
        deleteLibrary: () => Promise<boolean>,
    ): Promise<boolean> {
        const connected = usb.connected;
        const scan = await scanReferences(request);
        const notes = referenceNotes(request, scan, profile.activeProfile);
        const message = [deleteConfirmation(noun, connected), ...notes].join(" ");

        const confirmed = await confirm.ask({
            title: request.kind === "page" ? "Delete page" : "Delete icon",
            message,
            confirmLabel: request.kind === "page" ? "Delete page" : "Delete icon",
            danger: true,
        });
        if (!confirmed) {
            return false;
        }
        if (connected && !usb.connected) {
            useAppStore().pushToast("warning", "The deck disconnected. Nothing was deleted.");
            return false;
        }

        deletingKey.value =
            request.kind === "page"
                ? pageInventoryKey(request.profile, request.id)
                : iconInventoryKey(request.name);
        try {
            if (connected) {
                const result = await usbClient.deleteFile({ ...request, allowMissing: true });
                if (!result.ok) {
                    useAppStore().pushToast("error", result.error);
                    return false;
                }
            }
            const removed = await deleteLibrary();
            if (!removed) {
                return false;
            }
            await refresh();
            return true;
        } finally {
            deletingKey.value = null;
        }
    }

    /** Delete a page from the library and, when connected, from the deck. */
    async function deletePage(id: string): Promise<boolean> {
        const profileName = profile.activeProfile;
        if (profileName === "" || !profile.pages.some((page) => page.id === id)) {
            return false;
        }
        return deleteTarget({ kind: "page", profile: profileName, id }, pageLabel(id), () =>
            profile.removePage(id),
        );
    }

    /** Delete an icon from the library and, when connected, from the deck. */
    async function deleteIcon(name: string): Promise<boolean> {
        return deleteTarget({ kind: "icon", name }, `Icon “${name}”`, () => icons.remove(name));
    }

    return {
        info,
        inventory,
        plan,
        loading,
        stale,
        deletingKey,
        summary,
        operations,
        plannedDeletions,
        canDelete,
        deleteDisabledReason,
        syncAction,
        refresh,
        syncNow,
        remove,
        deletePage,
        deleteIcon,
    };
});
