import { ref } from "vue";
import { defineStore } from "pinia";
import type { PluginConfigSnapshot, PluginInspectResult, PluginMeta } from "@shared/ipc";
import type { PluginConfigValues } from "@shared/plugins";
import { pluginsClient } from "@/ipc/client";
import { eventChannels, on } from "@/ipc/events";
import type { PluginRegistration } from "@/actions/registry";
import { useAppStore } from "@/stores/appStore";

/**
 * Installed plugins, their config snapshots and the registration revision the
 * picker watches. Main owns the processes; this store mirrors their status and
 * turns status/registration pushes into a fresh list.
 */
export const usePluginStore = defineStore("plugins", () => {
    const plugins = ref<PluginMeta[]>([]);
    const configs = ref<Record<string, PluginConfigSnapshot>>({});
    const lastError = ref<string | null>(null);
    /** Last error log line per plugin, shown on its row rather than globally. */
    const logErrors = ref<Record<string, string>>({});
    /** Bumped when a plugin's command list changes; the picker reloads on it. */
    const registrationRevision = ref(0);

    let initialization: Promise<void> | null = null;

    function clearError(): void {
        lastError.value = null;
    }

    function refresh(): Promise<void> {
        return (async () => {
            const result = await pluginsClient.list();
            if (!result.ok) {
                lastError.value = result.error;
                useAppStore().pushToast("error", result.error);
                return;
            }
            plugins.value = result.data;
            clearError();
        })();
    }

    function init(): Promise<void> {
        if (initialization !== null) {
            return initialization;
        }
        on(eventChannels.plugin, (payload) => {
            if (payload.type === "status") {
                const plugin = plugins.value.find((item) => item.handle === payload.handle);
                if (plugin !== undefined) {
                    plugin.status = payload.status;
                    plugin.error = payload.error;
                    if (payload.status !== "running") {
                        plugin.commands = [];
                    }
                }
                return;
            }
            if (payload.type === "registrations") {
                // Refresh first: the revision is what tells the picker to
                // reload, so it must land after the command lists do.
                void refresh().then(() => {
                    registrationRevision.value += 1;
                });
                return;
            }
            if (payload.level === "error") {
                // A handler or setup log belongs to one plugin's row; keeping
                // it in `lastError` would leave a global banner behind.
                logErrors.value = { ...logErrors.value, [payload.handle]: payload.message };
            }
        });
        initialization = refresh();
        return initialization;
    }

    /** Provider payload: every installed plugin, disabled ones without commands. */
    function registrations(): PluginRegistration[] {
        return plugins.value.map((plugin) => ({
            handle: plugin.handle,
            label: plugin.name,
            iconDataUrl: plugin.iconDataUrl,
            commands:
                plugin.status === "running"
                    ? plugin.commands.map((command) => ({
                          command: command.name,
                          ...(command.title === undefined ? {} : { title: command.title }),
                      }))
                    : [],
        }));
    }

    function find(handle: string): PluginMeta | undefined {
        return plugins.value.find((plugin) => plugin.handle === handle);
    }

    async function inspect(path?: string): Promise<PluginInspectResult | null> {
        const result = await pluginsClient.inspect(path);
        if (!result.ok) {
            lastError.value = result.error;
            return null;
        }
        clearError();
        return result.data;
    }

    async function install(path: string, replace: boolean): Promise<PluginMeta | null> {
        const result = await pluginsClient.install(path, replace);
        if (!result.ok) {
            lastError.value = result.error;
            return null;
        }
        await refresh();
        clearError();
        useAppStore().pushToast("success", `Installed ${result.data.name} ${result.data.version}`);
        return result.data;
    }

    async function setEnabled(handle: string, enabled: boolean): Promise<boolean> {
        const result = await pluginsClient.setEnabled(handle, enabled);
        if (!result.ok) {
            lastError.value = result.error;
            useAppStore().pushToast("error", result.error);
            await refresh();
            return false;
        }
        delete logErrors.value[handle];
        await refresh();
        clearError();
        return true;
    }

    async function restart(handle: string): Promise<boolean> {
        const result = await pluginsClient.restart(handle);
        if (!result.ok) {
            lastError.value = result.error;
            useAppStore().pushToast("error", result.error);
            await refresh();
            return false;
        }
        delete logErrors.value[handle];
        await refresh();
        clearError();
        return true;
    }

    async function remove(handle: string): Promise<boolean> {
        const result = await pluginsClient.remove(handle);
        if (!result.ok) {
            lastError.value = result.error;
            useAppStore().pushToast("error", result.error);
            return false;
        }
        delete configs.value[handle];
        delete logErrors.value[handle];
        await refresh();
        clearError();
        useAppStore().pushToast("success", `Removed ${handle}`);
        return true;
    }

    async function getConfig(handle: string): Promise<PluginConfigSnapshot | null> {
        const result = await pluginsClient.getConfig(handle);
        if (!result.ok) {
            lastError.value = result.error;
            return null;
        }
        configs.value[handle] = result.data;
        clearError();
        return result.data;
    }

    async function setConfig(
        handle: string,
        values: PluginConfigValues,
    ): Promise<PluginConfigSnapshot | null> {
        const result = await pluginsClient.setConfig(handle, values);
        if (!result.ok) {
            lastError.value = result.error;
            return null;
        }
        configs.value[handle] = result.data;
        delete logErrors.value[handle];
        await refresh();
        clearError();
        useAppStore().pushToast("success", `Saved config for ${handle}`);
        return result.data;
    }

    /** Run one command by hand; returns the handler's error, if any. */
    async function invoke(handle: string, command: string): Promise<string | null> {
        const result = await pluginsClient.invoke(handle, command);
        if (!result.ok) {
            lastError.value = result.error;
            return result.error;
        }
        delete logErrors.value[handle];
        clearError();
        return null;
    }

    /**
     * Why a `CMD:<handle>:<command>` step would do nothing, or `null` when it
     * is ready to run. Used by the inspector's advisory line.
     */
    function commandProblem(handle: string, command: string): string | null {
        const plugin = find(handle);
        if (plugin === undefined) {
            return "This action needs a plugin that is not installed.";
        }
        if (!plugin.enabled) {
            return `This action needs ${plugin.name}, which is disabled.`;
        }
        if (plugin.status === "failed") {
            return `This action needs ${plugin.name}, which failed to start.`;
        }
        if (plugin.status === "starting") {
            return null;
        }
        if (plugin.status !== "running") {
            return `This action needs ${plugin.name}, which is not running.`;
        }
        if (!plugin.commands.some((item) => item.name === command)) {
            return `${plugin.name} does not offer this action anymore.`;
        }
        return null;
    }

    return {
        plugins,
        configs,
        lastError,
        logErrors,
        registrationRevision,
        init,
        refresh,
        registrations,
        find,
        inspect,
        install,
        setEnabled,
        restart,
        remove,
        getConfig,
        setConfig,
        invoke,
        commandProblem,
    };
});
