// ---------------------------------------------------------------------------
// The result of one two-sided delete.
//
// A delete touches the deck copy first and the library copy second, and either
// side can stay behind. The result says what happened to each side and, from
// that, which copy remains: the renderer repeats the remaining copy to the user
// and never coordinates the two sides itself.
// ---------------------------------------------------------------------------

/** What a deck delete can report: the file is gone, or it was already gone. */
export type DeckDeleteStatus = "deleted" | "missing";

/** What happened to one side of a delete. */
export type DeleteStatus = DeckDeleteStatus | "skipped" | "failed";

/** Which copy of the item still exists. */
export type DeleteRemaining = "none" | "deck" | "library" | "both";

/** One side's outcome; `error` only accompanies `failed`. */
export interface DeleteSide {
    status: DeleteStatus;
    error?: string;
}

export interface DeleteResult {
    deck: DeleteSide;
    library: DeleteSide;
    remaining: DeleteRemaining;
}

/**
 * Which copy remains after a delete. A deck delete that never ran (`skipped`,
 * the offline path) and a failed one both leave the deck copy behind; a library
 * delete only removes it when the file is really gone. `missing` counts as
 * gone: the postcondition of a delete is that the copy is absent.
 */
export function deleteRemaining(deck: DeleteStatus, library: DeleteStatus): DeleteRemaining {
    const deckGone = deck === "deleted" || deck === "missing";
    const libraryGone = library === "deleted";
    if (deckGone && libraryGone) {
        return "none";
    }
    if (deckGone) {
        return "library";
    }
    if (libraryGone) {
        return "deck";
    }
    return "both";
}

/** Pair the two sides with the remaining copy derived from them. */
export function deleteResult(deck: DeleteSide, library: DeleteSide): DeleteResult {
    return { deck, library, remaining: deleteRemaining(deck.status, library.status) };
}
