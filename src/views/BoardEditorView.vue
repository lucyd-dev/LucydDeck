<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import BoardCanvas from "@/components/board/BoardCanvas.vue";
import { useProfileStore } from "@/stores/profileStore";

const profile = useProfileStore();

function onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
        return;
    }
    const target = event.target as HTMLElement | null;
    const ownsKeys = target?.closest(
        "input, textarea, select, [contenteditable='true'], [role='dialog']",
    );
    if (ownsKeys !== undefined && ownsKeys !== null) {
        // Typing has its own undo; a dialog owns its own keys.
        return;
    }
    event.preventDefault();
    if (event.shiftKey) {
        profile.redo();
    } else {
        profile.undo();
    }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
    <section class="view view--board">
        <p v-if="!profile.hasProfile" class="view__hint">
            Create or select a profile to start editing.
        </p>
        <BoardCanvas v-else-if="profile.hasPage" />
        <p v-else class="view__hint">
            This profile has no pages yet — create one to start editing.
        </p>
    </section>
</template>
