<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
    AlertTriangle,
    Check,
    Play,
    Plug,
    Plus,
    RefreshCw,
    Settings2,
    Terminal,
    Trash2,
} from "@lucide/vue";
import type { PluginConfigSnapshot, PluginInspectResult, PluginMeta } from "@shared/ipc";
import type { PluginCommand } from "@shared/plugins";
import { humanizePluginCommandName, type PluginConfigValues } from "@shared/plugins";
import { storageClient } from "@/ipc/client";
import { referenceNotes } from "@/device/references";
import Button from "@/components/ui/Button.vue";
import Dialog from "@/components/ui/Dialog.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import IconButton from "@/components/ui/IconButton.vue";
import Switch from "@/components/ui/Switch.vue";
import PluginConfigDialog from "@/components/plugins/PluginConfigDialog.vue";
import { useAppStore } from "@/stores/appStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useProfileStore } from "@/stores/profileStore";

const store = usePluginStore();
const app = useAppStore();
const profile = useProfileStore();

const inspecting = ref(false);
const installing = ref(false);
const inspectResult = ref<PluginInspectResult | null>(null);
const installError = ref<string | null>(null);

const configTarget = ref<PluginMeta | null>(null);
const configSnapshot = ref<PluginConfigSnapshot | null>(null);
const configSaving = ref(false);
const configError = ref<string | null>(null);

const removeTarget = ref<PluginMeta | null>(null);
const removeNotes = ref<string[]>([]);

const commandsHandle = ref<string | null>(null);
const runResults = ref<Record<string, CommandRunResult>>({});
const runningCommand = ref<string | null>(null);

interface CommandRunResult {
    ok: boolean;
    message: string;
}

interface CommandRow {
    name: string;
    title: string;
    result: CommandRunResult | null;
}

const commandsPlugin = computed<PluginMeta | null>(() =>
    commandsHandle.value === null ? null : (store.find(commandsHandle.value) ?? null),
);

const commandRows = computed<CommandRow[]>(() => {
    const plugin = commandsPlugin.value;
    if (plugin === null) {
        return [];
    }
    return plugin.commands.map((command: PluginCommand) => ({
        name: command.name,
        title: commandLabel(command),
        result: runResults.value[`${plugin.handle}:${command.name}`] ?? null,
    }));
});

const replaceHandles = computed(() => new Set(store.plugins.map((plugin) => plugin.handle)));

const installReplaces = computed(() => {
    const result = inspectResult.value;
    if (result === null || result.manifest === null) {
        return false;
    }
    return replaceHandles.value.has(result.manifest.handle);
});

onMounted(() => {
    void store.refresh();
});

const STATUS_LABELS: Record<PluginMeta["status"], string> = {
    stopped: "Stopped",
    starting: "Starting",
    running: "Running",
    failed: "Failed",
};

const STATUS_CLASSES: Record<PluginMeta["status"], string> = {
    stopped: "",
    starting: "badge--warning",
    running: "badge--success",
    failed: "badge--error",
};

async function startInstall(): Promise<void> {
    if (inspecting.value) {
        return;
    }
    inspecting.value = true;
    installError.value = null;
    const result = await store.inspect();
    inspecting.value = false;
    if (result === null) {
        return;
    }
    inspectResult.value = result;
}

async function confirmInstall(): Promise<void> {
    const result = inspectResult.value;
    if (result === null || !result.valid || installing.value) {
        return;
    }
    installing.value = true;
    installError.value = null;
    const installed = await store.install(result.path, installReplaces.value);
    installing.value = false;
    if (installed !== null) {
        inspectResult.value = null;
        return;
    }
    installError.value = store.lastError ?? "Could not install the plugin";
}

async function toggle(plugin: PluginMeta, enabled: boolean): Promise<void> {
    await store.setEnabled(plugin.handle, enabled);
}

async function retry(plugin: PluginMeta): Promise<void> {
    await store.restart(plugin.handle);
}

async function openConfig(plugin: PluginMeta): Promise<void> {
    configError.value = null;
    const snapshot = await store.getConfig(plugin.handle);
    if (snapshot === null) {
        app.pushToast("error", store.lastError ?? "Could not read the plugin settings");
        return;
    }
    configTarget.value = plugin;
    configSnapshot.value = snapshot;
}

function closeConfig(): void {
    configTarget.value = null;
    configSnapshot.value = null;
    configError.value = null;
}

async function saveConfig(values: PluginConfigValues): Promise<void> {
    const target = configTarget.value;
    if (target === null || configSaving.value) {
        return;
    }
    configSaving.value = true;
    configError.value = null;
    const snapshot = await store.setConfig(target.handle, values);
    configSaving.value = false;
    if (snapshot === null) {
        configError.value = store.lastError ?? "Could not save the settings";
        return;
    }
    closeConfig();
}

async function startRemove(plugin: PluginMeta): Promise<void> {
    removeTarget.value = plugin;
    removeNotes.value = [];
    const scan = await storageClient.scanReferences({
        kind: "plugin",
        handle: plugin.handle,
    });
    if (scan.ok) {
        removeNotes.value = referenceNotes(
            { kind: "plugin", handle: plugin.handle },
            scan.data,
            profile.activeProfile,
        );
    }
}

function closeRemove(): void {
    removeTarget.value = null;
    removeNotes.value = [];
}

async function confirmRemove(): Promise<void> {
    const target = removeTarget.value;
    if (target === null) {
        return;
    }
    const removed = await store.remove(target.handle);
    if (removed) {
        closeRemove();
    }
}

function openCommands(plugin: PluginMeta): void {
    commandsHandle.value = plugin.handle;
    runResults.value = {};
}

function closeCommands(): void {
    commandsHandle.value = null;
}

async function runCommand(plugin: PluginMeta, command: string): Promise<void> {
    const key = `${plugin.handle}:${command}`;
    if (runningCommand.value !== null) {
        return;
    }
    runningCommand.value = key;
    delete runResults.value[key];
    const error = await store.invoke(plugin.handle, command);
    runningCommand.value = null;
    const result: CommandRunResult =
        error === null ? { ok: true, message: "Ran successfully." } : { ok: false, message: error };
    runResults.value = { ...runResults.value, [key]: result };
}

/** A command's title, or its name with separators turned into spaces. */
function commandLabel(command: { name: string; title?: string }): string {
    return command.title ?? humanizePluginCommandName(command.name);
}

function commandsEmpty(plugin: PluginMeta): string {
    if (!plugin.enabled) {
        return "Enable the plugin to use its commands.";
    }
    if (plugin.status === "failed") {
        return "The plugin did not start, so it has no commands.";
    }
    if (plugin.status !== "running") {
        return "Starting…";
    }
    return "This plugin has no commands.";
}

function closeInspect(): void {
    inspectResult.value = null;
    installError.value = null;
}
</script>

<template>
    <section class="view">
        <header class="view-header">
            <div>
                <h1 class="view-header__title">Plugins</h1>
            </div>
            <div class="view-header__actions">
                <Button variant="primary" :loading="inspecting" @click="startInstall">
                    <Plus :size="14" />
                    <span>Install plugin</span>
                </Button>
            </div>
        </header>

        <p v-if="store.lastError" class="plugin-banner" role="alert">
            <AlertTriangle :size="14" />
            <span>{{ store.lastError }}</span>
        </p>

        <EmptyState
            v-if="store.plugins.length === 0"
            title="No plugins installed"
            description="Plugins add actions you can run from a key. Install one to get started."
            :icon="Plug"
        >
            <Button variant="secondary" :loading="inspecting" @click="startInstall">
                <Plus :size="14" />
                <span>Install plugin</span>
            </Button>
        </EmptyState>

        <div v-else class="plugin-list">
            <article v-for="plugin in store.plugins" :key="plugin.handle" class="plugin-card">
                <div class="plugin-card__main">
                    <span class="plugin-card__icon">
                        <img
                            v-if="plugin.iconDataUrl"
                            class="plugin-card__icon-image"
                            :src="plugin.iconDataUrl"
                            alt=""
                        />
                        <Plug v-else :size="20" />
                    </span>

                    <div class="plugin-card__body">
                        <div class="plugin-card__heading">
                            <h2 class="plugin-card__name">{{ plugin.name }}</h2>
                            <span class="badge" :class="STATUS_CLASSES[plugin.status]">
                                {{ STATUS_LABELS[plugin.status] }}
                            </span>
                            <span v-if="plugin.version" class="plugin-card__version">
                                v{{ plugin.version }}
                            </span>
                        </div>

                        <p class="plugin-card__description">
                            {{ plugin.description || "No description." }}
                        </p>

                        <p v-if="plugin.error" class="plugin-card__error">
                            <AlertTriangle :size="13" />
                            <span>{{ plugin.error }}</span>
                        </p>
                        <p v-else-if="store.logErrors[plugin.handle]" class="plugin-card__error">
                            <AlertTriangle :size="13" />
                            <span>{{ store.logErrors[plugin.handle] }}</span>
                        </p>
                    </div>
                </div>

                <div class="plugin-card__side">
                    <Button size="sm" @click="openCommands(plugin)">
                        <Terminal :size="12" />
                        <span>Commands</span>
                    </Button>

                    <Button
                        v-if="plugin.status === 'failed'"
                        size="sm"
                        variant="secondary"
                        @click="retry(plugin)"
                    >
                        <RefreshCw :size="12" />
                        <span>Retry</span>
                    </Button>

                    <Button
                        v-if="plugin.hasConfig"
                        size="sm"
                        variant="secondary"
                        @click="openConfig(plugin)"
                    >
                        <Settings2 :size="12" />
                        <span>Configure</span>
                    </Button>

                    <Switch
                        :model-value="plugin.enabled"
                        :aria-label="`Enable ${plugin.name}`"
                        @update:model-value="toggle(plugin, $event)"
                    />

                    <IconButton
                        class="plugin-card__remove"
                        variant="ghost"
                        :label="`Remove ${plugin.name}`"
                        @click="startRemove(plugin)"
                    >
                        <Trash2 :size="15" />
                    </IconButton>
                </div>
            </article>
        </div>

        <Dialog
            v-if="inspectResult"
            :title="
                inspectResult.valid
                    ? `Install ${inspectResult.manifest?.name ?? ''}?`
                    : 'Cannot install this folder'
            "
            size="md"
            @close="closeInspect"
        >
            <template v-if="inspectResult.valid && inspectResult.manifest">
                <dl class="install-summary">
                    <dt>Version</dt>
                    <dd>{{ inspectResult.manifest.version }}</dd>
                    <dt>Description</dt>
                    <dd>{{ inspectResult.manifest.description || "None" }}</dd>
                </dl>

                <p v-if="installReplaces" class="install-warning">
                    <AlertTriangle :size="14" />
                    <span>
                        Version {{ inspectResult.installedVersion ?? "unknown" }} is already
                        installed. Replacing keeps its settings and whether it is enabled.
                    </span>
                </p>

                <p class="install-trust">
                    A plugin runs with the same privileges as this app. It can read and write your
                    files, use the network and start other programs. Install only plugins you trust.
                </p>
            </template>

            <p v-else class="install-error" role="alert">{{ inspectResult.error }}</p>
            <p v-if="installError" class="install-error install-error--spaced" role="alert">
                {{ installError }}
            </p>

            <template #footer>
                <Button variant="ghost" @click="closeInspect">
                    {{ inspectResult.valid ? "Cancel" : "Close" }}
                </Button>
                <Button
                    v-if="inspectResult.valid"
                    variant="primary"
                    :loading="installing"
                    @click="confirmInstall"
                >
                    {{ installReplaces ? "Replace" : "Install" }}
                </Button>
            </template>
        </Dialog>

        <Dialog
            v-if="commandsPlugin"
            :title="`${commandsPlugin.name} commands`"
            description="Run a command to test its handler."
            size="md"
            @close="closeCommands"
        >
            <p v-if="commandsPlugin.error" class="commands-modal__error">
                <AlertTriangle :size="13" />
                <span>{{ commandsPlugin.error }}</span>
            </p>

            <ul v-if="commandRows.length > 0" class="commands-modal__list">
                <li v-for="row in commandRows" :key="row.name" class="commands-modal__row">
                    <span class="commands-modal__icon"><Play :size="12" /></span>
                    <div class="commands-modal__body">
                        <span class="commands-modal__title">{{ row.title }}</span>
                        <span
                            v-if="row.result"
                            class="commands-modal__result"
                            :class="
                                row.result.ok
                                    ? 'commands-modal__result--ok'
                                    : 'commands-modal__result--error'
                            "
                        >
                            <component :is="row.result.ok ? Check : AlertTriangle" :size="12" />
                            <span>{{ row.result.message }}</span>
                        </span>
                    </div>
                    <Button
                        size="sm"
                        :disabled="runningCommand !== null"
                        :loading="runningCommand === `${commandsPlugin.handle}:${row.name}`"
                        @click="runCommand(commandsPlugin, row.name)"
                    >
                        <span>Run</span>
                    </Button>
                </li>
            </ul>
            <p v-else class="commands-modal__empty">{{ commandsEmpty(commandsPlugin) }}</p>

            <template #footer>
                <Button variant="ghost" @click="closeCommands">Close</Button>
            </template>
        </Dialog>

        <Dialog
            v-if="removeTarget"
            :title="`Remove ${removeTarget.name}?`"
            size="sm"
            @close="closeRemove"
        >
            <p class="remove-message">
                This plugin and its settings will be removed. This cannot be undone.
            </p>
            <ul v-if="removeNotes.length > 0" class="remove-notes">
                <li v-for="note in removeNotes" :key="note">{{ note }}</li>
            </ul>
            <template #footer>
                <Button variant="ghost" @click="closeRemove">Cancel</Button>
                <Button variant="danger" @click="confirmRemove">Remove</Button>
            </template>
        </Dialog>

        <PluginConfigDialog
            v-if="configSnapshot"
            :snapshot="configSnapshot"
            :title="configTarget?.name ?? 'Plugin'"
            :saving="configSaving"
            :error="configError"
            @save="saveConfig"
            @close="closeConfig"
        />
    </section>
</template>

<style scoped>
.plugin-banner {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    margin: 0 0 var(--space-md);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border));
    border-radius: var(--radius-md);
    color: var(--color-error);
    font-size: 0.84rem;
}

.plugin-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
}

.plugin-card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-lg);
    padding: var(--space-lg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-bg-elevated);
}

.plugin-card__main {
    display: flex;
    align-items: flex-start;
    gap: var(--space-md);
    min-width: 0;
}

.plugin-card__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-bg-hover);
    color: var(--color-text-dim);
}

.plugin-card__icon-image {
    width: 100%;
    height: 100%;
    border-radius: calc(var(--radius-md) - 1px);
    object-fit: contain;
}

.plugin-card__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
}

.plugin-card__heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
}

.plugin-card__name {
    margin: 0;
    font-size: 0.98rem;
    font-weight: 650;
}

.plugin-card__version {
    color: var(--color-text-faint);
    font-family: var(--font-mono);
    font-size: 0.72rem;
}

.plugin-card__description {
    margin: 0;
    color: var(--color-text-dim);
    font-size: 0.84rem;
    line-height: 1.5;
}

.plugin-card__error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin: 0;
    color: var(--color-error);
    font-size: 0.8rem;
    line-height: 1.45;
}

.commands-modal__error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin: 0 0 var(--space-md);
    color: var(--color-error);
    font-size: 0.8rem;
    line-height: 1.45;
}

.commands-modal__list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-bg);
    overflow: hidden;
}

.commands-modal__row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-top: 1px solid var(--color-border);
}

.commands-modal__row:first-child {
    border-top: none;
}

.commands-modal__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-hover);
    color: var(--color-text-faint);
}

.commands-modal__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.commands-modal__title {
    font-size: 0.84rem;
    font-weight: 600;
}

.commands-modal__result {
    display: flex;
    align-items: center;
    gap: var(--space-2xs);
    font-size: 0.74rem;
    line-height: 1.4;
}

.commands-modal__result--ok {
    color: var(--color-success);
}

.commands-modal__result--error {
    color: var(--color-error);
}

.commands-modal__empty {
    margin: 0;
    padding: var(--space-md);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-faint);
    font-size: 0.82rem;
    line-height: 1.5;
}

.plugin-card__side {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-sm);
}

.plugin-card__remove.ui-icon-button:hover:not(:disabled) {
    border-color: var(--color-error);
    color: var(--color-error);
}

.install-summary {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-xs) var(--space-md);
    margin: 0 0 var(--space-md);
    font-size: 0.84rem;
}

.install-summary dt {
    color: var(--color-text-faint);
}

.install-summary dd {
    margin: 0;
    color: var(--color-text);
}

.install-trust,
.install-warning,
.install-error,
.remove-message {
    margin: 0;
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-size: 0.82rem;
    line-height: 1.5;
}

.install-trust {
    margin-top: var(--space-sm);
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, var(--color-border));
    color: var(--color-text-dim);
}

.install-warning {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin-bottom: var(--space-sm);
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, var(--color-border));
    color: var(--color-warning);
}

.install-error {
    border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border));
    color: var(--color-error);
}

.install-error--spaced {
    margin-top: var(--space-sm);
}

.remove-message {
    padding: 0;
    color: var(--color-text-dim);
}

.remove-notes {
    margin: var(--space-sm) 0 0;
    padding-left: var(--space-lg);
    color: var(--color-warning);
    font-size: 0.8rem;
    line-height: 1.5;
}
</style>
