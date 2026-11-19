#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:?repository root required}"
OUTPUT="${2:?archive path required}"
cd "$ROOT"
tar -czf "$OUTPUT" \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./.nuxt" \
    --exclude="./.output" \
    --exclude="./.agent" \
    --exclude="./web/.output" \
    --exclude="./web/node_modules" \
    --exclude="./evals/corpus" \
    --exclude="*.env" \
    --exclude="*.env.*" \
    --exclude="./web/data.db*" \
    --exclude="./.agent*" \
    .
sha256sum "$OUTPUT"
