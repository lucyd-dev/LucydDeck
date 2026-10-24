<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useIconStore } from "@/stores/iconStore";

const props = withDefaults(
    defineProps<{
        name: string;
        selected: boolean;
        removable?: boolean;
    }>(),
    { removable: false },
);

const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "remove", name: string): void;
}>();

const icons = useIconStore();
const root = ref<HTMLElement | null>(null);
const dataUrl = ref<string | null>(icons.preview(props.name));
let observer: IntersectionObserver | null = null;

async function load(): Promise<void> {
    dataUrl.value = await icons.ensurePreview(props.name);
}

onMounted(() => {
    if (dataUrl.value !== null) {
        return;
    }
    observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            void load();
            observer?.disconnect();
            observer = null;
        }
    });
    if (root.value) {
        observer.observe(root.value);
    }
});

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
});
</script>

<template>
    <button
        ref="root"
        class="icon-tile"
        :class="{ 'icon-tile--selected': props.selected }"
        type="button"
        :title="props.name"
        :aria-pressed="props.selected"
        @click="emit('select', props.name)"
        @contextmenu.prevent="props.removable && emit('remove', props.name)"
    >
        <img v-if="dataUrl" class="icon-tile__image" :src="dataUrl" :alt="props.name" />
        <span v-else class="icon-tile__placeholder">{{ props.name.slice(0, 2) }}</span>
    </button>
</template>
