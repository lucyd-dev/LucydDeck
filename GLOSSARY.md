# LucydDeck

The desktop app that configures a LucydDeck device and runs the host side of its buttons.

## Language

**Deck**:
The physical 15-key device with its touchscreen.
_Avoid_: Board, pad, macro pad

**Profile**:
A named set of pages on the device. Exactly one profile is active at a time.
_Avoid_: Layout, preset

**Page**:
One screen of 15 keys inside a profile, identified by a number from 0 to 255.
_Avoid_: Screen, view, sheet

**Page label**:
The one-based name a page is shown under in the app, so the page with id 0 reads "Page 1".
_Avoid_: Page number, page id

**Entity name**:
A name that creates a profile directory or an icon file: 1 to 64 bytes of ASCII letters, digits, space, `-` and `_`, with no leading or trailing space. A new name is sanitized to this grammar before it is stored or sent; a name already on the card is only checked for path safety.
_Avoid_: Filename, slug, safe name

**Key**:
One of the 15 cells on a page, holding an icon, a label, a background colour and one sequence.
_Avoid_: Button, slot, tile

**Sequence**:
The ordered list of action steps that runs when a key is pressed.
_Avoid_: Macro, click list

**Action step**:
One entry in a sequence, written as a firmware action string such as `HID_KEY:CTRL+C`.
_Avoid_: Action, command (when the meaning is the step)

**Reference**:
A key's use of an icon, or an action step that names another page or profile.
_Avoid_: Dependency, link, usage

**View**:
A screen of the desktop app: Deck, Device, Plugins or Settings.
_Avoid_: Page, tab, section

**Sync**:
Copying changed profiles, pages and icons from the app to the device, and, in a sync the user starts, removing deck files and profiles with no library copy.
_Avoid_: Upload, push, deploy

**In sync**:
A local page or icon whose CRC32 matches the copy on the device.
_Avoid_: Clean, up to date

**Missing icon**:
An icon a key references that is neither in the library nor on the deck.
_Avoid_: Broken icon, lost image

**Pending change**:
One upload-side operation the next sync performs: create or rename a profile, upload a page or icon, or switch the active profile. Removals are counted separately ("remove 2").
_Avoid_: Operation, task, diff entry

**Review**:
The Device section that lists the pending changes of the next sync and explains what it will do.
_Avoid_: Sync page, plan view

**Device-only file**:
A page or icon that exists on the device with no local copy.
_Avoid_: Orphan, stale file

**Device-only profile**:
A profile that exists on the deck with no library copy. A sync removes it, and everything in it, after the pages and icons it could hold are settled.
_Avoid_: Orphan profile, stale profile

**Profile rename**:
Sending a library profile's new name to the deck with `CMD_PROFILE_RENAME`, which keeps the profile and its pages. A sync detects it only when one deck profile and one library profile correspond page for page; otherwise it falls back to create plus remove.
_Avoid_: Move, recreate

**Delete**:
Removing a page or icon from the library and from the deck in the same action. While the deck is disconnected, the library copy goes and the deck copy stays.
_Avoid_: Remove, discard

**Library**:
The local collection of profiles, pages and icons that the app edits.
_Avoid_: Local store, file store

**Deck copy**:
The firmware's file for a page or icon, as opposed to the library copy.
_Avoid_: Device copy, remote copy

**Remove**:
Taking a device-only file, or a deck profile with no library copy, off the deck during a sync. The library is untouched.
_Avoid_: Delete, cleanup

**Identity**:
The string that names a device file without its extension: `gaming/3` for a page, `github` for an icon. The firmware builds the path from it.
_Avoid_: Path, filename, target

**Target type**:
The one-byte kind at the start of a file transfer: `0x01` for a page, `0x02` for an icon.
_Avoid_: Path type, file type

**Plugin**:
A host-side command handler that runs on the PC when a key runs a `CMD:` step.
_Avoid_: Extension, add-on, integration

**Plugin manifest**:
The `plugin.json` at the root of a plugin folder. It gives the host API version, handle, name, version, entry file and config fields, and the host validates it at install.
_Avoid_: Descriptor, plugin file, metadata

**Plugin handle**:
The plugin id that appears as the first part of a plugin command, as in `CMD:obs:scene`.
_Avoid_: Namespace, prefix

**Installed plugin**:
A plugin the host has registered, whether or not it offers any commands.
_Avoid_: Loaded plugin, active plugin

**Plugin label**:
The manifest `name` shown in the action picker and the Plugins view. It does not come from a registration call.
_Avoid_: Title, display name

**Plugin command**:
One command a plugin registers, writable as a `CMD:` action step.
_Avoid_: Action, endpoint

**Plugin config**:
The values a user sets for the config fields a plugin declares, stored in `plugins/<handle>/config.json` and read through `getConfig()`.
_Avoid_: Settings, preferences, options

**Plugin status**:
Where a plugin's process is: stopped, starting, running or failed. A failed plugin stays installed and enabled.
_Avoid_: State (when the meaning is status), health

**Plugin data folder**:
The `data/` folder the host creates inside a plugin folder for files the plugin keeps. Removing the plugin removes it too.
_Avoid_: Storage, workspace, cache

**Plugin state**:
A value a plugin publishes to describe what it is doing, such as muted or live. The app shows it. The deck does not.
_Avoid_: Status, flag

**Firmware release**:
One published firmware build, named by a version and described by the manifest the updater reads.

**Firmware manifest**:
The published description of a release: its version, board, image size and checksum. The updater reads it before downloading anything.
_Avoid_: Descriptor, metadata, release file

**Deck firmware version**:
The version a deck reports for the firmware it is running.
_Avoid_: Firmware build, device version

**Flash**:
To write a firmware image to a deck over its USB cable. The updater does everything over USB.
_Avoid_: Upload, push, burn, install

**Firmware update**:
Checking for a newer release, downloading it, and flashing it. The check is automatic; the flash happens only when the user asks.
_Avoid_: Upgrade, OTA

**Bootloader mode**:
The deck's built-in USB mode that accepts a firmware image while the app firmware is not running. A bad app flash cannot remove it.
_Also_: ROM loader
_Avoid_: Download mode, DFU, recovery mode, serial mode

**Bootloader port**:
The serial port the deck exposes while it is in bootloader mode. On Linux the app identifies it by the USB serial number and physical path recorded before the handoff. When the HID interface exposes neither, as on Windows, the app accepts the recorded `303A:1001` only on a port that appeared after the handoff; a pre-existing port is never selected by PID. The app keeps the matching port after a failed write so Retry writes again without another handoff.
_Avoid_: ROM port, loader port, retained ROM port

**Bootloader handoff**:
The acknowledged restart from the running firmware into bootloader mode. The app sends `CMD_ENTER_BOOTLOADER`, the deck answers, then the HID interface disappears.
_Short form_: handoff (in code and stage names)
_Avoid_: reset, reboot

**App slot**:
The part of the deck's flash that holds the application firmware. A flash writes only this part, so the bootloader, partition table, NVS and SD card stay.
_Avoid_: App partition, app image area

**App image**:
The application firmware binary written to the app slot.
_Avoid_: App binary, firmware.bin
