<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

withDefaults(
    defineProps<{
        align?: "start" | "end";
        ariaLabel?: string;
        /** Span the nearest positioned ancestor instead of the trigger. */
        wide?: boolean;
    }>(),
    {
        align: "start",
        ariaLabel: undefined,
        wide: false,
    },
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle(): void {
    open.value = !open.value;
    if (open.value) {
        void nextTick(focusFirst);
    }
}

function close(): void {
    open.value = false;
}

function focusFirst(): void {
    const items = menuItems();
    items[0]?.focus();
}

function menuItems(): HTMLElement[] {
    if (root.value === null) {
        return [];
    }
    return Array.from(
        root.value.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    );
}

function onPointerDown(event: MouseEvent): void {
    if (root.value !== null && !root.value.contains(event.target as Node)) {
        close();
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (!open.value) {
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
    }
    const items = menuItems();
    if (items.length === 0) {
        return;
    }
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + delta + items.length) % items.length;
    items[next].focus();
}

onMounted(() => {
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
    document.removeEventListener("mousedown", onPointerDown);
    document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
    <div ref="root" class="ui-menu" :class="{ 'ui-menu--wide': wide }">
        <slot name="trigger" :open="open" :toggle="toggle" />
        <div
            v-if="open"
            class="ui-menu__panel"
            :class="[`ui-menu__panel--${align}`, { 'ui-menu__panel--wide': wide }]"
            role="menu"
            :aria-label="ariaLabel"
        >
            <slot :close="close" />
        </div>
    </div>
</template>

<style scoped>
.ui-menu {
    position: relative;
    min-width: 0;
}

/* Anchor to the positioned ancestor so a panel can span a whole panel row. */
.ui-menu--wide {
    position: static;
}

.ui-menu__panel {
    position: absolute;
    top: calc(100% + var(--space-xs));
    z-index: var(--z-menu);
    min-width: 220px;
    padding: var(--space-xs);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    box-shadow: var(--shadow-2);
}

.ui-menu__panel--start {
    left: 0;
}

.ui-menu__panel--end {
    right: 0;
}

.ui-menu__panel--wide {
    right: 0;
    left: 0;
    min-width: 0;
}
</style>
