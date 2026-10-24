<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
    value: string | null;
    side: "local" | "device";
}>();

const absent = computed(() => {
    if (props.value !== null) {
        return undefined;
    }
    return props.side === "local" ? "No local copy" : "Not on deck";
});
</script>

<template>
    <span class="hash" :class="{ 'hash--absent': absent !== undefined }" :title="absent">
        <span aria-hidden="true">{{ value ?? "—" }}</span>
        <span v-if="absent !== undefined" class="sr-only">{{ absent }}</span>
    </span>
</template>
