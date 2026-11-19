#!/usr/bin/env bash
set -Eeuo pipefail

NODE_VERSION="${NODE_VERSION:-22.14.0}"
NODE_ROOT="/opt/node-v${NODE_VERSION}-linux-x64"
NODE_ARCHIVE="/tmp/node-v${NODE_VERSION}-linux-x64.tar.xz"
if [[ ! -x "$NODE_ROOT/bin/node" ]]; then
    curl --fail --silent --show-error --location "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" --output "$NODE_ARCHIVE"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
        | awk -v file="node-v${NODE_VERSION}-linux-x64.tar.xz" '$2 == file {print $1 "  " $2}' \
        | (cd /tmp && sha256sum --check -)
    tar -xJf "$NODE_ARCHIVE" -C /opt
    rm -f "$NODE_ARCHIVE"
fi
ln -sfn "$NODE_ROOT" /opt/node
if [[ ! -x /usr/bin/node ]]; then
    ln -s /opt/node/bin/node /usr/bin/node
fi
if [[ ! -x /usr/bin/npm ]]; then
    ln -s /opt/node/bin/npm /usr/bin/npm
fi
node --version
