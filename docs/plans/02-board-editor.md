# Step 2: Board editor

Branch: `feature/ui-rebuild`, same branch as step 1. Read `00-shared-context.md` first.

## Scope

Make editing fast. Typed action steps, an inspector that needs no hunting, drag and drop, multi-select, autosave with undo, page names and page management. The wire format is unchanged except for one ignored key.

## Deliverables

1. Schema: `PageConfig.name?: string`. `validatePageConfig` and `serializePageConfig` keep a trimmed name of at most 40 characters, and still drop everything else unknown. The firmware ignores it, so pages stay valid. Tests: round-trip, export and import, oversized name, page without a name.
2. `src/editor/actionSteps.ts`: `ActionStep { namespace, args, raw }`, `parseStep`, `formatStep`, `describeStep`, built on `shared/actions.ts`. A malformed saved string becomes a read-only invalid step instead of being deleted on load. Tests: every namespace round-trips, malformed input keeps its raw text, descriptions stay short.
3. `src/editor/pageDocument.ts`: the edit document and its undo history. Snapshots per page, 100 entries, typing coalesced, history survives a page switch, cleared on external reload, one entry for a multi-key apply.
4. Board:
    - Device-accurate proportions: three rows of five, 140px cells on an 800x480 panel.
    - Each key shows icon, label, background, and an action count. Selected and multi-selected states are distinct. Empty slots invite a drop.
    - Keyboard: arrows move selection, Enter focuses the inspector, Delete clears, Ctrl/Cmd+C and V, Ctrl/Cmd+Z and Shift+Z.
    - Drag an icon from the gallery onto a key. Drag a key onto another key to swap them. Drag a step handle to reorder.
    - Right-click a key for duplicate, clear, copy and paste. Shift-click extends the selection.
5. Inspector, one scroll with three parts:
    - Key: label, background colour, icon with gallery and import.
    - Sequence: ordered steps, add through a searchable picker grouped Deck, Keyboard, Mouse, Text, Plugin. Inline argument editing, drag reorder, duplicate, delete, and a visible reason for an invalid step.
    - Advanced: raw JSON, read only, with a copy button.
    - Multi-select replaces the Key and Sequence parts with bulk actions for appearance and sequence, labelled with the number of keys.
6. Autosave: 400ms after the last change, written through `storage:savePage`. Failure raises a toast and keeps the document dirty in memory. No Save button and no unload prompt. External edits show a banner offering reload or keep local, never a blocking dialog. A page switch flushes a pending write first.
7. Pages in the sidebar: live thumbnails rendered from page config, inline name editing, create takes the next free id, delete removes the local file and the device file when the capability exists, otherwise it states that the device copy remains until the profile is deleted. No reorder, and the UI says why.
8. Profiles keep create, rename, delete, export, import and default.

## Data flow

Editor document, then store, then a 400ms debounce, then `storage:savePage`, then disk. Sync reads the canonical files, so the wire and the sync planner need no change.

## Edge cases

- Autosave must not swallow an undo. An undo after a save schedules its own save.
- Invalid steps block saving that page with a clear reason, and stay editable.
- Deleting the last page leaves an empty profile with an empty state and a create action.
- A pending write on quit: flush synchronously on `before-quit` where possible, otherwise warn once.
- Icon removed from the library while a key references it: the key shows the existing missing-icon warning.

## Validation

1. Editing round trip: drop an icon, type a label, add a step of every namespace, reorder, undo and redo, switch page, come back, restart, everything intact.
2. Autosave writes once per burst, verified by mtime or a spied IPC call.
3. Page delete on protocol 1 and on protocol 2.
4. Keyboard-only pass and both themes.
5. Tests for `actionSteps`, undo history and the name field.
6. `npm run lint && npm run typecheck && npm run test && npm run build` green; CI green.

## Out of scope

Plugins (step 3), updater (step 4), page reordering, drag and drop between profiles.
