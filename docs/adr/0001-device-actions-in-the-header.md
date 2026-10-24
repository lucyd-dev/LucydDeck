# Device actions live in the Device header

Device actions were spread across the Device header and two controls in the Device sidebar, and sync was reachable only inside Review. The header now holds every device action (connect, refresh, sync) in all three sections, and the sidebar is navigation plus its counts. The single sync control reads "Sync 3 changes" when there is work, a disabled "In sync" when the plan is empty, the blocking reason when the deck is offline or stale, and the progress bar while a sync runs. Review keeps the plan counts, the missing-icon warning and the deletion note, and no longer has its own button. The store exposes a single `syncNow()` action and one computed state, so a later autosync adds a trigger and calls the same action rather than a second code path.

## Consequences

- Sync progress renders in the header in every section, and the Review detail keeps its own progress row.
- The inventory re-reads after a sync and after a delete. A delete removes the library copy and the deck copy in one action (ADR 0005), so it no longer leaves a device-only file; Files shows only files a delete never reached, such as one deleted while the deck was offline.
- Recomputing the plan after a local autosave belongs to the autosync workstream. Until then the plan is rebuilt on Device mount, on connect, after a sync and after a delete.
