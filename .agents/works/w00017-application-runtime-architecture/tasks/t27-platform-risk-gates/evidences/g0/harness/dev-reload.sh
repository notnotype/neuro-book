#!/usr/bin/env bash
# 用法：dev-reload.sh <新修订号> <被修改的文件: route|deep>
# 修改一个服务端文件触发 Nitro 热重载，轮询直到路由返回新修订，然后打印事件时间线与 lease 状态。
set -u
SCR=/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad
APP=$SCR/g0-wt/packages/neuro-book
REV=$1
KIND=${2:-route}
EVENTS=$SCR/g0-state/dev/g0-events.jsonl
before=$(wc -l < "$EVENTS")
echo "== reload to $REV via $KIND at $(date -u +%H:%M:%S.%3N)"
if [ "$KIND" = route ]; then
  sed -i -E "s/const G0_ROUTE_REVISION = \"[^\"]+\";/const G0_ROUTE_REVISION = \"$REV\";/" "$APP/server/api/g0/probe.get.ts"
else
  # 修改被入口/插件/路由共同导入的深层模块
  sed -i -E "s/^\/\/ g0-deep-revision:.*$//" "$APP/server/g0/probe.ts"
  echo "// g0-deep-revision: $REV" >> "$APP/server/g0/probe.ts"
  sed -i -E "s/const G0_ROUTE_REVISION = \"[^\"]+\";/const G0_ROUTE_REVISION = \"$REV\";/" "$APP/server/api/g0/probe.get.ts"
fi
for i in $(seq 1 120); do
  body=$(curl -s --max-time 5 http://127.0.0.1:3311/api/g0/probe || true)
  if echo "$body" | grep -q "\"routeRevision\": \"$REV\""; then break; fi
  sleep 0.5
done
echo "$body" | tr -d '\n' | sed 's/  */ /g'; echo
sleep 3
echo "-- events since edit:"
tail -n +$((before + 1)) "$EVENTS" | bun -e 'const lines=(await Bun.stdin.text()).trim().split("\n").filter(Boolean); for (const l of lines){const e=JSON.parse(l); const {at,mono,pid,threadId,devWorkerId,event,phase,...rest}=e; console.log(at.slice(11), "worker="+devWorkerId, "thread="+threadId, event, phase, Object.keys(rest).length?JSON.stringify(rest):"");}'
echo "-- lease lock: $(ls -d $SCR/g0-state/dev/workspace/.nbook/agent/migrations/runtime.lease.lock 2>/dev/null || echo absent)"
echo "-- lease owner: $(cat $SCR/g0-state/dev/workspace/.nbook/agent/migrations/runtime.lease 2>/dev/null | tr -d '\n ' )"
