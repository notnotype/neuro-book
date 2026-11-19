#!/usr/bin/env bash
# t35 第 4 片的真实模型小抽取（plan.md 的“切片”第 4 条）：全程经产品管线（nbstory ingest），看马甲核对在真实回复下的表现。
# - 魔女学院：从 t33 的 graph-164.json 拼回前 20 章原文；关着核对抽第 1 到 16 章，再交前 20 章的原文追加第 17 到 20 章、打开核对；
# - 样例书：前 10 章开着核对抽一遍。
# 模型 gpt-6-luna（.env 的 NBOOK_LLM_*），单价按 deepseek-flash 低谷价。渠道失败重试用完时 nbstory 以 4 停下，这里接着跑同一本书，至多 8 次。
# 用法：extract-small.sh <运行名>
set -u
name="${1:?用法：extract-small.sh <运行名>}"
REPO=/home/<user>/CodeRepository/neuro-book
PKG=$REPO/.worktree/w00024-t35-persona-check/packages/nb-story
OUT=$REPO/.local/agent/works/w00024-nb-story/tasks/t35-persona-check/extract/$name
GRAPH=$REPO/.local/agent/works/w00024-nb-story/tasks/t33-graph-issue-reports/data/graph-164.json
mkdir -p "$OUT"
LOG=$OUT/ingest.log
LIB=$OUT/library
cfg() { # cfg <文件> <true|false>
    bun --env-file=$REPO/.env -e '
const [file, on] = process.argv.slice(1);
await Bun.write(file, JSON.stringify({model: {baseUrl: process.env.NBOOK_LLM_BASE_URL, id: "gpt-6-luna", apiKeyEnv: "NBOOK_LLM_API_KEY", price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"}}, ingest: {personaCheck: {enabled: on === "true"}}}, null, 2));
' "$1" "$2"
}
cfg "$OUT/config-off.json" false
cfg "$OUT/config-on.json" true
bun -e '
const [graph, out] = process.argv.slice(1);
const g = await Bun.file(graph).json();
for (const n of [16, 20]) await Bun.write(`${out}/witch-${n}.txt`, g.sources.filter(s => s.chapter <= n).map(s => s.paragraphs.join("\n")).join("\n") + "\n");
' "$GRAPH" "$OUT"
bun -e "
import {sampleSourceText} from '$PKG/testing/sample.ts';
await Bun.write(process.argv[1], await sampleSourceText(10));
" "$OUT/sample-10.txt"

ingest() { # ingest <书 id> <原文> <配置>
    local id=$1 file=$2 config=$3
    for attempt in 1 2 3 4 5 6 7 8; do
        echo "$(date -Is) $id attempt $attempt" >> "$LOG"
        bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest "$file" --id "$id" --library "$LIB" --config "$config" >> "$LOG" 2>&1
        local code=$?
        echo "$(date -Is) $id exit $code" >> "$LOG"
        [ $code -eq 0 ] && return 0
        [ $code -ne 4 ] && return $code
        sleep 60
    done
    return 1
}
bun "$PKG/src/cli.ts" ingest "$OUT/witch-20.txt" --preview --id witch --library "$LIB" --config "$OUT/config-off.json" > "$OUT/preview.txt" 2>&1
ingest witch "$OUT/witch-16.txt" "$OUT/config-off.json" && ingest witch "$OUT/witch-20.txt" "$OUT/config-on.json"
ingest sample "$OUT/sample-10.txt" "$OUT/config-on.json"
echo "$(date -Is) $name done" >> "$LOG"
