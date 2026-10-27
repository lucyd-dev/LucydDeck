import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { storageClient } from "@/ipc/client";
import { useAppStore } from "@/stores/appStore";
import { PageDocumentHistory, clonePageConfig } from "@/editor/pageDocument";
import { validateActionString } from "@shared/actions";
import { emptyButtonConfig, emptyPageConfig, isValidBoardIndex } from "@shared/schema";
import { iconBaseName } from "@shared/icons";
import type { ButtonConfig, PageConfig, PageMeta, ProfileMeta } from "@shared/types";

/** Delay between the last edit and the autosave write. */
export const AUTOSAVE_DELAY_MS = 400;

export type SaveState = "saved" | "dirty" | "saving" | "blocked" | "error";

export interface ExternalChange {
    pageId: string;
    mtimeMs: number;
}

/** Stable history/document key for one page in one profile. */
export function pageHistoryKey(profile: string, pageId: string): string {
    return `${profile}/${pageId}`;
}

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
 * Profile editing state: active profile, its pages, the loaded page, the
 * selected keys driving the inspector, and the autosave loop.
 *
 * The store owns the edit document. Every mutation records an undo snapshot,
 * bumps a revision, and schedules one write 400 ms later. Writes run one at a
 * time; a change made during a write queues another pass.
 */
export const useProfileStore = defineStore("profile", () => {
    const profiles = ref<ProfileMeta[]>([]);
    const activeProfile = ref<string>("");
    const pages = ref<PageMeta[]>([]);
    const currentPageId = ref<string | null>(null);
    const currentPage = ref<PageConfig>(emptyPageConfig());
    const currentPageMtime = ref<number | null>(null);
    const selectedKeys = ref<string[]>([]);
    const dirty = ref(false);
    const saveState = ref<SaveState>("saved");
    const externalChange = ref<ExternalChange | null>(null);

    const history = new PageDocumentHistory();
    const historyVersion = ref(0);
    /** Pages with unsaved invalid steps, kept while the user edits elsewhere. */
    const deferredPages = new Map<string, PageConfig>();
    let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSave: Promise<boolean> | null = null;
    let saveAgain = false;
    let changeRevision = 0;
    let pagesRequestSeq = 0;
    /** Profiles deleted this session; a queued write must not revive one. */
    const retiredProfiles = new Set<string>();

    const hasProfile = computed(() => activeProfile.value !== "");
    const hasPage = computed(() => currentPageId.value !== null);
    const selectedKey = computed<string | null>(() =>
        selectedKeys.value.length === 1 ? selectedKeys.value[0] : null,
    );
    const selectedButton = computed<ButtonConfig | undefined>(() =>
        selectedKey.value === null ? undefined : currentPage.value.buttons[selectedKey.value],
    );
    const selectedCount = computed(() => selectedKeys.value.length);
    const isMultiSelect = computed(() => selectedKeys.value.length > 1);
    const saving = computed(() => saveState.value === "saving");
    const defaultProfile = computed(
        () => profiles.value.find((item) => item.isDefault)?.name ?? null,
    );

    const invalidStepCount = computed(() => {
        let count = 0;
        for (const button of Object.values(currentPage.value.buttons)) {
            for (const action of button.click) {
                if (!validateActionString(action).ok) {
                    count++;
                }
            }
        }
        return count;
    });

    const historyPageId = (): string | null => {
        if (activeProfile.value === "" || currentPageId.value === null) {
            return null;
        }
        return pageHistoryKey(activeProfile.value, currentPageId.value);
    };

    const canUndo = computed(() => {
        void historyVersion.value;
        const id = historyPageId();
        return id !== null && history.canUndo(id);
    });

    const canRedo = computed(() => {
        void historyVersion.value;
        const id = historyPageId();
        return id !== null && history.canRedo(id);
    });

    function clearAutosaveTimer(): void {
        if (autosaveTimer !== null) {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
        }
    }

    function scheduleAutosave(): void {
        clearAutosaveTimer();
        if (invalidStepCount.value > 0) {
            saveState.value = "blocked";
            return;
        }
        saveState.value = "dirty";
        autosaveTimer = setTimeout(() => {
            autosaveTimer = null;
            void saveNow();
        }, AUTOSAVE_DELAY_MS);
    }

    /** Mark a change and queue the debounced write. */
    function touch(): void {
        dirty.value = true;
        changeRevision++;
        scheduleAutosave();
    }

    function recordHistory(coalesce?: string): void {
        const id = historyPageId();
        if (id === null) {
            return;
        }
        history.record(id, currentPage.value, coalesce === undefined ? {} : { coalesce });
        historyVersion.value++;
    }

    async function writeCurrentPage(): Promise<boolean> {
        const profile = activeProfile.value;
        const id = currentPageId.value;
        if (profile === "" || id === null || retiredProfiles.has(profile)) {
            return true;
        }
        if (invalidStepCount.value > 0) {
            saveState.value = "blocked";
            return false;
        }

        const revision = changeRevision;
        const page = clonePageConfig(currentPage.value);
        saveState.value = "saving";
        const result = await storageClient.savePage(profile, id, page);
        if (!result.ok) {
            saveState.value = "error";
            dirty.value = true;
            useAppStore().pushToast("error", result.error);
            return false;
        }

        if (activeProfile.value !== profile || currentPageId.value !== id) {
            // The user left this page while the write was in flight. The page
            // itself is saved; the new page keeps its own state.
            return true;
        }

        // Read back the file mtime instead of guessing with the local clock:
        // a stale mtime would make the app report its own write as an external
        // edit on the next focus.
        deferredPages.delete(pageHistoryKey(profile, id));
        const pagesResult = await storageClient.listPages(profile).catch(() => null);
        if (activeProfile.value !== profile || currentPageId.value !== id) {
            return true;
        }
        if (pagesResult?.ok) {
            pages.value = pagesResult.data;
            currentPageMtime.value =
                pagesResult.data.find((page) => page.id === id)?.mtimeMs ?? Date.now();
        } else {
            currentPageMtime.value = Date.now();
        }

        if (revision === changeRevision) {
            dirty.value = false;
            saveState.value = "saved";
        } else {
            dirty.value = true;
            saveState.value = "dirty";
            if (autosaveTimer === null && invalidStepCount.value === 0) {
                scheduleAutosave();
            }
        }
        return true;
    }

    async function saveNow(): Promise<boolean> {
        if (activeSave !== null) {
            saveAgain = true;
            return activeSave;
        }
        const task = (async () => {
            let ok: boolean;
            do {
                saveAgain = false;
                ok = await writeCurrentPage();
            } while (ok && saveAgain);
            return ok;
        })();
        activeSave = task;
        try {
            return await task;
        } finally {
            if (activeSave === task) {
                activeSave = null;
            }
        }
    }

    /** Write a pending change immediately; the page-switch flush. */
    async function flushPending(): Promise<boolean> {
        clearAutosaveTimer();
        if (activeSave !== null) {
            await activeSave;
        }
        if (!dirty.value) {
            return true;
        }
        return saveNow();
    }

    /**
     * Leave the current page. Invalid steps cannot be written, so their page is
     * kept in memory and restored when the user comes back; everything else is
     * flushed first.
     */
    async function leaveCurrentPage(): Promise<boolean> {
        if (!dirty.value) {
            return true;
        }
        if (invalidStepCount.value > 0) {
            const key = historyPageId();
            if (key === null) {
                return false;
            }
            deferredPages.set(key, clonePageConfig(currentPage.value));
            clearAutosaveTimer();
            dirty.value = false;
            changeRevision++;
            useAppStore().pushToast(
                "warning",
                "That page has invalid steps. Its changes stay in the editor until you fix them.",
            );
            return true;
        }
        return flushPending();
    }

    async function refreshProfiles(): Promise<void> {
        const result = await storageClient.listProfiles();
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        profiles.value = result.data;
        // A profile that is back on disk is writable again (import, recreate).
        for (const item of result.data) {
            retiredProfiles.delete(item.name);
        }
        if (
            activeProfile.value !== "" &&
            !result.data.some((p) => p.name === activeProfile.value)
        ) {
            resetDocument();
            history.clear();
            historyVersion.value++;
            pages.value = [];
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

    /** Drop the page-level document, leaving the active profile in place. */
    function clearDocument(): void {
        clearAutosaveTimer();
        // Discard a page listing still in flight for the document being dropped.
        pagesRequestSeq++;
        pages.value = [];
        currentPageId.value = null;
        currentPage.value = emptyPageConfig();
        currentPageMtime.value = null;
        selectedKeys.value = [];
        dirty.value = false;
        saveState.value = "saved";
        externalChange.value = null;
        changeRevision++;
    }

    function resetDocument(): void {
        clearDocument();
        activeProfile.value = "";
        deferredPages.clear();
    }

    async function loadPage(id: string, options: { fromDisk?: boolean } = {}): Promise<boolean> {
        const profile = activeProfile.value;
        if (profile === "") {
            return false;
        }
        const key = pageHistoryKey(profile, id);
        if (options.fromDisk) {
            deferredPages.delete(key);
        } else {
            const deferred = deferredPages.get(key);
            if (deferred !== undefined) {
                deferredPages.delete(key);
                currentPage.value = clonePageConfig(deferred);
                currentPageId.value = id;
                currentPageMtime.value =
                    pages.value.find((page) => page.id === id)?.mtimeMs ?? null;
                selectedKeys.value = [];
                dirty.value = true;
                saveState.value = "blocked";
                externalChange.value = null;
                changeRevision++;
                return true;
            }
        }

        const result = await storageClient.loadPage(profile, id);
        // The user switched profiles while this page was loading; the new
        // profile owns the document now.
        if (activeProfile.value !== profile) {
            return false;
        }
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return false;
        }
        currentPage.value = result.data;
        currentPageId.value = id;
        currentPageMtime.value = pages.value.find((page) => page.id === id)?.mtimeMs ?? null;
        selectedKeys.value = [];
        dirty.value = false;
        saveState.value = "saved";
        externalChange.value = null;
        changeRevision++;
        if (options.fromDisk) {
            history.clear(key);
            historyVersion.value++;
        }
        return true;
    }

    async function selectProfile(profile: string): Promise<void> {
        if (profile === activeProfile.value) {
            return;
        }
        if (!(await leaveCurrentPage())) {
            return;
        }
        if (profile === activeProfile.value) {
            return;
        }
        // Drop the previous document before the profile changes. A watcher
        // must never see the new profile paired with the old page id.
        clearDocument();
        activeProfile.value = profile;
        await refreshPages(profile);
        if (activeProfile.value !== profile) {
            return;
        }
        if (pages.value.length > 0) {
            await loadPage(pages.value[0].id);
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
        if (id === currentPageId.value) {
            return;
        }
        if (!(await leaveCurrentPage())) {
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
        if (!(await leaveCurrentPage())) {
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

    /**
     * Apply the in-memory aftermath of a page delete the main process already
     * made: drop its history and, when it was the open page, open the lowest
     * remaining one or leave the editor blank. A page whose library copy
     * survived keeps its editor state, so the delete can be retried.
     */
    async function applyPageDeleted(profileName: string, id: string): Promise<void> {
        const isCurrent = profileName === activeProfile.value && id === currentPageId.value;
        if (isCurrent) {
            // A pending autosave would write the page back the moment it lands.
            clearAutosaveTimer();
        }

        const key = pageHistoryKey(profileName, id);
        history.clear(key);
        historyVersion.value++;
        deferredPages.delete(key);

        if (activeProfile.value !== profileName) {
            return;
        }
        await refreshPages(profileName);
        if (!isCurrent || activeProfile.value !== profileName) {
            return;
        }

        const next = pages.value[0]?.id ?? null;
        if (next !== null) {
            await loadPage(next, { fromDisk: true });
        } else {
            currentPage.value = emptyPageConfig();
            currentPageId.value = null;
            currentPageMtime.value = null;
            selectedKeys.value = [];
            dirty.value = false;
            saveState.value = "saved";
            externalChange.value = null;
            changeRevision++;
        }
    }

    function selectKey(index: string | null, extend = false): void {
        if (index === null || !isValidBoardIndex(index)) {
            selectedKeys.value = [];
            return;
        }
        if (extend) {
            if (selectedKeys.value.includes(index)) {
                selectedKeys.value = selectedKeys.value.filter((key) => key !== index);
            } else {
                selectedKeys.value = [...selectedKeys.value, index];
            }
            return;
        }
        selectedKeys.value = [index];
    }

    function isKeySelected(index: string): boolean {
        return selectedKeys.value.includes(index);
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
        if (selectedKey.value === null) {
            return;
        }
        const existing = currentPage.value.buttons[selectedKey.value];
        if ((existing?.label ?? "") === value) {
            return;
        }
        recordHistory("label");
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (value === "") {
            delete button.label;
        } else {
            button.label = value;
        }
        touch();
    }

    function setBackgroundColor(value: string): void {
        if (selectedKey.value === null) {
            return;
        }
        const existing = currentPage.value.buttons[selectedKey.value];
        if ((existing?.backgroundColor ?? "") === value) {
            return;
        }
        recordHistory("background");
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (value === "") {
            delete button.backgroundColor;
        } else {
            button.backgroundColor = value;
        }
        touch();
    }

    /** `imageName` is always stored without the `.png` extension. */
    function setImageName(value: string): void {
        if (selectedKey.value === null) {
            return;
        }
        const base = iconBaseName(value);
        const existing = currentPage.value.buttons[selectedKey.value];
        if ((existing?.imageName ?? "") === base) {
            return;
        }
        recordHistory();
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (base === "") {
            delete button.imageName;
        } else {
            button.imageName = base;
        }
        touch();
    }

    function clearButton(): void {
        if (
            selectedKey.value === null ||
            currentPage.value.buttons[selectedKey.value] === undefined
        ) {
            return;
        }
        recordHistory();
        delete currentPage.value.buttons[selectedKey.value];
        touch();
    }

    function addAction(action: string, mode: "append" | "replace"): void {
        if (selectedKey.value === null) {
            return;
        }
        recordHistory();
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        button.click = mode === "replace" ? [action] : [...button.click, action];
        touch();
    }

    function updateAction(index: number, value: string): void {
        const button = ensureSelectedButton();
        if (!button || index < 0 || index >= button.click.length) {
            return;
        }
        if (button.click[index] === value) {
            return;
        }
        recordHistory(`step:${index}`);
        const next = [...button.click];
        next[index] = value;
        button.click = next;
        touch();
    }

    function removeAction(index: number): void {
        const button = ensureSelectedButton();
        if (!button || index < 0 || index >= button.click.length) {
            return;
        }
        recordHistory();
        const next = [...button.click];
        next.splice(index, 1);
        button.click = next;
        touch();
    }

    /** Move a step to a new position; used by drag and the arrow controls. */
    function moveActionTo(from: number, to: number): void {
        const button = ensureSelectedButton();
        if (!button) {
            return;
        }
        if (
            from < 0 ||
            from >= button.click.length ||
            to < 0 ||
            to >= button.click.length ||
            from === to
        ) {
            return;
        }
        recordHistory();
        const next = [...button.click];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        button.click = next;
        touch();
    }

    /** Move a step up (`delta = -1`) or down (`delta = 1`). */
    function moveAction(index: number, delta: -1 | 1): void {
        moveActionTo(index, index + delta);
    }

    function setSelectedBackgroundColor(value: string): void {
        if (selectedKeys.value.length === 0) {
            return;
        }
        recordHistory("bulk:background");
        for (const key of selectedKeys.value) {
            const button = ensureButton(key);
            if (value === "") {
                delete button.backgroundColor;
            } else {
                button.backgroundColor = value;
            }
        }
        touch();
    }

    function setSelectedImageName(value: string): void {
        if (selectedKeys.value.length === 0) {
            return;
        }
        const base = iconBaseName(value);
        recordHistory();
        for (const key of selectedKeys.value) {
            const button = ensureButton(key);
            if (base === "") {
                delete button.imageName;
            } else {
                button.imageName = base;
            }
        }
        touch();
    }

    function clearSelectedKeys(): void {
        if (selectedKeys.value.length === 0) {
            return;
        }
        const hasContent = selectedKeys.value.some(
            (key) => currentPage.value.buttons[key] !== undefined,
        );
        if (!hasContent) {
            return;
        }
        recordHistory();
        for (const key of selectedKeys.value) {
            delete currentPage.value.buttons[key];
        }
        touch();
    }

    function undo(): void {
        const id = historyPageId();
        if (id === null) {
            return;
        }
        const previous = history.undo(id, currentPage.value);
        historyVersion.value++;
        if (previous === null) {
            return;
        }
        currentPage.value = previous;
        touch();
    }

    function redo(): void {
        const id = historyPageId();
        if (id === null) {
            return;
        }
        const next = history.redo(id, currentPage.value);
        historyVersion.value++;
        if (next === null) {
            return;
        }
        currentPage.value = next;
        touch();
    }

    /**
     * Profile CRUD wrappers (the caller owns confirmation UX). Creating one
     * opens it and returns false when the name was refused.
     */
    async function createProfile(name: string): Promise<boolean> {
        const result = await storageClient.createProfile(name);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return false;
        }
        const created = result.data.name;
        if (created !== name.trim()) {
            useAppStore().pushToast("info", `Profile name saved as "${created}"`);
        }
        retiredProfiles.delete(created);
        const hadDefault = profiles.value.some((item) => item.isDefault);
        await refreshProfiles();
        if (!hadDefault) {
            await setDefaultProfile(created);
        }
        await selectProfile(created);
        return true;
    }

    async function renameProfile(oldName: string, newName: string): Promise<void> {
        const wasDefault = profiles.value.find((item) => item.name === oldName)?.isDefault === true;
        const result = await storageClient.renameProfile(oldName, newName);
        if (!result.ok) {
            useAppStore().pushToast("error", result.error);
            return;
        }
        const renamed = result.data.name;
        if (renamed !== newName.trim()) {
            useAppStore().pushToast("info", `Profile name saved as "${renamed}"`);
        }
        history.clear();
        historyVersion.value++;
        deferredPages.clear();
        if (activeProfile.value === oldName) {
            activeProfile.value = renamed;
        }
        if (wasDefault) {
            await storageClient.setDefaultProfile(renamed);
        }
        await refreshProfiles();
    }

    /**
     * Settle a write into the profile that is about to be deleted. A pending
     * autosave or an in-flight save is flushed first, the page-delete rule, so
     * a failed delete leaves the edits on disk and a successful one removes
     * them with the profile.
     */
    async function settleProfileWrites(name: string): Promise<void> {
        if (activeProfile.value !== name) {
            return;
        }
        await flushPending();
    }

    /**
     * Apply the in-memory aftermath of a profile delete the main process
     * already made: drop the profile and its deferred pages, then leave the
     * editor blank and open the default profile (else the first remaining).
     * Only called when the library copy is gone, so a failed or partial delete
     * leaves the profile and its editor state in place.
     */
    async function applyProfileDeleted(name: string): Promise<void> {
        const wasDefault = profiles.value.find((item) => item.name === name)?.isDefault === true;
        // Re-check: the user may have switched profiles while the delete was
        // in flight, and the new profile keeps its own document.
        const activeWasDeleted = activeProfile.value === name;
        retiredProfiles.add(name);
        // Drop the profile from the listing now, so no write can target it
        // while the fresh listing is still on its way.
        profiles.value = profiles.value.filter((item) => item.name !== name);
        for (const key of [...deferredPages.keys()]) {
            if (key.startsWith(`${name}/`)) {
                deferredPages.delete(key);
            }
        }
        if (activeWasDeleted) {
            resetDocument();
            history.clear();
            historyVersion.value++;
        }

        await refreshProfiles();
        if (wasDefault) {
            // Promote the next remaining profile before choosing a fallback.
            const fallback = profiles.value[0]?.name ?? null;
            await storageClient.setDefaultProfile(fallback);
            await refreshProfiles();
        }
        if (activeWasDeleted) {
            // The default profile when there is one, else the first remaining.
            const target = defaultProfile.value ?? profiles.value[0]?.name ?? null;
            if (target !== null) {
                await selectProfile(target);
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
     * Re-list pages and show a banner when the open page changed on disk.
     * External edits never open a blocking dialog: the panel offers reload or
     * keep local.
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
            externalChange.value = { pageId: currentPageId.value, mtimeMs: meta.mtimeMs };
        }
    }

    async function reloadExternalPage(): Promise<void> {
        const change = externalChange.value;
        if (change === null) {
            return;
        }
        if (change.pageId === currentPageId.value) {
            await loadPage(change.pageId, { fromDisk: true });
        }
        externalChange.value = null;
    }

    function keepLocalPage(): void {
        const change = externalChange.value;
        externalChange.value = null;
        if (change !== null) {
            currentPageMtime.value = change.mtimeMs;
        }
        if (activeProfile.value === "" || currentPageId.value === null) {
            return;
        }
        // Keep local always means the in-memory page wins, even when it was
        // clean before the banner appeared.
        clearAutosaveTimer();
        dirty.value = true;
        changeRevision++;
        void saveNow();
    }

    return {
        profiles,
        activeProfile,
        pages,
        currentPageId,
        currentPage,
        currentPageMtime,
        selectedKeys,
        selectedKey,
        selectedCount,
        isMultiSelect,
        dirty,
        saving,
        saveState,
        externalChange,
        invalidStepCount,
        hasProfile,
        hasPage,
        selectedButton,
        defaultProfile,
        canUndo,
        canRedo,
        refreshProfiles,
        refreshPages,
        loadPage,
        selectProfile,
        initProfiles,
        selectPage,
        createPage,
        applyPageDeleted,
        selectKey,
        isKeySelected,
        setLabel,
        setBackgroundColor,
        setImageName,
        clearButton,
        setSelectedBackgroundColor,
        setSelectedImageName,
        clearSelectedKeys,
        addAction,
        updateAction,
        removeAction,
        moveAction,
        moveActionTo,
        undo,
        redo,
        flushPending,
        createProfile,
        renameProfile,
        settleProfileWrites,
        applyProfileDeleted,
        setDefaultProfile,
        importProfile,
        exportProfile,
        checkExternalChanges,
        reloadExternalPage,
        keepLocalPage,
    };
});
