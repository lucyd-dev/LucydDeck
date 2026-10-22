# Step 4: Firmware updater

Branch: `feature/firmware-updater`, cut from `main` after step 3 merges. Read `00-shared-context.md` first.

## Scope

Version check and guided flashing, inside the Device view built in step 1. No tray, no autostart, no app self-update, no CH343 recovery UI.

## Deliverables

1. `shared/firmware.ts`: parse and compare versions, `protocolCompatible`, and a release asset matcher for `espressif/esptool`. Tests with fixture version strings and asset lists.
2. `FirmwareReleaseService`: GitHub releases without prereleases, TTL cache, comparison against the connected device, `firmware:state` with current, latest, update available and protocol note.
3. `EsptoolManager`: download the matching esptool release into `tools/esptool/`, verify SHA256, write `esptool.json`. Never bundled, since it is GPL. Show the license note in the UI.
4. `FlashRoutine`, staged over `flash:progress`:
    1. Preflight: device connected, tool present, board supported, artifact present.
    2. Touch reset: open the USB CDC port at 1200 baud, close it.
    3. Poll for the bootloader port, with a timeout and instructions.
    4. Run `esptool write_flash` with the correct offsets and bootloader files.
    5. Wait for the vendor HID device to return, reconnect, read device info and confirm the version.
    - Cancellable, and a `--dry-run` mode prints the stages without touching hardware.
5. Device view firmware card: current and latest version, changelog excerpt, update button, stage stepper, error text with recovery steps, license note.
6. IPC: `firmware:getState`, `refresh`, `startFlash`, `cancelFlash`, plus `flash:progress` and `firmware:state`.

## Edge cases

- Asset naming drift: log the candidates tried and offer a manual file choice.
- Touch reset fails: retry a few times, then show manual instructions.
- Interrupted flash: the device may sit in the bootloader. Detect it and offer a re-run.
- No network: keep the cached state and allow a manual artifact.
- Protocol mismatch: warn, do not block.

## Validation

1. `--dry-run` prints the planned stages and touches nothing.
2. On hardware: flash the previous version to the new one, watch the stepper, confirm the version afterwards.
3. Failure paths: no device, missing tool, unsupported board, cancelled flash.
4. Tests: version comparison and the asset matcher.
5. `npm run lint && npm run typecheck && npm run test && npm run build` green; CI green; packaged build shows the firmware card.

## Out of scope

Tray, autostart, app auto-update, CH343 unbrick flow, macOS release.
