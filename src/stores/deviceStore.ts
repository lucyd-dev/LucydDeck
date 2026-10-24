import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { DeviceInfo } from "@shared/ipc";
import { diffPlanOperations } from "@shared/sync";
import type { DiffPlan } from "@shared/sync";
import { iconsClient, storageClient, syncClient, usbClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import { useProfileStore } from "@/stores/profileStore";
import { useUsbStore } from "@/stores/usbStore";
import { buildInventory, summarizeInventory } from "@/device/inventory";
import type {
    DeviceInventory,
    InventoryRow,
    LocalInventory,
    LocalProfileSummary,
} from "@/device/inventory";

/**
 * Device view state: the last device info and inventory, the sync review plan,
 * and a stale marker. A disconnect keeps the last inventory and marks it stale
 * (sync and cleanup are disabled) instead of blanking the view.
 */
export const useDeviceStore = defineStore("device", () => {
    const usb = useUsbStore();
    const profile = useProfileStore();

    const info = ref<DeviceInfo | null>(null);
    const inventory = ref<InventoryRow[]>([]);
    const plan = ref<DiffPlan | null>(null);
    const loading = ref(false);
    const stale = ref(false);
    const deletingKey = ref<string | null>(null);

    const summary = computed(() => summarizeInventory(inventory.value));
    const operations = computed(() => (plan.value === null ? 0 : diffPlanOperations(plan.value)));
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
    const syncDisabledReason = computed<string | undefined>(() => {
        if (!usb.connected) {
            return "Connect the deck before syncing";
        }
        if (stale.value) {
            return "Reconnect and refresh the inventory before syncing";
        }
        if (usb.syncing) {
            return "A sync is already running";
        }
        if (plan.value === null) {
            return "The review has not loaded yet";
        }
        if (operations.value === 0) {
            return "Nothing to sync";
        }
        return undefined;
    });

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
    async function push(): Promise<boolean> {
        if (plan.value === null || !usb.connected) {
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

    return {
        info,
        inventory,
        plan,
        loading,
        stale,
        deletingKey,
        summary,
        operations,
        canDelete,
        deleteDisabledReason,
        syncDisabledReason,
        refresh,
        push,
        remove,
    };
});
