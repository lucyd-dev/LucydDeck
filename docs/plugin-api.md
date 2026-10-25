# Plugin API

A plugin adds host-side commands to a LucydDeck key. A step written `CMD:<handle>:<command>` reaches the plugin's handler while the deck runs the sequence. The deck sends the command and keeps going; it does not wait for the result.

New to plugins? Start with [Build your first plugin](plugin-development.md).

## What a plugin is

A plugin is a folder the user installs from disk. The app copies it to `plugins/<handle>/` in the data folder and starts `main.mjs` in its own process.

```
hello/
├── plugin.json
├── main.mjs
├── icon.png
└── data/          created by the host, not part of the install
```

The host installs no dependencies. Ship everything the plugin needs inside the folder. `.node` files are rejected at install. A plugin still runs with the app's privileges, so it can fetch or build code at runtime, but the host does not support that.

## plugin.json

| Field          | Required | Meaning                                                             |
| -------------- | -------- | ------------------------------------------------------------------- |
| `apiVersion`   | yes      | Host API version. `1` is the only value this build accepts.         |
| `handle`       | yes      | Plugin id, used in the folder name and in `CMD:<handle>:<command>`. |
| `name`         | yes      | Label in the picker and the Plugins view.                           |
| `version`      | yes      | Three numeric parts separated by dots, such as `1.2.3`.             |
| `description`  | no       | One line under the name in the Plugins view.                        |
| `icon`         | no       | File inside the folder. PNG, JPEG or WebP, at most 256 KB.          |
| `main`         | yes      | ESM entry file inside the folder, with a `.mjs` extension.          |
| `configFields` | no       | Values the Plugins view asks the user to fill in.                   |

`handle` matches `^[a-z][a-z0-9_-]{1,31}$`. It is the plugin's identity everywhere. A replace must use the same handle.

```json
{
    "apiVersion": 1,
    "handle": "hello",
    "name": "Hello",
    "version": "1.0.0",
    "description": "A minimal example plugin.",
    "icon": "icon.png",
    "main": "main.mjs",
    "configFields": [
        {
            "key": "greeting",
            "label": "Greeting",
            "kind": "text",
            "default": "Hello",
            "required": true
        }
    ]
}
```

A manifest that fails validation is refused at install with the reason.

## Entry module

The entry exports `setup` and may export `teardown`. It can import other files from the plugin folder with relative paths.

```js
export async function setup(context) {
    context.registerCommand("greet", {
        title: "Say hello",
        handler: async () => {
            const { greeting } = context.getConfig();
            context.log("info", `${greeting} from hello`);
        },
    });
}

export async function teardown() {
    // Close connections here. The host allows two seconds.
}
```

`setup` runs once when the plugin starts. `teardown` runs before disable, remove, a config save and quit. A plugin whose `setup` throws, or takes longer than five seconds, is marked failed.

`registerCommand` may only be called during `setup`. A second registration with the same name throws and fails setup.

## Context

| Member                                              | Meaning                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| `context.handle`                                    | The plugin handle.                                                 |
| `context.version`                                   | The manifest version.                                              |
| `context.dataDir`                                   | Absolute path to `plugins/<handle>/data/`, created before `setup`. |
| `context.getConfig()`                               | Current config values, as a plain object keyed by field.           |
| `context.registerCommand(name, { title, handler })` | Register one command. `title` is optional.                         |
| `context.log(level, message)`                       | `debug`, `info`, `warn` or `error`. Goes to the app log.           |

A handler takes no arguments, may return a promise, and runs one at a time per plugin. Errors are caught and logged, and the Plugins view shows them when a command is run by hand. A handler that exceeds ten seconds frees the queue and keeps running; the host does not kill it.

Command names match the handle grammar. The command's label in the picker is `title` when given, otherwise `<handle>:<command>`.

## Config

`configFields` entries have these keys.

| Field         | Required     | Meaning                                                                               |
| ------------- | ------------ | ------------------------------------------------------------------------------------- |
| `key`         | yes          | Value name in `getConfig()`. Letters, digits and underscores, starting with a letter. |
| `label`       | yes          | Form label.                                                                           |
| `kind`        | yes          | `text`, `textarea`, `number`, `boolean`, `select`, `secret`.                          |
| `description` | no           | Help line under the field.                                                            |
| `required`    | no           | Reject an empty value. Defaults to false.                                             |
| `default`     | no           | Value used when none is stored.                                                       |
| `options`     | for `select` | Array of `{ "value": "...", "label": "..." }`.                                        |

Values live in `plugins/<handle>/config.json`. A `number` field stores a number, a `boolean` field stores a boolean, and the other kinds store strings. Unknown keys are dropped when the form saves, and fields with no stored value read as their default. A default that does not match its field's kind fails install validation. Saving config restarts the plugin, so `getConfig()` always returns the values that were current when `setup` ran.

A `secret` field is masked in the form and stored as plaintext. The form says so.

## Installing

- Install picks a folder and copies it to `plugins/<handle>/`. The folder must be at most 20 MB.
- `main` and `icon` must resolve inside the folder, with no symlinks.
- A plugin with an existing handle replaces it only after a confirmation. Config, data and the enabled state are kept, and the version may go down.
- Remove stops the plugin, then deletes the folder, including `config.json` and `data/`. The confirmation names up to three pages that run its commands, scanned across every profile.

## Status and limits

A plugin is `stopped` when disabled, `starting` while `setup` runs, `running` once it resolves, and `failed` after a setup error or three failed restarts.

| Limit                  | Value                             |
| ---------------------- | --------------------------------- |
| setup                  | 5 seconds                         |
| teardown               | 2 seconds                         |
| pending commands       | 16, newest dropped when full      |
| handler                | 10 seconds before the queue frees |
| restarts after an exit | 3, at 1s, 2s and 4s               |

## Routing

The deck sends the CMD body with the prefix removed, so `CMD:hello:greet` arrives as `hello:greet`. The host splits at the first colon. Anything else is dropped with a rate-limited toast: a body with no colon, an unknown handle, an unregistered command, or a plugin that is stopped or failed. Commands that arrive while a plugin is starting wait in its queue. There is no shell fallback.

An event carries no key, page or profile. A handler cannot tell which key was pressed, and two keys that run the same command are indistinguishable.

## Debugging

The Plugins view shows each plugin's status and last error, its registered commands, and a Run button for each command. That button calls the same path as a deck press. Logs go to the app log with a `[plugin:<handle>]` prefix; Settings has a button that opens the logs folder. There is no log viewer yet.

## Security

A plugin runs with the same privileges as the app. It can read and write files, make network requests, start processes, and read every other plugin's config. Installation is a trust decision, and the confirmation says so. The separate process contains crashes; it is not a security boundary.

## Example

`examples/plugins/hello` is a complete plugin with one config field, a command that logs, and a command that throws.
