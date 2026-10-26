# LucydDeck

The desktop host for the LucydDeck, an ESP32-S3 stream deck. Vue 3 renderer, Electron main process, and firmware in a separate repository (`lucyd-dev/LucydDeck-firmware`).

## Agent skills

### Issue tracker

GitHub Issues in this repo and in `lucyd-dev/LucydDeck-firmware`, so a host ticket and the firmware change it waits on share one system. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unmodified. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

Spec body checklist: `docs/agents/spec.md`. Review standards: `CODING_STANDARDS.md`.

Plugin author docs: start at `docs/plugin-development.md`; the reference is `docs/plugin-api.md`.

Deck and UI test loop: `docs/agents/hardware-test.md`; the CDP driver is `scripts/cdp.mjs`.

## Workstreams

Work them in order. One workstream's spec is alive at a time, in the tracker, and only while that workstream is open. When it merges, the next one starts and writes its own spec.

1. **Firmware targets and delete.** Done.
2. **UI finish.** Done.
3. **Plugin integration.** Done.
4. **Firmware updater.** Next. Host and firmware bootloader, last because a bad flash bricks a deck.

The tracker holds the closed specs. The next spec is the firmware updater.

## Environment

- Development and agent work: `~/Code/LucydDeck` in WSL.
- Windows build check: `/mnt/c/Users/steve/Documents/Code/LucydDeckProject/LucydDeck`, a separate clone. Sync it with git and do not develop features there.
- Firmware: `~/Code/LucydDeck-firmware` in WSL, built and flashed with PlatformIO over usbipd. The Windows clone is a fallback, not the working copy. Setup is in `docs/wsl-usb.md`.
- The renderer never imports `node-hid`, `sharp` or `electron`.
- Deck and UI testing: `docs/agents/hardware-test.md`. Use the main checkout's Electron binary if a worktree has no `node_modules/electron/dist`.
- Plugin author docs: `docs/plugin-development.md` and `docs/plugin-api.md`.
- Review standards: `CODING_STANDARDS.md`. Spec body: `docs/agents/spec.md`.

## Code map

- `shared/`: wire, schema, action grammar, sync planner, IPC contract. Unit tested.
- `electron/main/services/`: `StorageService`, `UsbService`, `FileTransfer`, `DeviceService`, `ImagePipelineService`, `SyncService`, `FirmwareService`.
- `electron/main/services/flash/`: the esptool adapter, USB port fingerprint, ROM-port locator and quit guard for local firmware flashes.
- `electron/main/ipc/register.ts`: every channel. `electron/preload.ts` exposes `window.lucyd`.
- `src/`: Vue 3 renderer, Pinia stores, router, `AppShell`, board, inspector and views.
- `scripts/cdp.mjs`: drives the running renderer over CDP for UI checks.

The wire, the opcodes and the firmware gaps are in `docs/protocol.md`. The firmware source and its `wiki/` live in `~/Code/LucydDeck-firmware`.

## House rules

1. Conventional Commits on every commit.
2. No push, pull request or GitHub mutation without explicit user confirmation.
3. Ask for a review of the working tree before a large commit.
4. `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` green before a pull request. Vitest covers every pure module and service.
5. Spec questions go to the firmware wiki, not to memory.
6. Vocabulary lives in `GLOSSARY.md`.
7. Review standards live in `CODING_STANDARDS.md`; UI copy, prototypes and docs are part of review.
8. Prototypes live on `prototype/<name>` branches, never on `main`; CI rejects a tracked `prototype/`.
