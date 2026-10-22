<script setup lang="ts">
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import { useConfirmStore } from "@/stores/confirmStore";
import { useIconStore } from "@/stores/iconStore";
import IconTile from "./IconTile.vue";

const props = defineProps<{ selected: string }>();
const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "close"): void;
}>();

const icons = useIconStore();
const confirm = useConfirmStore();

async function remove(name: string): Promise<void> {
    const confirmed = await confirm.ask({
        title: "Delete icon",
        message: `Delete icon "${name}" from the library? Keys that use it will show a missing-icon warning.`,
        confirmLabel: "Delete icon",
        danger: true,
    });
    if (confirmed) {
        await icons.remove(name);
    }
}
</script>

<template>
    <Dialog title="Select Icon" @close="emit('close')">
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

        <template #footer>
            <Button variant="ghost" :disabled="props.selected === ''" @click="emit('select', '')">
                Clear selection
            </Button>
        </template>
    </Dialog>
</template>
