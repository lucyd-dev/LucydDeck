<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
    Check,
    ChevronDown,
    Download,
    MoreVertical,
    Pencil,
    Plus,
    Star,
    Trash2,
    Upload,
    X,
} from "@lucide/vue";
import IconButton from "@/components/ui/IconButton.vue";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useProfileStore } from "@/stores/profileStore";
import { storageClient } from "@/ipc/client";
import { referenceNotes } from "@/device/references";

const profile = useProfileStore();
const app = useAppStore();
const confirm = useConfirmStore();

const open = ref(false);
const rowMenu = ref<string | null>(null);
const mode = ref<"create" | "rename" | null>(null);
const draft = ref("");
const root = ref<HTMLElement | null>(null);

const canDelete = computed(() => profile.profiles.length > 1);

function toggleOpen(): void {
    open.value = !open.value;
    rowMenu.value = null;
}

function close(): void {
    open.value = false;
    rowMenu.value = null;
    mode.value = null;
}

function onDocumentPointerDown(event: MouseEvent): void {
    if (root.value !== null && !root.value.contains(event.target as Node)) {
        close();
    }
}

onMounted(() => document.addEventListener("mousedown", onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentPointerDown));

function choose(name: string): void {
    close();
    void profile.selectProfile(name);
}

function toggleRowMenu(name: string, event: MouseEvent): void {
    event.stopPropagation();
    rowMenu.value = rowMenu.value === name ? null : name;
}

async function setDefault(name: string): Promise<void> {
    rowMenu.value = null;
    await profile.setDefaultProfile(name);
}

function startRename(name: string): void {
    rowMenu.value = null;
    mode.value = "rename";
    draft.value = name;
}

function startCreate(): void {
    rowMenu.value = null;
    mode.value = "create";
    draft.value = "";
    open.value = true;
}

function cancelEdit(): void {
    mode.value = null;
    draft.value = "";
}

async function submitEdit(): Promise<void> {
    const name = draft.value.trim();
    const current = mode.value;
    if (name === "") {
        app.pushToast("warning", "Profile name cannot be empty");
        return;
    }
    cancelEdit();
    if (current === "create") {
        await profile.createProfile(name);
    } else if (current === "rename" && name !== profile.activeProfile) {
        await profile.renameProfile(profile.activeProfile, name);
    }
}

async function exportProfile(name: string): Promise<void> {
    rowMenu.value = null;
    await profile.exportProfile(name);
}

async function removeProfile(name: string): Promise<void> {
    rowMenu.value = null;
    if (!canDelete.value) {
        return;
    }
    let message = `Delete profile "${name}" and all its pages?`;
    const scan = await storageClient.scanReferences({ kind: "profile", name });
    if (scan.ok) {
        const notes = referenceNotes({ kind: "profile", name }, scan.data, profile.activeProfile);
        if (notes.length > 0) {
            message += ` ${notes.join(" ")}`;
        }
    }
    const confirmed = await confirm.ask({
        title: "Delete profile",
        message,
        confirmLabel: "Delete profile",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    await profile.deleteProfile(name);
}

async function importProfile(): Promise<void> {
    close();
    await profile.importProfile();
}
</script>

<template>
    <div ref="root" class="profile-menu" :class="{ 'profile-menu--open': open }">
        <div class="sidebar__section-head">
            <p id="profile-section-title" class="sidebar__section-title">Profiles</p>
            <div class="profile-menu__head-actions">
                <IconButton label="Add profile" variant="ghost" @click="startCreate">
                    <Plus :size="14" />
                </IconButton>
                <IconButton label="Import profile" variant="ghost" @click="importProfile">
                    <Upload :size="14" />
                </IconButton>
            </div>
        </div>
        <button
            class="profile-menu__trigger"
            type="button"
            :aria-expanded="open"
            aria-labelledby="profile-section-title"
            @click="toggleOpen"
        >
            <span class="profile-menu__value">{{ profile.activeProfile || "Select…" }}</span>
            <ChevronDown :size="14" />
        </button>

        <div v-if="open" class="profile-menu__popover" role="menu">
            <form v-if="mode !== null" class="profile-menu__edit" @submit.prevent="submitEdit">
                <input
                    v-model="draft"
                    class="profile-menu__input"
                    type="text"
                    :placeholder="mode === 'create' ? 'New profile name' : 'Rename profile'"
                    autofocus
                />
                <button class="profile-menu__icon" type="submit" title="Confirm">
                    <Check :size="13" />
                </button>
                <button class="profile-menu__icon" type="button" title="Cancel" @click="cancelEdit">
                    <X :size="13" />
                </button>
            </form>

            <ul class="profile-menu__list">
                <li v-for="item in profile.profiles" :key="item.name" class="profile-menu__row">
                    <button
                        class="profile-menu__item"
                        :class="{
                            'profile-menu__item--active': item.name === profile.activeProfile,
                        }"
                        type="button"
                        role="menuitem"
                        @click="choose(item.name)"
                    >
                        <span class="profile-menu__name">{{ item.name }}</span>
                        <span v-if="item.isDefault" class="profile-menu__badge" title="Default">
                            <Star :size="11" />
                        </span>
                    </button>
                    <button
                        class="profile-menu__more"
                        type="button"
                        title="Profile actions"
                        @click="toggleRowMenu(item.name, $event)"
                    >
                        <MoreVertical :size="14" />
                    </button>

                    <div v-if="rowMenu === item.name" class="profile-menu__submenu" role="menu">
                        <button
                            class="profile-menu__subitem"
                            type="button"
                            :disabled="item.isDefault"
                            @click="setDefault(item.name)"
                        >
                            <Star :size="13" />
                            <span>Set as Default</span>
                        </button>
                        <button
                            class="profile-menu__subitem"
                            type="button"
                            @click="startRename(item.name)"
                        >
                            <Pencil :size="13" />
                            <span>Rename / Edit</span>
                        </button>
                        <button
                            class="profile-menu__subitem"
                            type="button"
                            @click="exportProfile(item.name)"
                        >
                            <Download :size="13" />
                            <span>Export Profile</span>
                        </button>
                        <button
                            class="profile-menu__subitem profile-menu__subitem--danger"
                            type="button"
                            :disabled="!canDelete"
                            :title="
                                !canDelete ? 'Cannot delete the only profile' : 'Delete Profile'
                            "
                            @click="removeProfile(item.name)"
                        >
                            <Trash2 :size="13" />
                            <span>Delete Profile</span>
                        </button>
                    </div>
                </li>
            </ul>

            <p v-if="profile.profiles.length === 0" class="profile-menu__empty">No profiles yet.</p>
        </div>
    </div>
</template>
