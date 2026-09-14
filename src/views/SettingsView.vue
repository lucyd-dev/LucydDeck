<script setup lang="ts">
import { useSettingsStore } from "@/stores/settingsStore";

const settings = useSettingsStore();
</script>

<template>
    <section class="view">
        <h1 class="view__title">Settings</h1>
        <p class="view__hint">Preferences and the firmware updater ship in Step 5.</p>
        <p class="view__context">
            Data directory: <code>{{ settings.dataDir }}</code>
        </p>
    </section>
</template>
