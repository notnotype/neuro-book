#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_ROOT="${1:?release root required}"
cd "$RELEASE_ROOT"
export DATABASE_URL="${DATABASE_URL:-file:/srv/llmlint/data/data.db}"
export NUXT_EVAL_CONFIG_PATH="${NUXT_EVAL_CONFIG_PATH:-/srv/llmlint/runtime/eval.config.json}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
bun install --frozen-lockfile
cd web
bun install --frozen-lockfile
bun run db:init
bun run db:generate
bun run build
node --version
bun --version
printf 'built=%s\n' "$RELEASE_ROOT"
