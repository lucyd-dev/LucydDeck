<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Trash2 } from "@lucide/vue";
import IconButton from "@/components/ui/IconButton.vue";
import { useIconStore } from "@/stores/iconStore";

const props = withDefaults(
    defineProps<{
        name: string;
        selected: boolean;
        removable?: boolean;
        removeDisabledReason?: string;
    }>(),
    { removable: false, removeDisabledReason: undefined },
);

const emit = defineEmits<{
    (event: "select", name: string): void;
    (event: "remove", name: string): void;
}>();

const icons = useIconStore();
const root = ref<HTMLElement | null>(null);
const dataUrl = ref<string | null>(icons.preview(props.name));
let observer: IntersectionObserver | null = null;

const canRemove = computed(() => props.removable && props.removeDisabledReason === undefined);
const removeLabel = computed(() =>
    props.removeDisabledReason !== undefined
        ? `Delete ${props.name} — ${props.removeDisabledReason}`
        : `Delete ${props.name}`,
);

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
    <div ref="root" class="icon-tile" :class="{ 'icon-tile--selected': props.selected }">
        <button
            class="icon-tile__select"
            type="button"
            :title="props.name"
            :aria-pressed="props.selected"
            @click="emit('select', props.name)"
            @contextmenu.prevent="canRemove && emit('remove', props.name)"
        >
            <img v-if="dataUrl" class="icon-tile__image" :src="dataUrl" :alt="props.name" />
            <span v-else class="icon-tile__placeholder">{{ props.name.slice(0, 2) }}</span>
        </button>
        <IconButton
            v-if="props.removable"
            class="icon-tile__remove"
            :label="removeLabel"
            variant="ghost"
            :disabled="props.removeDisabledReason !== undefined"
            @click.stop="emit('remove', props.name)"
        >
            <Trash2 :size="14" />
        </IconButton>
    </div>
</template>
