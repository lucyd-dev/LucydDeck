# Firmware contract

The firmware wiki (`Home`, `USB-Protocol`, `File-Transfer-Protocol`, `Configuration-Schema`, `Storage-Structure`) is the source of truth for the wire and the SD card. Never guess a field or an opcode.

This file condenses what the host relies on. Update it when a firmware change lands.

## Transport

- The report is 64 bytes: report id `0x06` plus a 63-byte frame `[opcode][seqHi][seqLo][payload 60 max]`.
- The host sequence rises by one per frame and wraps at `0x7FFF` to `0`. The M-bit stays clear. It never restarts at 1 on a HID reconnect, because a reconnect raises no USB event. The device clears its baseline on USB start or resume and on `CMD_RESET_SEQUENCE` (`0x04`), and between clears it requires exactly `previous + 1`. The app sends the reset when it opens the deck and again before retrying a command the deck answered with `ERR_SEQUENCE`. Firmware without the command answers `ERR_UNKNOWN_COMMAND`, and the app keeps using the running counter. The device sets the M-bit except on the last frame of a stream.
- One outstanding request at a time. Reassemble a stream by the expected opcode. `0xA0` can arrive at any moment and is never acked.

## Bootloader handoff

`CMD_ENTER_BOOTLOADER` (`0x05`) asks the running firmware to restart into the ESP32-S3 ROM bootloader so the host can flash an app image. It takes no payload and needs no open file transfer. Before sending it, the host cancels any transfer the deck still holds, so no `CMD_FILE_*` frame races the handoff.

The contract is ack-then-restart, not a reply:

1. The device answers `RESP_ACK` (`0xFF`).
2. It waits about 100 ms so the ack leaves the USB stack.
3. It calls `usb_persist_restart(RESTART_BOOTLOADER)`.
4. Nothing follows the ack. The HID interface disappearing is success; a missing second response is expected and must not be treated as a timeout or a failure.

The ROM loader re-enumerates as `303A:1001` (`USB JTAG/serial debug unit`), which is also the running app's VID:PID. The host therefore records the deck's USB identity (serial number and, where the platform exposes it, the physical port path) **before** sending `0x05`, then selects the serial port that carries that identity. It never picks a port by PID alone. Under usbipd the loader can appear on a different vhci path; the serial number carries the identity across that re-enumeration, with the path as a corroborating match on native Linux.

Firmware older than this command answers `ERR_UNKNOWN_COMMAND`; the deck then stays in app mode. `protocol_version` stays 1. The first release that carries `0x05` is installed once with PlatformIO (see `docs/wsl-usb.md`); after that the app owns updates.

The app-only guarantee sits with the host. A local `.bin` carries no manifest, so the Advanced local path checks only the size bound of `0x7E0000` bytes (8064 KiB) and always writes at `0x10000`. The release updater checks the manifest's address, layout and checksum when it lands. esptool writes with `eraseAll: false`; no path writes the bootloader, partition table, NVS or SD card.

## Opcodes

Host to device:

| Opcode         | Command                        |
| -------------- | ------------------------------ |
| `0x00`         | ping                           |
| `0x01`         | device info                    |
| `0x02`         | images list                    |
| `0x03`         | profiles list                  |
| `0x04`         | reset sequence                 |
| `0x05`         | enter bootloader               |
| `0x20`-`0x22`  | profile create, rename, delete |
| `0x23`, `0x24` | page delete, icon delete       |
| `0x30`-`0x33`  | file start, chunk, end, cancel |
| `0x40`, `0x41` | set active profile and page    |

Device to host:

| Opcode | Response                                                                      |
| ------ | ----------------------------------------------------------------------------- |
| `0x80` | device info JSON (`fw_version`, `protocol_version`, `board`, `free_space_kb`) |
| `0x81` | images list                                                                   |
| `0x82` | profiles list                                                                 |
| `0xA0` | action triggered                                                              |
| `0xFE` | error, one byte                                                               |
| `0xFF` | ack                                                                           |

## Upload

- Payload is `[kind][identity]`. `0x01` is a page identity `"<profile>/<id>"`, `0x02` is an icon identity `"<name>"`. The host never names a file or an extension; the firmware appends `.json` or `.png` and rejects an identity that carries one.
- Chunks are 60 bytes, paced by the ack. The end frame carries a CRC32 in IEEE form, big-endian.
- The firmware stages `.tmp` and keeps the old file on failure. A failed or aborted upload sends `CMD_FILE_CANCEL`, so the deck does not keep the staging transfer.
- If an earlier session left a transfer open, `CMD_FILE_START` is answered with `ERR_TRANSFER_BUSY`. The app cancels and retries the start once.

## Pages and profiles

- Page JSON has a `buttons` object keyed `"0"` to `"14"`, row major. A button holds `imageName` without the extension, `backgroundColor` as `#RRGGBB`, `label`, and `click[]`. Unknown top-level keys are ignored. There is no `longPress`.
- A page name, when the app writes one, is a top-level `name` key of at most 40 characters. The firmware ignores it, so the wire format is unchanged.
- An action string is `namespace:args`, split on the first colon. Namespaces: `PAGE`, `PROFILE`, `HID_KEY`, `CONTROL_KEY`, `MOUSE_MOVE`, `MOUSE_CLICK`, `DELAY`, `TEXT`, `CMD`. The device drops invalid actions, so validate before upload.
- Page files are `<id>.json`, where the id is the leading digits, 0 to 255. Order is numeric. No rename and no reorder.
- Profiles are directories. The device builds its profile list at boot and changes it only through protocol commands.
- A new profile name, and the new half of a rename, must pass the firmware's entity-name grammar: 1 to 64 bytes of ASCII letters, digits, space, `-` and `_`, with no leading or trailing space. The host sanitizes profile input to it before storing, and rejects a name that sanitizes to nothing. Delete, activation, scanning and the profile half of a page identity keep `validateName`, so a profile from before the grammar still works.
- An uploaded icon identity must pass the same entity grammar and carry no extension. An icon already on the card may be overwritten under an older `validateName` name, because that creates no new name; a local icon with such a name that is not on the card is skipped during sync rather than failing it. Icon delete and listing keep `validateName`.

## Gaps the app must respect

- No read-file, no page rename, and no query for the active profile or page.
- Uploading the active page does not repaint it. A reload needs `CMD_SET_ACTIVE_PAGE`.
- `CMD:` events are fire and forget.
- A key that runs only local actions reports nothing to the host.

## Deletion

Both commands take one identity string with no extension and answer `RESP_ACK` on success. The firmware appends `.json` or `.png` and rejects an identity that carries an extension.

| Opcode         | Command           | Payload                      |
| -------------- | ----------------- | ---------------------------- |
| `0x23`         | `CMD_PAGE_DELETE` | `<profile>/<id>`, no `.json` |
| `0x24`         | `CMD_ICON_DELETE` | `<name>`, no `.png`          |
| Page failures: |

| Failure                           | Error                        |
| --------------------------------- | ---------------------------- |
| profile half fails `validateName` | `ERR_INVALID_PATH 0x10`      |
| profile directory missing         | `ERR_PROFILE_NOT_FOUND 0x12` |
| page half not 0 to 255            | `ERR_INVALID_PAGE_NAME 0x11` |
| page file missing                 | `ERR_FILE_NOT_FOUND 0x2A`    |
| unlink fails                      | `ERR_DELETE 0x16`            |

Icon failures: `ERR_INVALID_PATH` for a bad name, `ERR_FILE_NOT_FOUND` for a missing file, `ERR_DELETE` when the unlink fails. The image list is scanned on request, so it needs no refresh. The current page keeps the pixmap it loaded.

Deleting the displayed page repaints the first remaining page (lowest id) in the active profile, and a blank page when none remain.

## Profile rename and delete

| Opcode | Command              | Payload   |
| ------ | -------------------- | --------- |
| `0x21` | `CMD_PROFILE_RENAME` | `old:new` |
| `0x22` | `CMD_PROFILE_DELETE` | `<name>`  |

`CMD_PROFILE_RENAME` splits on the first `:`. The old name is a lookup under `validateName`; the new name creates a directory and passes the entity grammar, or the command answers `ERR_INVALID_PATH` and leaves the directory untouched. The profile keeps its pages, and an active profile follows the rename.

`CMD_PROFILE_DELETE` removes the profile directory and every page in it, so the host settles page and icon removals first. A missing profile answers `ERR_PROFILE_NOT_FOUND`; a delete failure answers `ERR_DELETE`. An active profile is reselected and the display repaints.

Both keep `validateName` on the name that already exists, so a profile from before the entity grammar still renames and deletes.

## Versioning

The project is a prototype until the 1.0.0 release. The wire changes without a `protocol_version` bump before that release, so the host never uses the version to decide which commands a deck supports. A command the firmware does not implement answers `ERR_UNKNOWN_COMMAND`.
