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
