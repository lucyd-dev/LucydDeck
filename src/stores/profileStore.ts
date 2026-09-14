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

    async function refreshProfiles(): Promise<void> {
        const result = await storageClient.listProfiles();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        profiles.value = result.data;
    }

    async function refreshPages(profile: string | null = activeProfile.value): Promise<void> {
        if (profile === null || profile === "") {
            pages.value = [];
            return;
        }
        const result = await storageClient.listPages(profile);
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
