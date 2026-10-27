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

## 5. Delete an icon from both sides

With the app still running against the isolated directory and the deck connected, create a test icon, save a page that uses it, and upload the icon:

```bash
node "$MAIN/scripts/cdp.mjs" '
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const imported = await window.lucyd.invoke("icons:importData", { name: "zz-delete-check", dataUrl: "data:image/png;base64," + png });
const saved = await window.lucyd.invoke("storage:savePage", { profile: "Default", id: "250", page: { buttons: { "0": { imageName: "zz-delete-check", label: "delete check" } } } });
const refs = await window.lucyd.invoke("storage:scanReferences", { kind: "icon", name: "zz-delete-check" });
const uploaded = await window.lucyd.invoke("usb:uploadIcon", { name: "zz-delete-check" });
return { imported, saved, refs, uploaded };
'
```

`refs.data.hits` must name the page. Open any key's icon gallery, right-click `zz-delete-check` and delete it. The confirmation names the page that still uses the icon, and after confirming, neither side lists the icon:

```bash
node "$MAIN/scripts/cdp.mjs" '
const library = await window.lucyd.invoke("icons:list", undefined);
const deck = await window.lucyd.invoke("usb:listImages", undefined);
return {
    inLibrary: library.ok && library.data.some(i => i.name === "zz-delete-check"),
    onDeck: deck.ok && deck.data.some(i => i.filename === "zz-delete-check.png"),
};
'
```

Both values must be `false`. The toast says the icon was deleted. Remove the test page from the isolated library so the restore reconcile stays clean:

```bash
rm "$D/profiles/Default/250.json"
```

For the unplugged case, create and upload a second icon, disconnect, then delete it from the gallery:

```bash
node "$MAIN/scripts/cdp.mjs" '
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
await window.lucyd.invoke("icons:importData", { name: "zz-offline-check", dataUrl: "data:image/png;base64," + png });
await window.lucyd.invoke("usb:uploadIcon", { name: "zz-offline-check" });
await window.lucyd.invoke("usb:disconnect", undefined);
return window.lucyd.invoke("icons:list", undefined);
'
```

The gallery confirmation says the deck copy stays. After confirming, the toast says the library copy was deleted and the next sync removes the deck copy. Reconnect and check the deck still has it, then remove that deck-only copy:

```bash
node "$MAIN/scripts/cdp.mjs" '
await window.lucyd.invoke("usb:connect", undefined);
await new Promise(r => setTimeout(r, 3500));
const deck = await window.lucyd.invoke("usb:listImages", undefined);
const cleaned = await window.lucyd.invoke("usb:deleteFile", { kind: "icon", name: "zz-offline-check", allowMissing: true });
return { stayedOnDeck: deck.ok && deck.data.some(i => i.filename === "zz-offline-check.png"), cleaned };
'
```

## 6. Delete a profile from both sides

With the deck connected, create a throwaway profile and upload it:

```bash
node "$MAIN/scripts/cdp.mjs" '
const created = await window.lucyd.invoke("storage:createProfile", { name: "zz-profile-check" });
await window.lucyd.invoke("storage:savePage", { profile: "zz-profile-check", id: "0", page: { buttons: { "0": { label: "delete check" } } } });
const plan = await window.lucyd.invoke("sync:reconcile", { activeProfile: "zz-profile-check" });
if (!plan.ok) return plan;
return { created, plan: await window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: false }) };
'
```

Select `zz-profile-check`, open the profile menu, choose its row menu and **Delete Profile**. The confirmation says the profile is deleted from the library and from the deck. After confirming, both sides must lose it and the app must open another profile:

```bash
node "$MAIN/scripts/cdp.mjs" '
const library = await window.lucyd.invoke("storage:listProfiles", undefined);
const deck = await window.lucyd.invoke("usb:listProfiles", undefined);
return {
    inLibrary: library.ok && library.data.some(p => p.name === "zz-profile-check"),
    onDeck: deck.ok && deck.data.some(p => p.name === "zz-profile-check"),
};
'
```

Both values must be `false`. The toast says the profile was deleted, and the deck repaints on its own reselected profile.

Repeat for the disconnected path:

```bash
node "$MAIN/scripts/cdp.mjs" '
await window.lucyd.invoke("storage:createProfile", { name: "zz-offline-profile" });
await window.lucyd.invoke("storage:savePage", { profile: "zz-offline-profile", id: "0", page: { buttons: {} } });
const plan = await window.lucyd.invoke("sync:reconcile", { activeProfile: "zz-offline-profile" });
if (!plan.ok) return plan;
await window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: false });
return window.lucyd.invoke("usb:disconnect", undefined);
'
```

Delete it from the profile menu. The confirmation says the deck copy stays, the library loses the profile, and the deck still has it. Reconnect, read the plan, and let an explicit sync prune it:

```bash
node "$MAIN/scripts/cdp.mjs" '
await window.lucyd.invoke("usb:connect", undefined);
await new Promise(r => setTimeout(r, 3500));
const library = await window.lucyd.invoke("storage:listProfiles", undefined);
const deck = await window.lucyd.invoke("usb:listProfiles", undefined);
const plan = await window.lucyd.invoke("sync:reconcile", {});
if (!plan.ok) return plan;
if (!plan.data.profilesToDelete.includes("zz-offline-profile")) return { stopped: "plan did not list the deck-only profile", library, deck };
return { library, deck, cleaned: await window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: true }) };
'
```

Deleting the active profile is the connected case above: make `zz-profile-check` active before deleting it and confirm the app opens the default profile, or the first remaining one.

## 7. Deck writes during a sync

Set up a plan with enough pages that the sync takes longer than a frame round trip, then start it and try a delete and a direct write while it runs:

```bash
node "$MAIN/scripts/cdp.mjs" '
for (const id of ["250", "251", "252", "253", "254", "255"]) {
    await window.lucyd.invoke("storage:savePage", { profile: "Default", id, page: { buttons: {} } });
}
const plan = await window.lucyd.invoke("sync:reconcile", {});
if (!plan.ok) return plan;
const sync = window.lucyd.invoke("sync:execute", { plan: plan.data, allowRemovals: false });
const deleted = await window.lucyd.invoke("delete:page", { profile: "Default", id: "250" });
const wrote = await window.lucyd.invoke("usb:setActiveProfile", { name: "Default" });
return { deleted, wrote, sync: await sync };
'
```

While the sync runs, `delete` and `wrote` must report `{ ok: false, code: "DEVICE_BUSY" }` and the error must say a sync is running. The Device → Files delete button is disabled with **Wait for the sync to finish** at the same time. If either call succeeded, the sync had already finished; raise the page count and repeat.

After the sync, the lock must be free: run an ordinary write and confirm it succeeds:

```bash
node "$MAIN/scripts/cdp.mjs" 'return window.lucyd.invoke("usb:setActivePage", { id: "0" })'
```

Remove the test pages from the isolated library before the restore reconcile:

```bash
rm -f "$D/profiles/Default/"{250,251,252,253,254,255}.json
```

## 8. Restore the deck and the app

Set the active profile back before removing the test profile:

```bash
node "$MAIN/scripts/cdp.mjs" '
await window.lucyd.invoke("usb:setActiveProfile", { name: "Default" });
return window.lucyd.invoke("delete:profile", { name: "PluginPass" });
'
```

Reconcile again. The plan should have no profile removals left:

```bash
node "$MAIN/scripts/cdp.mjs" 'return window.lucyd.invoke("sync:reconcile", {})'
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
