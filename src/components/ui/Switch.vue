<script setup lang="ts">
const model = defineModel<boolean>({ default: false });

withDefaults(
    defineProps<{
        label?: string;
        disabled?: boolean;
        ariaLabel?: string;
    }>(),
    {
        label: undefined,
        disabled: false,
        ariaLabel: undefined,
    },
);
</script>

<template>
    <button
        class="ui-switch"
        :class="{ 'ui-switch--on': model, 'ui-switch--disabled': disabled }"
        type="button"
        role="switch"
        :aria-checked="model"
        :aria-label="ariaLabel ?? label"
        :disabled="disabled"
        @click="model = !model"
    >
        <span class="ui-switch__track"><span class="ui-switch__thumb"></span></span>
        <span v-if="label !== undefined" class="ui-switch__label">{{ label }}</span>
    </button>
</template>

<style scoped>
.ui-switch {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
}

.ui-switch__track {
    display: inline-flex;
    align-items: center;
    width: 34px;
    height: 20px;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    background-color: var(--color-bg-hover);
    transition: background-color var(--transition-fast);
}

.ui-switch__thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background-color: var(--color-text-dim);
    transition: transform var(--transition-fast);
}

.ui-switch--on .ui-switch__track {
    border-color: var(--color-accent);
    background-color: var(--color-accent-soft);
}

.ui-switch--on .ui-switch__thumb {
    background-color: var(--color-accent);
    transform: translateX(14px);
}

.ui-switch--disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
</style>
