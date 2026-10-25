<script setup lang="ts">
import { computed } from "vue";
import { usePluginStore } from "@/stores/pluginStore";

const plugins = usePluginStore();
const count = computed(() => plugins.plugins.length);
</script>

<template>
    <div class="deck-sidebar">
        <p class="sidebar__section-title">Plugins</p>
        <nav class="sidebar__nav" aria-label="Plugin sections">
            <RouterLink
                class="sidebar__nav-item sidebar__nav-item--active"
                :to="{ name: 'plugins' }"
            >
                <span>Installed</span>
                <span class="sidebar__nav-count">{{ count }}</span>
            </RouterLink>
        </nav>
    </div>
</template>
