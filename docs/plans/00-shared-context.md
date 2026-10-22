# LucydDeck host: shared context

Referenced by every step plan. The firmware wiki (`Home`, `USB-Protocol`, `File-Transfer-Protocol`, `Configuration-Schema`, `Storage-Structure`) is the source of truth for the wire and the SD card. Never guess a field or an opcode.

## Status

| Work                                                         | State                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| CI, storage shell, HID engine, file transfer, image pipeline | shipped in `main`                                             |
| 3x5 configurator, action inspector, delta sync               | committed on `feature/ui-rebuild`, one commit ahead of `main` |
| Step 1: UI foundation, device view, settings                 | implemented on `feature/ui-rebuild`, awaiting review          |
| Steps 2 to 4 below                                           | to do                                                         |

Steps 1 and 2 run on `feature/ui-rebuild`, which is already checked out. Merge it into `main` when the UI work is done.

## Environment

- Development and agent work: `~/Code/LucydDeck` in WSL.
- Windows build check: `/mnt/c/Users/steve/Documents/Code/LucydDeckProject/LucydDeck`,
  a separate clone. Sync it with git before building. Do not develop features there.


## Code map

- `shared/`: wire, schema, action grammar, sync planner, IPC contract. Unit tested.
- `electron/main/services/`: `StorageService`, `UsbService`, `FileTransfer`, `DeviceService`, `ImagePipelineService`, `SyncService`.
- `electron/main/ipc/register.ts`: every channel. `electron/preload.ts` exposes `window.lucyd`.
- `src/`: Vue 3 renderer, Pinia stores, one route, `AppShell`, board, inspector, settings dialog.
- The renderer never imports node-hid, sharp or electron.

## Firmware contract (condensed)

- Report is 64 bytes: report id `0x06` plus a 63-byte frame `[opcode][seqHi][seqLo][payload 60 max]`.
- Host sequence rises by one per frame, wraps at `0x7FFF` to `0`, M-bit clear, and never restarts at 1 on a HID reconnect, which raises no USB event. The device clears its baseline on USB start/resume and on `CMD_RESET_SEQUENCE` (`0x04`), and between clears it requires exactly `previous + 1`. The app sends the reset when it opens the deck and again before retrying a command the deck answered with `ERR_SEQUENCE`. Firmware without the command answers `ERR_UNKNOWN_COMMAND` and the app keeps using the running counter. The device sets the M-bit except on the last frame of a stream.
- Host opcodes: `0x00` ping, `0x01` device info, `0x02` images list, `0x03` profiles list, `0x04` reset sequence, `0x20` to `0x22` profile create, rename, delete, `0x30` to `0x33` file start, chunk, end, cancel, `0x40` and `0x41` set active profile and page.
- Device opcodes: `0x80` device info JSON (`fw_version`, `protocol_version`, `board`, `free_space_kb`), `0x81` images list, `0x82` profiles list, `0xA0` action triggered, `0xFE` error with one byte, `0xFF` ack.
- One outstanding request at a time. Reassemble a stream by the expected opcode. `0xA0` can arrive at any moment and is never acked.
- Upload: `[pathType][path]`, `0x01` page `"<profile>/<id>.json"`, `0x02` icon `"<name>.png"`, chunks of 60 bytes paced by the ack, end carries a CRC32 in IEEE form, big-endian. The firmware stages `.tmp` and keeps the old file on failure.
- Page JSON: `buttons` object keyed `"0".."14"`, row major. A button holds `imageName` without extension, `backgroundColor` as `#RRGGBB`, `label`, `click[]`. Unknown top-level keys are ignored. There is no `longPress`.
- Action string is `namespace:args`, split on the first colon. Namespaces: `PAGE`, `PROFILE`, `HID_KEY`, `CONTROL_KEY`, `MOUSE_MOVE`, `MOUSE_CLICK`, `DELAY`, `TEXT`, `CMD`. The device drops invalid actions, so validate before upload.
- Page files are `<id>.json`, id is the leading digits, 0 to 255. Order is numeric. No rename, no reorder.
- Profiles are directories. The device builds its profile list at boot and changes it only through protocol commands.

## Firmware gaps the app must respect

- No delete-file, no read-file, no page rename, no query for the active profile or page.
- Uploading the active page does not repaint it. A reload needs `CMD_SET_ACTIVE_PAGE`.
- `CMD:` events are fire and forget.
- A button that runs only local actions reports nothing to the host.

## Firmware dependency: delete a file

Reminder for a firmware session. It needs an opcode, the same path rules as upload, an error for a missing file, a page-list refresh after a page delete, and a rule for deleting the active page.

- `CMD_FILE_DELETE = 0x34`, payload `[pathType][path]`, same grammar and validation as `CMD_FILE_START`. Page path `"<profile>/<id>.json"`, icon path `"<name>.png"`.
- Reuse `ERR_INVALID_PATH 0x10`, `ERR_INVALID_PAGE_NAME 0x11`, `ERR_PROFILE_NOT_FOUND 0x12`. Add `ERR_FILE_NOT_FOUND 0x2A`.
- Answer `RESP_ACK`.
- `protocol_version` becomes 2. The host treats deletion as a capability and keeps today's warning on protocol 1.

## Decisions settled on 2026-10-22

UI:

- Workflow first, then structure, paint last.
- Deck-first editor with one sidebar: view switch at the top, then the profile picker and page thumbnails in the Deck view. Inspector on the right.
- Typed action steps in the renderer, serialized to firmware strings on save. Wire schema unchanged.
- Autosave with undo and redo. No Save button, no dirty prompts.
- Page name stored as a top-level `name` in the page JSON. Pages stay numeric and cannot be reordered. Delete removes the local file and warns when the device copy stays.
- Device view shows inventory and a review of the changes to push, not a blind sync button.
- Settings view holds appearance, data folder, logs and about. Themes: system, dark, light. Tray and autostart are out.
- No long press anywhere.

Plugins:

- A plugin is a host-side command handler reached through `CMD:<handle>:<command>[:args]`.
- Worker thread with full Node. No permission field, because it could not be enforced. Install screen carries a plain warning.
- Install from a zip file or a developer folder. No git install, no marketplace.
- Plugins can publish state. The app shows it. Deck rendering of state stays unimplemented.

Updater:

- Version check and guided flash only. No tray, no autostart.

## House rules

1. Steps 1 and 2 share `feature/ui-rebuild`. Steps 3 and 4 get their own branch off `main` once the UI work merges.
2. Conventional Commits on every commit.
3. Remote gate: no push, pull request or GitHub mutation without explicit user confirmation.
4. Before a large commit, ask for a review of the working tree.
5. `npm run lint && npm run typecheck && npm run test && npm run build` green before a pull request. Vitest covers every pure module and service.
6. Spec questions go to the wiki, not to memory.
7. Vocabulary lives in `GLOSSARY.md`.
