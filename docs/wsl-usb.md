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

## When something is missing

- **No `ttyACM` or `hidraw` node.** Check `lsusb -d 303a:`. If the device is there but the nodes have the wrong owner, the udev rule did not apply. Replug, rerun `udevadm trigger`, or temporarily `sudo chmod -R a+rw /dev/bus/usb`.
- **The port vanishes after a flash.** The ESP32 re-enumerated. Auto-attach should bring it back in a second or two. Without auto-attach, run the attach command again.
- **Upload times out at 921600.** Lower `upload_speed` to `460800` in a local override. The virtual USB hop is less forgiving than the native one.
- **`/dev/ttyACM0` keeps disappearing.** Ubuntu's `brltty` grabs ESP32 CDC ports as Braille displays. Remove or mask it.
