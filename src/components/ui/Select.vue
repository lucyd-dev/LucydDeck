<script setup lang="ts">
const model = defineModel<string>({ default: "" });

withDefaults(
    defineProps<{
        id?: string;
        options?: Array<{ value: string; label: string; disabled?: boolean }>;
        placeholder?: string;
        disabled?: boolean;
        ariaLabel?: string;
    }>(),
    {
        id: undefined,
        options: () => [],
        placeholder: undefined,
        disabled: false,
        ariaLabel: undefined,
    },
);
</script>

<template>
    <select :id="id" v-model="model" class="ui-select" :disabled="disabled" :aria-label="ariaLabel">
        <option v-if="placeholder !== undefined" value="" disabled>{{ placeholder }}</option>
        <slot>
            <option
                v-for="option in options"
                :key="option.value"
                :value="option.value"
                :disabled="option.disabled"
            >
                {{ option.label }}
            </option>
        </slot>
    </select>
</template>

<style scoped>
.ui-select {
    width: 100%;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-input-bg);
    color: var(--color-text);
    font-size: 0.85rem;
}

.ui-select:focus {
    border-color: var(--color-accent);
    outline: none;
}

.ui-select:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
</style>
