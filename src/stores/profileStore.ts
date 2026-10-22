import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { storageClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import { useConfirmStore } from "@/stores/confirmStore";
import { emptyButtonConfig, emptyPageConfig, isValidBoardIndex } from "@shared/schema";
import { iconBaseName } from "@shared/icons";
import { pageLabel } from "@shared/pages";
import type { ButtonConfig, PageConfig, PageMeta, ProfileMeta } from "@shared/types";

/** Next free page id (smallest 0..255 not present); `null` when full. */
export function nextPageId(pages: readonly PageMeta[]): string | null {
    const used = new Set(pages.map((page) => Number(page.id)));
    for (let id = 0; id <= 255; id++) {
        if (!used.has(id)) {
            return String(id);
        }
    }
    return null;
}

/**
 * Profile editing state: active profile, its pages, the loaded page (with
 * dirty tracking), and the selected board key driving the inspector.
 */
export const useProfileStore = defineStore("profile", () => {
    const profiles = ref<ProfileMeta[]>([]);
    const activeProfile = ref<string>("");
    const pages = ref<PageMeta[]>([]);
    const currentPageId = ref<string | null>(null);
    const currentPage = ref<PageConfig>(emptyPageConfig());
    const currentPageMtime = ref<number | null>(null);
    const selectedKey = ref<string | null>(null);
    const saving = ref(false);
    const dirty = ref(false);
    let pagesRequestSeq = 0;

    const hasProfile = computed(() => activeProfile.value !== "");
    const hasPage = computed(() => currentPageId.value !== null);
    const selectedButton = computed<ButtonConfig | undefined>(() =>
        selectedKey.value === null ? undefined : currentPage.value.buttons[selectedKey.value],
    );
    const defaultProfile = computed(
        () => profiles.value.find((item) => item.isDefault)?.name ?? null,
    );

    async function refreshProfiles(): Promise<void> {
        const result = await storageClient.listProfiles();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        profiles.value = result.data;
        if (
            activeProfile.value !== "" &&
            !result.data.some((p) => p.name === activeProfile.value)
        ) {
            activeProfile.value = "";
            pages.value = [];
            currentPageId.value = null;
            currentPage.value = emptyPageConfig();
            selectedKey.value = null;
            dirty.value = false;
        }
    }

    async function refreshPages(profile: string | null = activeProfile.value): Promise<void> {
        const requestSeq = ++pagesRequestSeq;
        if (profile === null || profile === "") {
            if (requestSeq === pagesRequestSeq) {
                pages.value = [];
            }
            return;
        }
        const result = await storageClient.listPages(profile);
        // Discard stale responses when the user switched profile meanwhile.
        if (requestSeq !== pagesRequestSeq) {
            return;
        }
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        pages.value = result.data;
    }

    /** Confirm discarding unsaved edits; true when it is safe to proceed. */
    async function guardUnsaved(): Promise<boolean> {
        if (!dirty.value) {
            return true;
        }
        return useConfirmStore().ask({
            title: "Discard unsaved changes",
            message: "This page has unsaved changes. Discard them?",
            confirmLabel: "Discard",
            danger: true,
        });
    }

    async function loadPage(id: string): Promise<void> {
        if (activeProfile.value === "") {
            return;
        }
        const result = await storageClient.loadPage(activeProfile.value, id);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        currentPage.value = result.data;
        currentPageId.value = id;
        currentPageMtime.value = pages.value.find((page) => page.id === id)?.mtimeMs ?? null;
        selectedKey.value = null;
        dirty.value = false;
    }

    async function selectProfile(profile: string): Promise<void> {
        if (profile === activeProfile.value) {
            return;
        }
        if (!(await guardUnsaved())) {
            return;
        }
        activeProfile.value = profile;
        await refreshPages(profile);
        if (pages.value.length > 0) {
            await loadPage(pages.value[0].id);
        } else {
            currentPage.value = emptyPageConfig();
            currentPageId.value = null;
            currentPageMtime.value = null;
            selectedKey.value = null;
            dirty.value = false;
        }
    }

    /**
     * Boot resolution: list profiles, then open the persisted default profile
     * (falling back to the first profile) instead of a profile literally named
     * "Default".
     */
    async function initProfiles(): Promise<void> {
        await refreshProfiles();
        if (profiles.value.length === 0) {
            return;
        }
        const target = defaultProfile.value ?? profiles.value[0].name;
        await selectProfile(target);
    }

    async function selectPage(id: string): Promise<void> {
        if (id === currentPageId.value || !(await guardUnsaved())) {
            return;
        }
        await loadPage(id);
    }

    /** Create the next free page (persisted immediately) and open it. */
    async function createPage(): Promise<void> {
        if (activeProfile.value === "") {
            useAppStore().pushToast("warning", "Select a profile first");
            return;
        }
        if (!(await guardUnsaved())) {
            return;
        }
        const id = nextPageId(pages.value);
        if (id === null) {
            useAppStore().pushToast("error", "All 256 page ids are in use");
            return;
        }
        const result = await storageClient.savePage(activeProfile.value, id, emptyPageConfig());
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        await refreshPages();
        await loadPage(id);
    }

    function selectKey(index: string | null): void {
        selectedKey.value = index !== null && isValidBoardIndex(index) ? index : null;
    }

    function ensureButton(index: string): ButtonConfig {
        const existing = currentPage.value.buttons[index];
        if (existing) {
            return existing;
        }
        const created = emptyButtonConfig();
        currentPage.value.buttons[index] = created;
        return created;
    }

    function ensureSelectedButton(): ButtonConfig | null {
        if (selectedKey.value === null) {
            return null;
        }
        return ensureButton(selectedKey.value);
    }

    function setLabel(value: string): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (value === "") {
            delete button.label;
        } else {
            button.label = value;
        }
        dirty.value = true;
    }

    function setBackgroundColor(value: string): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (value === "") {
            delete button.backgroundColor;
        } else {
            button.backgroundColor = value;
        }
        dirty.value = true;
    }

    /** `imageName` is always stored without the `.png` extension. */
    function setImageName(value: string): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        const base = iconBaseName(value);
        if (base === "") {
            delete button.imageName;
        } else {
            button.imageName = base;
        }
        dirty.value = true;
    }

    function clearButton(): void {
        if (selectedKey.value === null) {
            return;
        }
        delete currentPage.value.buttons[selectedKey.value];
        dirty.value = true;
    }

    function addAction(action: string): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        button.click = [...button.click, action];
        dirty.value = true;
    }

    function updateAction(index: number, value: string): void {
        const button = ensureSelectedButton();
        if (!button || index < 0 || index >= button.click.length) {
            return;
        }
        const next = [...button.click];
        next[index] = value;
        button.click = next;
        dirty.value = true;
    }

    function removeAction(index: number): void {
        const button = ensureSelectedButton();
        if (!button || index < 0 || index >= button.click.length) {
            return;
        }
        const next = [...button.click];
        next.splice(index, 1);
        button.click = next;
        dirty.value = true;
    }

    /** Move a step up (`delta = -1`) or down (`delta = 1`). */
    function moveAction(index: number, delta: -1 | 1): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        const target = index + delta;
        if (
            index < 0 ||
            index >= button.click.length ||
            target < 0 ||
            target >= button.click.length
        ) {
            return;
        }
        const next = [...button.click];
        [next[index], next[target]] = [next[target], next[index]];
        button.click = next;
        dirty.value = true;
    }

    async function saveCurrentPage(): Promise<boolean> {
        if (activeProfile.value === "" || currentPageId.value === null) {
            return false;
        }
        saving.value = true;
        try {
            const result = await storageClient.savePage(
                activeProfile.value,
                currentPageId.value,
                currentPage.value,
            );
            if (!result.ok) {
                useAppStore().pushToast("error", result.error);
                return false;
            }
            dirty.value = false;
            await refreshPages();
            currentPageMtime.value =
                pages.value.find((page) => page.id === currentPageId.value)?.mtimeMs ?? null;
            useAppStore().pushToast("success", "Page saved");
            return true;
        } finally {
            saving.value = false;
        }
    }

    /** Profile CRUD wrappers (the caller owns confirmation UX). */
    async function createProfile(name: string): Promise<void> {
        const result = await storageClient.createProfile(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        const hadDefault = profiles.value.some((item) => item.isDefault);
        await refreshProfiles();
        if (!hadDefault) {
            await setDefaultProfile(name);
        }
        await selectProfile(name);
    }

    async function renameProfile(oldName: string, newName: string): Promise<void> {
        const wasDefault = profiles.value.find((item) => item.name === oldName)?.isDefault === true;
        const result = await storageClient.renameProfile(oldName, newName);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        if (activeProfile.value === oldName) {
            activeProfile.value = newName;
        }
        if (wasDefault) {
            await storageClient.setDefaultProfile(newName);
        }
        await refreshProfiles();
    }

    async function deleteProfile(name: string): Promise<void> {
        const wasDefault = profiles.value.find((item) => item.name === name)?.isDefault === true;
        const result = await storageClient.deleteProfile(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        if (activeProfile.value === name) {
            activeProfile.value = "";
            pages.value = [];
            currentPageId.value = null;
            currentPage.value = emptyPageConfig();
            selectedKey.value = null;
            dirty.value = false;
        }
        await refreshProfiles();
        if (wasDefault) {
            const fallback = profiles.value[0]?.name ?? null;
            await storageClient.setDefaultProfile(fallback);
            await refreshProfiles();
            if (fallback !== null) {
                await selectProfile(fallback);
            }
        }
    }

    async function setDefaultProfile(name: string): Promise<void> {
        const result = await storageClient.setDefaultProfile(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        await refreshProfiles();
        useAppStore().pushToast("success", `Default profile set to "${name}"`);
    }

    /** Import a profile directory picked in the main process. */
    async function importProfile(): Promise<void> {
        const result = await storageClient.importProfile();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        if (result.data === null) {
            return;
        }
        const imported = result.data.name;
        const hadDefault = profiles.value.some((item) => item.isDefault);
        await refreshProfiles();
        if (!hadDefault) {
            await storageClient.setDefaultProfile(imported);
            await refreshProfiles();
        }
        await selectProfile(imported);
        useAppStore().pushToast("success", `Imported profile "${imported}"`);
    }

    /** Export a profile directory via the main-process save dialog. */
    async function exportProfile(name: string): Promise<void> {
        const result = await storageClient.exportProfile(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        if (result.data !== null) {
            useAppStore().pushToast("success", `Exported "${name}" to ${result.data.path}`);
        }
    }

    /**
     * Re-list pages and, when the open page file changed on disk since it was
     * loaded, offer to reload (store<->disk desync guard).
     */
    async function checkExternalChanges(): Promise<void> {
        if (activeProfile.value === "" || currentPageId.value === null) {
            return;
        }
        const result = await storageClient.listPages(activeProfile.value);
        if (!result.ok) {
            return;
        }
        pages.value = result.data;
        const meta = result.data.find((page) => page.id === currentPageId.value);
        if (
            meta?.mtimeMs !== undefined &&
            currentPageMtime.value !== null &&
            meta.mtimeMs > currentPageMtime.value
        ) {
            const reload = await useConfirmStore().ask({
                title: "Page changed on disk",
                message: `${pageLabel(currentPageId.value)} changed on disk. Reload it and discard unsaved edits?`,
                confirmLabel: "Reload",
                danger: true,
            });
            if (reload) {
                await loadPage(currentPageId.value);
            } else {
                currentPageMtime.value = meta.mtimeMs;
            }
        }
    }

    return {
        profiles,
        activeProfile,
        pages,
        currentPageId,
        currentPage,
        currentPageMtime,
        selectedKey,
        saving,
        dirty,
        hasProfile,
        hasPage,
        selectedButton,
        defaultProfile,
        refreshProfiles,
        refreshPages,
        loadPage,
        selectProfile,
        initProfiles,
        selectPage,
        createPage,
        selectKey,
        setLabel,
        setBackgroundColor,
        setImageName,
        clearButton,
        addAction,
        updateAction,
        removeAction,
        moveAction,
        saveCurrentPage,
        createProfile,
        renameProfile,
        deleteProfile,
        setDefaultProfile,
        importProfile,
        exportProfile,
        checkExternalChanges,
    };
});
