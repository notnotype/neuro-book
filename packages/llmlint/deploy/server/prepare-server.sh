#!/usr/bin/env bash
set -Eeuo pipefail

install -d -m 0755 /srv/llmlint
if ! id -u llmlint >/dev/null 2>&1; then
    useradd --system --home-dir /srv/llmlint --shell /usr/sbin/nologin llmlint
fi
install -d -m 0755 -o llmlint -g llmlint /srv/llmlint/releases /srv/llmlint/data /srv/llmlint/logs /srv/llmlint/runtime
if [[ -e /srv/llmlint/current && ! -L /srv/llmlint/current ]]; then
    mv /srv/llmlint/current "/srv/llmlint/releases/bootstrap-$(date -u +%Y%m%dT%H%M%SZ)"
fi
install -d -m 0755 -o llmlint -g llmlint /srv/llmlint/current
install -d -m 0755 -o root -g root /var/www/neuro-book-site-acme/.well-known/acme-challenge
if [[ ! -e /srv/llmlint/runtime/eval.config.json ]]; then
    printf '{}\n' >/srv/llmlint/runtime/eval.config.json
fi
chown llmlint:llmlint /srv/llmlint/runtime/eval.config.json
chmod 0640 /srv/llmlint/runtime/eval.config.json
printf 'prepared /srv/llmlint\n'
