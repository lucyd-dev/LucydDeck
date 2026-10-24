<script setup lang="ts">
const model = defineModel<string | number>({ default: "" });

withDefaults(
    defineProps<{
        id?: string;
        type?: "text" | "search" | "color" | "number" | "password";
        placeholder?: string;
        disabled?: boolean;
        invalid?: boolean;
        autocomplete?: string;
        min?: string | number;
        max?: string | number;
        step?: string | number;
        ariaLabel?: string;
    }>(),
    {
        id: undefined,
        type: "text",
        placeholder: undefined,
        disabled: false,
        invalid: false,
        autocomplete: "off",
        min: undefined,
        max: undefined,
        step: undefined,
        ariaLabel: undefined,
    },
);
</script>

<template>
    <input
        :id="id"
        v-model="model"
        class="ui-input"
        :class="{ 'ui-input--invalid': invalid }"
        :type="type"
        :placeholder="placeholder"
        :disabled="disabled"
        :autocomplete="autocomplete"
        :min="min"
        :max="max"
        :step="step"
        :aria-label="ariaLabel"
        :aria-invalid="invalid || undefined"
    />
</template>

<style scoped>
.ui-input {
    width: 100%;
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-input-bg);
    color: var(--color-text);
    font-size: 0.85rem;
}

.ui-input::placeholder {
    color: var(--color-text-faint);
}

.ui-input:focus {
    border-color: var(--color-accent);
    outline: none;
}

.ui-input--invalid {
    border-color: var(--color-error);
}

.ui-input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.ui-input[type="color"] {
    width: 38px;
    height: 30px;
    padding: 0;
    background: transparent;
}
</style>
