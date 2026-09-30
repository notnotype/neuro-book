#!/usr/bin/env bash
# 在隔离的无头 KWin 中运行 webkitgtk-run.py，结束时停止 KWin。用法：webkitgtk-run.sh <url> <label>
set -u
URL="$1"; LABEL="$2"
SP=/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad
RUNTIME=/tmp/claude-1000/g1x
OUT="$SP/g1-out"
mkdir -p "$RUNTIME" "$SP/g1-kwin-config" "$OUT/results"
chmod 700 "$RUNTIME"
rm -f "$RUNTIME/g1-wl" "$RUNTIME/g1-wl.lock"
env -u DISPLAY -u WAYLAND_DISPLAY XDG_RUNTIME_DIR="$RUNTIME" XDG_CONFIG_HOME="$SP/g1-kwin-config" KDE_DEBUG=1 \
  dbus-run-session -- kwin_wayland --virtual --no-lockscreen --no-global-shortcuts --socket g1-wl --width 1280 --height 900 \
  > "$OUT/kwin-$LABEL.log" 2>&1 &
KWIN_PID=$!
for _ in $(seq 1 50); do [ -S "$RUNTIME/g1-wl" ] && break; sleep 0.2; done
env -u DISPLAY XDG_RUNTIME_DIR="$RUNTIME" WAYLAND_DISPLAY=g1-wl GDK_BACKEND=wayland \
  timeout 300 python3 "$SP/g1-test/webkitgtk-run.py" "$URL" "$OUT/results/$LABEL.json" > "$OUT/results-$LABEL.log" 2>&1
kill "$KWIN_PID" 2>/dev/null
pkill -TERM -f -- "--socket g1-wl"
for _ in $(seq 1 25); do pgrep -f -- "--socket g1-wl" > /dev/null || break; sleep 0.2; done
pkill -KILL -f -- "--socket g1-wl"
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  if { tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null | grep -qx "XDG_RUNTIME_DIR=$RUNTIME"; then kill -9 "$pid" 2>/dev/null; fi
done
echo "cleanup: kwin-left=$(pgrep -f -- '--socket g1-wl' | wc -l)"
python3 - "$OUT/results/$LABEL.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if "fatal" in d: print("FATAL", d["fatal"][:500])
for k, v in d.get("checks", {}).items(): print(("PASS" if v["pass"] else "FAIL"), k, json.dumps(v["detail"], ensure_ascii=False)[:220])
print("negative", json.dumps(d.get("negative"), ensure_ascii=False))
print("pageErrors", d.get("pageErrors"), "webkitgtk", d.get("webkitgtk"))
PY
