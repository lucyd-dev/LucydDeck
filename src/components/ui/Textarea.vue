<script setup lang="ts">
const model = defineModel<string>({ default: "" });

withDefaults(
    defineProps<{
        id?: string;
        rows?: number;
        placeholder?: string;
        disabled?: boolean;
        invalid?: boolean;
        ariaLabel?: string;
        mono?: boolean;
    }>(),
    {
        id: undefined,
        rows: 3,
        placeholder: undefined,
        disabled: false,
        invalid: false,
        ariaLabel: undefined,
        mono: false,
    },
);
</script>

<template>
    <textarea
        :id="id"
        v-model="model"
        class="ui-textarea"
        :class="{ 'ui-textarea--invalid': invalid, 'ui-textarea--mono': mono }"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel"
        :aria-invalid="invalid || undefined"
    ></textarea>
</template>

<style scoped>
.ui-textarea {
    width: 100%;
    min-width: 0;
    padding: var(--space-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-input-bg);
    color: var(--color-text);
    font: inherit;
    font-size: 0.85rem;
    resize: vertical;
}

.ui-textarea--mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
}

.ui-textarea::placeholder {
    color: var(--color-text-faint);
}

.ui-textarea:focus {
    border-color: var(--color-accent);
    outline: none;
}

.ui-textarea--invalid {
    border-color: var(--color-error);
}

.ui-textarea:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}
</style>
