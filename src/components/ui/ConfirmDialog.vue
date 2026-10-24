<script setup lang="ts">
import Dialog from "./Dialog.vue";
import Button from "./Button.vue";

withDefaults(
    defineProps<{
        title: string;
        message: string;
        confirmLabel?: string;
        cancelLabel?: string;
        danger?: boolean;
    }>(),
    {
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        danger: false,
    },
);

const emit = defineEmits<{
    (event: "confirm"): void;
    (event: "cancel"): void;
}>();
</script>

<template>
    <Dialog :title="title" size="sm" @close="emit('cancel')">
        <p class="ui-confirm__message">{{ message }}</p>
        <template #footer>
            <Button variant="ghost" @click="emit('cancel')">{{ cancelLabel }}</Button>
            <Button :variant="danger ? 'danger' : 'primary'" @click="emit('confirm')">
                {{ confirmLabel }}
            </Button>
        </template>
    </Dialog>
</template>

<style scoped>
.ui-confirm__message {
    margin: 0;
    color: var(--color-text-dim);
    font-size: 0.88rem;
    line-height: 1.55;
}
</style>
