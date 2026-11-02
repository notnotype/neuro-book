#!/usr/bin/env bash
# w00039 t09：作者用 Git 管作品、每记完一章提交一次时，修订日志让 .git 涨多少（evidences/disk-growth.txt）。
# 用 log-scale.ts 生成 <章数> 章的日志（第 1 行是开局，之后每章 3 行），在临时仓库里按章逐次截取、提交，
# 量 gc 前（每个改过的文件每次提交存一个完整的压缩副本）与 git gc 后（打包成增量）的 .git 大小。gc.auto 关掉：
# 默认要攒到约 6700 个零散对象才自动打包，这里 1000 次提交约 3000 个，本来也不会触发。跑完删除临时目录。
#
# 两种放法：<分段 KiB> 为 0 时日志是一个文件；大于 0 时按大小分段（写满就开新的一段，旧段不再变），
# 每次提交只有最后一两段是新内容。
#
# 文字字段从样本书原文里轮流取句（第三方素材，只读进临时目录、用完删除）：默认取 nb-story V9 数据集里前 20 章的段落，
# 可用第三个参数指定别的 dataset-v9.json。
# 用法（仓库根执行）：bash <本文件> <章数> <分段 KiB> [<dataset-v9.json>]
set -euo pipefail
chapters=${1:?章数}
segment_kib=${2:?分段 KiB，0 表示一个文件}
script_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

dataset=${3:-.local/agent/works/w00024-nb-story/tasks/t20-ingest-pipeline-fixes/regress/run-3/dataset-v9.json}
python3 -c 'import json, sys; [print(p) for s in json.load(open(sys.argv[1], encoding="utf-8"))["sources"] for p in s["paragraphs"]]' "$dataset" > "$work/pool.txt"
TEXT_POOL="$work/pool.txt" KEEP_LOG="$work/full.jsonl" bun "$script_dir/log-scale.ts" "$chapters" > /dev/null
repo="$work/repo"
git init -q "$repo"
git -C "$repo" config user.name t09
git -C "$repo" config user.email t09@example.invalid
git -C "$repo" config gc.auto 0

python3 - "$work/full.jsonl" "$repo" "$chapters" "$segment_kib" <<'EOF'
import os, subprocess, sys
full, repo, chapters, segment_kib = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
lines = open(full, "rb").read().splitlines(keepends=True)
# 每行属于哪一段：从头贪心切，前缀变长时前面的段不变。
segment_of, current, size = [], 0, 0
for line in lines:
    if segment_kib > 0 and size > 0 and size + len(line) > segment_kib * 1024:
        current, size = current + 1, 0
    segment_of.append(current)
    size += len(line)
path = lambda s: os.path.join(repo, "log.jsonl" if segment_kib == 0 else f"log/{s:06d}.jsonl")
if segment_kib > 0:
    os.makedirs(os.path.join(repo, "log"))
written_through = 0  # 已写到第几行（不含）
for n in range(1, chapters + 1):
    end = 1 + 3 * n
    # 只重写这次有新行的段：从上次最后一行所在的段到这次最后一行所在的段。
    first = segment_of[max(written_through - 1, 0)]
    for s in range(first, segment_of[end - 1] + 1):
        with open(path(s), "wb") as f:
            f.writelines(line for line, seg in zip(lines[:end], segment_of[:end]) if seg == s)
    written_through = end
    subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
    subprocess.run(["git", "-C", repo, "commit", "-q", "-m", f"第 {n} 章"], check=True)
EOF

log_bytes=$(cat "$work/full.jsonl" | wc -c)
gzip_bytes=$(gzip -c "$work/full.jsonl" | wc -c)
before=$(du -sb "$repo/.git" | cut -f1)
git -C "$repo" gc -q --aggressive
after=$(du -sb "$repo/.git" | cut -f1)
files=$(git -C "$repo" ls-files | wc -l)
mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1024 / 1024 }'; }
layout=$([ "$segment_kib" = 0 ] && echo "一个文件" || echo "按 ${segment_kib} KiB 分段（${files} 段）")
echo "$chapters 章，$layout：日志 $(mb "$log_bytes")（gzip 后 $(mb "$gzip_bytes")）；提交 $chapters 次后 .git：gc 前 $(mb "$before")，git gc 后 $(mb "$after")"
