import { ref } from "vue";
import { defineStore } from "pinia";
import { iconsClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import type { IconMeta } from "@shared/ipc";

const RECENT_STORAGE_KEY = "lucyd.recent-icons";
const RECENT_LIMIT = 8;

function readRecent(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_STORAGE_KEY);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed
                  .filter((item): item is string => typeof item === "string")
                  .slice(0, RECENT_LIMIT)
            : [];
    } catch {
        return [];
    }
}

function writeRecent(names: string[]): void {
    try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(names));
    } catch {
        // The recent list is a convenience; the icon library is authoritative.
    }
}

/**
 * Local icon library. The renderer cannot read data-dir files directly, so
 * previews come from the `icons:preview` data-URL cache (loaded lazily by the
 * components that render an icon).
 */
export const useIconStore = defineStore("icons", () => {
    const icons = ref<IconMeta[]>([]);
    const previews = ref<Record<string, string | null>>({});
    const recent = ref<string[]>(readRecent());
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

    /** True while the library still lists this icon. */
    function has(name: string): boolean {
        return icons.value.some((icon) => icon.name === name);
    }

    /** Remember the last icons picked in the inspector's quick popover. */
    function markRecent(name: string): void {
        if (name === "") {
            return;
        }
        recent.value = [name, ...recent.value.filter((item) => item !== name)].slice(
            0,
            RECENT_LIMIT,
        );
        writeRecent(recent.value);
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

    /**
     * Apply the in-memory aftermath of an icon delete the main process already
     * made: drop the cached preview and the recent entry, then re-list. A
     * library copy that survived keeps all three, so the delete can be retried.
     */
    async function applyIconDeleted(name: string): Promise<void> {
        invalidate(name);
        recent.value = recent.value.filter((item) => item !== name);
        writeRecent(recent.value);
        await refresh();
    }

    return {
        icons,
        previews,
        recent,
        refresh,
        ensurePreview,
        preview,
        has,
        markRecent,
        invalidate,
        importIcons,
        importData,
        applyIconDeleted,
    };
});
