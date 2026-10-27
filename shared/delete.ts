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

/** What happened to the deck side of a delete. */
export type DeckSideStatus = DeckDeleteStatus | "skipped" | "failed";

/** What happened to the library side of a delete; `missing` is deck-side only. */
export type LibrarySideStatus = "deleted" | "skipped" | "failed";

/** Which copy of the item still exists. */
export type DeleteRemaining = "none" | "deck" | "library" | "both";

/** The deck copy's outcome; `error` only accompanies `failed`. */
export interface DeckDeleteSide {
    status: DeckSideStatus;
    error?: string;
}

/** The library copy's outcome; `error` only accompanies `failed`. */
export interface LibraryDeleteSide {
    status: LibrarySideStatus;
    error?: string;
}

export interface DeleteResult {
    deck: DeckDeleteSide;
    library: LibraryDeleteSide;
    remaining: DeleteRemaining;
}

/**
 * Which copy remains after a delete. A deck delete that never ran (`skipped`,
 * the offline path) and a failed one both leave the deck copy behind; a library
 * delete only removes it when the file is really gone. `missing` counts as
 * gone: the postcondition of a delete is that the copy is absent.
 */
export function deleteRemaining(deck: DeckSideStatus, library: LibrarySideStatus): DeleteRemaining {
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
export function deleteResult(deck: DeckDeleteSide, library: LibraryDeleteSide): DeleteResult {
    return { deck, library, remaining: deleteRemaining(deck.status, library.status) };
}
