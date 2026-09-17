import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { storageClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import type { PageMeta, ProfileMeta } from "@shared/types";

/** Profile editing state: active profile, its pages, and the selected key. */
export const useProfileStore = defineStore("profile", () => {
    const profiles = ref<ProfileMeta[]>([]);
    const activeProfile = ref<string>("");
    const pages = ref<PageMeta[]>([]);
    const selectedKey = ref<string | null>(null);
    const saving = ref(false);
    let pagesRequestSeq = 0;

    async function refreshProfiles(): Promise<void> {
        const result = await storageClient.listProfiles();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        profiles.value = result.data;
    }

    async function refreshPages(profile: string | null = activeProfile.value): Promise<void> {
        const requestSeq = ++pagesRequestSeq;
        if (profile === null || profile === "") {
            if (requestSeq === pagesRequestSeq) {
                pages.value = [];
            }
            return;
        }
        const result = await storageClient.listPages(profile);
        // Discard stale responses when the user switched profile meanwhile.
        if (requestSeq !== pagesRequestSeq) {
            return;
        }
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        pages.value = result.data;
    }

    function selectProfile(profile: string): void {
        activeProfile.value = profile;
        void refreshPages(profile);
    }

    function selectKey(id: string | null): void {
        selectedKey.value = id;
    }

    const hasProfile = computed(() => activeProfile.value !== "");

    return {
        profiles,
        activeProfile,
        pages,
        selectedKey,
        saving,
        hasProfile,
        refreshProfiles,
        refreshPages,
        selectProfile,
        selectKey,
    };
});
