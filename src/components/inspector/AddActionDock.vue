<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { Component } from "vue";
import {
    ChevronDown,
    ChevronLeft,
    ChevronUp,
    CornerDownLeft,
    Cpu,
    LayoutGrid,
    Plug,
    Plus,
    X,
} from "@lucide/vue";
import { validateActionString } from "@shared/actions";
import type { ActionTypeDef, PluginRegistration } from "@/actions/registry";
import { defaultFieldValues } from "@/actions/registry";
import type { ProviderRow } from "@/actions/providers";
import { buildProviders, pluginHandleOf } from "@/actions/providers";
import { stepCategory } from "@/editor/actionSteps";
import { useProfileStore } from "@/stores/profileStore";
import ActionFields from "./ActionFields.vue";
import { CATEGORY_ICONS } from "./categoryIcons";

const props = defineProps<{
    types: readonly ActionTypeDef[];
    registrations: readonly PluginRegistration[];
    submitLabel: string;
    appendAfter: string | null;
    resetKey: string | null;
}>();

const emit = defineEmits<{
    (event: "add", action: string): void;
    (event: "cancel-append"): void;
}>();

const HINTS: Record<string, string> = {
    PAGE: "Jump to another page",
    PROFILE: "Activate a profile",
    HID_KEY: "Press a key or key combination",
    CONTROL_KEY: "Media and system keys",
    MOUSE_MOVE: "Move the pointer by an offset",
    MOUSE_CLICK: "Click a mouse button",
    DELAY: "Pause before the next step",
    TEXT: "Type a string of text",
    CMD: "Run a host command",
};

const open = defineModel<boolean>("open", { default: true });
const profile = useProfileStore();
const provider = ref<string>("deck");
const picked = ref<ActionTypeDef | null>(null);
const values = ref<Record<string, string>>({});
const root = ref<HTMLElement | null>(null);

const providers = computed<ProviderRow[]>(() => buildProviders(props.types, props.registrations));

const selectedProvider = computed<ProviderRow>(
    () => providers.value.find((item) => item.id === provider.value) ?? providers.value[0],
);

const preview = computed(() => {
    if (picked.value === null) {
        return "";
    }
    return picked.value.build(values.value);
});

const previewValid = computed(
    () => picked.value !== null && validateActionString(preview.value).ok,
);

const pickedProvider = computed<ProviderRow | null>(() => {
    if (picked.value === null) {
        return null;
    }
    const id = providerForType(picked.value);
    return providers.value.find((item) => item.id === id) ?? null;
});

function providerIcon(row: ProviderRow): Component {
    if (row.kind === "deck") {
        return LayoutGrid;
    }
    return row.kind === "system" ? Cpu : Plug;
}

function providerForType(type: ActionTypeDef): string {
    if (type.section === "lucyddeck") {
        return "deck";
    }
    if (type.section === "system") {
        return "system";
    }
    return pluginHandleOf(type) ?? "deck";
}

function categoryOf(type: ActionTypeDef): keyof typeof CATEGORY_ICONS {
    return type.section === "plugins" ? "plugins" : stepCategory(type.namespace);
}

function hintOf(type: ActionTypeDef): string {
    return type.section === "plugins" ? "Plugin command" : (HINTS[type.namespace] ?? type.label);
}

function resetPicked(): void {
    picked.value = null;
    values.value = {};
}

function pick(type: ActionTypeDef): void {
    picked.value = type;
    provider.value = providerForType(type);
    const profileNames = [
        ...(profile.activeProfile === "" ? [] : [profile.activeProfile]),
        ...profile.profiles
            .map((item) => item.name)
            .filter((name) => name !== profile.activeProfile),
    ];
    values.value = defaultFieldValues(
        type,
        profile.pages.map((page) => page.id),
        profileNames,
    );
    void nextTick(() => {
        root.value
            ?.querySelector<HTMLElement>(
                ".add-config input, .add-config select, .add-config textarea",
            )
            ?.focus();
    });
}

function submit(): void {
    if (!previewValid.value || picked.value === null) {
        return;
    }
    emit("add", preview.value);
    resetPicked();
}

function onFieldChange(key: string, value: string): void {
    values.value = { ...values.value, [key]: value };
}

watch(
    () => props.resetKey,
    () => resetPicked(),
);

watch(
    () => props.types,
    (types) => {
        if (picked.value !== null && !types.some((type) => type.id === picked.value?.id)) {
            resetPicked();
        }
    },
);
</script>

<template>
    <section
        ref="root"
        class="add-dock"
        :class="{ 'add-dock--open': open }"
        aria-label="Add action"
    >
        <button
            class="add-dock__head"
            type="button"
            :aria-expanded="open"
            :title="open ? 'Collapse Add Action' : 'Expand Add Action'"
            @click="open = !open"
        >
            <span class="add-dock__mark"><Plus :size="12" /></span>
            <span class="add-dock__title">Add Action</span>
            <span class="add-dock__chev">
                <component :is="open ? ChevronDown : ChevronUp" :size="14" />
            </span>
        </button>

        <div v-if="open" class="add-dock__body">
            <div v-if="props.appendAfter" class="append-banner">
                <CornerDownLeft :size="12" />
                <span>Adding after “{{ props.appendAfter }}”</span>
                <button
                    class="append-banner__button"
                    type="button"
                    title="Stop adding a step"
                    @click="emit('cancel-append')"
                >
                    <X :size="12" />
                </button>
            </div>

            <div v-if="picked && pickedProvider" class="add-config">
                <div class="add-config__head">
                    <button
                        class="add-config__back"
                        type="button"
                        title="Back to actions"
                        @click="resetPicked"
                    >
                        <ChevronLeft :size="13" />
                        <span>Back</span>
                    </button>
                    <span class="add-config__path">
                        {{ pickedProvider.label }} / {{ picked.label }}
                    </span>
                </div>
                <div class="add-config__scroll">
                    <ActionFields
                        v-if="picked.fields.length > 0"
                        :fields="picked.fields"
                        :values="values"
                        @change="onFieldChange"
                    />
                    <p v-else class="add-config__note">
                        No options. It runs as soon as the key is pressed.
                    </p>
                </div>
                <div class="add-config__foot">
                    <button
                        class="add-submit"
                        type="button"
                        :disabled="!previewValid"
                        @click="submit"
                    >
                        <Plus :size="11" />
                        <span>{{ props.submitLabel }}</span>
                    </button>
                </div>
            </div>

            <div v-else class="add-split">
                <nav class="provider-menu" aria-label="Action providers">
                    <button
                        v-for="item in providers"
                        :key="item.id"
                        class="provider-row"
                        :class="{
                            'provider-row--active': provider === item.id,
                            'provider-row--empty': item.actions.length === 0,
                        }"
                        type="button"
                        :title="item.hint"
                        @click="provider = item.id"
                    >
                        <span class="provider-row__icon">
                            <component :is="providerIcon(item)" :size="13" />
                        </span>
                        <span class="provider-row__label">{{ item.label }}</span>
                        <span class="provider-row__count">
                            {{ item.actions.length === 0 ? "—" : item.actions.length }}
                        </span>
                    </button>
                </nav>

                <div class="add-pane">
                    <div class="add-pane__head">
                        <span>{{ selectedProvider?.label }}</span>
                        <span>
                            {{ selectedProvider?.actions.length ?? 0 }}
                            {{ selectedProvider?.actions.length === 1 ? "action" : "actions" }}
                        </span>
                    </div>
                    <div class="add-pane__scroll">
                        <div
                            v-if="selectedProvider && selectedProvider.actions.length > 0"
                            class="add-actions"
                        >
                            <button
                                v-for="type in selectedProvider.actions"
                                :key="type.id"
                                class="add-action"
                                type="button"
                                @click="pick(type)"
                            >
                                <span class="add-action__body">
                                    <span class="add-action__label">{{ type.label }}</span>
                                    <span class="add-action__hint">{{ hintOf(type) }}</span>
                                </span>
                                <span class="add-action__category">
                                    <component :is="CATEGORY_ICONS[categoryOf(type)]" :size="12" />
                                </span>
                                <Plus :size="11" class="add-action__plus" />
                            </button>
                        </div>
                        <p v-else class="add-pane__empty">No actions in this provider.</p>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>
