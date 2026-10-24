<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import {
    AlertTriangle,
    Cpu,
    FileJson,
    Folder,
    Image as ImageIcon,
    RefreshCw,
    Upload,
    Usb,
} from "@lucide/vue";
import { pageLabel } from "@shared/pages";
import Button from "@/components/ui/Button.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import Tooltip from "@/components/ui/Tooltip.vue";
import HashValue from "@/components/device/HashValue.vue";
import InventoryDeleteButton from "@/components/device/InventoryDeleteButton.vue";
import { useSectionQuery } from "@/composables/useSectionQuery";
import type { InventoryRow, InventoryState } from "@/device/inventory";
import { useConfirmStore } from "@/stores/confirmStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useUsbStore } from "@/stores/usbStore";
import { DEFAULT_DEVICE_SECTION, DEVICE_SECTION_IDS } from "@/views/deviceSections";

const confirm = useConfirmStore();
const usb = useUsbStore();
const device = useDeviceStore();
const active = useSectionQuery("device", DEVICE_SECTION_IDS, DEFAULT_DEVICE_SECTION);

const profileGroups = computed(() =>
    device.inventory
        .filter((row) => row.kind === "profile")
        .map((profile) => ({
            profile,
            pages: device.inventory.filter(
                (row) => row.kind === "page" && row.profile === profile.name,
            ),
        })),
);
const iconRows = computed(() => device.inventory.filter((row) => row.kind === "icon"));

const planOperations = computed(() => device.operations);
const deviceOnlyCount = computed(
    () =>
        device.inventory.filter((row) => row.kind !== "profile" && row.state === "device-only")
            .length,
);

const STATE_LABEL: Record<InventoryState, string> = {
    "in-sync": "In sync",
    "local-only": "Local only",
    "device-only": "Device only",
    "out-of-sync": "Changed",
};

const STATE_TONE: Record<InventoryState, string> = {
    "in-sync": "success",
    "local-only": "warning",
    "device-only": "info",
    "out-of-sync": "error",
};

function formatSpace(kb: number): string {
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

function rowIcon(row: InventoryRow) {
    if (row.kind === "profile") {
        return Folder;
    }
    return row.kind === "page" ? FileJson : ImageIcon;
}

function isDeletableRow(row: InventoryRow): boolean {
    return row.kind !== "profile" && row.state === "device-only";
}

async function removeRow(row: InventoryRow): Promise<void> {
    if (!isDeletableRow(row) || device.deleteDisabledReason !== undefined) {
        return;
    }
    const confirmed = await confirm.ask({
        title: "Delete device file",
        message: `Delete "${row.name}" from the deck? The local copy, if any, is not touched.`,
        confirmLabel: "Delete from deck",
        danger: true,
    });
    if (confirmed) {
        await device.remove(row);
    }
}

function reviewNames(items: Array<{ name?: string; profile?: string; id?: string }>): string[] {
    return items.map((item) =>
        item.profile !== undefined && item.id !== undefined
            ? `${item.profile} / ${pageLabel(item.id)}`
            : (item.name ?? ""),
    );
}

onMounted(() => {
    void device.refresh();
});

watch(
    () => usb.connected,
    (connected) => {
        if (connected) {
            void device.refresh();
        }
    },
);
</script>

<template>
    <section class="view">
        <header class="view-header">
            <div>
                <h1 class="view-header__title">Device</h1>
                <p class="view-header__subtitle">
                    {{ usb.connected ? "Connected deck" : "No deck connected" }}
                </p>
            </div>
            <div class="view-header__actions">
                <Button
                    :variant="usb.connected ? 'secondary' : 'primary'"
                    :loading="usb.busy"
                    @click="usb.toggle()"
                >
                    <Usb :size="14" />
                    <span>{{ usb.connected ? "Disconnect" : "Connect" }}</span>
                </Button>
                <Button
                    :disabled="!usb.connected || device.loading"
                    :loading="device.loading"
                    @click="device.refresh()"
                >
                    <RefreshCw :size="14" />
                    <span>Refresh</span>
                </Button>
                <div class="device-sync">
                    <template v-if="usb.syncing">
                        <span
                            class="progress"
                            role="progressbar"
                            :aria-valuenow="usb.syncProgress?.percent ?? 0"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-label="Sync progress"
                        >
                            <span
                                class="progress__bar"
                                :style="{ width: `${usb.syncProgress?.percent ?? 0}%` }"
                            ></span>
                        </span>
                        <span class="progress-label">
                            {{ usb.syncProgress?.message ?? usb.syncProgress?.phase ?? "Syncing…" }}
                        </span>
                    </template>
                    <Tooltip v-else :text="device.syncAction.hint" placement="bottom" align="end">
                        <Button
                            variant="primary"
                            :disabled="device.syncAction.disabled"
                            @click="device.syncNow()"
                        >
                            <Upload :size="14" />
                            <span>{{ device.syncAction.label }}</span>
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </header>

        <div v-if="device.stale" class="device-banner">
            <AlertTriangle :size="15" />
            <span>
                The device disconnected. Showing the last inventory from this session; sync and
                cleanup are disabled until it reconnects.
            </span>
        </div>

        <template v-if="active === 'info'">
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title"><Cpu :size="15" /> Deck information</h2>
                    <span
                        class="badge"
                        :class="usb.connected ? 'badge--success' : 'badge--warning'"
                    >
                        {{ usb.connected ? "Connected" : "Disconnected" }}
                    </span>
                </div>

                <template v-if="device.info">
                    <div class="info-grid">
                        <div class="info-item">
                            <p class="info-item__label">Firmware</p>
                            <p class="info-item__value">{{ device.info.firmwareVersion || "—" }}</p>
                        </div>
                        <div class="info-item">
                            <p class="info-item__label">Protocol</p>
                            <p class="info-item__value">{{ device.info.protocolVersion || "—" }}</p>
                        </div>
                        <div class="info-item">
                            <p class="info-item__label">Board</p>
                            <p class="info-item__value">{{ device.info.board || "—" }}</p>
                        </div>
                        <div class="info-item">
                            <p class="info-item__label">Free space</p>
                            <p class="info-item__value">
                                {{ formatSpace(device.info.freeSpaceKb) }}
                            </p>
                        </div>
                    </div>
                </template>

                <EmptyState
                    v-else
                    :icon="Usb"
                    :title="usb.connected ? 'No device information yet' : 'No deck connected'"
                    :description="
                        usb.connected
                            ? 'Refresh to read the firmware version, board and free space.'
                            : 'Connect the deck to read its firmware version, board and free space.'
                    "
                    compact
                />
            </div>
        </template>

        <template v-else-if="active === 'files'">
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Inventory</h2>
                    <span class="badge">{{ device.inventory.length }} entries</span>
                </div>
                <p class="settings-section__intro">
                    Every profile, page and icon compared with the local copy by CRC32.
                </p>

                <div class="inventory-toolbar">
                    <span class="badge badge--success">{{ device.summary.inSync }} in sync</span>
                    <span class="badge badge--warning">
                        {{ device.summary.localOnly }} local only
                    </span>
                    <span class="badge badge--info">
                        {{ device.summary.deviceOnly }} device only
                    </span>
                    <span v-if="device.summary.outOfSync > 0" class="badge badge--error">
                        {{ device.summary.outOfSync }} changed
                    </span>
                </div>

                <div v-if="device.inventory.length > 0" class="inventory-row inventory-row--head">
                    <span aria-hidden="true"></span>
                    <span></span>
                    <span class="hash">Local CRC32</span>
                    <span class="hash">Deck CRC32</span>
                    <span></span>
                    <span></span>
                </div>

                <EmptyState
                    v-if="device.inventory.length === 0"
                    title="No inventory yet"
                    :description="
                        usb.connected
                            ? 'Refresh to compare the deck with the local library.'
                            : 'Connect the deck to see its profiles, pages and icons.'
                    "
                    compact
                />

                <template v-else>
                    <div
                        v-for="group in profileGroups"
                        :key="group.profile.key"
                        class="inventory-group"
                    >
                        <p class="inventory-group__title">Profiles</p>
                        <div
                            v-for="row in [group.profile, ...group.pages]"
                            :key="row.key"
                            class="inventory-row"
                            :class="`inventory-row--${row.kind}`"
                        >
                            <component :is="rowIcon(row)" :size="14" class="inventory-row__meta" />
                            <span class="inventory-row__name">
                                <span class="inventory-row__name-text">{{ row.name }}</span>
                            </span>
                            <HashValue :value="row.localHash" side="local" />
                            <HashValue :value="row.deviceHash" side="device" />
                            <span class="badge" :class="`badge--${STATE_TONE[row.state]}`">
                                {{ STATE_LABEL[row.state] }}
                            </span>
                            <span class="inventory-row__actions">
                                <InventoryDeleteButton
                                    v-if="isDeletableRow(row)"
                                    :row="row"
                                    :disabled-reason="device.deleteDisabledReason"
                                    :deleting="device.deletingKey === row.key"
                                    @delete="removeRow(row)"
                                />
                            </span>
                        </div>
                    </div>

                    <div class="inventory-group">
                        <p class="inventory-group__title">Icons</p>
                        <EmptyState
                            v-if="iconRows.length === 0"
                            title="No icons"
                            description="Import icons from the inspector to add them to the deck."
                            compact
                        />
                        <template v-else>
                            <div
                                v-for="row in iconRows"
                                :key="row.key"
                                class="inventory-row"
                                :class="`inventory-row--${row.kind}`"
                            >
                                <component
                                    :is="rowIcon(row)"
                                    :size="14"
                                    class="inventory-row__meta"
                                />
                                <span class="inventory-row__name">
                                    <span class="inventory-row__name-text">{{ row.name }}</span>
                                </span>
                                <HashValue :value="row.localHash" side="local" />
                                <HashValue :value="row.deviceHash" side="device" />
                                <span class="badge" :class="`badge--${STATE_TONE[row.state]}`">
                                    {{ STATE_LABEL[row.state] }}
                                </span>
                                <span class="inventory-row__actions">
                                    <InventoryDeleteButton
                                        v-if="isDeletableRow(row)"
                                        :row="row"
                                        :disabled-reason="device.deleteDisabledReason"
                                        :deleting="device.deletingKey === row.key"
                                        @delete="removeRow(row)"
                                    />
                                </span>
                            </div>
                        </template>
                    </div>

                    <p v-if="deviceOnlyCount > 0" class="review-footer__note">
                        {{ deviceOnlyCount }} device-only
                        {{ deviceOnlyCount === 1 ? "file" : "files" }}.
                        <template v-if="device.deleteDisabledReason">
                            {{ device.deleteDisabledReason }}
                        </template>
                        <template v-else>
                            Delete them here, or let the next sync remove them.
                        </template>
                    </p>
                </template>
            </div>
        </template>

        <template v-else>
            <div class="card">
                <div class="card__header">
                    <h2 class="card__title">Review changes</h2>
                    <span
                        class="badge"
                        :class="planOperations === 0 ? 'badge--success' : 'badge--info'"
                    >
                        {{ planOperations }} operation(s)
                    </span>
                </div>

                <EmptyState
                    v-if="device.plan === null"
                    :icon="RefreshCw"
                    title="No review loaded"
                    description="Connect and refresh the deck to plan the next sync."
                    compact
                />

                <template v-else>
                    <div class="review-groups">
                        <div class="review-group">
                            <p class="review-group__label">Profiles to create</p>
                            <p class="review-group__count">
                                {{ device.plan.profilesToCreate.length }}
                            </p>
                            <ul v-if="device.plan.profilesToCreate.length > 0" class="review-list">
                                <li v-for="name in device.plan.profilesToCreate" :key="name">
                                    {{ name }}
                                </li>
                            </ul>
                        </div>
                        <div class="review-group">
                            <p class="review-group__label">Pages to upload</p>
                            <p class="review-group__count">
                                {{ device.plan.pagesToUpload.length }}
                            </p>
                            <ul v-if="device.plan.pagesToUpload.length > 0" class="review-list">
                                <li
                                    v-for="name in reviewNames(device.plan.pagesToUpload)"
                                    :key="name"
                                >
                                    {{ name }}
                                </li>
                            </ul>
                        </div>
                        <div class="review-group">
                            <p class="review-group__label">Icons to upload</p>
                            <p class="review-group__count">
                                {{ device.plan.iconsToUpload.length }}
                            </p>
                            <ul v-if="device.plan.iconsToUpload.length > 0" class="review-list">
                                <li
                                    v-for="name in reviewNames(device.plan.iconsToUpload)"
                                    :key="name"
                                >
                                    {{ name }}
                                </li>
                            </ul>
                        </div>
                        <div class="review-group">
                            <p class="review-group__label">Files to remove</p>
                            <p class="review-group__count">
                                {{ device.plannedDeletions }}
                            </p>
                            <ul v-if="device.plannedDeletions > 0" class="review-list">
                                <li
                                    v-for="name in [
                                        ...reviewNames(device.plan.pagesToDelete),
                                        ...reviewNames(device.plan.iconsToDelete),
                                    ]"
                                    :key="name"
                                >
                                    {{ name }}
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div
                        v-if="device.plan.missingIcons.length > 0"
                        class="device-banner"
                        style="margin-top: var(--space-md)"
                    >
                        <AlertTriangle :size="15" />
                        <span>
                            Missing icon(s): {{ reviewNames(device.plan.missingIcons).join(", ") }}.
                            Upload them before the pages that reference them.
                        </span>
                    </div>

                    <div class="review-footer">
                        <div class="review-footer__note">
                            <p>
                                {{ device.summary.inSync }} file(s) already match and stay
                                untouched.
                                <template v-if="device.plannedDeletions > 0">
                                    {{ device.plannedDeletions }}
                                    {{ device.plannedDeletions === 1 ? "file" : "files" }} that
                                    {{ device.plannedDeletions === 1 ? "is" : "are" }} only on the
                                    deck {{ device.plannedDeletions === 1 ? "is" : "are" }} removed
                                    by this sync.
                                </template>
                            </p>
                            <p v-if="device.plan.setActiveProfile">
                                The deck switches to profile
                                <strong>{{ device.plan.setActiveProfile }}</strong> after the sync.
                            </p>
                        </div>
                        <template v-if="usb.syncing">
                            <span
                                class="progress"
                                role="progressbar"
                                :aria-valuenow="usb.syncProgress?.percent ?? 0"
                                aria-valuemin="0"
                                aria-valuemax="100"
                            >
                                <span
                                    class="progress__bar"
                                    :style="{ width: `${usb.syncProgress?.percent ?? 0}%` }"
                                ></span>
                            </span>
                            <span class="progress-label">
                                {{
                                    usb.syncProgress?.message ??
                                    usb.syncProgress?.phase ??
                                    "Syncing…"
                                }}
                            </span>
                        </template>
                    </div>
                </template>
            </div>
        </template>
    </section>
</template>
