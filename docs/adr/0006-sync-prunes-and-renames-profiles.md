# A sync prunes deck profiles and renames them in place

The library is the source of truth for profiles, pages and icons, but the only removals `executePlan` performed were pages and icons. A deck profile with no library counterpart stayed forever, and a local rename looked like a new profile plus an orphan: create the new name, upload every page again, and leave the old profile on the deck. A sync now plans `profilesToDelete` for deck profiles with no local counterpart, sends `CMD_PROFILE_DELETE` for each after its pages and icons are settled, and sends a detected rename as `CMD_PROFILE_RENAME` so the deck keeps the profile and its pages.

Rename detection is strict and never guesses. It applies only when exactly one deck-only profile and exactly one library-only profile exist, every page of the deck profile exists in the library profile with the same CRC-32 (or the page sets match exactly), and no other profile on either side corresponds as well. Otherwise the plan falls back to create plus remove, which reaches the same end state with more traffic. Swaps, duplicate page content and a deck profile with no pages to compare are fallbacks, and the reason is logged and carried in `plan.profileRenameFallback` so Review can say so.

The remaining safety rules are the reason this is not a general "mirror" mode. A plan never prunes profiles while the local profile list is empty, because that state is far more likely to be an unmounted or broken data directory than a user asking to wipe the deck. An unreadable profile directory or an invalid local page aborts the whole reconcile, not just the prune. Deck profiles are matched with the looser delete name rule, so a profile from before the entity grammar is pruned like any other. Removals only run in a sync the user started: `executePlan` skips them unless the caller passes `allowRemovals`, and only the Sync action does.

A sync that plans a profile removal asks once before it starts, because deleting a profile takes every page inside it. Page and icon removals keep ADR-0004's no-second-dialog rule: the button count and the Review list are the confirmation. This narrows ADR-0004 rather than contradicting its split: deletes still own the removal they can reach, sync removes what a delete never saw.

## Considered options

- Send a rename as create plus prune with the pages uploaded to the new name. It loses the deck profile's pages if anything fails between create and delete, and it retransfers every page on every rename.
- Treat any deck-only/library-only pair as a rename. With duplicate or swapped page content it renames the wrong profile, which is worse than the extra traffic of create plus remove.
- Prune profiles from any plan including autosync. A background pass after a local save must not be able to empty the deck.

## Consequences

- The Review plan carries `profileRenames` and `profilesToDelete`; a rename counts as a pending change, a removal counts in the button's `remove N`.
- A profile removal takes its pages with it, so `pagesToDelete` skips a profile that is itself being removed.
- The result reports `renamedProfiles` and `removedProfiles`, and the sync toast names the counts.
- The fallback is visible in Review, not only in the log.
