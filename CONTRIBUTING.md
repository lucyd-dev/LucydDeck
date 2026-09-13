# Contributing to LucydDeck

Thanks for your interest in contributing! This project uses a conventional
workflow: every commit must follow the [Conventional Commits][cc] specification,
and commit messages are linted by CI on every pull request.

## Conventional Commits

Commit messages must be formatted as:

```
<type>[optional scope]: <description>

[optional body]
```

Allowed types:

| Type        | Purpose                                                          |
| ----------- | ---------------------------------------------------------------- |
| `feat:`     | A new feature. Triggers a minor bump (pre-1.0: `0.2.0`, etc.).   |
| `fix:`      | A bug fix. Triggers a patch bump (`0.1.1`, etc.).                |
| `perf:`     | A performance improvement.                                       |
| `revert:`   | Reverts a previous commit.                                       |
| `docs:`     | Documentation only.                                              |
| `refactor:` | Code change that neither fixes a bug nor adds a feature.         |
| `ci:`       | Changes to CI configuration and scripts.                         |
| `build:`    | Changes that affect the build system or dependencies.            |
| `test:`     | Adding or correcting tests.                                      |
| `style:`    | Formatting, whitespace, missing semicolons (no behavior change). |
| `chore:`    | Other changes that do not modify source or test files.           |

Examples:

```
feat(usb): add HID frame sequence validation
fix: handle device disconnect during file transfer
ci: cache electron-builder binaries across jobs
docs: document the ESP32-S3 bootloader provenance
```

Release notes are generated automatically from these commit messages by
[release-please][release-please]. Types marked as hidden in
`config/release-please-config.json` (e.g. `docs`, `ci`, `chore`) still count toward
version bumps but do not appear as changelog sections.

### Rules

- Use the present tense and imperative mood: `fix: correct page index math`,
  not `fix: fixed page index math` or `fix: fixes page index math`.
- Keep the summary line under ~72 characters.
- A `!` after the type/scope (`feat!:`) forces a major bump — **do not use it**.
  This project is pre-1.0 and never introduces a major version.

## Development

```bash
npm install
npm run dev          # start the Vite + Electron dev environment
npm run lint         # ESLint (flat config, --max-warnings=0)
npm run typecheck    # vue-tsc --noEmit
npm run build        # typecheck + production renderer build
npm run dist         # package for all platforms
```

## Workflow

1. Branch off `main` (e.g. `feature/my-change`).
2. Make small, focused commits following Conventional Commits.
3. Open a pull request to `main`. CI runs lint, typecheck, and a build/package
   matrix on Ubuntu, Windows, and macOS, and commitlint validates your commit
   messages.

[cc]: https://www.conventionalcommits.org/en/v1.0.0/
[release-please]: https://github.com/googleapis/release-please
