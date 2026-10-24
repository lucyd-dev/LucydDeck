<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
    AlertTriangle,
    ArrowDown,
    ArrowUp,
    GripVertical,
    Image as ImageIcon,
    LayoutGrid,
    Plus,
    Trash2,
    Zap,
} from "@lucide/vue";
import type { ActionTypeDef, PluginRegistration } from "@/actions/registry";
import {
    INTERNAL_ACTION_TYPES,
    loadPluginRegistrations,
    pluginRegistrationsToTypes,
} from "@/actions/registry";
import { describeStep } from "@/editor/actionSteps";
import type { StepDescription } from "@/editor/actionSteps";
import Button from "@/components/ui/Button.vue";
import { useAppStore } from "@/stores/appStore";
import { useIconStore } from "@/stores/iconStore";
import { useProfileStore } from "@/stores/profileStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { readCssToken } from "@/theme/cssTokens";
import ActionStepEditor from "./ActionStepEditor.vue";
import AddActionDock from "./AddActionDock.vue";
import { CATEGORY_ICONS } from "./categoryIcons";
import IconGallery from "./IconGallery.vue";
import IconImportDialog from "./IconImportDialog.vue";
import IconQuickMenu from "./IconQuickMenu.vue";

const profile = useProfileStore();
const icons = useIconStore();
const settings = useSettingsStore();
const app = useAppStore();

const pluginRegistrations = ref<PluginRegistration[]>([]);
const types = computed<ActionTypeDef[]>(() => [
    ...INTERNAL_ACTION_TYPES,
    ...pluginRegistrationsToTypes(pluginRegistrations.value),
]);

const galleryOpen = ref(false);
const importOpen = ref(false);
const dockOpen = ref(true);
const openStep = ref<number | null>(null);
const appendAfter = ref(false);
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);
const previewDataUrl = ref<string | null>(null);
const previewResolved = ref(false);
const listScroll = ref<HTMLElement | null>(null);

const steps = computed(() => profile.selectedButton?.click ?? []);
const describedSteps = computed<StepDescription[]>(() => steps.value.map(describeStep));
const currentImageName = computed(() => profile.selectedButton?.imageName ?? "");
const missingIcon = computed(
    () => currentImageName.value !== "" && previewResolved.value && previewDataUrl.value === null,
);

const fallbackBackground = (): string => readCssToken("--color-bg-elevated", "#1c2129");

const backgroundColor = computed(() => {
    // Re-read after a theme switch so the native picker and swatch agree.
    void settings.theme;
    void settings.accent;
    return profile.selectedButton?.backgroundColor ?? fallbackBackground();
});

const bulkColor = computed(() => {
    void settings.theme;
    void settings.accent;
    const first = profile.selectedKeys[0];
    if (first === undefined) {
        return fallbackBackground();
    }
    return profile.currentPage.buttons[first]?.backgroundColor ?? fallbackBackground();
});

const bulkStepCount = computed(() =>
    profile.selectedKeys.reduce(
        (total, key) => total + (profile.currentPage.buttons[key]?.click.length ?? 0),
        0,
    ),
);

const submitLabel = computed(() => {
    if (appendAfter.value || steps.value.length > 1) {
        return "Add step";
    }
    return steps.value.length === 1 ? "Replace" : "Add";
});

const appendLabel = computed(() =>
    appendAfter.value && steps.value.length === 1 ? (describedSteps.value[0]?.label ?? "") : null,
);

const displayVersion = computed(() => (settings.version === "" ? "dev" : `v${settings.version}`));

const saveStatus = computed<{ label: string; tone: "saved" | "warning" | "error" }>(() => {
    const invalid = profile.invalidStepCount;
    if (invalid > 0) {
        return {
            label: `${invalid} invalid step${invalid === 1 ? "" : "s"} · save blocked`,
            tone: "error",
        };
    }
    switch (profile.saveState) {
        case "saving":
            return { label: "Saving…", tone: "warning" };
        case "dirty":
            return { label: "Unsaved", tone: "warning" };
        case "blocked":
            return { label: "Save blocked", tone: "error" };
        case "error":
            return { label: "Save failed", tone: "error" };
        default:
            return { label: "Saved", tone: "saved" };
    }
});

watch(
    () =>
        [
            profile.selectedButton?.imageName,
            currentImageName.value === "" ? null : icons.previews[currentImageName.value],
        ] as const,
    async ([name]) => {
        previewDataUrl.value = null;
        previewResolved.value = false;
        if (name === undefined || name === "") {
            previewResolved.value = true;
            return;
        }
        const dataUrl = await icons.ensurePreview(name);
        if (profile.selectedButton?.imageName === name) {
            previewDataUrl.value = dataUrl;
            previewResolved.value = true;
        }
    },
    { immediate: true },
);

watch(
    () => [profile.activeProfile, profile.currentPageId, profile.selectedKey] as const,
    () => {
        openStep.value = null;
        appendAfter.value = false;
        galleryOpen.value = false;
        importOpen.value = false;
    },
);

watch(
    () => steps.value.length,
    (length) => {
        if (openStep.value !== null && openStep.value >= length) {
            openStep.value = length > 0 ? length - 1 : null;
        }
        if (length !== 1) {
            appendAfter.value = false;
        }
    },
);

onMounted(async () => {
    await icons.refresh();
    pluginRegistrations.value = await loadPluginRegistrations();
});

function onLabelInput(event: Event): void {
    profile.setLabel((event.target as HTMLInputElement).value);
}

function onColorInput(event: Event): void {
    profile.setBackgroundColor((event.target as HTMLInputElement).value);
}

function onBulkColorInput(event: Event): void {
    profile.setSelectedBackgroundColor((event.target as HTMLInputElement).value);
}

function selectIcon(name: string): void {
    profile.setImageName(name);
    if (name !== "") {
        icons.markRecent(name);
    }
}

function selectBulkIcon(name: string): void {
    profile.setSelectedImageName(name);
    if (name !== "") {
        icons.markRecent(name);
    }
}

function onGallerySelect(name: string): void {
    if (profile.isMultiSelect) {
        selectBulkIcon(name);
    } else {
        selectIcon(name);
    }
    galleryOpen.value = false;
}

function onImported(name: string): void {
    if (profile.isMultiSelect) {
        selectBulkIcon(name);
    } else {
        selectIcon(name);
    }
    importOpen.value = false;
    galleryOpen.value = false;
    app.pushToast("success", `Imported icon "${name}"`);
}

function openImport(): void {
    galleryOpen.value = false;
    importOpen.value = true;
}

function clearKeys(): void {
    if (profile.isMultiSelect) {
        profile.clearSelectedKeys();
    } else {
        profile.clearButton();
    }
    openStep.value = null;
}

function startAppend(): void {
    appendAfter.value = true;
    dockOpen.value = true;
    openStep.value = null;
}

function cancelAppend(): void {
    appendAfter.value = false;
}

function addStep(action: string): void {
    const append = appendAfter.value || steps.value.length > 1;
    profile.addAction(action, append ? "append" : "replace");
    appendAfter.value = false;
    openStep.value = null;
    void nextTick(() => {
        if (steps.value.length > 1 && listScroll.value !== null) {
            listScroll.value.scrollTop = listScroll.value.scrollHeight;
        }
    });
}

function toggleStep(index: number): void {
    openStep.value = openStep.value === index ? null : index;
}

function updateStep(index: number, raw: string): void {
    profile.updateAction(index, raw);
}

function removeStep(index: number): void {
    const wasOpen = openStep.value;
    profile.removeAction(index);
    if (wasOpen === index) {
        openStep.value = null;
    } else if (wasOpen !== null && wasOpen > index) {
        openStep.value = wasOpen - 1;
    }
}

function moveStep(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= steps.value.length) {
        return;
    }
    profile.moveAction(index, delta);
    if (openStep.value === index) {
        openStep.value = target;
    } else if (openStep.value === target) {
        openStep.value = index;
    }
}

function onDragStart(index: number, event: DragEvent): void {
    dragIndex.value = index;
    overIndex.value = index;
    if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
    }
}

function onDragOver(index: number, event: DragEvent): void {
    event.preventDefault();
    overIndex.value = index;
    if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "move";
    }
}

function onDrop(index: number): void {
    const from = dragIndex.value;
    dragIndex.value = null;
    overIndex.value = null;
    if (from === null || from === index) {
        return;
    }
    profile.moveActionTo(from, index);
    openStep.value = index;
}

function onDragEnd(): void {
    dragIndex.value = null;
    overIndex.value = null;
}
</script>

<template>
    <div class="inspector-panel">
        <div v-if="profile.externalChange" class="panel-banner" role="status">
            <AlertTriangle :size="13" />
            <span class="panel-banner__text">This page changed on disk.</span>
            <button
                class="panel-banner__action"
                type="button"
                @click="profile.reloadExternalPage()"
            >
                Reload
            </button>
            <button
                class="panel-banner__action panel-banner__action--primary"
                type="button"
                @click="profile.keepLocalPage()"
            >
                Keep local
            </button>
        </div>

        <div v-if="profile.hasPage && profile.isMultiSelect" class="inspector-panel__body">
            <header class="key-head key-head--bulk">
                <div class="key-head__body">
                    <div class="key-head__title-row">
                        <h3 class="bulk__title">{{ profile.selectedCount }} keys selected</h3>
                        <Button variant="danger" size="sm" @click="clearKeys">
                            <Trash2 :size="12" />
                            <span>Clear</span>
                        </Button>
                    </div>
                    <p class="bulk__meta">
                        {{ bulkStepCount }} {{ bulkStepCount === 1 ? "step" : "steps" }} ·
                        Shift-click keys to extend the selection
                    </p>
                    <div class="key-head__appearance">
                        <label
                            class="appearance-control appearance-control--color"
                            title="Background color for all selected keys"
                        >
                            <span
                                class="appearance-control__swatch"
                                :style="{ backgroundColor: bulkColor }"
                            ></span>
                            <span>Color</span>
                            <input
                                class="appearance-control__input"
                                type="color"
                                :value="bulkColor"
                                aria-label="Background color for selected keys"
                                @input="onBulkColorInput"
                            />
                        </label>
                        <IconQuickMenu
                            :selected="''"
                            @select="selectBulkIcon"
                            @browse="galleryOpen = true"
                        >
                            <template #trigger="{ toggle, open }">
                                <button
                                    class="appearance-control"
                                    type="button"
                                    :aria-expanded="open"
                                    title="Choose an icon for all selected keys"
                                    @click="toggle"
                                >
                                    <ImageIcon :size="14" />
                                    <span>Icon</span>
                                </button>
                            </template>
                        </IconQuickMenu>
                    </div>
                    <p class="bulk__hint">
                        Colour and icon changes apply to every selected key. Undo restores the whole
                        apply.
                    </p>
                </div>
            </header>
        </div>

        <div
            v-else-if="profile.hasPage && profile.selectedKey !== null"
            class="inspector-panel__body"
        >
            <header class="key-head">
                <IconQuickMenu
                    :selected="currentImageName"
                    @select="selectIcon"
                    @browse="galleryOpen = true"
                >
                    <template #trigger="{ toggle, open }">
                        <button
                            class="key-head__preview"
                            :style="{ '--key-bg': backgroundColor }"
                            type="button"
                            :aria-expanded="open"
                            title="Change icon"
                            @click="toggle"
                        >
                            <img
                                v-if="previewDataUrl"
                                class="key-head__preview-image"
                                :src="previewDataUrl"
                                alt=""
                            />
                            <span
                                v-else-if="missingIcon"
                                class="key-head__preview-missing"
                                title="Icon not found"
                            >
                                <AlertTriangle :size="18" />
                            </span>
                            <ImageIcon v-else :size="22" class="key-head__preview-empty" />
                        </button>
                    </template>
                </IconQuickMenu>

                <div class="key-head__body">
                    <div class="key-head__title-row">
                        <input
                            class="key-head__title"
                            type="text"
                            :value="profile.selectedButton?.label ?? ''"
                            placeholder="Unnamed key"
                            aria-label="Key label"
                            @input="onLabelInput"
                        />
                        <Button
                            class="key-head__clear"
                            variant="danger"
                            size="sm"
                            title="Clear key"
                            @click="clearKeys"
                        >
                            <Trash2 :size="12" />
                            <span>Clear</span>
                        </Button>
                    </div>

                    <div class="key-head__appearance">
                        <label
                            class="appearance-control appearance-control--color"
                            title="Background color"
                        >
                            <span
                                class="appearance-control__swatch"
                                :style="{ backgroundColor }"
                            ></span>
                            <span>Color</span>
                            <input
                                class="appearance-control__input"
                                type="color"
                                :value="backgroundColor"
                                aria-label="Background color"
                                @input="onColorInput"
                            />
                        </label>
                        <IconQuickMenu
                            :selected="currentImageName"
                            @select="selectIcon"
                            @browse="galleryOpen = true"
                        >
                            <template #trigger="{ toggle, open }">
                                <button
                                    class="appearance-control"
                                    type="button"
                                    :aria-expanded="open"
                                    title="Choose icon"
                                    @click="toggle"
                                >
                                    <img
                                        v-if="previewDataUrl"
                                        class="appearance-control__icon"
                                        :src="previewDataUrl"
                                        alt=""
                                    />
                                    <span
                                        v-else-if="missingIcon"
                                        class="appearance-control__warning"
                                    >
                                        <AlertTriangle :size="13" />
                                    </span>
                                    <ImageIcon v-else :size="14" />
                                    <span>Icon</span>
                                </button>
                            </template>
                        </IconQuickMenu>
                    </div>
                </div>
            </header>

            <section class="action-section" aria-label="Action sequence">
                <div class="action-section__bar">
                    <span>{{ steps.length > 1 ? "Sequence" : "Action" }}</span>
                    <span v-if="steps.length > 1" class="action-section__meta">
                        {{ steps.length }} steps
                    </span>
                </div>

                <div ref="listScroll" class="action-section__scroll">
                    <p v-if="steps.length === 0" class="action-empty">
                        No action assigned yet. Pick one below.
                    </p>

                    <template v-else-if="steps.length === 1">
                        <article
                            class="step-card"
                            :class="{
                                'step-card--open': openStep === 0,
                                'step-card--invalid': describedSteps[0]?.invalid !== undefined,
                            }"
                        >
                            <div class="step-card__row">
                                <button
                                    class="step-card__main"
                                    type="button"
                                    :aria-expanded="openStep === 0"
                                    @click="toggleStep(0)"
                                >
                                    <span
                                        class="cat-icon"
                                        :class="`cat-icon--${describedSteps[0]?.category ?? 'commands'}`"
                                    >
                                        <component
                                            :is="
                                                CATEGORY_ICONS[
                                                    describedSteps[0]?.category ?? 'commands'
                                                ]
                                            "
                                            :size="18"
                                        />
                                    </span>
                                    <span class="step-card__body">
                                        <span class="step-card__label">
                                            {{ describedSteps[0]?.label }}
                                        </span>
                                        <span class="step-card__detail">
                                            {{
                                                describedSteps[0]?.invalid ??
                                                describedSteps[0]?.detail
                                            }}
                                        </span>
                                    </span>
                                </button>
                                <span class="row-controls">
                                    <button
                                        class="row-control row-control--danger"
                                        type="button"
                                        title="Remove action"
                                        @click="removeStep(0)"
                                    >
                                        <Trash2 :size="12" />
                                    </button>
                                </span>
                            </div>
                            <ActionStepEditor
                                v-if="openStep === 0"
                                :raw="steps[0] ?? ''"
                                :types="types"
                                @update="updateStep(0, $event)"
                            />
                        </article>

                        <button
                            v-if="!appendAfter"
                            class="add-step-link"
                            type="button"
                            @click="startAppend"
                        >
                            <Plus :size="12" />
                            <span>Add step after this</span>
                        </button>
                    </template>

                    <ol v-else class="sequence-list">
                        <li
                            v-for="(raw, index) in steps"
                            :key="index"
                            class="sequence-item"
                            :class="{
                                'sequence-item--open': openStep === index,
                                'sequence-item--invalid':
                                    describedSteps[index]?.invalid !== undefined,
                                'sequence-item--drag-over':
                                    overIndex === index && dragIndex !== null,
                            }"
                            @dragover="onDragOver(index, $event)"
                            @drop="onDrop(index)"
                            @dragend="onDragEnd"
                        >
                            <div class="sequence-item__row">
                                <span
                                    class="sequence-item__handle"
                                    draggable="true"
                                    title="Drag to reorder"
                                    @dragstart="onDragStart(index, $event)"
                                >
                                    <GripVertical :size="13" />
                                </span>
                                <button
                                    class="sequence-item__main"
                                    type="button"
                                    :aria-expanded="openStep === index"
                                    @click="toggleStep(index)"
                                >
                                    <span class="sequence-item__num">{{ index + 1 }}</span>
                                    <span
                                        class="cat-icon"
                                        :class="`cat-icon--${describedSteps[index]?.category ?? 'commands'}`"
                                    >
                                        <component
                                            :is="
                                                CATEGORY_ICONS[
                                                    describedSteps[index]?.category ?? 'commands'
                                                ]
                                            "
                                            :size="14"
                                        />
                                    </span>
                                    <span class="sequence-item__text">
                                        <span class="sequence-item__label">
                                            {{ describedSteps[index]?.label }}
                                        </span>
                                        <span class="sequence-item__detail">
                                            {{
                                                describedSteps[index]?.invalid ??
                                                describedSteps[index]?.detail
                                            }}
                                        </span>
                                    </span>
                                </button>
                                <span class="row-controls">
                                    <button
                                        class="row-control"
                                        type="button"
                                        title="Move up"
                                        :disabled="index === 0"
                                        @click="moveStep(index, -1)"
                                    >
                                        <ArrowUp :size="12" />
                                    </button>
                                    <button
                                        class="row-control"
                                        type="button"
                                        title="Move down"
                                        :disabled="index === steps.length - 1"
                                        @click="moveStep(index, 1)"
                                    >
                                        <ArrowDown :size="12" />
                                    </button>
                                    <button
                                        class="row-control row-control--danger"
                                        type="button"
                                        title="Remove step"
                                        @click="removeStep(index)"
                                    >
                                        <Trash2 :size="12" />
                                    </button>
                                </span>
                            </div>
                            <ActionStepEditor
                                v-if="openStep === index"
                                :raw="raw"
                                :types="types"
                                @update="updateStep(index, $event)"
                            />
                        </li>
                    </ol>
                </div>
            </section>

            <AddActionDock
                v-model:open="dockOpen"
                :types="types"
                :registrations="pluginRegistrations"
                :submit-label="submitLabel"
                :append-after="appendLabel"
                :reset-key="profile.selectedKey"
                @add="addStep"
                @cancel-append="cancelAppend"
            />
        </div>

        <div v-else class="inspector-panel__empty">
            <LayoutGrid :size="22" />
            <p v-if="!profile.hasProfile">Select a profile to start editing.</p>
            <p v-else-if="!profile.hasPage">This profile has no pages yet.</p>
            <p v-else>Select a key on the deck to edit its label, appearance and actions.</p>
        </div>

        <footer class="panel-foot">
            <span class="panel-foot__version">
                <Zap :size="11" />
                <span>LucydDeck {{ displayVersion }}</span>
            </span>
            <span
                v-if="profile.hasPage"
                class="panel-foot__status"
                :class="`panel-foot__status--${saveStatus.tone}`"
            >
                {{ saveStatus.label }}
            </span>
        </footer>

        <IconGallery
            v-if="galleryOpen"
            :selected="profile.isMultiSelect ? '' : currentImageName"
            @select="onGallerySelect"
            @import="openImport"
            @close="galleryOpen = false"
        />
        <IconImportDialog v-if="importOpen" @imported="onImported" @close="importOpen = false" />
    </div>
</template>
