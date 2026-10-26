# Building, flashing and testing from WSL

The whole loop runs in WSL: edit the host and the firmware, build both, flash the deck, run the app and read the logs. The Windows clone is a fallback.

## One-time Windows setup

Run these in an administrator PowerShell.

```powershell
winget install usbipd
usbipd list
usbipd bind --busid <busid>
```

`usbipd list` shows the deck as vendor `303A`. `bind` is needed once per device and survives reboots.

## Each session

Keep a PowerShell window open:

```powershell
usbipd attach --wsl --auto-attach --busid <busid>
```

Auto-attach brings the deck back after it resets. Every flash resets it, so without this you would reattach by hand each time. Keep the same USB port: the bus id belongs to the port.

While attached, the deck is invisible to Windows. That is expected now that flashing also happens in WSL.

## One-time WSL setup

```bash
sudo apt install usbutils
sudo usermod -aG dialout "$USER"
sudo cp contrib/udev/99-lucyddeck.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Log out and back in for the group change. Check with `lsusb -d 303a:` and `pio device list`.

PlatformIO is installed with pipx and lives at `~/.local/bin/pio`.

```bash
pipx install platformio
git clone https://github.com/lucyd-dev/LucydDeck-firmware.git ~/Code/LucydDeck-firmware
```

Clone into the Linux filesystem. Building across `/mnt/c` is slow, and a Windows `.pio` directory holds Windows build objects.

## Daily loop

```bash
cd ~/Code/LucydDeck-firmware
pio run -e debug                 # build
pio run -e debug -t upload       # flash
pio device monitor -e debug      # serial log
```

Then run the app from the branch worktree:

```bash
npm run dev
```

## One-time bootstrap flash

A deck whose firmware predates `CMD_ENTER_BOOTLOADER` (`0x05`) cannot restart itself from the app. Flash the first release that carries the command once with PlatformIO:

```bash
cd ~/Code/LucydDeck-firmware
git pull
pio run -e release -t upload
```

The app reports "This deck's firmware is too old to update from the app" for such a deck. From that release onward, Settings → Firmware → Advanced flashes local images and the release updater owns later updates. The bootstrap is a one-time developer step, not a user path.

## Binding the ROM device

The running app and its ROM bootloader share Espressif `303A:1001`, so usbipd sees them as separate devices on the same physical port. Bind **both** once, as administrator:

```powershell
usbipd list
usbipd bind --busid <app-busid>
usbipd bind --busid <bootloader-busid>
```

Trigger the bootloader once with a PlatformIO upload or `CMD_ENTER_BOOTLOADER` while the deck is visible, note the new bus id, and bind it. Bindings survive reboots and reconnects.

Then attach with auto-attach:

```powershell
usbipd attach --wsl --auto-attach --busid <app-busid>
usbipd attach --wsl --auto-attach --busid <bootloader-busid>
```

Auto-attach follows the deck when the app interface drops and the ROM interface appears. A flash that stops at "Waiting for the deck's bootloader mode" usually means the ROM device is not bound or attached.

The app identifies the loader by the deck's USB serial number plus its physical path. Under usbipd the ROM device can land on a different vhci path, so the serial number is what matches; the path is a corroborating check on native Linux. A port that only shares `303A:1001` is never selected.

## WSL acceptance check

Use a WSL `npm run dev` pass as the Linux functional gate for a local flash:

1. Attach both devices as above.
2. In Settings → Firmware, confirm the deck firmware version and deck appear.
3. Choose a local `.bin` built for `max_app_8MB`, confirm, and watch the stages: bootloader handoff, bootloader mode, write percentage, return.
4. Confirm the deck comes back and the section shows the version the deck now reports. Profiles, pages, icons and the active page stay as they were.

The limits and copy are in the [local flash reference](#local-flash-reference).

The WSL pass on 2026-10-26 flashed a local `firmware.bin`, watched bootloader handoff, bootloader mode, write and return, and read back `v0.4.0`; the deck's profiles and icons were unchanged.

Native Linux packages are supported, but their install layer (udev rule, `brltty`, AppImage) is documented and **unverified**; Windows is the hardware acceptance gate.

## Local fake update

The release path can be tested without publishing a release. The manifest's fields, limits and refusals are in the [Firmware Manifest](https://github.com/lucyd-dev/LucydDeck-firmware/wiki/Firmware-Manifest) reference, and the release walk-through is [Releasing](https://github.com/lucyd-dev/LucydDeck-firmware/wiki/Releasing). A development build honours `LUCYD_FIRMWARE_MANIFEST`; a packaged build ignores it and always reads the published manifest. The image is resolved from the same directory as the manifest, so both files can be served from one local folder.

1. Build an image that reports the fake version. The app checks that the deck returns exactly the manifest version, so a `9.9.9` manifest needs an image built with `version.txt` set to `9.9.9`.

    ```bash
    cd ~/Code/LucydDeck-firmware
    printf '9.9.9\n' > version.txt
    pio run -e release
    git checkout version.txt
    mkdir -p /tmp/opencode/fake-release
    cp .pio/build/release/firmware.bin /tmp/opencode/fake-release/LucydDeck-firmware-v9.9.9.bin
    ```

2. Write `firmware.json` beside the image and serve the folder.

    ```bash
    python3 - <<'PY'
    import hashlib, json, pathlib

    folder = pathlib.Path("/tmp/opencode/fake-release")
    image = folder / "LucydDeck-firmware-v9.9.9.bin"
    manifest = {
        "schemaVersion": 1,
        "version": "9.9.9",
        "releaseUrl": "http://127.0.0.1:8765/notes.html",
        "boards": {
            "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3": {
                "asset": image.name,
                "size": image.stat().st_size,
                "sha256": hashlib.sha256(image.read_bytes()).hexdigest(),
                "chip": "esp32s3",
                "address": 65536,
                "layout": "max_app_8MB",
            }
        },
    }
    (folder / "firmware.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (folder / "notes.html").write_text("<h1>Fake release</h1>\n")
    PY
    python3 -m http.server 8765 --directory /tmp/opencode/fake-release
    ```

3. In another WSL shell, start the app with the override and connect the deck.

    ```bash
    cd ~/Code/LucydDeck
    LUCYD_FIRMWARE_MANIFEST=http://127.0.0.1:8765/firmware.json npm run dev
    ```

    Settings → Firmware should show `Version 9.9.9 is available`, the Settings item should carry the dot, and the local notes page should be the release link. Choose **Update to 9.9.9**, watch the download, handoff, write and return, and confirm the section spells out the version the deck now reports. **Check for updates** afterwards should say the deck is up to date. Profiles, pages, icons and the active page stay on the deck.

4. Restore the deck. The fake version is higher than every published release, so flash the real release once with PlatformIO and remove the folder.

    ```bash
    cd ~/Code/LucydDeck-firmware
    git pull
    pio run -e release -t upload
    rm -rf /tmp/opencode/fake-release
    ```

The manifest version must be newer than the deck's firmware version and match the version the image reports. To test only the "update available" state, any newer version works; for the flash and post-flash confirmation, build the image with the same version. The override changes nothing in a packaged build and does not alter the default release URL.

## Local flash reference

See the [WSL acceptance check](#wsl-acceptance-check) for the manual pass.

The Advanced action accepts one local `.bin` built for the `max_app_8MB` layout. It checks the size bound of 8064 KiB, writes at `0x10000` with `eraseAll: false`, and never writes the bootloader, partition table, NVS or SD card. A local file carries no manifest, so its address and layout are not checked; the release updater owns those checks.

The stages are bootloader handoff, bootloader mode, write (0-100%) and return. The confirmation dialog is the cancel point; there is no cancel after the bootloader handoff. Quitting during the write asks first, once per write.

## When something is missing

- **No `ttyACM` or `hidraw` node.** Check `lsusb -d 303a:`. If the device is there but the nodes have the wrong owner, the udev rule did not apply. Replug, rerun `udevadm trigger`, or temporarily `sudo chmod -R a+rw /dev/bus/usb`.
- **The port vanishes after a flash.** The ESP32 re-enumerated. Auto-attach should bring it back in a second or two. Without auto-attach, run the attach command again.
- **The port vanishes at the start of an upload and never returns.** The flash reset the deck into its ROM bootloader, which is a second USB device on the same port (`USB JTAG/serial debug unit`, a different COM port). usbipd shares devices individually, so bind that one too while it is visible: `usbipd bind --busid <busid>` as administrator. With both the app device and the bootloader device shared, auto-attach follows the deck through a flash. A power cycle boots the old firmware and brings the app device back.
- **Upload times out at 921600.** Lower `upload_speed` to `460800` in a local override. The virtual USB hop is less forgiving than the native one.
- **`/dev/ttyACM0` keeps disappearing.** Ubuntu's `brltty` grabs ESP32 CDC ports as Braille displays. Remove or mask it.
