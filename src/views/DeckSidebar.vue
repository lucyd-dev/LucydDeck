<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { FilePlus2, PanelRight, Plus, Trash2 } from "@lucide/vue";
import { BOARD_SIZE } from "@shared/schema";
import { pageLabel } from "@shared/pages";
import type { PageConfig } from "@shared/types";
import { storageClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import EmptyState from "@/components/ui/EmptyState.vue";
import IconButton from "@/components/ui/IconButton.vue";
import ScrollArea from "@/components/ui/ScrollArea.vue";
import ProfileMenu from "@/components/layout/ProfileMenu.vue";
import { useDeviceStore } from "@/stores/deviceStore";
import { useProfileStore } from "@/stores/profileStore";

const app = useAppStore();
const profile = useProfileStore();
const device = useDeviceStore();
const deletingPageId = ref<string | null>(null);

const previews = ref<Record<string, PageConfig>>({});
let previewSeq = 0;

const pageKey = computed(() => profile.pages.map((page) => page.id).join(","));

watch(
    [() => profile.activeProfile, pageKey],
    async () => {
        const seq = ++previewSeq;
        const entries: Record<string, PageConfig> = {};
        await Promise.all(
            profile.pages.map(async (page) => {
                if (page.id === profile.currentPageId) {
                    entries[page.id] = profile.currentPage;
                    return;
                }
                const result = await storageClient.loadPage(profile.activeProfile, page.id);
                if (result.ok) {
                    entries[page.id] = result.data;
                }
            }),
        );
        if (seq === previewSeq) {
            previews.value = entries;
        }
    },
    { immediate: true },
);

// Keep the open page's thumbnail live while its keys are edited.
watch(
    () => profile.currentPage,
    (page) => {
        const id = profile.currentPageId;
        if (id !== null) {
            previews.value = { ...previews.value, [id]: page };
        }
    },
    { deep: true },
);

function cells(id: string): Array<string | undefined> {
    const page = previews.value[id];
    return Array.from({ length: BOARD_SIZE }, (_, index) => {
        const button = page?.buttons[String(index)];
        return button?.backgroundColor;
    });
}

function selectPage(id: string): void {
    void profile.selectPage(id);
}

function createPage(): void {
    void profile.createPage();
}

async function removePage(id: string): Promise<void> {
    deletingPageId.value = id;
    try {
        await device.deletePage(id);
    } finally {
        deletingPageId.value = null;
    }
}
</script>

<template>
    <div class="deck-sidebar">
        <div v-if="app.narrow" class="deck-sidebar__actions">
            <IconButton
                label="Inspector"
                :active="app.inspectorOpen"
                variant="ghost"
                @click="app.toggleInspector()"
            >
                <PanelRight :size="16" />
            </IconButton>
        </div>

        <ProfileMenu />

        <div class="sidebar__section-head">
            <p class="sidebar__section-title">Pages</p>
            <IconButton
                label="New page"
                variant="ghost"
                :disabled="!profile.hasProfile"
                @click="createPage"
            >
                <Plus :size="14" />
            </IconButton>
        </div>
        <ScrollArea v-if="profile.pages.length > 0" class="page-list">
            <div
                v-for="page in profile.pages"
                :key="page.id"
                class="page-card"
                :class="{ 'page-card--active': page.id === profile.currentPageId }"
            >
                <button
                    class="page-card__select"
                    type="button"
                    :aria-current="page.id === profile.currentPageId ? 'page' : undefined"
                    @click="selectPage(page.id)"
                >
                    <span class="page-thumb" aria-hidden="true">
                        <span
                            v-for="(background, cell) in cells(page.id)"
                            :key="cell"
                            class="page-thumb__cell"
                            :style="background ? { '--page-cell': background } : undefined"
                        ></span>
                    </span>
                    <span class="page-card__body">
                        <span class="page-card__name">{{ pageLabel(page.id) }}</span>
                    </span>
                </button>
                <IconButton
                    class="page-card__delete"
                    :label="`Delete ${pageLabel(page.id)}`"
                    variant="ghost"
                    :disabled="
                        device.deckWriteBlockedReason !== undefined || deletingPageId === page.id
                    "
                    @click="removePage(page.id)"
                >
                    <Trash2 :size="14" />
                </IconButton>
            </div>
        </ScrollArea>

        <EmptyState
            v-else-if="profile.hasProfile"
            title="No pages yet"
            description="Create a page to start placing keys."
            :icon="FilePlus2"
            compact
        />

        <p v-if="device.deckWriteBlockedReason" class="deck-sidebar__hint">
            {{ device.deckWriteBlockedReason }}
        </p>

        <p v-if="!profile.hasProfile" class="deck-sidebar__hint">
            Choose a profile above, or create one from the profile menu.
        </p>
    </div>
</template>
