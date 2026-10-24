<script setup lang="ts">
import { useSectionQuery } from "@/composables/useSectionQuery";
import {
    DEFAULT_SETTINGS_SECTION,
    SETTINGS_SECTION_IDS,
    SETTINGS_SECTIONS,
} from "@/views/settingsSections";

const section = useSectionQuery("settings", SETTINGS_SECTION_IDS, DEFAULT_SETTINGS_SECTION);
</script>

<template>
    <div class="deck-sidebar">
        <p class="sidebar__section-title">Settings</p>
        <nav class="sidebar__nav" aria-label="Settings sections">
            <RouterLink
                v-for="item in SETTINGS_SECTIONS"
                :key="item.id"
                class="sidebar__nav-item"
                :class="{ 'sidebar__nav-item--active': section === item.id }"
                :to="{ name: 'settings', query: { section: item.id } }"
            >
                <span> <component :is="item.icon" :size="14" /> {{ item.label }} </span>
            </RouterLink>
        </nav>
    </div>
</template>
