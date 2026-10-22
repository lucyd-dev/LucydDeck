# Step 3: Plugin system

Branch: `feature/plugin-system`, cut from `main` after the UI branch merges. Read `00-shared-context.md` first.

## Scope

A plugin is a host-side command handler. A button step `CMD:<handle>:<command>[:args]` reaches the PC as `0xA0` with no ack, and the plugin does the work. Plugins run in a worker thread with full Node. There is no permission field, because Node in a worker cannot enforce one, so the install screen says that plainly. Install from a zip or a developer folder. No git install, no marketplace. Not this step: drawing plugin state on the deck, npm dependency resolution, the updater.

## Deliverables

1. `shared/plugin.ts`:
    - Manifest `{ id, name, version, description?, entry, commands[{ name, title?, description? }], configFields[] }`.
    - `configFields` entries are `{ key, type: text | number | bool | select | color, label, default?, options?, required? }`.
    - `validateManifest`, `validateConfig`, and `parseTriggeredAction(raw) -> { handle, command, args }` splitting on the first two colons only.
    - Tests: happy path, bad slug, duplicate command, unknown field type, args containing colons.
2. `plugin-worker.mjs`, unpacked from asar: loads `plugins/<id>/<entry>` with a cache-busting query, exposes `registerCommand`, `getConfig`, `setState`, `logger`, `notify`. Each invoke has a 10s timeout. A crash restarts the worker up to three times, then the plugin is marked broken.
3. `PluginManager`: list, enable, disable, uninstall, `installZip` (yauzl with a zip-slip guard, 10MB cap, manifest and entry validation), `installDevFolder` (reference the folder without copying, reload on change), config get and set with a worker restart, `listCommands`.
4. `PluginDispatcher`: subscribes to `0xA0`, routes by handle, toasts an unknown handle, emits `plugin:event` for state, notify and log, and keeps the last 200 events for the UI.
5. IPC: `plugins:list`, `installZip`, `chooseZip`, `installDevFolder`, `enable`, `disable`, `uninstall`, `getConfig`, `setConfig`, `listCommands`, `events`. Event channels `plugin:event` and `plugins:log`.
6. Plugins view: cards with name, version, status and command count, install buttons, developer folder, enable and disable, uninstall with confirm. A detail panel holds the generated config form, the command list, the current state and a live event log.
7. Inspector integration: the Plugins group in step 2's picker lists commands per plugin with search and an args field, and builds `CMD:<handle>:<command>` steps. A step whose plugin is gone shows as a missing plugin command.
8. Bundled reference plugin `plugins/reference-demo`: commands `ping` and `timer`, using config, state, notify and log. `PLUGIN_GUIDE.md` covers the manifest, the API, a twenty-line example and how to zip it.

## Data flow

Key press, then firmware `0xA0` carrying `handle:command:args`, then `UsbService`, then the dispatcher, then a worker invoke, then a result with log, state and notify, then `plugin:event`, then the Plugins view and a toast.

## Edge cases

- Hung plugin: the 10s timeout fires, the worker restarts, the app stays responsive.
- Bad archive, zip-slip path, oversized zip, missing entry, broken manifest: rejected with a readable reason.
- Import throws: the plugin is marked broken, other plugins keep running.
- Two plugins with the same handle: the second install is rejected.
- Uninstalling leaves `CMD:` steps in pages: the inspector flags them, sync still uploads them, the device still sends them and the dispatcher toasts an unknown handle.

## Validation

1. Install a zip and a developer folder, edit config, restart the worker, enable and disable, uninstall.
2. Simulate `0xA0` with a test button, run the reference plugin, see the log, the state and the toast.
3. A busy-loop plugin does not freeze the window.
4. On hardware: a real key press reaches the plugin.
5. Tests: manifest and config validation, triggered-action parsing, zip-slip guard, handle conflict.
6. `npm run lint && npm run typecheck && npm run test && npm run build` green; packaged smoke run proves the asar unpacked worker path.

## Out of scope

Deck rendering of plugin state, npm dependencies at install, git install, marketplace, macOS support.
