# Build your first plugin

A plugin adds commands to LucydDeck. Install it once, then use its commands on any key. The app runs the command on your PC when the deck runs that key's `CMD:` step.

This guide builds a small plugin, installs it, puts it on a key and adds one setting. The full API is in [Plugin API](plugin-api.md).

## What a plugin is

A plugin is a folder with these files:

- `plugin.json`, the manifest
- `main.mjs`, the code the app starts
- optional files such as an icon or your own modules

The app copies the folder into its data directory and starts `main.mjs` in its own process. It does not run `npm install`, so ship every file the plugin needs. Native `.node` files are not supported.

## 1. Make the folder

Create a folder named `hello` with two files:

```
hello/
  plugin.json
  main.mjs
```

Name the folder after the handle. The app installs it as `plugins/<handle>/`.

## 2. Write plugin.json

```json
{
    "apiVersion": 1,
    "handle": "hello",
    "name": "Hello",
    "version": "1.0.0",
    "description": "My first LucydDeck plugin.",
    "main": "main.mjs"
}
```

- `apiVersion` is the host API version. This build accepts `1`.
- `handle` is the plugin id. Use 2 to 32 lowercase letters, digits, `-` or `_`, starting with a letter.
- `name` is what people see in the app.
- `version` is three numbers, such as `1.0.0`.
- `main` is the entry file and must end in `.mjs`.

Add an `icon` field later if you want a picture in the app. A PNG, JPEG or WebP up to 256 KB works.

## 3. Write main.mjs

```js
export async function setup(context) {
    context.log("info", "Hello plugin started");

    context.registerCommand("greet", {
        title: "Say hello",
        handler: async () => {
            context.log("info", "Hello from my plugin");
        },
    });
}
```

`setup` runs once when the plugin starts. Register commands there. Command names use the same lowercase grammar as handles. This command becomes the action `CMD:hello:greet`.

A handler takes no arguments. The deck does not send the key, page or profile, so two keys that run the same command are identical.

The deck does not wait for the handler. Keep it quick and log what happened. Add `teardown` to close connections when the plugin stops:

```js
export async function teardown() {
    // close sockets, files or timers here
}
```

## 4. Install it

1. Open **Plugins**.
2. Choose **Install plugin**.
3. Pick the `hello` folder.
4. Read the warning and confirm.

The plugin should show **Running**. If it shows **Failed**, open its error and fix the code. The app log has the detail under `[plugin:hello]`; **Settings** opens the logs folder.

## 5. Put it on a key

1. Open **Deck**.
2. Select a key.
3. Choose **Add Action**.
4. Open the **Hello** row and pick **Say hello**.
5. Sync the page to the deck.
6. Press the key.

The app logs `Hello from my plugin`. Nothing visible happens on the deck because this example only logs. That is the point of the first test.

You can also test without the deck. Open **Plugins**, choose **Commands**, and press **Run** next to the command. The result appears in the dialog.

## 6. Add a setting

Most plugins need a token, a path or a choice. Add a config field to the manifest:

```json
{
    "apiVersion": 1,
    "handle": "hello",
    "name": "Hello",
    "version": "1.0.0",
    "description": "My first LucydDeck plugin.",
    "main": "main.mjs",
    "configFields": [
        {
            "key": "greeting",
            "label": "Greeting",
            "kind": "text",
            "description": "The words the plugin logs.",
            "default": "Hello",
            "required": true
        }
    ]
}
```

Read the value in `setup`:

```js
export async function setup(context) {
    const { greeting } = context.getConfig();

    context.registerCommand("greet", {
        title: "Say hello",
        handler: async () => {
            context.log("info", `${greeting} from my plugin`);
        },
    });
}
```

The app shows these fields under **Configure**. Saving settings restarts the plugin, so read them during `setup`. The supported kinds are `text`, `textarea`, `number`, `boolean`, `select` and `secret`. A `select` field also needs an `options` list. Secret values are masked in the app but stored unencrypted on the computer.

## 7. Keep files between runs

`context.dataDir` is a folder the app creates for your plugin. Store state there:

```js
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function setup(context) {
    const file = path.join(context.dataDir, "state.json");
    await writeFile(file, "{}", "utf8");
    // register commands here as before
}
```

Removing the plugin removes this folder together with its settings.

## 8. Handle errors

Throw an error when a command cannot do its job:

```js
handler: async () => {
    throw new Error("Discord is not running");
};
```

A manual **Run** shows the message. A deck press logs it and the deck continues. If the plugin process crashes, the app restarts it a few times, then shows **Failed** with a **Retry** button.

## 9. Replace and remove

To update a plugin, install a folder with the same handle and confirm **Replace**. The app keeps its settings, data and enabled state.

To remove a plugin, use the trash button on its row. The app warns about pages that use its commands, then deletes the plugin and its settings.

## Where to go next

- [Plugin API](plugin-api.md) has every manifest field, context member, config kind, limit and routing rule.
- [examples/plugins/hello](../examples/plugins/hello) is a complete plugin with two commands and one setting.
- The **Commands** dialog in the Plugins view runs a handler without a key.

Plugins run with the same access as the app. They can read and write files, use the network and start programs. Install only code you trust.
