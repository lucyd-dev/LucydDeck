<script setup lang="ts">
withDefaults(
    defineProps<{
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md";
        type?: "button" | "submit" | "reset";
        disabled?: boolean;
        loading?: boolean;
        block?: boolean;
    }>(),
    {
        variant: "secondary",
        size: "md",
        type: "button",
        disabled: false,
        loading: false,
        block: false,
    },
);
</script>

<template>
    <button
        class="ui-button"
        :class="[
            `ui-button--${variant}`,
            `ui-button--${size}`,
            { 'ui-button--block': block, 'ui-button--loading': loading },
        ]"
        :type="type"
        :disabled="disabled || loading"
    >
        <span v-if="loading" class="ui-button__spinner" aria-hidden="true"></span>
        <slot />
    </button>
</template>

<style scoped>
.ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-hover);
    color: var(--color-text);
    font-weight: 600;
    line-height: 1.2;
    transition:
        border-color var(--transition-fast),
        background-color var(--transition-fast),
        color var(--transition-fast);
}

.ui-button:hover:not(:disabled) {
    border-color: var(--color-text-faint);
}

.ui-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.ui-button--sm {
    padding: var(--space-2xs) var(--space-sm);
    font-size: 0.78rem;
}

.ui-button--md {
    padding: var(--space-xs) var(--space-md);
    font-size: 0.85rem;
}

.ui-button--block {
    width: 100%;
}

.ui-button--primary {
    border-color: var(--color-accent);
    background-color: var(--color-accent);
    color: var(--color-accent-contrast);
}

.ui-button--primary:hover:not(:disabled) {
    border-color: var(--color-accent);
    background-color: color-mix(in srgb, var(--color-accent) 86%, var(--color-text));
}

.ui-button--secondary {
    background-color: var(--color-bg-hover);
    color: var(--color-text);
}

.ui-button--ghost {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-dim);
}

.ui-button--ghost:hover:not(:disabled) {
    border-color: var(--color-border);
    background-color: var(--color-bg-hover);
    color: var(--color-text);
}

.ui-button--danger {
    border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border));
    background-color: color-mix(in srgb, var(--color-error) 14%, transparent);
    color: var(--color-error);
}

.ui-button--danger:hover:not(:disabled) {
    border-color: var(--color-error);
    background-color: color-mix(in srgb, var(--color-error) 22%, transparent);
}

.ui-button__spinner {
    width: 0.8em;
    height: 0.8em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: ui-button-spin 700ms linear infinite;
}

@keyframes ui-button-spin {
    to {
        transform: rotate(360deg);
    }
}
</style>
