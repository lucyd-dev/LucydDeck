<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { AlertTriangle } from "@lucide/vue";
import { useIconStore } from "@/stores/iconStore";
import type { ButtonConfig } from "@shared/types";

const props = defineProps<{
    index: number;
    button?: ButtonConfig;
    selected: boolean;
}>();

const emit = defineEmits<{ (event: "select", index: string): void }>();

const icons = useIconStore();
const key = String(props.index);
const dataUrl = ref<string | null>(null);
const resolved = ref(false);

const missingIcon = computed(
    () => props.button?.imageName !== undefined && resolved.value && dataUrl.value === null,
);

async function loadPreview(): Promise<void> {
    const name = props.button?.imageName;
    if (!name) {
        dataUrl.value = null;
        resolved.value = true;
        return;
    }
    resolved.value = false;
    dataUrl.value = await icons.ensurePreview(name);
    resolved.value = true;
}

onMounted(loadPreview);
watch(() => props.button?.imageName, loadPreview);
</script>

<template>
    <button
        class="key-button"
        :class="{
            'key-button--selected': props.selected,
            'key-button--empty': !props.button,
        }"
        :style="props.button?.backgroundColor ? { backgroundColor: props.button.backgroundColor } : undefined"
        type="button"
        :aria-pressed="props.selected"
        @click="emit('select', key)"
    >
        <img
            v-if="dataUrl"
            class="key-button__icon"
            :src="dataUrl"
            :alt="props.button?.label ?? ''"
        />
        <span v-else-if="missingIcon" class="key-button__missing" title="Icon not found">
            <AlertTriangle :size="18" />
        </span>
        <span v-else class="key-button__index">{{ props.index + 1 }}</span>

        <span v-if="props.button?.label" class="key-button__label">{{ props.button.label }}</span>

        <span
            v-if="props.button && props.button.click.length > 0"
            class="key-button__badges"
        >
            <span class="key-button__badge"> C{{ props.button.click.length }} </span>
        </span>
    </button>
</template>
