#!/usr/bin/env bash
# G1 Electron 运行器：在隔离的无头 KWin（私有 DBus、私有配置目录、短 XDG_RUNTIME_DIR）里启动
# Electron 43，用 CDP 端口跑 g1-verify.mjs 与 g1-heap.mjs，结束时停止本脚本启动的全部进程。
# 用法：electron-run.sh <url> <label>
set -u
URL="$1"; LABEL="$2"
SP=/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad
RUNTIME=/tmp/claude-1000/g1x
OUT="$SP/g1-out"
mkdir -p "$RUNTIME" "$SP/g1-kwin-config" "$OUT/results" "$OUT/heap"
chmod 700 "$RUNTIME"
rm -f "$RUNTIME/g1-wl" "$RUNTIME/g1-wl.lock"
env -u DISPLAY -u WAYLAND_DISPLAY XDG_RUNTIME_DIR="$RUNTIME" XDG_CONFIG_HOME="$SP/g1-kwin-config" KDE_DEBUG=1 \
  dbus-run-session -- kwin_wayland --virtual --no-lockscreen --no-global-shortcuts --socket g1-wl --width 1280 --height 900 \
  > "$OUT/kwin-$LABEL.log" 2>&1 &
KWIN_PID=$!
for _ in $(seq 1 50); do [ -S "$RUNTIME/g1-wl" ] && break; sleep 0.2; done
cd "$SP/g1-electron"
env -u DISPLAY XDG_RUNTIME_DIR="$RUNTIME" WAYLAND_DISPLAY=g1-wl G1_URL="about:blank" G1_CDP_PORT=9431 \
  ./node_modules/.bin/electron main.cjs --ozone-platform=wayland --no-sandbox > "$OUT/electron-$LABEL.log" 2>&1 &
ELECTRON_PID=$!
for _ in $(seq 1 100); do curl -s --max-time 1 http://127.0.0.1:9431/json/version > /dev/null && break; sleep 0.2; done
cd "$SP/g1-test"
export G1_PLAYWRIGHT_FROM="$SP/g1-wt/package.json"
node g1-verify.mjs --url "$URL" --browser cdp --cdp http://127.0.0.1:9431 --label "$LABEL" --out "$OUT/results" > "$OUT/results-$LABEL.log" 2>&1
for a in cjs esm; do
  node g1-heap.mjs --url "$URL" --approach "$a" --interact full --cdp http://127.0.0.1:9431 --out "$OUT/heap/$LABEL-$a-full.json" >> "$OUT/results-$LABEL.log" 2>&1
done
kill "$ELECTRON_PID" 2>/dev/null
kill "$KWIN_PID" 2>/dev/null
pkill -TERM -f -- "--socket g1-wl"
for _ in $(seq 1 25); do pgrep -f -- "--socket g1-wl" > /dev/null || break; sleep 0.2; done
pkill -KILL -f -- "--socket g1-wl"
kill -9 "$ELECTRON_PID" 2>/dev/null
echo "cleanup: kwin-left=$(pgrep -f -- '--socket g1-wl' | wc -l) electron-left=$(kill -0 "$ELECTRON_PID" 2>/dev/null && echo 1 || echo 0)"
# kwin 可能拉起脱离进程树的子进程；按私有 XDG_RUNTIME_DIR 找回并停止（kwin 自身带 capability，environ 不可读，已在上面按 pid 停止）。
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if { tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null | grep -qx "XDG_RUNTIME_DIR=$RUNTIME"; then kill -9 "$pid" 2>/dev/null; fi
done
grep -E "^(FAIL|INFO|SUMMARY|FATAL)|\"approach\"" "$OUT/results-$LABEL.log" | cut -c1-300
