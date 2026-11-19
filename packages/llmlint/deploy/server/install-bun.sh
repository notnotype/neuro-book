#!/usr/bin/env bash
set -Eeuo pipefail

BUN_VERSION="${BUN_VERSION:-1.3.14}"
BUN_ROOT="/opt/bun-v${BUN_VERSION}"
BUN_ARCHIVE="/tmp/bun-linux-x64.zip"
if [[ ! -x "$BUN_ROOT/bun" ]]; then
    command -v unzip >/dev/null || { echo 'unzip is required' >&2; exit 1; }
    curl --fail --silent --show-error --location "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" --output "$BUN_ARCHIVE"
    rm -rf "$BUN_ROOT" /tmp/bun-linux-x64
    unzip -q "$BUN_ARCHIVE" -d /tmp
    install -d -m 0755 "$BUN_ROOT"
    install -m 0755 /tmp/bun-linux-x64/bun "$BUN_ROOT/bun"
    rm -rf /tmp/bun-linux-x64 "$BUN_ARCHIVE"
fi
ln -sfn "$BUN_ROOT/bun" /usr/local/bin/bun
bun --version
