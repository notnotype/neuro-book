#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE="${1:?source archive required}"
RELEASE_ID="${2:?release id required}"
RELEASE_ROOT="/srv/llmlint/releases/${RELEASE_ID}"
CURRENT_LINK="/srv/llmlint/current"

install -d -m 0755 -o llmlint -g llmlint "$RELEASE_ROOT"
tar -xzf "$ARCHIVE" -C "$RELEASE_ROOT"
chown -R llmlint:llmlint "$RELEASE_ROOT"
sudo -u llmlint /usr/local/sbin/llmlint-build-release "$RELEASE_ROOT"
ln -sfn "$RELEASE_ROOT" "$CURRENT_LINK"
chown -h llmlint:llmlint "$CURRENT_LINK"
systemctl daemon-reload
systemctl enable llmlint-web.service
systemctl restart llmlint-web.service
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3020/api/health >/dev/null; then
        systemctl --no-pager --full status llmlint-web.service | sed -n '1,12p'
        printf 'release=%s\n' "$RELEASE_ID"
        exit 0
    fi
    sleep 2
done
journalctl -u llmlint-web.service -n 100 --no-pager >&2
exit 1
