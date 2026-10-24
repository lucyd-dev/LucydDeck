# Deletes own removal; sync removes what a delete cannot reach

Two mechanisms claimed the same job. Host issue #7 makes sync prune device-only files and profiles, while the UI workstream makes a delete remove the library copy and the deck copy together. The split now is by reach: deleting a page or icon with the deck connected removes both copies in one confirmed action, and deleting while disconnected removes the library copy and tells the user the deck copy stays for the next sync. Sync still removes what a delete never saw: device-only files left by an offline delete, files that never had a library copy, and deck profiles with no library counterpart. It keeps #7's safety rules, so this destructive work runs only in an explicit sync, it fails closed, and it never prunes profiles from an empty library.

## Consequences

- The sync-side page and icon removals are implemented in this workstream, since the header counts them. Issue #7 narrows to deck profiles with no library counterpart, and to sending a profile rename as `CMD_PROFILE_RENAME` so the prune cannot delete a renamed profile. Its acceptance case for a connected delete now happens at the delete, not at the next sync.
- The Sync button counts removals separately from changes ("Sync 4 changes, remove 2"), and the "In sync" idle label only holds when the plan has neither.
- A sync that only removes runs from a primary button labelled with the count, with no second dialog: the label states the removal, Review lists the files, and the click is the confirmation.
- The delete confirmation is the only place that promises what happens to the deck copy while the deck is disconnected.
- Issue #7 is not edited. Its Why still describes the manual two-step this ADR replaces, so this ADR is the current split; the issue's scope and safety rules stand.
