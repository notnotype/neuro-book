#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="${1:?source archive required}"
RELEASE_ID="${2:?release id required}"
RELEASE_ROOT="/srv/llmlint/releases/${RELEASE_ID}"
install -d -m 0755 -o llmlint -g llmlint "$RELEASE_ROOT"
tar -xzf "$ARCHIVE" -C "$RELEASE_ROOT"
chown -R llmlint:llmlint "$RELEASE_ROOT"
cd "$RELEASE_ROOT"
export DATABASE_URL="${DATABASE_URL:-file:/srv/llmlint/data/data.db}"
export NUXT_EVAL_CONFIG_PATH="${NUXT_EVAL_CONFIG_PATH:-/srv/llmlint/runtime/eval.config.json}"
sudo -u llmlint /usr/local/sbin/llmlint-build-release "$RELEASE_ROOT"
ln -sfn "$RELEASE_ROOT" /srv/llmlint/current
chown -h llmlint:llmlint /srv/llmlint/current
printf 'release=%s\n' "$RELEASE_ID"
