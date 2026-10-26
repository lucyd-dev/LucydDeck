# Windows host test loop

Use this when a change has to be seen in the app on Windows, and for any
firmware update pass: the Windows USB stack differs from WSL's, and three
firmware-updater bugs only appeared here. The WSL loop is in
[hardware-test.md](hardware-test.md); this is the Windows counterpart.

## 1. Sync the Windows clone

The Windows clone is a build-check clone. Sync it with git; do not develop
there.

```powershell
git fetch origin
git switch -C <branch> --track origin/<branch>   # or: git switch main && git pull
npm install
npm run build
```

Run npm and the build from Windows, not from WSL on the mount: native modules
(`node-hid`, `serialport`, `sharp`) must be the Windows builds. `npm install`
here is expected to change `package-lock.json`; do not commit that churn.

## 2. Give the deck to Windows

While `usbipd` auto-attach is running, the deck belongs to WSL and Windows
cannot see it.

```powershell
usbipd list
usbipd detach --busid <busid>       # e.g. 1-13
```

Stop the auto-attach helper as well, or it re-attaches within seconds. The deck
then enumerates on Windows (HID plus a COM port). To hand it back to WSL:

```powershell
usbipd attach --wsl --busid <busid>
```

## 3. Run the app against a throwaway data directory

Create a batch file so the environment survives the `cd`:

```bat
@echo off
cd /d <path-to-windows-clone>
set "LUCYD_DECK_DATA_DIR=%TEMP%\lucyddeck-test"
node_modules\electron\dist\electron.exe . --remote-debugging-port=9226
```

- The isolated data directory keeps the user's library untouched. Do not run
  Sync against it; the library is empty and a pruning sync would clear the deck.
- `LUCYD_FIRMWARE_MANIFEST=http://127.0.0.1:8899/firmware.json` points the
  update check at a locally served fake release. It is honoured only when the
  app is not packaged. The image must sit beside the manifest with the name the
  manifest gives, and its built-in version must match the manifest version, or
  the read-back after flashing fails.
- Kill stale Electron processes first: `taskkill /IM electron.exe /F`. An old
  instance holds the single-instance lock and the CDP port, and the new one
  starts headless with a `bind()` error.
- Redirect stdout to a file; the app logs USB scanning, port choice, esptool
  output and flash progress there.

## 4. Drive it over CDP

Mirrored networking lets WSL reach the Windows port:

```bash
export CDP_ENDPOINT=http://127.0.0.1:9226
node scripts/cdp.mjs 'document.querySelector("button.device-chip")?.click(); ...'
```

The app scans for the deck on a chip click, not at launch. Then
`location.hash = "#/settings"`, click the **Firmware** tab, and use the
**Check for updates** button.

## 5. Firmware update checklist

- Deck on an older version; the check finds the newer one and links its notes.
- Confirm, handoff, and the ROM loader appears as a new COM port
  (`USB JTAG/serial debug unit`).
- The write runs at `0x10000`; the deck returns and the reported version matches.
- Profiles, pages, icons and the active page are unchanged.
- Failure path: with the loader detached the app says it could not reach
  bootloader mode, keeps scanning, and recovers when the deck appears again.
  A slow return past the timeout says "unplug and replug", then recovers the
  same way.

## 6. Windows differences worth knowing

- The HID product string Windows reports is the **interface** string
  (`TinyUSB HID`), not the device `iProduct`; the app labels the known
  `303A:1001` as `LucydDeck`.
- `serialport`'s `serialNumber` for a COM port is a PnP instance ID, not the USB
  serial. The flasher therefore finds the bootloader by VID/PID on a port that
  appeared after the handoff, never by the HID serial.
- The ROM loader needs no driver install; it appears as a standard CDC port.
