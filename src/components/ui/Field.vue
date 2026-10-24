<script setup lang="ts">
import { useId } from "vue";

withDefaults(
    defineProps<{
        label?: string;
        hint?: string;
        error?: string;
        id?: string;
    }>(),
    {
        label: undefined,
        hint: undefined,
        error: undefined,
        id: undefined,
    },
);

const generatedId = useId();
</script>

<template>
    <label class="ui-field" :for="id ?? generatedId">
        <span v-if="label !== undefined" class="ui-field__label">{{ label }}</span>
        <slot :id="id ?? generatedId" />
        <span v-if="error !== undefined && error !== ''" class="ui-field__error" role="alert">
            {{ error }}
        </span>
        <span v-else-if="hint !== undefined" class="ui-field__hint">{{ hint }}</span>
    </label>
</template>

<style scoped>
.ui-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
}

.ui-field__label {
    color: var(--color-text-dim);
    font-size: 0.78rem;
    font-weight: 600;
}

.ui-field__hint {
    color: var(--color-text-faint);
    font-size: 0.76rem;
}

.ui-field__error {
    color: var(--color-error);
    font-size: 0.76rem;
}
</style>
