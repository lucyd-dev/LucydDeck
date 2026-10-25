# Plugins run in one utility process each

A plugin is a folder the user installs: a `plugin.json` manifest and an ESM entry that exports `setup(context)` and `teardown()`. The deck reaches it through `CMD:<handle>:<command>` steps. The firmware forwards the CMD body with the prefix stripped, one `0xA0` event per step, with no key, page or profile metadata and no acknowledgement. The host parses `handle:command`, finds the plugin that registered the command, and runs its handler.

The host treats plugin code as trusted. There is no permission manifest and no sandbox claim, because a plugin runs on Node and can import `node:child_process`. Hiding that behind shims would only mislead the user. The install confirmation says once that a plugin can do anything the app can.

Trust does not mean sharing a process. Each enabled plugin runs in its own `utilityProcess`, so `process.exit()`, a crash in a native module the plugin fetched, or an out-of-memory loop ends that process and not the app. A worker thread would not contain `process.exit()`. The main process supervises every plugin: it starts enabled plugins when the app is ready, restarts a process that exits up to three times at one, two and four seconds and then marks it failed, and kills a process whose `teardown()` exceeds two seconds.

Commands are fire and forget from the deck, so the host owns delivery. Handlers run serially per plugin, with a queue of sixteen pending commands and the newest dropped when it is full. A handler that runs longer than ten seconds frees the queue and logs. The device is not waiting either way.

Config is a snapshot taken when `setup` starts, because a plugin may bind values while setting up. Saving config restarts the process. A plugin may register commands only during `setup`, so the picker's command list stays stable for the life of the process. The picker gets one row per installed plugin, including a disabled one, and plugin rows use `plugin:<handle>` as their id so a handle cannot collide with the built-in rows.

## Considered options

- Run plugins in the main process. One infinite loop or `process.exit()` takes the app with it.
- Run every plugin in one shared process. One plugin can kill another and a restart loses every plugin's state.
- Use `worker_threads`. It isolates JavaScript exceptions but not `process.exit()` or a native crash.
- Declare permissions in the manifest. Node exposes filesystem, network and process APIs directly, and a wrapper is the first thing a plugin bypasses.
- Push config changes to a running plugin. It adds an API every plugin must implement to stay correct, and setup-bound values are the common case.

## Consequences

- Each enabled plugin costs one Node process.
- The build ships a second main-process entry for the worker runtime. If the packaged app cannot load it from `app.asar`, that one file goes in `asarUnpack`.
- A plugin can read the app's data folder, including another plugin's config. The plugin docs say so.
- `secret` config fields are masked in the form and stored in plaintext.
- A slow handler delays later commands for that plugin, and can delay the deck's own steps if the vendor endpoint stops draining. The host cannot tell the deck to wait.
- The Review and the inspector warn about a `CMD:` step whose plugin is missing, disabled or does not register the command. Neither blocks a save or an upload.
- Removing a plugin stops its process before deleting the folder, and the folder holds the only copy of its config and data.
