#!/usr/bin/env bash
# 用 omp 的 eval 加 browser 全局对象跑一个实验任务：一次性会话、隔离的空工作目录、yolo（浏览器动作不弹确认）。
# 用法：run_omp.sh <模型> <任务文件> <输出目录>
set -u
model=$1; task=$2; out=$3
mkdir -p "$out/cwd" "$out/session"
prompt="$(cat "$task")

（实验约束：用 eval 里的 browser 全局对象，开一个新的托管浏览器标签页，不要用 relay 或用户自己的浏览器；不要改动工作目录以外的文件。）"
start=$(date +%s)
omp -p --mode json --cwd "$out/cwd" --session-dir "$out/session" --model "$model" --thinking medium \
  --approval-mode yolo --max-time 20m "$prompt" < /dev/null > "$out/events.jsonl" 2> "$out/stderr.txt"
code=$?
echo "{\"exit\": $code, \"seconds\": $(( $(date +%s) - start ))}" > "$out/summary.json"
exit $code
