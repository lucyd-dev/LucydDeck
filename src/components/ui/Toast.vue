<script setup lang="ts">
import { X } from "@lucide/vue";
import type { ToastPayload } from "@shared/ipc";

defineProps<{
    level: ToastPayload["level"];
    message: string;
}>();

const emit = defineEmits<{ (event: "dismiss"): void }>();
</script>

<template>
    <div class="ui-toast" :class="`ui-toast--${level}`" role="status">
        <span class="ui-toast__message">{{ message }}</span>
        <button
            class="ui-toast__dismiss"
            type="button"
            aria-label="Dismiss"
            @click="emit('dismiss')"
        >
            <X :size="12" />
        </button>
    </div>
</template>

<style scoped>
.ui-toast {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    max-width: 420px;
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    box-shadow: var(--shadow-1);
}

.ui-toast__message {
    flex: 1;
    color: var(--color-text);
    font-size: 0.85rem;
}

.ui-toast__dismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2xs);
    border: none;
    background: transparent;
    color: var(--color-text-dim);
}

.ui-toast__dismiss:hover {
    color: var(--color-text);
}

.ui-toast--success {
    border-color: var(--color-success);
}

.ui-toast--warning {
    border-color: var(--color-warning);
}

.ui-toast--error {
    border-color: var(--color-error);
}
</style>
