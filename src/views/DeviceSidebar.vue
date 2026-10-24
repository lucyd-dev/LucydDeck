<script setup lang="ts">
import { useSectionQuery } from "@/composables/useSectionQuery";
import {
    DEVICE_SECTION_IDS,
    DEVICE_SECTIONS,
    DEFAULT_DEVICE_SECTION,
} from "@/views/deviceSections";
import { useDeviceStore } from "@/stores/deviceStore";

const device = useDeviceStore();

const section = useSectionQuery("device", DEVICE_SECTION_IDS, DEFAULT_DEVICE_SECTION);
</script>

<template>
    <div class="deck-sidebar">
        <p class="sidebar__section-title">Device</p>
        <nav class="sidebar__nav" aria-label="Device sections">
            <RouterLink
                v-for="item in DEVICE_SECTIONS"
                :key="item.id"
                class="sidebar__nav-item"
                :class="{ 'sidebar__nav-item--active': section === item.id }"
                :to="{ name: 'device', query: { section: item.id } }"
            >
                <span> <component :is="item.icon" :size="14" /> {{ item.label }} </span>
                <span v-if="item.id === 'files'" class="sidebar__nav-count">
                    {{ device.inventory.length }}
                </span>
                <span v-if="item.id === 'review'" class="sidebar__nav-count">
                    {{ device.operations + device.plannedDeletions }}
                </span>
            </RouterLink>
        </nav>

        <p v-if="device.stale" class="sidebar__hint">
            The device disconnected. The last inventory stays visible, but sync and cleanup are
            disabled.
        </p>
    </div>
</template>
