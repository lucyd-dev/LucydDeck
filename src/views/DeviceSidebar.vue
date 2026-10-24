<script setup lang="ts">
import { RefreshCw, ShieldAlert } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import IconButton from "@/components/ui/IconButton.vue";
import { useSectionQuery } from "@/composables/useSectionQuery";
import {
    DEVICE_SECTION_IDS,
    DEVICE_SECTIONS,
    DEFAULT_DEVICE_SECTION,
} from "@/views/deviceSections";
import { useDeviceStore } from "@/stores/deviceStore";
import { useUsbStore } from "@/stores/usbStore";

const usb = useUsbStore();
const device = useDeviceStore();

const section = useSectionQuery("device", DEVICE_SECTION_IDS, DEFAULT_DEVICE_SECTION);
</script>

<template>
    <div class="deck-sidebar">
        <div class="deck-sidebar__actions">
            <IconButton
                label="Refresh device and inventory"
                :disabled="!usb.connected || device.loading"
                @click="device.refresh()"
            >
                <RefreshCw :size="16" :class="{ 'is-spinning': device.loading }" />
            </IconButton>
            <Button
                size="sm"
                :disabled="!usb.connected || device.loading"
                @click="device.refresh()"
            >
                Refresh
            </Button>
        </div>

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
                    {{ device.operations }}
                </span>
            </RouterLink>
        </nav>

        <p class="sidebar__section-title">Capabilities</p>
        <p class="sidebar__hint">
            <ShieldAlert :size="13" />
            File deletion:
            <template v-if="device.deleteDisabledReason">
                {{ device.deleteDisabledReason }}
            </template>
            <template v-else> supported</template>
        </p>
        <p v-if="device.stale" class="sidebar__hint">
            The device disconnected. The last inventory stays visible, but sync and cleanup are
            disabled.
        </p>
    </div>
</template>
