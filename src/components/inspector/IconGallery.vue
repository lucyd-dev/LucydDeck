<script setup lang="ts">
import { computed, ref } from "vue";
import { Search } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import Input from "@/components/ui/Input.vue";
import { useConfirmStore } from "@/stores/confirmStore";
import { useIconStore } from "@/stores/iconStore";
import IconTile from "./IconTile.vue";

const props = defineProps<{ selected: string }>();
const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "close"): void;
    (event: "import"): void;
}>();

const icons = useIconStore();
const confirm = useConfirmStore();
const query = ref("");

const visible = computed(() => {
    const search = query.value.trim().toLowerCase();
    if (search === "") {
        return icons.icons;
    }
    return icons.icons.filter((icon) => icon.name.toLowerCase().includes(search));
});

async function remove(name: string): Promise<void> {
    const confirmed = await confirm.ask({
        title: "Delete icon",
        message: `Delete icon "${name}" from the library? Keys that use it will show a missing-icon warning.`,
        confirmLabel: "Delete icon",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    await icons.remove(name);
}
</script>

<template>
    <Dialog title="Icons" size="lg" @close="emit('close')">
        <p class="icon-library__hint">
            Choose a PNG for this key. Right-click an icon to delete it; icons are stored at
            140×140.
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
            <IconTile
                v-for="icon in visible"
                :key="icon.name"
                :name="icon.name"
                :selected="props.selected === icon.name"
                removable
                @select="emit('select', $event)"
                @remove="remove"
            />
        </div>
        <p v-else-if="icons.icons.length === 0" class="icon-library__empty">
            No icons yet — import a PNG to get started.
        </p>
        <p v-else class="icon-library__empty">No icons match “{{ query }}”.</p>

        <template #footer>
            <Button variant="ghost" :disabled="props.selected === ''" @click="emit('select', '')">
                Clear selection
            </Button>
            <span class="icon-library__spacer"></span>
            <Button @click="emit('import')">Import PNG</Button>
            <Button variant="primary" @click="emit('close')">Done</Button>
        </template>
    </Dialog>
</template>
