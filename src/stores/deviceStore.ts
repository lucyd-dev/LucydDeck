import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { DeviceInfo, IpcResponse, ReferenceQuery, ReferenceScanResult } from "@shared/ipc";
import type { DeleteResult } from "@shared/delete";
import { diffPlanDeletions, diffPlanOperations, planRemovesProfiles } from "@shared/sync";
import type { DiffPlan } from "@shared/sync";
import { pageLabel } from "@shared/pages";
import { deleteClient, iconsClient, storageClient, syncClient, usbClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useFirmwareStore } from "@/stores/firmwareStore";
import { useIconStore } from "@/stores/iconStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";
import { buildInventory, summarizeInventory } from "@/device/inventory";
import type {
    DeviceInventory,
    InventoryRow,
    LocalInventory,
    LocalProfileSummary,
} from "@/device/inventory";
import { deleteConfirmation, deleteOutcome, referenceNotes } from "@/device/references";
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
    const firmware = useFirmwareStore();

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
    const plannedProfileRemovals = computed(() =>
        plan.value === null ? 0 : plan.value.profilesToDelete.length,
    );
    /** Why no deck write may start: a sync or a firmware update owns the deck. */
    const deckWriteBlockedReason = computed<string | undefined>(() => {
        if (firmware.installing) {
            return "Wait for the firmware update to finish";
        }
        if (usb.syncing) {
            return "Wait for the sync to finish";
        }
        return undefined;
    });
    const deleteDisabledReason = computed<string | undefined>(() => {
        const busy = deckWriteBlockedReason.value;
        if (busy !== undefined) {
            return busy;
        }
        if (!usb.connected) {
            return "Connect the deck to delete device files";
        }
        if (stale.value) {
            return "Reconnect and refresh the inventory first";
        }
        return undefined;
    });
    const canDelete = computed(() => deleteDisabledReason.value === undefined);
    const syncAction = computed(() =>
        readSyncAction({
            connected: usb.connected,
            stale: stale.value,
            syncing: usb.syncing,
            updating: firmware.installing,
            planLoaded: plan.value !== null,
            pendingChanges: operations.value,
            plannedRemovals: plannedDeletions.value,
            plannedProfileRemovals: plannedProfileRemovals.value,
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

            // No active-profile request: device info carries no current profile,
            // so asking for one made every refresh plan a change the deck could
            // not be compared against, and the header then promised a sync that
            // never went away. The deck keeps its own active profile.
            const planResult = await syncClient.reconcile();
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
        const current = plan.value;
        if (syncAction.value.disabled || current === null) {
            return false;
        }
        // A profile removal takes its pages with it, so it is the one removal
        // the button asks about before running. Page and icon removals stay
        // covered by the label and the Review list.
        if (planRemovesProfiles(current)) {
            const names = current.profilesToDelete;
            const confirmed = await confirm.ask({
                title: names.length === 1 ? "Remove a deck profile" : "Remove deck profiles",
                message:
                    `This sync removes ${names.map((name) => `“${name}”`).join(", ")} from the ` +
                    `deck, including the pages ${
                        names.length === 1 ? "it holds" : "they hold"
                    }. The library has no copy of ${
                        names.length === 1 ? "that profile" : "those profiles"
                    }.`,
                confirmLabel:
                    names.length === 1 ? "Remove profile and sync" : "Remove profiles and sync",
                danger: true,
            });
            if (!confirmed) {
                return false;
            }
        }
        const result = await usb.executePlan(current, { allowRemovals: true });
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
     * Confirm and report one two-sided delete; the main process owns both
     * sides. The blocker is checked before the dialog, then the reference scan
     * supplies the notes, and the aftermath runs only when the library copy is
     * gone. A deck or library failure leaves the caller's state alone so the
     * retry is the same action again.
     */
    async function deleteThroughOwner(options: {
        noun: string;
        request: ReferenceQuery;
        title: string;
        confirmLabel: string;
        settle?: () => Promise<unknown>;
        deleteItem: () => Promise<IpcResponse<DeleteResult>>;
        applyAftermath?: () => Promise<void>;
    }): Promise<boolean> {
        const blocked = deckWriteBlockedReason.value;
        if (blocked !== undefined) {
            useAppStore().pushToast("warning", blocked);
            return false;
        }

        const scan = await scanReferences(options.request);
        const notes = referenceNotes(options.request, scan, profile.activeProfile);
        const confirmed = await confirm.ask({
            title: options.title,
            message: [deleteConfirmation(options.noun, usb.connected), ...notes].join(" "),
            confirmLabel: options.confirmLabel,
            danger: true,
        });
        if (!confirmed) {
            return false;
        }

        await options.settle?.();

        const result = await options.deleteItem();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return false;
        }
        const outcome = deleteOutcome(options.noun, result.data);
        useAppStore().pushToast(outcome.level, outcome.message);
        if (result.data.library.status !== "deleted") {
            return false;
        }

        await options.applyAftermath?.();
        await refresh();
        return true;
    }

    /**
     * Delete an icon through the main-process owner. A failed side leaves the
     * icon, its preview and its recent entry in place.
     */
    async function deleteIcon(name: string): Promise<boolean> {
        if (!icons.has(name)) {
            return false;
        }
        return deleteThroughOwner({
            noun: `Icon “${name}”`,
            request: { kind: "icon", name },
            title: "Delete icon",
            confirmLabel: "Delete icon",
            deleteItem: () => deleteClient.icon(name),
            applyAftermath: () => icons.applyIconDeleted(name),
        });
    }

    /**
     * Delete a page through the main-process owner. A failed side leaves the
     * page, its editor state and the inventory in place. A pending or in-flight
     * save is settled first so it cannot write the page back after the delete.
     */
    async function deletePage(id: string): Promise<boolean> {
        const profileName = profile.activeProfile;
        if (profileName === "" || !profile.pages.some((page) => page.id === id)) {
            return false;
        }
        return deleteThroughOwner({
            noun: pageLabel(id),
            request: { kind: "page", profile: profileName, id },
            title: "Delete page",
            confirmLabel: "Delete page",
            settle: () => profile.flushPending(),
            deleteItem: () => deleteClient.page(profileName, id),
            applyAftermath: () => profile.applyPageDeleted(profileName, id),
        });
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
        plannedProfileRemovals,
        canDelete,
        deleteDisabledReason,
        deckWriteBlockedReason,
        syncAction,
        refresh,
        syncNow,
        remove,
        deletePage,
        deleteIcon,
    };
});
