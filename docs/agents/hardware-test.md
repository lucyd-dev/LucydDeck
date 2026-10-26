# Deck and UI test loop

Use this for a host or UI change that must be seen on the real deck. It runs the app against an isolated data directory, so the user's library is untouched.

The serial and flashing setup is in [docs/wsl-usb.md](../wsl-usb.md). The deck's native USB port is `303a:1001`. The CH343 UART is `1a86` on a separate port. Stop any UART reader before flashing.

## 1. Start from the main checkout's Electron binary

A worktree may have `node_modules` without the Electron download. Use the main checkout's binary and point it at the checkout you want to run:

```bash
MAIN="/path/to/LucydDeck"
APP="${APP:-$MAIN}"                         # worktree or main checkout
ELECTRON="$MAIN/node_modules/electron/dist/electron"
[ -x "$ELECTRON" ] || ELECTRON="$APP/node_modules/electron/dist/electron"

D=/tmp/opencode/deck-test
rm -rf "$D"
mkdir -p "$D"
cp -a "$HOME/.config/LucydDeck/profiles" "$D/profiles"
cp -a "$HOME/.config/LucydDeck/icons" "$D/icons"
cp "$HOME/.config/LucydDeck/settings.json" "$D/settings.json"

cd "$APP"
LUCYD_DECK_DATA_DIR="$D" "$ELECTRON" --no-sandbox --remote-debugging-port=9224 .
```

The copied `profiles` and `icons` are deliberate. A sync with removals would otherwise delete every deck profile and icon missing from an empty local library.

## 2. Drive the renderer over CDP

The repo has a small driver:

```bash
export CDP_ENDPOINT=http://127.0.0.1:9224
node "$MAIN/scripts/cdp.mjs" 'return document.body.innerText.slice(0, 600)'
```

The expression runs inside an async function. Use `await window.lucyd.invoke(...)` for IPC.

Connect the deck by clicking the chip in the app, or with:

```bash
node "$MAIN/scripts/cdp.mjs" \
  'document.querySelector("button.device-chip")?.click(); await new Promise(r => setTimeout(r, 3500)); return document.body.innerText.slice(0, 300)'
```

## 3. Install the test plugin

The example plugin is at `examples/plugins/hello`. From the UI, choose **Plugins**, **Install plugin** and pick that folder. The OS picker is not driveable over CDP; for an automated pass use the same IPC path:

```bash
node "$MAIN/scripts/cdp.mjs" '
const path = "/absolute/path/to/examples/plugins/hello";
const install = await window.lucyd.invoke("plugins:install", { path });
await new Promise(r => setTimeout(r, 1800));
const list = await window.lucyd.invoke("plugins:list", undefined);
return { install, list };
'
```

The plugin should be `running` with its commands registered. If it is `failed`, read `$D/logs/main.log`.

## 4. Put a command on the deck

Create a test profile in the isolated data directory:

```bash
mkdir -p "$D/profiles/PluginPass"
cat > "$D/profiles/PluginPass/0.json" <<'JSON'
{
    "buttons": {
        "0": {
            "click": ["CMD:hello:greet"],
            "backgroundColor": "#0060fa",
            "label": "Greet"
        }
    }
}
JSON
```

Reconcile before syncing, and read the plan:

```bash
node "$MAIN/scripts/cdp.mjs" '
const plan = await window.lucyd.invoke("sync:reconcile", { activeProfile: "PluginPass" });
return plan;
'
```

Proceed only when `profilesToDelete`, `pagesToDelete` and `iconsToDelete` are empty. The copied library should keep them empty. Upload with removals off:

```bash
node "$MAIN/scripts/cdp.mjs" '
const plan = await window.lucyd.invoke("sync:reconcile", { activeProfile: "PluginPass" });
if (!plan.ok) return plan;
return window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: false });
'
```

Set page 1 and confirm the deck is on `PluginPass`:

```bash
node "$MAIN/scripts/cdp.mjs" 'return window.lucyd.invoke("usb:setActivePage", { id: "0" })'
```

Press the top-left key. The app log should show both lines:

```
[usb] action triggered: hello:greet
[plugin:hello] Hello from the hello plugin
```

Watch it with:

```bash
tail -f "$D/logs/main.log"
```

## 5. Restore the deck and the app

Set the active profile back before removing the test profile:

```bash
node "$MAIN/scripts/cdp.mjs" '
await window.lucyd.invoke("usb:setActiveProfile", { name: "Default" });
return window.lucyd.invoke("storage:deleteProfile", { name: "PluginPass" });
'
```

Reconcile again. The plan should list only `PluginPass` under `profilesToDelete`. Then remove it with removals on:

```bash
node "$MAIN/scripts/cdp.mjs" '
const plan = await window.lucyd.invoke("sync:reconcile", {});
if (!plan.ok) return plan;
return window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: true });
'
```

Remove the test plugin and stop the app:

```bash
node "$MAIN/scripts/cdp.mjs" 'return window.lucyd.invoke("plugins:remove", { handle: "hello" })'
# stop the Electron process, then:
rm -rf "$D"
```

The real `~/.config/LucydDeck` was never edited. If the deck still shows the test key, the restore step above was skipped.

## Notes

- The isolated data dir must be removed after the pass. It contains a copy of the user's profiles and icons.
- Never run `allowRemovals: true` without reading the plan first.
- A key press runs the handler on the host. A plugin that only logs looks like nothing happened on the deck; check the log.
- The native install dialog is for humans. The IPC `plugins:inspect` and `plugins:install` path is the automated equivalent.
- The CDP driver needs Node 22's `fetch` and `WebSocket`.
