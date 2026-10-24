<script setup lang="ts">
import { computed } from "vue";
import Menu from "@/components/ui/Menu.vue";
import { useIconStore } from "@/stores/iconStore";
import IconTile from "./IconTile.vue";

const props = defineProps<{ selected: string }>();

const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "browse"): void;
}>();

const icons = useIconStore();

const recent = computed(() => {
    const names = [...icons.recent, ...icons.icons.map((icon) => icon.name)];
    return [...new Set(names)].slice(0, 8);
});
</script>

<template>
    <Menu align="start" aria-label="Choose icon">
        <template #trigger="{ toggle, open }">
            <slot name="trigger" :toggle="toggle" :open="open" />
        </template>
        <template #default="{ close }">
            <div class="icon-popover">
                <div class="icon-popover__head">
                    <span>Icons</span>
                    <button
                        class="icon-popover__browse"
                        type="button"
                        @click="
                            close();
                            emit('browse');
                        "
                    >
                        Browse all
                    </button>
                </div>
                <div v-if="recent.length > 0" class="icon-popover__grid">
                    <IconTile
                        v-for="name in recent"
                        :key="name"
                        :name="name"
                        :selected="props.selected === name"
                        @select="
                            emit('select', $event);
                            close();
                        "
                    />
                </div>
                <p v-else class="icon-popover__empty">
                    No icons yet — import one from the library.
                </p>
            </div>
        </template>
    </Menu>
</template>
