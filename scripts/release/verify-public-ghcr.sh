#!/usr/bin/env bash
set -euo pipefail

manager_version="$1"
candidate_manifest="$2"
root="$3"
port="$4"
engine="$5"
manifest="$root/.deploy/installation.json"
compose_path="$root/.deploy/docker-compose.generated.yml"
manager_home="${root}-manager"
manager_cwd="${manager_home}/bunx"
state_root=""

channel="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.channel)' "$candidate_manifest")"
export NEURO_BOOK_CONTAINER_ENGINE="$engine"
export NEURO_BOOK_MANAGER_CONFIG="${manager_home}/config.json"
export NO_COLOR=1
if [[ "$engine" == "podman" ]]; then
    export PODMAN_COMPOSE_PROVIDER="podman-compose"
fi

manager() {
    # 仓库自身也是同名 Bun workspace；必须在空目录运行，确保消费 npm 公开包而不是 Source workspace。
    (cd "$manager_cwd" && bunx --bun "@notnotype/neuro-book-manager@${manager_version}" "$@")
}

resolve_state_root() {
    bun --no-install --no-env-file scripts/release/installation-state-root.ts "$root"
}

compose() {
    [[ -n "$state_root" ]] || { echo "State Root尚未解析。" >&2; return 1; }
    "$engine" compose --env-file "$state_root/.env" -f "$compose_path" "$@"
}

application_container_id() {
    if [[ "$engine" == "podman" ]]; then
        compose_working_dir="$(realpath "$root/.deploy")"
        "$engine" ps --all \
            --filter "label=com.docker.compose.project.working_dir=$compose_working_dir" \
            --filter "label=com.docker.compose.service=app" \
            --format '{{.ID}}'
    else
        compose ps --all --quiet app
    fi
}

cleanup() {
    if [[ -z "$state_root" && -f "$manifest" ]]; then
        state_root="$(resolve_state_root)" || state_root=""
    fi
    if [[ -n "$state_root" && -f "$compose_path" ]]; then
        compose down --remove-orphans || true
    fi
    rm -rf "$root" "$manager_home"
}
trap cleanup EXIT INT TERM

rm -rf "$root" "$manager_home"
mkdir -p "$manager_cwd"
manager install \
    --profile ghcr \
    --channel "$channel" \
    --release-manifest "$candidate_manifest" \
    --dir "$root" \
    --port "$port" \
    --yes

state_root="$(resolve_state_root)"
[[ -f "$state_root/.env" ]] || { echo "Manifest State Root缺少.env：$state_root" >&2; exit 1; }
manifest_engine="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.containerEngine ?? "")' "$manifest")"
[[ "$manifest_engine" == "$engine" ]] || { echo "Manifest engine错误：$manifest_engine != $engine" >&2; exit 1; }

export AUTH_ADMIN_PASSWORD="release-ghcr-password"
manager --root "$root" admin create release-ghcr-admin
unset AUTH_ADMIN_PASSWORD

base="http://127.0.0.1:${port}"
for attempt in $(seq 1 120); do
    if curl --fail --silent "$base/api/app/version" >/dev/null; then break; fi
    if [[ "$attempt" == 120 ]]; then exit 1; fi
    sleep 1
done

container_id="$(application_container_id)"
[[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]] || { echo "Product smoke容器ID非法：$container_id" >&2; exit 1; }
"$engine" exec "$container_id" bun --no-install --no-env-file .output/server/commands/product-command.mjs check all

cookie="${root}-cookie.txt"
curl --fail --silent --show-error -c "$cookie" \
    -H 'content-type: application/json' \
    -d '{"username":"release-ghcr-admin","password":"release-ghcr-password"}' \
    "$base/api/auth/login" >/dev/null
curl --fail --silent --show-error -b "$cookie" "$base/api/auth/me" >/dev/null

manager --root "$root" doctor --json > "${root}-doctor-running.json"
node -e 'const r=require(process.argv[1]); if (!r.healthy || r.checks.some((c)=>c.status === "fail")) { console.error(JSON.stringify({service:r.service,failures:r.checks.filter((c)=>c.status === "fail")}, null, 2)); process.exit(1); }' "${root}-doctor-running.json"

if [[ "$engine" == "podman" ]]; then
    container_id="$(application_container_id)"
    [[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]] || { echo "Podman app容器ID非法：$container_id" >&2; exit 1; }
    "$engine" stop --time 10 "$container_id"
else
    compose stop app
fi
manager --root "$root" doctor --json > "${root}-doctor-stopped.json"
node -e 'const r=require(process.argv[1]); if (!r.healthy || !r.checks.some((c)=>c.id === "service.application" && c.status === "warn")) { console.error(JSON.stringify({service:r.service,failures:r.checks.filter((c)=>c.status === "fail")}, null, 2)); process.exit(1); }' "${root}-doctor-stopped.json"
manager --root "$root" start

for attempt in $(seq 1 120); do
    if curl --fail --silent "$base/api/app/version" >/dev/null; then break; fi
    if [[ "$attempt" == 120 ]]; then exit 1; fi
    sleep 1
done
curl --fail --silent --show-error -b "$cookie" "$base/api/auth/me" >/dev/null

# Inject one planned Operation and let the public Manager recover it before its no-op update.
bun scripts/release/create-interrupted-operation.ts "$root"
recovery_log="${root}-recovery.log"
if ! manager --root "$root" update --channel "$channel" --release-manifest "$candidate_manifest" > "$recovery_log" 2>&1; then
    cat "$recovery_log" >&2
    exit 1
fi
node -e 'const fs=require("node:fs"); const path=require("node:path"); const root=process.argv[1]; const leftovers=[".deploy/operations/release-recovery.json", ".deploy/staging/release-recovery-marker", ".deploy/backups/release-recovery"].filter((relative)=>fs.existsSync(path.join(root, relative))); if (leftovers.length) { console.error(`Operation recovery cleanup incomplete: ${leftovers.join(", ")}`); process.exit(1); }' "$root"
