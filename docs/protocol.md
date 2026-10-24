# Firmware contract

The firmware wiki (`Home`, `USB-Protocol`, `File-Transfer-Protocol`, `Configuration-Schema`, `Storage-Structure`) is the source of truth for the wire and the SD card. Never guess a field or an opcode.

This file condenses what the host relies on. Update it when a firmware change lands.

## Transport

- The report is 64 bytes: report id `0x06` plus a 63-byte frame `[opcode][seqHi][seqLo][payload 60 max]`.
- The host sequence rises by one per frame and wraps at `0x7FFF` to `0`. The M-bit stays clear. It never restarts at 1 on a HID reconnect, because a reconnect raises no USB event. The device clears its baseline on USB start or resume and on `CMD_RESET_SEQUENCE` (`0x04`), and between clears it requires exactly `previous + 1`. The app sends the reset when it opens the deck and again before retrying a command the deck answered with `ERR_SEQUENCE`. Firmware without the command answers `ERR_UNKNOWN_COMMAND`, and the app keeps using the running counter. The device sets the M-bit except on the last frame of a stream.
- One outstanding request at a time. Reassemble a stream by the expected opcode. `0xA0` can arrive at any moment and is never acked.

## Opcodes

Host to device:

| Opcode         | Command                        |
| -------------- | ------------------------------ |
| `0x00`         | ping                           |
| `0x01`         | device info                    |
| `0x02`         | images list                    |
| `0x03`         | profiles list                  |
| `0x04`         | reset sequence                 |
| `0x20`-`0x22`  | profile create, rename, delete |
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

- Payload is `[pathType][path]`. `0x01` is a page at `"<profile>/<id>.json"`, `0x02` is an icon at `"<name>.png"`.
- Chunks are 60 bytes, paced by the ack. The end frame carries a CRC32 in IEEE form, big-endian.
- The firmware stages `.tmp` and keeps the old file on failure. A failed or aborted upload sends `CMD_FILE_CANCEL`, so the deck does not keep the staging transfer.
- If an earlier session left a transfer open, `CMD_FILE_START` is answered with `ERR_TRANSFER_BUSY`. The app cancels and retries the start once.

## Pages and profiles

- Page JSON has a `buttons` object keyed `"0"` to `"14"`, row major. A button holds `imageName` without the extension, `backgroundColor` as `#RRGGBB`, `label`, and `click[]`. Unknown top-level keys are ignored. There is no `longPress`.
- A page name, when the app writes one, is a top-level `name` key of at most 40 characters. The firmware ignores it, so the wire format is unchanged.
- An action string is `namespace:args`, split on the first colon. Namespaces: `PAGE`, `PROFILE`, `HID_KEY`, `CONTROL_KEY`, `MOUSE_MOVE`, `MOUSE_CLICK`, `DELAY`, `TEXT`, `CMD`. The device drops invalid actions, so validate before upload.
- Page files are `<id>.json`, where the id is the leading digits, 0 to 255. Order is numeric. No rename and no reorder.
- Profiles are directories. The device builds its profile list at boot and changes it only through protocol commands.

## Gaps the app must respect

- No read-file, no page rename, and no query for the active profile or page.
- Uploading the active page does not repaint it. A reload needs `CMD_SET_ACTIVE_PAGE`.
- `CMD:` events are fire and forget.
- A key that runs only local actions reports nothing to the host.

## Deletion

The firmware has no delete opcode yet. The app treats deletion as a capability: it enables cleanup only when `protocol_version` is 2 or higher, and keeps the current warning on protocol 1.

The firmware change is tracked in [LucydDeck-firmware#9](https://github.com/lucyd-dev/LucydDeck-firmware/issues/9):

- `CMD_FILE_DELETE = 0x34`, payload `[pathType][path]`, same grammar and validation as `CMD_FILE_START`.
- Page path `"<profile>/<id>.json"`, icon path `"<name>.png"`.
- Reuse `ERR_INVALID_PATH 0x10`, `ERR_INVALID_PAGE_NAME 0x11`, `ERR_PROFILE_NOT_FOUND 0x12`, and add `ERR_FILE_NOT_FOUND 0x2A`.
- Answer `RESP_ACK`.
- `protocol_version` becomes 2.

When it lands, the host work is in `shared/protocol.ts`, `DeviceService.deleteFile`, the `usb:deleteFile` channel, the capability record, and the Device view cleanup action.
