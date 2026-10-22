<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { Plus } from "@lucide/vue";
import { validateActionString } from "@shared/actions";
import type { ActionTypeDef } from "@/actions/registry";
import { defaultFieldValues } from "@/actions/registry";
import { useAppStore } from "@/stores/appStore";

const props = defineProps<{
    types: readonly ActionTypeDef[];
    /** Optional type id to preselect (used by the inspector search). */
    preselect?: string | null;
    addLabel?: string;
}>();

const emit = defineEmits<{ (event: "add", action: string): void }>();

const app = useAppStore();
const selectedTypeId = ref(props.types[0]?.id ?? "");
const fieldValues = reactive<Record<string, string>>({});

const selectedType = computed<ActionTypeDef | undefined>(
    () => props.types.find((type) => type.id === selectedTypeId.value) ?? props.types[0],
);
const previewAction = computed(() => selectedType.value?.build(fieldValues) ?? "");
const previewError = computed(() => {
    const result = validateActionString(previewAction.value);
    return result.ok ? null : (result.reason ?? "Invalid action");
});

function resetFields(): void {
    for (const key of Object.keys(fieldValues)) {
        delete fieldValues[key];
    }
    if (selectedType.value) {
        Object.assign(fieldValues, defaultFieldValues(selectedType.value));
    }
}

watch(selectedTypeId, resetFields, { immediate: true });

watch(
    () => props.types,
    (types) => {
        if (!types.some((type) => type.id === selectedTypeId.value)) {
            selectedTypeId.value = types[0]?.id ?? "";
        }
    },
);

watch(
    () => props.preselect,
    (id) => {
        if (id && props.types.some((type) => type.id === id)) {
            selectedTypeId.value = id;
        }
    },
    { immediate: true },
);

function addStep(): void {
    if (previewError.value !== null || selectedType.value === undefined) {
        app.pushToast("error", previewError.value ?? "Select an action type");
        return;
    }
    emit("add", previewAction.value);
}
</script>

<template>
    <div class="action-picker">
        <p v-if="props.types.length === 0" class="inspector-section__hint">No actions available.</p>

        <template v-else>
            <label class="field">
                <span class="field__label">Action type</span>
                <select v-model="selectedTypeId" class="field__input">
                    <option v-for="type in props.types" :key="type.id" :value="type.id">
                        {{ type.label }}
                    </option>
                </select>
            </label>

            <label v-for="field in selectedType?.fields ?? []" :key="field.key" class="field">
                <span class="field__label">{{ field.label }}</span>
                <select
                    v-if="field.kind === 'select'"
                    v-model="fieldValues[field.key]"
                    class="field__input"
                >
                    <option
                        v-for="option in field.options ?? []"
                        :key="option.value"
                        :value="option.value"
                    >
                        {{ option.label }}
                    </option>
                </select>
                <textarea
                    v-else-if="field.kind === 'textarea'"
                    v-model="fieldValues[field.key]"
                    class="field__input field__input--multiline"
                    :placeholder="field.placeholder"
                    rows="2"
                ></textarea>
                <input
                    v-else
                    v-model="fieldValues[field.key]"
                    class="field__input"
                    :type="field.kind === 'number' ? 'number' : 'text'"
                    :placeholder="field.placeholder"
                />
            </label>

            <p class="step-add__preview">
                <code :class="{ 'step-add__preview--invalid': previewError !== null }">
                    {{ previewAction || "—" }}
                </code>
            </p>
            <p v-if="previewError" class="step__error">{{ previewError }}</p>
            <button
                class="step-add__button"
                type="button"
                :disabled="previewError !== null"
                @click="addStep"
            >
                <Plus :size="13" />
                <span>{{ props.addLabel ?? "Add step" }}</span>
            </button>
        </template>
    </div>
</template>
