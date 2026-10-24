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

**Key**:
One of the 15 cells on a page, holding an icon, a label, a background colour and one sequence.
_Avoid_: Button, slot, tile

**Sequence**:
The ordered list of action steps that runs when a key is pressed.
_Avoid_: Macro, click list

**Action step**:
One entry in a sequence, written as a firmware action string such as `HID_KEY:CTRL+C`.
_Avoid_: Action, command (when the meaning is the step)

**View**:
A screen of the desktop app: Deck, Device, Plugins or Settings.
_Avoid_: Page, tab, section

**Sync**:
Copying changed pages and icons from the app to the device.
_Avoid_: Upload, push, deploy

**In sync**:
A local page or icon whose CRC32 matches the copy on the device.
_Avoid_: Clean, up to date

**Device-only file**:
A page or icon that exists on the device with no local copy.
_Avoid_: Orphan, stale file

**Identity**:
The string that names a device file without its extension: `gaming/3` for a page, `github` for an icon. The firmware builds the path from it.
_Avoid_: Path, filename, target

**Target type**:
The one-byte kind at the start of a file transfer: `0x01` for a page, `0x02` for an icon.
_Avoid_: Path type, file type

**Plugin**:
A host-side command handler that runs on the PC when a key runs a `CMD:` step.
_Avoid_: Extension, add-on, integration

**Plugin handle**:
The plugin id that appears as the first part of a plugin command, as in `CMD:obs:scene`.
_Avoid_: Namespace, prefix

**Plugin command**:
One command a plugin registers, writable as a `CMD:` action step.
_Avoid_: Action, endpoint

**Plugin state**:
A value a plugin publishes to describe what it is doing, such as muted or live. The app shows it. The deck does not.
_Avoid_: Status, flag
