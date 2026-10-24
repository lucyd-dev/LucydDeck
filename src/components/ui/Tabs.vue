<script setup lang="ts">
interface TabItem {
    id: string;
    label: string;
    icon?: unknown;
    disabled?: boolean;
}

withDefaults(
    defineProps<{
        items: TabItem[];
        ariaLabel?: string;
        stretch?: boolean;
    }>(),
    {
        ariaLabel: undefined,
        stretch: false,
    },
);

const model = defineModel<string>({ required: true });
</script>

<template>
    <div
        class="ui-tabs"
        :class="{ 'ui-tabs--stretch': stretch }"
        role="tablist"
        :aria-label="ariaLabel"
    >
        <button
            v-for="item in items"
            :key="item.id"
            class="ui-tab"
            :class="{ 'ui-tab--active': model === item.id }"
            type="button"
            role="tab"
            :aria-selected="model === item.id"
            :disabled="item.disabled"
            @click="model = item.id"
        >
            <component :is="item.icon" v-if="item.icon" :size="14" />
            <span>{{ item.label }}</span>
        </button>
    </div>
</template>

<style scoped>
.ui-tabs {
    display: inline-flex;
    gap: var(--space-2xs);
    padding: var(--space-2xs);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-bg-elevated);
}

.ui-tabs--stretch {
    display: flex;
}

.ui-tabs--stretch .ui-tab {
    flex: 1;
}

.ui-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-dim);
    font-size: 0.82rem;
    font-weight: 600;
}

.ui-tab:hover:not(:disabled) {
    background-color: var(--color-bg-hover);
    color: var(--color-text);
}

.ui-tab--active {
    border-color: var(--color-accent);
    background-color: var(--color-accent-soft);
    color: var(--color-accent);
}

.ui-tab:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}
</style>
