<script setup lang="ts">
import { RouterLink } from "vue-router";

withDefaults(
    defineProps<{
        label: string;
        to?: string;
        variant?: "secondary" | "ghost";
        active?: boolean;
        disabled?: boolean;
    }>(),
    {
        to: undefined,
        variant: "secondary",
        active: false,
        disabled: false,
    },
);
</script>

<template>
    <component
        :is="to === undefined ? 'button' : RouterLink"
        class="ui-icon-button"
        :class="[
            `ui-icon-button--${variant}`,
            { 'ui-icon-button--active': active, 'ui-icon-button--disabled': disabled },
        ]"
        :to="to"
        :type="to === undefined ? 'button' : undefined"
        :aria-label="label"
        :title="label"
        :aria-current="active ? 'page' : undefined"
        :disabled="to === undefined && disabled ? true : undefined"
        :tabindex="disabled ? -1 : undefined"
    >
        <slot />
    </component>
</template>

<style scoped>
.ui-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-hover);
    color: var(--color-text-dim);
    transition:
        color var(--transition-fast),
        border-color var(--transition-fast),
        background-color var(--transition-fast);
}

.ui-icon-button:hover:not(:disabled) {
    border-color: var(--color-text-faint);
    color: var(--color-text);
}

.ui-icon-button--ghost {
    border-color: transparent;
    background: transparent;
}

.ui-icon-button--active {
    border-color: var(--color-accent);
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
}

.ui-icon-button--disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
</style>
