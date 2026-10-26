# Firmware updates flash the app image through the ROM bootloader

The deck's partition table (`max_app_8MB`) has one factory app partition at `0x10000` and no OTA slots, so the firmware cannot replace itself without repartitioning first. A self-updater would need a second app slot, a bootloader that chooses between them, and flash-writing code inside the app that can brick the deck if it fails. The ESP32-S3 ROM bootloader already sits below all of that, cannot be overwritten by a bad app flash, and is the path PlatformIO uses to install the firmware. The host therefore asks the running firmware to restart into bootloader mode (`CMD_ENTER_BOOTLOADER`, `0x05`), then writes only the app image at `0x10000`. It never erases the whole flash and never writes the bootloader, the partition table, NVS or the SD card.

The handoff is one explicit command, acknowledged before the device disappears, not the 1200 bps touch on the CDC port that the current firmware also honours. One trigger and one code path, with no dependence on which process holds the CDC port or on the host's serial stack. The project has no backward-compatibility obligation before 1.0.0, so a deck whose firmware predates the command is flashed once with PlatformIO; from the next release onward the app owns the update.

## Considered options

- **Self-update over HID with two app slots.** It requires a one-time full flash anyway, doubles the firmware work, and puts the write path inside the code being replaced, which is the one place a failure can leave nothing bootable.
- **1200 bps touch on the app's CDC port.** It works on the current firmware, but it is out of band, gives no acknowledgement, and fails when another program or `brltty` holds the tty. It buys compatibility that 1.0.0 does not need.
- **Guide the user to esptool or PlatformIO.** It puts Python and a command line between a normal user and an update, for a task the app can do itself.

## Consequences

- A deck on a firmware older than the release that adds `CMD_ENTER_BOOTLOADER` needs one manual PlatformIO flash. This is a bootstrap step, not a supported user path.
- A deck whose app will not boot is recovered with BOOT+RESET and PlatformIO. The app never claims to repair that, because it cannot run the handoff command.
- A release that changes the partition table, bootloader or flash layout cannot ship as an app-only update. It needs a separate full-flash path, which is out of scope until such a release exists.
- The release manifest is keyed by board, so a future custom board can carry its own image, flash address and layout without changing the updater's contract.
