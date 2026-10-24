<script setup lang="ts">
import { Plug } from "@lucide/vue";
import EmptyState from "@/components/ui/EmptyState.vue";

const view = {
    title: "Plugins",
    hint: "Plugins are host-side handlers reached from a key's CMD: step.",
};
</script>

<template>
    <section class="view">
        <header class="view-header">
            <div>
                <h1 class="view-header__title">{{ view.title }}</h1>
                <p class="view-header__subtitle">{{ view.hint }}</p>
            </div>
        </header>

        <EmptyState
            title="No plugins installed"
            description="Install a plugin from a zip file or a developer folder in a later step. The plugin runtime is not part of this build yet."
            :icon="Plug"
        />
    </section>
</template>
