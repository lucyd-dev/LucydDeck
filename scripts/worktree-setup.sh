#!/usr/bin/env bash
# Prepare a fresh LucydDeck worktree for agent work.
#
#   scripts/worktree-setup.sh [main-checkout]
#
# Links the main checkout's node_modules so lint, typecheck, test and build run
# immediately, then installs only what this branch adds. `npm install` without
# --package-lock=false rewrites package-lock.json (npm drops the libc fields),
# which then shows up as unrelated churn in every worktree.
set -euo pipefail

main="${1:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"

if [ ! -d node_modules ]; then
    if ! cp -al "$main/node_modules" node_modules 2>/dev/null; then
        rm -rf node_modules
        cp -a "$main/node_modules" node_modules
    fi
fi

npm install --package-lock=false --no-audit --no-fund
git config core.hooksPath .githooks

echo "worktree ready; commit messages are checked by .githooks/commit-msg"
