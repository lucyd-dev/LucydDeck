<script setup lang="ts">
import { Plus } from "@lucide/vue";
import BoardCanvas from "@/components/board/BoardCanvas.vue";
import { useProfileStore } from "@/stores/profileStore";

const profile = useProfileStore();

function selectPage(id: string): void {
    void profile.selectPage(id);
}

function createPage(): void {
    void profile.createPage();
}
</script>

<template>
    <section class="view view--board">
        <header v-if="profile.hasProfile" class="board-header">
            <div class="page-switcher" role="tablist" aria-label="Pages">
                <button
                    v-for="(page, index) in profile.pages"
                    :key="page.id"
                    class="page-switcher__pill"
                    :class="{ 'page-switcher__pill--active': page.id === profile.currentPageId }"
                    type="button"
                    role="tab"
                    :aria-selected="page.id === profile.currentPageId"
                    @click="selectPage(page.id)"
                >
                    Page {{ index + 1 }}
                </button>
                <button
                    class="page-switcher__add"
                    type="button"
                    title="New page"
                    aria-label="New page"
                    @click="createPage"
                >
                    <Plus :size="14" />
                </button>
            </div>
        </header>

        <p v-if="!profile.hasProfile" class="view__hint">
            Create or select a profile to start editing.
        </p>
        <BoardCanvas v-else-if="profile.hasPage" />
        <p v-else class="view__hint">This profile has no pages yet — create one to start editing.</p>
    </section>
</template>
