<script setup lang="ts">
import { X } from "@lucide/vue";
import { useIconStore } from "@/stores/iconStore";
import IconTile from "./IconTile.vue";

const props = defineProps<{ selected: string }>();
const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "close"): void;
}>();

const icons = useIconStore();

async function remove(name: string): Promise<void> {
    if (!window.confirm(`Delete icon "${name}" from the library?`)) {
        return;
    }
    await icons.remove(name);
}
</script>

<template>
    <div class="icon-gallery" role="dialog" aria-modal="true" aria-label="Icon gallery">
        <div class="icon-gallery__dialog">
            <header class="icon-gallery__header">
                <h3 class="icon-gallery__title">Select Icon</h3>
                <button
                    class="icon-gallery__close"
                    type="button"
                    title="Close gallery"
                    @click="emit('close')"
                >
                    <X :size="16" />
                </button>
            </header>

            <p class="inspector-section__hint">
                Right-click an icon to delete it. Icons are stored as 140×140 PNGs.
            </p>

            <div v-if="icons.icons.length > 0" class="icon-gallery__grid">
                <IconTile
                    v-for="icon in icons.icons"
                    :key="icon.name"
                    :name="icon.name"
                    :selected="props.selected === icon.name"
                    @select="emit('select', $event)"
                    @remove="remove"
                />
            </div>
            <p v-else class="inspector-section__hint">No icons yet — import one to get started.</p>

            <div class="icon-gallery__footer">
                <button
                    class="icon-gallery__clear"
                    type="button"
                    :disabled="props.selected === ''"
                    @click="emit('select', '')"
                >
                    Clear selection
                </button>
            </div>
        </div>
    </div>
</template>
