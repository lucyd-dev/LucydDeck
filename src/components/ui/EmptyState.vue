<script setup lang="ts">
withDefaults(
    defineProps<{
        title: string;
        description?: string;
        icon?: unknown;
        compact?: boolean;
    }>(),
    {
        description: undefined,
        icon: undefined,
        compact: false,
    },
);
</script>

<template>
    <div class="ui-empty" :class="{ 'ui-empty--compact': compact }">
        <component :is="icon" v-if="icon" :size="compact ? 18 : 24" class="ui-empty__icon" />
        <p class="ui-empty__title">{{ title }}</p>
        <p v-if="description" class="ui-empty__description">{{ description }}</p>
        <div v-if="$slots.default" class="ui-empty__action">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.ui-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-2xl) var(--space-lg);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    text-align: center;
}

.ui-empty--compact {
    padding: var(--space-lg);
}

.ui-empty__icon {
    color: var(--color-text-faint);
}

.ui-empty__title {
    margin: 0;
    color: var(--color-text-dim);
    font-size: 0.9rem;
    font-weight: 600;
}

.ui-empty__description {
    max-width: 420px;
    margin: 0;
    color: var(--color-text-faint);
    font-size: 0.82rem;
    line-height: 1.5;
}

.ui-empty__action {
    margin-top: var(--space-xs);
}
</style>
