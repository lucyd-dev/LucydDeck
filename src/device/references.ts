// ---------------------------------------------------------------------------
// Copy for the delete dialogs.
//
// A delete names up to three pages that still reference the target and totals
// the rest. A failed scan shows no sentence; a partial scan says the list may
// be incomplete. Neither ever blocks the delete.
// ---------------------------------------------------------------------------

import { pageLabel } from "@shared/pages";
import type { ReferenceHit, ReferenceKind, ReferenceQuery, ReferenceScanResult } from "@shared/ipc";
import type { DeleteResult } from "@shared/delete";

export const PARTIAL_SCAN_NOTE = "Some pages could not be read, so this list may be incomplete.";

/** One toast that says what the delete did to each copy. */
export interface DeleteOutcome {
    level: "success" | "warning" | "error";
    message: string;
}

/** The sentence shape differs only in what happens to the deck copy. */
export function deleteConfirmation(noun: string, connected: boolean): string {
    if (connected) {
        return `${noun} is deleted from the library and from the deck. This cannot be undone.`;
    }
    return `${noun} is deleted from the library. The deck is disconnected, so its copy stays, and the next sync removes it.`;
}

/**
 * A profile delete also takes every page in the profile directory. The copy
 * names that, so the confirmation says what the removal deletes.
 */
export function profileDeleteConfirmation(name: string, connected: boolean): string {
    if (connected) {
        return `Profile “${name}” and all its pages are deleted from the library and from the deck. This cannot be undone.`;
    }
    return `Profile “${name}” and all its pages are deleted from the library. The deck is disconnected, so its copy stays, and the next sync removes it.`;
}

/**
 * Report a delete result. Success and the offline deck copy are informative;
 * a library copy that stayed is a partial delete; a deck failure left both
 * copies in place. On failure the item stays visible so a retry is just the
 * same action again.
 */
export function deleteOutcome(noun: string, result: DeleteResult): DeleteOutcome {
    if (result.remaining === "none") {
        return { level: "success", message: `Deleted ${noun}` };
    }
    if (result.deck.status === "failed") {
        return {
            level: "error",
            message: `Could not delete ${noun} from the deck: ${
                result.deck.error ?? "unknown error"
            }. Nothing was deleted.`,
        };
    }
    if (result.library.status !== "deleted") {
        // A deck that was skipped (offline) was never touched, so nothing went.
        if (result.deck.status === "skipped") {
            return {
                level: "error",
                message: `Could not delete ${noun} from the library: ${
                    result.library.error ?? "unknown error"
                }. Nothing was deleted.`,
            };
        }
        return {
            level: "warning",
            message: `Deleted ${noun} from the deck, but the library copy could not be deleted. It is still in the library.`,
        };
    }
    return {
        level: "warning",
        message: `Deleted ${noun} from the library. The deck copy stays, and the next sync removes it.`,
    };
}

export function referenceNotes(
    query: ReferenceQuery,
    scan: ReferenceScanResult | null,
    activeProfile: string,
): string[] {
    if (scan === null) {
        return [];
    }
    const notes: string[] = [];
    const sentence = referenceSentence(query.kind, scan.hits, activeProfile);
    if (sentence !== null) {
        notes.push(sentence);
    }
    if (scan.partial) {
        notes.push(PARTIAL_SCAN_NOTE);
    }
    return notes;
}

function verbFor(kind: ReferenceKind, count: number): string {
    const singular = count === 1;
    switch (kind) {
        case "icon":
            return singular ? "uses this icon" : "use this icon";
        case "page":
            return singular ? "steps to this page" : "step to this page";
        case "plugin":
            return singular ? "runs this plugin's commands" : "run this plugin's commands";
        default:
            return singular ? "switches to this profile" : "switch to this profile";
    }
}

function locationLabel(kind: ReferenceKind, hit: ReferenceHit, activeProfile: string): string {
    const page = pageLabel(hit.pageId);
    // A page reference inside the active profile needs no profile prefix; every
    // other reference names its profile so the location is unambiguous.
    return kind === "page" && hit.profile === activeProfile ? page : `${hit.profile} / ${page}`;
}

/**
 * `2 pages still use this icon: Main / Page 1, work / Page 3.` Names at most
 * three locations and totals the rest; `null` when nothing references the
 * target.
 */
export function referenceSentence(
    kind: ReferenceKind,
    hits: readonly ReferenceHit[],
    activeProfile: string,
): string | null {
    if (hits.length === 0) {
        return null;
    }
    const locations = hits.slice(0, 3).map((hit) => locationLabel(kind, hit, activeProfile));
    const extra = hits.length > 3 ? ` and ${hits.length - 3} more` : "";
    return `${hits.length} ${hits.length === 1 ? "page" : "pages"} still ${verbFor(
        kind,
        hits.length,
    )}: ${locations.join(", ")}${extra}.`;
}
