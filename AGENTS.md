# LucydDeck

The desktop host for the LucydDeck, an ESP32-S3 stream deck. Vue 3 renderer, Electron main process, and firmware in a separate repository (`lucyd-dev/LucydDeck-firmware`).

## Agent skills

### Issue tracker

This repo keeps issues as local markdown under `.scratch/`; the firmware repo uses GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unmodified. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Workstreams

Work them in order. One workstream's spec is alive at a time, in the tracker, and only while that workstream is open. When it merges, the next one starts and writes its own spec.

1. **Firmware page delete.** Firmware repo, on the Windows machine, because PlatformIO uploads need it. Tracked in [LucydDeck-firmware#9](https://github.com/lucyd-dev/LucydDeck-firmware/issues/9): `CMD_PAGE_DELETE = 0x23`, payload `<profile>/<id>`, first remaining page repainted when the displayed page goes. The host draft on `feature/ui-rebuild` still sends the old file-path command and adapts once this lands.
2. **UI finish.** `feature/ui-rebuild`. The board inspector and the chosen prototype in `prototype/one-action.html` are the starting point. Ends with a review and a merge to `main`.
3. **Plugin integration.** New branch from `main`. A worker-hosted command handler reached by `CMD:` steps.
4. **Firmware updater.** Host and firmware bootloader, last because a bad flash bricks a deck.

Steps 2 and 3 can swap if the board is out of reach. The rest follow from dependencies: plugins need the finished inspector, and the updater comes last.

## Environment

- Development and agent work: `~/Code/LucydDeck` in WSL.
- Windows build check: `/mnt/c/Users/steve/Documents/Code/LucydDeckProject/LucydDeck`, a separate clone. Sync it with git and do not develop features there.
- Firmware: a separate clone on the Windows machine. It is a PlatformIO project and uploads need Windows, so it is not built in WSL.
- The renderer never imports `node-hid`, `sharp` or `electron`.

## Code map

- `shared/`: wire, schema, action grammar, sync planner, IPC contract. Unit tested.
- `electron/main/services/`: `StorageService`, `UsbService`, `FileTransfer`, `DeviceService`, `ImagePipelineService`, `SyncService`.
- `electron/main/ipc/register.ts`: every channel. `electron/preload.ts` exposes `window.lucyd`.
- `src/`: Vue 3 renderer, Pinia stores, router, `AppShell`, board, inspector and views.

The wire, the opcodes and the firmware gaps are in `docs/protocol.md`.

## House rules

1. Conventional Commits on every commit.
2. No push, pull request or GitHub mutation without explicit user confirmation.
3. Ask for a review of the working tree before a large commit.
4. `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` green before a pull request. Vitest covers every pure module and service.
5. Spec questions go to the firmware wiki, not to memory.
6. Vocabulary lives in `GLOSSARY.md`.
