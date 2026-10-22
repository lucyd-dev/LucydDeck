// Display helpers for page ids. Page ids stay 0..255 on disk and on the wire;
// the app shows them one-based so "Page 1" is the first page in every view.

/** Human label for a page id, e.g. `"0"` -> `"Page 1"`. */
export function pageLabel(id: string | number): string {
    const numeric = Number(id);
    return Number.isFinite(numeric) ? `Page ${numeric + 1}` : `Page ${String(id)}`;
}
