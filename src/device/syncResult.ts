// ---------------------------------------------------------------------------
// Human summary of one finished sync. The toast is the only place the result's
// removal and rename counts are reported, so the wording lives in one pure
// helper instead of inside the store.
// ---------------------------------------------------------------------------

import type { SyncResult } from "@shared/sync";

function countLabel(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

function joinList(items: readonly string[]): string {
    if (items.length === 0) {
        return "";
    }
    if (items.length === 1) {
        return items[0];
    }
    return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Summary for a finished sync, e.g. `Synced: removed 2 pages and 1 profile.` */
export function syncResultMessage(result: SyncResult): string {
    const removed: string[] = [];
    if (result.removedPages.length > 0) {
        removed.push(countLabel(result.removedPages.length, "page", "pages"));
    }
    if (result.removedIcons.length > 0) {
        removed.push(countLabel(result.removedIcons.length, "icon", "icons"));
    }
    if (result.removedProfiles.length > 0) {
        removed.push(countLabel(result.removedProfiles.length, "profile", "profiles"));
    }

    const parts: string[] = [];
    if (removed.length > 0) {
        parts.push(`removed ${joinList(removed)} from the deck`);
    }
    if (result.renamedProfiles.length > 0) {
        const names = result.renamedProfiles.map((rename) => `“${rename.to}”`);
        parts.push(`renamed ${joinList(names)}`);
    }
    if (parts.length === 0) {
        return "Device synced";
    }
    return `Synced: ${joinList(parts)}.`;
}
