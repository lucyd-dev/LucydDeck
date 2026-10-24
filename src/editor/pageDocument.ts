// ---------------------------------------------------------------------------
// Undo history for the board editor.
//
// The editor keeps one document per open page. History is snapshotted by page
// id, so switching pages and coming back keeps that page's undo trail. Typing
// on one field coalesces into one entry; a bulk edit records once. The store
// clears a page's history when the file is reloaded from disk.
// ---------------------------------------------------------------------------

import type { PageConfig } from "@shared/types";

/** Maximum undo entries kept per page. */
export const HISTORY_LIMIT = 100;

/** Consecutive edits to the same field within this window share one entry. */
export const COALESCE_WINDOW_MS = 900;

export interface RecordHistoryOptions {
    /** Field identity; consecutive edits with the same key coalesce. */
    coalesce?: string;
    /** Injectable clock for tests. */
    now?: number;
}

interface PageHistory {
    past: PageConfig[];
    future: PageConfig[];
    coalesceKey: string | null;
    coalescedAt: number;
}

/** Deep-copy a page config. JSON works on Vue reactive proxies and the data is plain JSON. */
export function clonePageConfig(page: PageConfig): PageConfig {
    return JSON.parse(JSON.stringify(page)) as PageConfig;
}

function emptyHistory(): PageHistory {
    return { past: [], future: [], coalesceKey: null, coalescedAt: 0 };
}

export class PageDocumentHistory {
    private readonly pages = new Map<string, PageHistory>();

    private state(pageId: string): PageHistory {
        const existing = this.pages.get(pageId);
        if (existing !== undefined) {
            return existing;
        }
        const created = emptyHistory();
        this.pages.set(pageId, created);
        return created;
    }

    private resetCoalescing(state: PageHistory): void {
        state.coalesceKey = null;
        state.coalescedAt = 0;
    }

    /**
     * Record the state *before* a change. Coalesced calls for the same field
     * inside `COALESCE_WINDOW_MS` keep the original snapshot, so one undo
     * removes the whole burst of typing.
     */
    record(pageId: string, before: PageConfig, options: RecordHistoryOptions = {}): void {
        const state = this.state(pageId);
        const now = options.now ?? Date.now();
        const coalesce = options.coalesce;
        const coalesced =
            coalesce !== undefined &&
            state.coalesceKey === coalesce &&
            now - state.coalescedAt <= COALESCE_WINDOW_MS;

        if (!coalesced) {
            state.past.push(clonePageConfig(before));
            if (state.past.length > HISTORY_LIMIT) {
                state.past.splice(0, state.past.length - HISTORY_LIMIT);
            }
        }

        state.future = [];
        state.coalesceKey = coalesce ?? null;
        state.coalescedAt = now;
    }

    /** Restore the previous snapshot, returning it or `null` when empty. */
    undo(pageId: string, current: PageConfig): PageConfig | null {
        const state = this.state(pageId);
        const previous = state.past.pop();
        if (previous === undefined) {
            return null;
        }
        state.future.push(clonePageConfig(current));
        this.resetCoalescing(state);
        return clonePageConfig(previous);
    }

    /** Restore the snapshot removed by the last undo. */
    redo(pageId: string, current: PageConfig): PageConfig | null {
        const state = this.state(pageId);
        const next = state.future.pop();
        if (next === undefined) {
            return null;
        }
        state.past.push(clonePageConfig(current));
        if (state.past.length > HISTORY_LIMIT) {
            state.past.splice(0, state.past.length - HISTORY_LIMIT);
        }
        this.resetCoalescing(state);
        return clonePageConfig(next);
    }

    canUndo(pageId: string): boolean {
        return (this.pages.get(pageId)?.past.length ?? 0) > 0;
    }

    canRedo(pageId: string): boolean {
        return (this.pages.get(pageId)?.future.length ?? 0) > 0;
    }

    /** Clear one page's history, or every page when `pageId` is omitted. */
    clear(pageId?: string): void {
        if (pageId === undefined) {
            this.pages.clear();
            return;
        }
        this.pages.delete(pageId);
    }
}
