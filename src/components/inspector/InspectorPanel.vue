<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
    ArrowDown,
    ArrowUp,
    Crop,
    Cpu,
    Gamepad2,
    ImagePlus,
    Layers,
    Plug,
    Search,
    SlidersHorizontal,
    Trash2,
    X,
    Zap,
} from "@lucide/vue";
import { parseActionString, validateActionString } from "@shared/actions";
import type { ActionTypeDef } from "@/actions/registry";
import { INTERNAL_ACTION_TYPES, loadPluginCommandTypes } from "@/actions/registry";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { useIconStore } from "@/stores/iconStore";
import { useProfileStore } from "@/stores/profileStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { readCssToken } from "@/theme/cssTokens";
import ActionPicker from "./ActionPicker.vue";
import IconGallery from "./IconGallery.vue";
import IconImportDialog from "./IconImportDialog.vue";

type SectionId = "general" | "custom" | "system" | "lucyddeck" | "plugins";

const profile = useProfileStore();
const icons = useIconStore();
const app = useAppStore();
const confirm = useConfirmStore();
const settings = useSettingsStore();

const sections: Array<{ id: SectionId; label: string; icon: unknown }> = [
    { id: "general", label: "General", icon: SlidersHorizontal },
    { id: "custom", label: "Custom", icon: Layers },
    { id: "system", label: "System", icon: Cpu },
    { id: "lucyddeck", label: "LucydDeck", icon: Zap },
    { id: "plugins", label: "Plugins", icon: Plug },
];

const activeSection = ref<SectionId>("general");
const searchQuery = ref("");
const preselect = ref<string | null>(null);
const galleryOpen = ref(false);
const importOpen = ref(false);
const pluginTypes = ref<ActionTypeDef[]>([]);

const pickerTypes = computed<ActionTypeDef[]>(() => [
    ...INTERNAL_ACTION_TYPES,
    ...pluginTypes.value,
]);
const systemTypes = computed(() => pickerTypes.value.filter((type) => type.section === "system"));
const lucydDeckTypes = computed(() =>
    pickerTypes.value.filter((type) => type.section === "lucyddeck"),
);
const pluginActionTypes = computed(() =>
    pickerTypes.value.filter((type) => type.section === "plugins"),
);
const pluginGroups = computed(() => {
    const groups = new Map<string, ActionTypeDef[]>();
    for (const type of pluginActionTypes.value) {
        const handle = type.id.split(":")[1] ?? "plugin";
        const list = groups.get(handle) ?? [];
        list.push(type);
        groups.set(handle, list);
    }
    return [...groups.entries()];
});

const query = computed(() => searchQuery.value.trim().toLowerCase());
const searchResults = computed(() => {
    if (query.value === "") {
        return [];
    }
    return pickerTypes.value.filter((type) => {
        const haystack = `${type.label} ${type.id} ${type.namespace}`.toLowerCase();
        return haystack.includes(query.value);
    });
});

const sequence = computed(() => profile.selectedButton?.click ?? []);
const currentImageName = computed(() => profile.selectedButton?.imageName ?? "");
const backgroundColor = computed(() => {
    // Re-read after a theme switch so the colour picker shows the new surface.
    void settings.theme;
    void settings.accent;
    return profile.selectedButton?.backgroundColor ?? readCssToken("--color-bg-elevated", "Canvas");
});
const sectionLabel = computed(
    () => sections.find((section) => section.id === activeSection.value)?.label ?? "",
);

function actionError(action: string): string | null {
    const result = validateActionString(action);
    return result.ok ? null : (result.reason ?? "Invalid action");
}

function namespaceOf(action: string): string {
    return parseActionString(action)?.namespace ?? "?";
}

function addStep(action: string): void {
    profile.addAction(action);
}

function selectSection(id: SectionId): void {
    activeSection.value = id;
    preselect.value = null;
}

function openSearchResult(type: ActionTypeDef): void {
    activeSection.value = type.section;
    preselect.value = type.id;
    searchQuery.value = "";
}

function toggleIcon(name: string): void {
    profile.setImageName(currentImageName.value === name ? "" : name);
    galleryOpen.value = false;
}

function onImported(name: string): void {
    profile.setImageName(name);
    importOpen.value = false;
    app.pushToast("success", `Imported icon "${name}"`);
}

async function clearKey(): Promise<void> {
    const confirmed = await confirm.ask({
        title: "Clear key",
        message: "Clear this key's icon, label and action sequences?",
        confirmLabel: "Clear key",
        danger: true,
    });
    if (!confirmed) {
        return;
    }
    profile.clearButton();
}

onMounted(async () => {
    await icons.refresh();
    pluginTypes.value = await loadPluginCommandTypes();
});
</script>

<template>
    <div class="inspector">
        <div v-if="profile.selectedKey === null" class="action-sidebar__empty">
            <p>Select a key on the board to edit its label, icon and action sequences.</p>
        </div>

        <div v-else class="inspector__body">
            <header class="inspector__key-header">
                <h3 class="action-sidebar__key-title">Key {{ Number(profile.selectedKey) + 1 }}</h3>
                <button class="action-sidebar__clear" type="button" @click="clearKey">
                    <Trash2 :size="13" />
                    <span>Clear</span>
                </button>
            </header>

            <div class="inspector__search">
                <Search :size="14" />
                <input
                    v-model="searchQuery"
                    class="inspector__search-input"
                    type="search"
                    placeholder="Search actions…"
                />
                <button
                    v-if="searchQuery !== ''"
                    class="inspector__search-clear"
                    type="button"
                    title="Clear search"
                    @click="searchQuery = ''"
                >
                    <X :size="13" />
                </button>
            </div>

            <div v-if="query !== ''" class="inspector__results">
                <button
                    v-for="type in searchResults"
                    :key="type.id"
                    class="inspector__result"
                    type="button"
                    @click="openSearchResult(type)"
                >
                    <span class="inspector__result-label">{{ type.label }}</span>
                    <span class="inspector__result-namespace">{{ type.namespace }}</span>
                </button>
                <p v-if="searchResults.length === 0" class="inspector-section__hint">
                    No actions match "{{ searchQuery }}".
                </p>
            </div>

            <div v-else class="inspector__main">
                <nav class="inspector-rail" aria-label="Inspector sections">
                    <button
                        v-for="section in sections"
                        :key="section.id"
                        class="inspector-rail__item"
                        :class="{ 'inspector-rail__item--active': activeSection === section.id }"
                        type="button"
                        :title="section.label"
                        @click="selectSection(section.id)"
                    >
                        <component :is="section.icon" :size="16" />
                    </button>
                </nav>

                <div class="inspector__content">
                    <h4 class="inspector-section__title">{{ sectionLabel }}</h4>

                    <!-- General: appearance + icon management -->
                    <template v-if="activeSection === 'general'">
                        <label class="field">
                            <span class="field__label">Label</span>
                            <input
                                class="field__input"
                                type="text"
                                :value="profile.selectedButton?.label ?? ''"
                                placeholder="Key label"
                                @input="profile.setLabel(($event.target as HTMLInputElement).value)"
                            />
                        </label>

                        <label class="field">
                            <span class="field__label">Background</span>
                            <span class="field__row">
                                <input
                                    class="field__color"
                                    type="color"
                                    :value="backgroundColor"
                                    @input="
                                        profile.setBackgroundColor(
                                            ($event.target as HTMLInputElement).value,
                                        )
                                    "
                                />
                                <input
                                    class="field__input"
                                    type="text"
                                    :value="profile.selectedButton?.backgroundColor ?? ''"
                                    placeholder="Surface colour"
                                    @change="
                                        profile.setBackgroundColor(
                                            ($event.target as HTMLInputElement).value.trim(),
                                        )
                                    "
                                />
                            </span>
                        </label>

                        <p v-if="currentImageName" class="inspector-section__hint">
                            Selected icon: <code>{{ currentImageName }}</code>
                        </p>
                        <p v-else class="inspector-section__hint">No icon selected.</p>

                        <div class="inspector__button-row">
                            <button
                                class="inspector-section__action"
                                type="button"
                                @click="galleryOpen = true"
                            >
                                <ImagePlus :size="13" />
                                <span>Select Icon</span>
                            </button>
                            <button
                                class="inspector-section__action"
                                type="button"
                                @click="importOpen = true"
                            >
                                <Crop :size="13" />
                                <span>Import Icon</span>
                            </button>
                        </div>
                        <p class="inspector-section__hint">
                            Import notes: output is <strong>140×140 px</strong>; source images up to
                            <strong>25 MB</strong> (PNG, JPEG, WebP).
                        </p>
                    </template>

                    <!-- Custom: multi-step macro sequence -->
                    <template v-else-if="activeSection === 'custom'">
                        <p class="inspector-section__hint">
                            Build a multi-step click sequence. Steps run top to bottom when the key
                            is pressed.
                        </p>

                        <ol v-if="sequence.length > 0" class="step-list">
                            <li
                                v-for="(action, index) in sequence"
                                :key="`step-${index}`"
                                class="step"
                                :class="{ 'step--invalid': actionError(action) !== null }"
                            >
                                <div class="step__head">
                                    <span class="step__index">{{ index + 1 }}</span>
                                    <span class="step__namespace">{{ namespaceOf(action) }}</span>
                                    <span class="step__controls">
                                        <button
                                            class="step__control"
                                            type="button"
                                            title="Move up"
                                            :disabled="index === 0"
                                            @click="profile.moveAction(index, -1)"
                                        >
                                            <ArrowUp :size="12" />
                                        </button>
                                        <button
                                            class="step__control"
                                            type="button"
                                            title="Move down"
                                            :disabled="index === sequence.length - 1"
                                            @click="profile.moveAction(index, 1)"
                                        >
                                            <ArrowDown :size="12" />
                                        </button>
                                        <button
                                            class="step__control step__control--danger"
                                            type="button"
                                            title="Remove step"
                                            @click="profile.removeAction(index)"
                                        >
                                            <Trash2 :size="12" />
                                        </button>
                                    </span>
                                </div>
                                <input
                                    class="step__input"
                                    type="text"
                                    :value="action"
                                    @change="
                                        profile.updateAction(
                                            index,
                                            ($event.target as HTMLInputElement).value,
                                        )
                                    "
                                />
                                <p v-if="actionError(action)" class="step__error">
                                    {{ actionError(action) }}
                                </p>
                            </li>
                        </ol>
                        <p v-else class="inspector-section__hint">No steps yet.</p>

                        <div class="step-add">
                            <ActionPicker :types="pickerTypes" @add="addStep" />
                        </div>
                    </template>

                    <!-- System: host OS controls -->
                    <template v-else-if="activeSection === 'system'">
                        <p class="inspector-section__hint">
                            Host OS controls: unified control keys, keyboard hotkeys, cursor
                            movement and clicks.
                        </p>
                        <ActionPicker :types="systemTypes" :preselect="preselect" @add="addStep" />
                    </template>

                    <!-- LucydDeck: device-specific actions -->
                    <template v-else-if="activeSection === 'lucyddeck'">
                        <p class="inspector-section__hint">
                            Device actions: page navigation and profile switching.
                        </p>
                        <ActionPicker
                            :types="lucydDeckTypes"
                            :preselect="preselect"
                            @add="addStep"
                        />
                    </template>

                    <!-- Plugins: grouped per installed plugin -->
                    <template v-else>
                        <p v-if="pluginGroups.length === 0" class="inspector-section__hint">
                            No plugin commands available. Install and enable plugins in Settings.
                        </p>
                        <div
                            v-for="[handle, types] in pluginGroups"
                            :key="handle"
                            class="inspector-section"
                        >
                            <h5 class="inspector-subsection__title">
                                <Gamepad2 :size="13" />
                                <span>{{ handle }}</span>
                            </h5>
                            <ActionPicker :types="types" :preselect="preselect" @add="addStep" />
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <IconGallery
            v-if="galleryOpen"
            :selected="currentImageName"
            @select="toggleIcon"
            @close="galleryOpen = false"
        />
        <IconImportDialog v-if="importOpen" @imported="onImported" @close="importOpen = false" />
    </div>
</template>
