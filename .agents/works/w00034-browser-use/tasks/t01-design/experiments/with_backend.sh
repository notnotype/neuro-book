#!/usr/bin/env bash
# 起假作家后台（端口 8765，提交记到 $1），跑完后面的命令再按记下的 PID 停掉后台。
set -u
log=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
python3 -I "$here/author-backend/server.py" 8765 "$log" > "$log.server.txt" 2>&1 &
pid=$!
sleep 1
"$@"
code=$?
kill "$pid"
exit $code
