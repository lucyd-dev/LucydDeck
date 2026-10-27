<script setup lang="ts">
import { computed, ref } from "vue";
import { Ban, ImagePlus, Search } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import Input from "@/components/ui/Input.vue";
import { useDeviceStore } from "@/stores/deviceStore";
import { useIconStore } from "@/stores/iconStore";
import IconTile from "./IconTile.vue";

const props = defineProps<{ selected: string }>();
const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "close"): void;
    (event: "import"): void;
}>();

const icons = useIconStore();
const device = useDeviceStore();
const query = ref("");
const deleteBlockedReason = computed(() => device.deckWriteBlockedReason);

const visible = computed(() => {
    const search = query.value.trim().toLowerCase();
    if (search === "") {
        return icons.icons;
    }
    return icons.icons.filter((icon) => icon.name.toLowerCase().includes(search));
});

async function remove(name: string): Promise<void> {
    await device.deleteIcon(name);
}
</script>

<template>
    <Dialog title="Icons" size="lg" @close="emit('close')">
        <p class="icon-library__hint">
            Choose a PNG for this key. Right-click an icon to delete it; icons are stored at
            140×140.
        </p>
        <p v-if="deleteBlockedReason" class="icon-library__blocked">
            Deleting icons is unavailable. {{ deleteBlockedReason }}.
        </p>

        <label class="icon-library__search">
            <Search :size="14" />
            <Input
                v-model="query"
                type="search"
                placeholder="Search icons…"
                aria-label="Search icons"
            />
        </label>

        <div v-if="visible.length > 0" class="icon-library__grid">
            <button
                class="icon-tile icon-tile--none"
                :class="{ 'icon-tile--selected': props.selected === '' }"
                type="button"
                title="No image"
                :aria-pressed="props.selected === ''"
                @click="emit('select', '')"
            >
                <Ban :size="18" />
            </button>
            <IconTile
                v-for="icon in visible"
                :key="icon.name"
                :name="icon.name"
                :selected="props.selected === icon.name"
                removable
                :remove-disabled-reason="deleteBlockedReason"
                @select="emit('select', $event)"
                @remove="remove"
            />
        </div>
        <p v-else-if="icons.icons.length === 0" class="icon-library__empty">
            No icons yet — import a PNG to get started.
        </p>
        <p v-else class="icon-library__empty">No icons match “{{ query }}”.</p>

        <template #footer>
            <span class="icon-library__spacer"></span>
            <Button variant="ghost" @click="emit('import')">
                <ImagePlus :size="14" />
                <span>Import PNG</span>
            </Button>
            <Button variant="primary" @click="emit('close')">Done</Button>
        </template>
    </Dialog>
</template>
