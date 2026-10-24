<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";

const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        size?: "sm" | "md" | "lg";
        closeOnBackdrop?: boolean;
    }>(),
    {
        description: undefined,
        size: "md",
        closeOnBackdrop: true,
    },
);

const emit = defineEmits<{ (event: "close"): void }>();

const panel = ref<HTMLElement | null>(null);
const titleId = useId();
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
    if (panel.value === null) {
        return [];
    }
    return Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        emit("close");
        return;
    }
    if (event.key !== "Tab") {
        return;
    }
    const items = focusables();
    if (items.length === 0) {
        event.preventDefault();
        panel.value?.focus();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.value)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

function onBackdrop(): void {
    if (props.closeOnBackdrop) {
        emit("close");
    }
}

onMounted(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.classList.add("ui-dialog-open");
    void nextTick(() => {
        const items = focusables();
        (items[0] ?? panel.value)?.focus();
    });
});

onBeforeUnmount(() => {
    document.body.classList.remove("ui-dialog-open");
    previouslyFocused?.focus?.();
});
</script>

<template>
    <Teleport to="body">
        <div class="ui-dialog" role="presentation" @mousedown.self="onBackdrop">
            <section
                ref="panel"
                class="ui-dialog__panel"
                :class="`ui-dialog__panel--${size}`"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="titleId"
                tabindex="-1"
                @keydown="onKeydown"
            >
                <header class="ui-dialog__header">
                    <div>
                        <h2 :id="titleId" class="ui-dialog__title">{{ title }}</h2>
                        <p v-if="description" class="ui-dialog__description">{{ description }}</p>
                    </div>
                    <button
                        class="ui-dialog__close"
                        type="button"
                        aria-label="Close"
                        @click="emit('close')"
                    >
                        <slot name="close-icon">×</slot>
                    </button>
                </header>
                <div class="ui-dialog__body">
                    <slot />
                </div>
                <footer v-if="$slots.footer" class="ui-dialog__footer">
                    <slot name="footer" />
                </footer>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
.ui-dialog {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xl);
    background-color: var(--color-overlay);
    backdrop-filter: blur(2px);
}

.ui-dialog__panel {
    display: flex;
    flex-direction: column;
    width: min(480px, 100%);
    max-height: calc(100vh - 2 * var(--space-xl));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-bg-elevated);
    box-shadow: var(--shadow-3);
    overflow: hidden;
}

.ui-dialog__panel--sm {
    width: min(400px, 100%);
}

.ui-dialog__panel--lg {
    width: min(760px, 100%);
}

.ui-dialog__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-lg);
    padding: var(--space-md) var(--space-lg);
    border-bottom: 1px solid var(--color-border);
}

.ui-dialog__title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
}

.ui-dialog__description {
    margin: var(--space-2xs) 0 0;
    color: var(--color-text-dim);
    font-size: 0.82rem;
}

.ui-dialog__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-hover);
    color: var(--color-text-dim);
    font-size: 1.1rem;
    line-height: 1;
}

.ui-dialog__close:hover {
    color: var(--color-text);
}

.ui-dialog__body {
    min-height: 0;
    padding: var(--space-lg);
    overflow-y: auto;
}

.ui-dialog__footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-sm);
    padding: var(--space-md) var(--space-lg);
    border-top: 1px solid var(--color-border);
}
</style>

<style>
body.ui-dialog-open {
    overflow: hidden;
}
</style>
