<script setup lang="ts">
import type { ActionFieldDef } from "@/actions/registry";
import { pageLabel } from "@shared/pages";
import { useProfileStore } from "@/stores/profileStore";
import Field from "@/components/ui/Field.vue";
import Input from "@/components/ui/Input.vue";
import Select from "@/components/ui/Select.vue";
import Textarea from "@/components/ui/Textarea.vue";

const props = defineProps<{
    fields: readonly ActionFieldDef[];
    values: Record<string, string>;
}>();

const emit = defineEmits<{ (event: "change", key: string, value: string): void }>();

const profile = useProfileStore();

function optionsFor(field: ActionFieldDef): Array<{ value: string; label: string }> {
    const current = props.values[field.key] ?? "";
    if (field.optionsSource === "profiles") {
        const options = profile.profiles.map((item) => ({
            value: item.name,
            label: item.name,
        }));
        if (current !== "" && !options.some((option) => option.value === current)) {
            options.push({ value: current, label: `${current} (not found)` });
        }
        return options;
    }
    if (field.optionsSource !== "profilePages") {
        return field.options ?? [];
    }
    const options = profile.pages.map((page) => ({
        value: page.id,
        label: pageLabel(page.id),
    }));
    if (current !== "" && !options.some((option) => option.value === current)) {
        options.push({
            value: current,
            label: `${pageLabel(current)} (not in this profile)`,
        });
    }
    return options;
}

function onValue(key: string, value: string | number): void {
    emit("change", key, String(value));
}
</script>

<template>
    <div class="action-fields">
        <Field
            v-for="field in props.fields"
            :key="field.key"
            :label="field.label"
            :class="{ 'action-fields__wide': field.wide }"
        >
            <template #default="{ id }">
                <Select
                    v-if="field.kind === 'select'"
                    :id="id"
                    :model-value="props.values[field.key] ?? ''"
                    :options="optionsFor(field)"
                    @update:model-value="onValue(field.key, $event)"
                />
                <Textarea
                    v-else-if="field.kind === 'textarea'"
                    :id="id"
                    :model-value="props.values[field.key] ?? ''"
                    :placeholder="field.placeholder"
                    :rows="2"
                    @update:model-value="onValue(field.key, $event)"
                />
                <Input
                    v-else
                    :id="id"
                    :model-value="props.values[field.key] ?? ''"
                    :type="field.kind === 'number' ? 'number' : 'text'"
                    :placeholder="field.placeholder"
                    @update:model-value="onValue(field.key, $event)"
                />
            </template>
        </Field>
    </div>
</template>
