# Action picker rows come from installed plugins

The picker carried four hardcoded plugin rows (Discord, OBS, Spotify, Other plugins) that never had commands, so every one of them opened a pane saying the plugin runtime was missing. Rows now come from plugin registrations: the reserved registry hook returns `{ handle, label, commands }` per installed plugin, the picker always shows Deck and System, shows one row per installed plugin even when it registers no commands, and has no "Other plugins" row. The plugin supplies its own label when it registers.

## Considered options

- Keep the hardcoded names as placeholders until plugins landed, which advertises actions the build cannot run.
- Build rows from registered commands, which labels a plugin by its handle and cannot show an installed plugin that offers nothing yet.
- Feed the picker a separate installed-plugin list beside the command types, which allows a command to arrive for a handle with no row.

## Consequences

- Grouping by handle stays, but the label no longer comes from the handle.
- A provider with no actions reads "No actions in this provider." and its count cell shows `—`.

## Amendment

ADR 0007 moves the label to the plugin manifest's `name`. A plugin no longer supplies it when it registers, because a disabled plugin never runs `setup` and the picker still needs a label for its row.
