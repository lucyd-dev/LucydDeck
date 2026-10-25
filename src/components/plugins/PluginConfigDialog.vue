<script setup lang="ts">
import { computed, reactive } from "vue";
import type { PluginConfigSnapshot } from "@shared/ipc";
import type { PluginConfigField, PluginConfigValues } from "@shared/plugins";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import Field from "@/components/ui/Field.vue";
import Input from "@/components/ui/Input.vue";
import Select from "@/components/ui/Select.vue";
import Switch from "@/components/ui/Switch.vue";
import Textarea from "@/components/ui/Textarea.vue";

const props = defineProps<{
    snapshot: PluginConfigSnapshot;
    title: string;
    saving?: boolean;
    error?: string | null;
}>();

const emit = defineEmits<{
    (event: "save", values: PluginConfigValues): void;
    (event: "close"): void;
}>();

const draft = reactive<Record<string, string | boolean>>({});
for (const field of props.snapshot.fields) {
    const value = props.snapshot.values[field.key];
    if (typeof value === "boolean") {
        draft[field.key] = value;
        continue;
    }
    const fallback = field.kind === "select" ? (field.options?.[0]?.value ?? "") : "";
    draft[field.key] = String(value ?? fallback);
}

const hasSecret = computed(() => props.snapshot.fields.some((field) => field.kind === "secret"));

const errors = computed<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const field of props.snapshot.fields) {
        const value = draft[field.key];
        if (field.kind === "boolean") {
            continue;
        }
        const text = String(value ?? "");
        if (field.required === true && text.trim() === "") {
            result[field.key] = `${field.label} is required`;
            continue;
        }
        if (field.kind === "number" && text.trim() !== "" && !Number.isFinite(Number(text))) {
            result[field.key] = `${field.label} must be a number`;
        }
    }
    return result;
});

const valid = computed(() => Object.keys(errors.value).length === 0);

function optionsOf(field: PluginConfigField): Array<{ value: string; label: string }> {
    return field.options ?? [];
}

function buildValues(): PluginConfigValues {
    const values: PluginConfigValues = {};
    for (const field of props.snapshot.fields) {
        const raw = draft[field.key];
        if (field.kind === "boolean") {
            values[field.key] = raw === true;
            continue;
        }
        const text = String(raw ?? "");
        if (field.kind === "number") {
            if (text.trim() !== "") {
                values[field.key] = Number(text);
            }
            continue;
        }
        if (field.kind !== "select" && field.required !== true && text === "") {
            // An empty optional value falls back to the manifest default.
            continue;
        }
        values[field.key] = text;
    }
    return values;
}

function submit(): void {
    if (!valid.value || props.saving === true) {
        return;
    }
    emit("save", buildValues());
}
</script>

<template>
    <Dialog :title="`Configure ${title}`" size="md" @close="emit('close')">
        <form class="plugin-config" @submit.prevent="submit">
            <p v-if="snapshot.fields.length === 0" class="plugin-config__empty">
                This plugin has no settings.
            </p>
            <template v-for="field in snapshot.fields" :key="field.key">
                <div v-if="field.kind === 'boolean'" class="plugin-config__boolean">
                    <div>
                        <p class="plugin-config__boolean-label">{{ field.label }}</p>
                        <p v-if="field.description" class="plugin-config__hint">
                            {{ field.description }}
                        </p>
                    </div>
                    <Switch
                        :model-value="draft[field.key] === true"
                        :aria-label="field.label"
                        @update:model-value="draft[field.key] = $event"
                    />
                </div>
                <Field
                    v-else
                    :label="field.label"
                    :hint="field.description"
                    :error="errors[field.key]"
                >
                    <template #default="{ id }">
                        <Select
                            v-if="field.kind === 'select'"
                            :id="id"
                            :model-value="String(draft[field.key] ?? '')"
                            :options="optionsOf(field)"
                            @update:model-value="draft[field.key] = String($event)"
                        />
                        <Textarea
                            v-else-if="field.kind === 'textarea'"
                            :id="id"
                            :model-value="String(draft[field.key] ?? '')"
                            :rows="3"
                            @update:model-value="draft[field.key] = String($event)"
                        />
                        <Input
                            v-else
                            :id="id"
                            :model-value="String(draft[field.key] ?? '')"
                            :type="
                                field.kind === 'secret'
                                    ? 'password'
                                    : field.kind === 'number'
                                      ? 'number'
                                      : 'text'
                            "
                            @update:model-value="draft[field.key] = String($event)"
                        />
                    </template>
                </Field>
            </template>

            <p v-if="hasSecret" class="plugin-config__note">
                Secret values are masked here, but stored unencrypted on this computer.
            </p>
            <p v-if="props.error" class="plugin-config__error" role="alert">{{ props.error }}</p>
        </form>

        <template #footer>
            <Button variant="ghost" @click="emit('close')">Cancel</Button>
            <Button
                variant="primary"
                :disabled="!valid || props.saving"
                :loading="props.saving"
                @click="submit"
            >
                Save
            </Button>
        </template>
    </Dialog>
</template>

<style scoped>
.plugin-config {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
}

.plugin-config__boolean {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
}

.plugin-config__boolean-label {
    margin: 0;
    color: var(--color-text-dim);
    font-size: 0.8rem;
    font-weight: 600;
}

.plugin-config__hint {
    margin: var(--space-2xs) 0 0;
    color: var(--color-text-faint);
    font-size: 0.76rem;
}

.plugin-config__note {
    margin: 0;
    color: var(--color-text-faint);
    font-size: 0.78rem;
    line-height: 1.5;
}

.plugin-config__error {
    margin: 0;
    color: var(--color-error);
    font-size: 0.8rem;
}

.plugin-config__empty {
    margin: 0;
    color: var(--color-text-faint);
    font-size: 0.84rem;
}
</style>
