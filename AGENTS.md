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

All four are done; the tracker holds their closed specs.

1. **Firmware targets and delete.**
2. **UI finish.**
3. **Plugin integration.**
4. **Firmware updater.**

The next workstream writes its own spec in the tracker.

## Environment

- Development and agent work: the main checkout in WSL.
- Windows build check: a separate Windows clone. Sync it with git and do not develop features there. The Windows host pass, including the deck handover from usbipd, is in `docs/agents/windows-test.md`.
- Firmware: the firmware checkout in WSL, built and flashed with PlatformIO over usbipd. A Windows clone is a fallback, not the working copy. Setup is in `docs/wsl-usb.md`.
- A fresh worktree: `scripts/worktree-setup.sh`. It links the main checkout's `node_modules`, installs without rewriting `package-lock.json`, and points git at the commit-message hook.
- The renderer never imports `node-hid`, `sharp` or `electron`.
- Deck and UI testing: `docs/agents/hardware-test.md`. Use the main checkout's Electron binary if a worktree has no `node_modules/electron/dist`.
- Plugin author docs: `docs/plugin-development.md` and `docs/plugin-api.md`.
- Review standards: `CODING_STANDARDS.md`. Spec body: `docs/agents/spec.md`.

## Code map

- `shared/`: wire, schema, action grammar, sync planner, delete result, firmware release policy, IPC contract. Unit tested.
- `electron/main/services/`: `StorageService`, `UsbService`, `FileTransfer`, `DeviceLock`, `DeviceService`, `ImagePipelineService`, `SyncService`, `DeleteService`, `FirmwareService`, `ReleaseSource`.
- `electron/main/services/flash/`: the esptool adapter, USB port fingerprint, ROM-port locator and quit guard for local firmware flashes.
- `electron/main/ipc/register.ts`: every channel. `electron/preload.ts` exposes `window.lucyd`.
- `src/`: Vue 3 renderer, Pinia stores, router, `AppShell`, board, inspector and views.
- `scripts/cdp.mjs`: drives the running renderer over CDP for UI checks.

The wire, the opcodes and the firmware gaps are in `docs/protocol.md`. The firmware source and its `wiki/` live in the firmware repository.

## House rules

1. Conventional Commits on every commit.
2. No push, pull request or GitHub mutation without explicit user confirmation.
3. Ask for a review of the working tree before a large commit.
4. `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` green before a pull request. Vitest covers every pure module and service.
5. Spec questions go to the firmware wiki, not to memory.
6. Vocabulary lives in `GLOSSARY.md`.
7. Review standards live in `CODING_STANDARDS.md`; UI copy, prototypes and docs are part of review.
8. Prototypes live on `prototype/<name>` branches, never on `main`; CI rejects a tracked `prototype/`.
