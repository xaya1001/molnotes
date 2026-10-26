#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if [[ ! -x node_modules/.bin/lint-staged ]]; then
  printf 'install dependencies first with npm ci\n' >&2
  exit 1
fi

if [[ ! -x .githooks/pre-commit ]]; then
  printf 'project pre-commit hook is missing\n' >&2
  exit 1
fi

if [[ "$(git rev-parse --path-format=absolute --git-dir)" != "$(git rev-parse --path-format=absolute --git-common-dir)" ]]; then
  printf 'install Git hooks from the canonical checkout\n' >&2
  exit 1
fi

worktree_count="$(git worktree list --porcelain | awk '$1 == "worktree" { count++ } END { print count }')"
if [[ "${worktree_count}" != "1" ]]; then
  printf 'install Git hooks after task worktrees have been removed\n' >&2
  exit 1
fi

git config --local core.hooksPath .githooks
printf 'Git hooks installed from .githooks\n'
