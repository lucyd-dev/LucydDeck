<script setup lang="ts">
import { ref } from "vue";

defineProps<{ text: string }>();

const visible = ref(false);
</script>

<template>
    <span
        class="ui-tooltip"
        @mouseenter="visible = true"
        @mouseleave="visible = false"
        @focusin="visible = true"
        @focusout="visible = false"
    >
        <slot />
        <span v-if="visible" class="ui-tooltip__bubble" role="tooltip">{{ text }}</span>
    </span>
</template>

<style scoped>
.ui-tooltip {
    position: relative;
    display: inline-flex;
}

.ui-tooltip__bubble {
    position: absolute;
    bottom: calc(100% + var(--space-xs));
    left: 50%;
    z-index: var(--z-menu);
    max-width: 260px;
    padding: var(--space-2xs) var(--space-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface);
    box-shadow: var(--shadow-1);
    color: var(--color-text);
    font-size: 0.76rem;
    line-height: 1.4;
    pointer-events: none;
    transform: translateX(-50%);
    white-space: normal;
    width: max-content;
}
</style>
