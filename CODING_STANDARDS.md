# Coding standards

Read this during review. Implementation sessions write to these standards, but the review agent enforces them.

## UI copy

Normal app UI speaks to the person using the app. It names what they do, not how the app is built.

- Developer detail belongs in `docs/plugin-api.md`, `docs/plugin-development.md` or an ADR.
- Do not show `CMD:`, plugin handles, `plugin.json` or `main.mjs`, API versions, config field counts, process or restart wording in the normal UI.
- Keep security and consent copy: plugin trust, unencrypted secrets, what a removal deletes.
- Use the user's words for states: Running, Failed, Commands, Settings.

## Prototypes

Prototypes are design inputs, not product artifacts.

- Live on `prototype/<name>` branches, never on `main`.
- Do not add prototype files or prototype scripts to `main`. CI rejects a tracked `prototype/`.
- Fold the chosen design into the real code, record the decision in the ticket, then remove the prototype branch and worktree.

## Docs

For a developer-facing surface, ship a tutorial and a reference.

- The tutorial takes a new author from nothing to a working example. It links to the reference.
- The reference covers every field, limit and error. It links back to the tutorial.
- The tutorial uses the tested example, so guide code and example code cannot drift.
- README and `AGENTS.md` point at the tutorial first.

## Review

- Check the UI copy rule on every changed screen.
- Check the docs pair for a new developer surface.
- Check that no `prototype/` is tracked on `main`.
- Keep security and consent copy intact, even when simplifying the rest.
