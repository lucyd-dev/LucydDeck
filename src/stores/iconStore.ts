import { ref } from "vue";
import { defineStore } from "pinia";
import { iconsClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import type { IconMeta } from "@shared/ipc";

/**
 * Local icon library. The renderer cannot read data-dir files directly, so
 * previews come from the `icons:preview` data-URL cache (loaded lazily by the
 * components that render an icon).
 */
export const useIconStore = defineStore("icons", () => {
    const icons = ref<IconMeta[]>([]);
    const previews = ref<Record<string, string | null>>({});
    const inflight = new Map<string, Promise<string | null>>();

    async function refresh(): Promise<void> {
        const result = await iconsClient.list();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        icons.value = result.data;
    }

    /**
     * Resolve (and cache) the data URL for one icon; `null` when missing.
     * Concurrent callers for the same icon share one in-flight request.
     */
    function ensurePreview(name: string): Promise<string | null> {
        if (Object.prototype.hasOwnProperty.call(previews.value, name)) {
            return Promise.resolve(previews.value[name]);
        }
        const existing = inflight.get(name);
        if (existing) {
            return existing;
        }
        const task = (async () => {
            try {
                const result = await iconsClient.preview(name);
                const dataUrl = result.ok ? (result.data?.dataUrl ?? null) : null;
                previews.value[name] = dataUrl;
                return dataUrl;
            } finally {
                inflight.delete(name);
            }
        })();
        inflight.set(name, task);
        return task;
    }

    function preview(name: string): string | null {
        return previews.value[name] ?? null;
    }

    function invalidate(name?: string): void {
        if (name === undefined) {
            previews.value = {};
        } else {
            delete previews.value[name];
        }
    }

    /** Import via the native picker (or explicit paths); returns imported meta. */
    async function importIcons(paths?: string[]): Promise<IconMeta[]> {
        const result = await iconsClient.import(paths);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return [];
        }
        invalidate();
        await refresh();
        return result.data;
    }

    /** Import an in-memory (cropped) image as a data URL; returns its meta. */
    async function importData(name: string, dataUrl: string): Promise<IconMeta | null> {
        const result = await iconsClient.importData(name, dataUrl);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return null;
        }
        invalidate();
        await refresh();
        return result.data;
    }

    async function remove(name: string): Promise<void> {
        const result = await iconsClient.remove(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        invalidate(name);
        await refresh();
    }

    return {
        icons,
        previews,
        refresh,
        ensurePreview,
        preview,
        invalidate,
        importIcons,
        importData,
        remove,
    };
});
