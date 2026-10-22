# Step 1: UI foundation, device view, settings

Branch: `feature/ui-rebuild`, already checked out. No new branch for this step. Read `00-shared-context.md` first.

## Scope

Replace the presentation layer and the navigation. Deliver design tokens, UI primitives, the one-sidebar shell with four views, the device view with a sync review, the settings view, themes, and host support for file deletion behind a capability check. The board keeps working through the existing inspector until step 2 rebuilds it. Not this step: board interactions, inspector rebuild, autosave (step 2), plugins (step 3), updater (step 4).

## Layout contract

- Sidebar 240px: four icon buttons for the views at the top, a contextual body, the device chip in the footer.
- Inspector 340px, only in the Deck view.
- Board column takes the rest, at least 560px at the 1024px window minimum, about 700px at 1280.
- Deck view body: profile picker, page thumbnails with names, new page. Plugins, Device and Settings put their own list or sections there.

## Deliverables

1. Tokens as CSS custom properties: colour, spacing, radii, typography, elevation. Themes `system`, `dark`, `light`, accent presets. `data-theme` on the root element, values persisted through IPC. Delete the hard-coded palette from `_variables.scss` and every file that repeats a hex value.
2. Primitives in `src/components/ui/`: Button, IconButton, Input, Textarea, Select, Switch, Field, Tabs, Menu, Dialog with focus trap and Escape, ConfirmDialog, Toast, EmptyState, Tooltip, ScrollArea. All dialogs use these. `window.confirm` disappears.
3. Settings IPC: `settings:get` and `settings:set` for theme, accent and window preferences, stored in `settings.json` beside `defaultProfile`, validated in main. Theme is applied before first paint.
4. Shell rewrite: `AppShell` with the sidebar, content router, inspector slot and toast host. Routes `/` Deck, `/plugins` Plugins, `/device` Device, `/settings` Settings. Topbar is removed, Sync and Save move to their proper homes.
5. Device view:
    - Info card: firmware version, protocol version, board, free space, connect and disconnect.
    - Inventory of device profiles, pages and icons against local files, each row marked in sync, local only or device only, with the CRC32 hash shown.
    - Review panel: every planned upload grouped by kind, a push button, progress, and a summary of what stays untouched.
    - Cleanup: delete a device-only page or icon when the capability exists, with a confirm dialog, otherwise the same explanation as today.
6. Settings view: appearance (theme, accent), data (reveal the data folder, open the logs folder), about (version, repository, licenses).
7. File deletion as a capability:
    - `shared/protocol.ts`: `CMD_FILE_DELETE = 0x34`, `ERR_FILE_NOT_FOUND = 0x2A`, `PROTOCOL_VERSION_WITH_DELETE = 2`.
    - `DeviceService.deleteFile`, `deletePage(profile, id)`, `deleteIcon(name)`.
    - `usb:capabilities` returns `{ deleteFile: boolean }` from the device info.
    - Tests: payload encoding, error mapping, capability gate on version 1 and 2.
8. Packaging: real `public/icon.ico` and `public/icon.png`, matching productName, window title and about version.
9. The current `BoardEditorView`, `BoardCanvas`, `KeyButton` and `InspectorPanel` mount unchanged inside the new Deck view.

## Data flow

View change is client-side routing. Settings go through `settings:*`. Device view reads `usb:deviceInfo`, `usb:listProfiles`, `usb:listImages`, `icons:*` and the sync planner, then pushes through `sync:execute`. Deletion calls `usb:deleteFile` only when the capability allows it.

## Edge cases

- Device disconnects while the Device view is open: keep the last inventory, mark it stale, disable push and cleanup.
- Protocol 1 device: the cleanup action is disabled with the real reason, not hidden.
- Theme switch while a dialog is open: no remount, no lost focus.
- Empty inventory and empty profile both get their own empty state.
- Narrow window: the sidebar stays, the inspector collapses below 1100px.

## Validation

1. Layouts at 1024, 1280 and 1440 in both themes.
2. Keyboard-only pass: tab order, Escape, focus trap, focus return after a dialog closes.
3. Device view against the fake transport: diff classes, review list, push progress, deletion gated on protocol 1 and enabled on 2.
4. Settings survive a restart and the theme paints before the first frame.
5. `npm run lint && npm run typecheck && npm run test && npm run build` green; CI green.

## Out of scope

Board editing and the inspector rebuild (step 2), plugins (step 3), updater (step 4), tray and autostart.
