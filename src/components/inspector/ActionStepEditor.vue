<script setup lang="ts">
import { computed } from "vue";
import type { ActionTypeDef } from "@/actions/registry";
import { describeStep, parseStep, stepValues } from "@/editor/actionSteps";
import Input from "@/components/ui/Input.vue";
import ActionFields from "./ActionFields.vue";

const props = defineProps<{
    raw: string;
    types: readonly ActionTypeDef[];
}>();

const emit = defineEmits<{ (event: "update", raw: string): void }>();

const step = computed(() => parseStep(props.raw));
const description = computed(() => describeStep(props.raw));
const values = computed(() => (step.value === null ? null : stepValues(step.value)));

const type = computed<ActionTypeDef | null>(() => {
    const parsed = step.value;
    if (parsed === null) {
        return null;
    }
    if (parsed.namespace === "CMD") {
        const pluginType = props.types.find((item) => item.id === `CMD:${parsed.args}`);
        if (pluginType !== undefined) {
            return pluginType;
        }
    }
    return props.types.find((item) => item.id === parsed.namespace) ?? null;
});

const editable = computed(
    () => step.value !== null && values.value !== null && type.value !== null,
);

function onFieldChange(key: string, value: string): void {
    if (!type.value || !values.value) {
        return;
    }
    emit("update", type.value.build({ ...values.value, [key]: value }));
}
</script>

<template>
    <div class="step-editor">
        <p v-if="description.invalid" class="step-editor__invalid">
            {{ description.invalid }}
        </p>

        <ActionFields
            v-if="editable && type && type.fields.length > 0"
            :fields="type.fields"
            :values="values ?? {}"
            @change="onFieldChange"
        />
        <p v-else-if="editable" class="step-editor__note">
            No options. It runs as soon as the key is pressed.
        </p>
        <template v-else>
            <label class="step-editor__raw-field">
                <span class="step-editor__raw-label">Raw step (not understood)</span>
                <Input
                    class="step-editor__raw"
                    :model-value="props.raw"
                    aria-label="Raw action step"
                    @update:model-value="emit('update', String($event))"
                />
            </label>
        </template>
    </div>
</template>
