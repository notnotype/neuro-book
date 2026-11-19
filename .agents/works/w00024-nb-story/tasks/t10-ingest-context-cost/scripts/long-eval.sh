#!/usr/bin/env bash
# t10 长书评估的一遍（plan.md“验证”第 3 条）：前 60 章直接提交（build-prefix.ts），再用真实模型（.env 的 NBOOK_LLM_*，
# gpt-6-luna）抽第 61 到 70 章。PKG 指定跑哪个版本的 nbstory（改前、改后各一个固定提交的 worktree）。
# 渠道失败重试用完时接着跑同一本书，至多 8 次。书库与日志放在不进 Git 的本地目录。
# 用法：PKG=<nb-story 包目录> long-eval.sh <运行名>，例如 long-eval.sh old-1
set -u
name="${1:?用法：PKG=<包目录> long-eval.sh <运行名>}"
REPO=/home/<user>/CodeRepository/neuro-book
PKG=${PKG:?要给 PKG}
HERE=$REPO/.agents/works/w00024-nb-story/tasks/t10-ingest-context-cost/scripts
OUT=$REPO/.local/agent/works/w00024-nb-story/tasks/t10-ingest-context-cost/long/$name
mkdir -p "$OUT"
LOG=$OUT/ingest.log
bun --env-file=$REPO/.env -e '
const [config] = process.argv.slice(1);
await Bun.write(config, JSON.stringify({model: {baseUrl: process.env.NBOOK_LLM_BASE_URL, id: "gpt-6-luna", apiKeyEnv: "NBOOK_LLM_API_KEY", price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"}}}, null, 2));
' "$OUT/config.json"
[ -d "$OUT/library/long" ] || bun "$HERE/build-prefix.ts" "$PKG" "$OUT/library" 60 70 >> "$LOG" 2>&1 || { echo "起点没建成，见 $LOG"; exit 1; }
for attempt in 1 2 3 4 5 6 7 8; do
    echo "$(date -Is) attempt $attempt" >> "$LOG"
    bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest --book long --library "$OUT/library" --config "$OUT/config.json" >> "$LOG" 2>&1
    code=$?
    echo "$(date -Is) exit $code" >> "$LOG"
    bun "$PKG/src/cli.ts" ingest --status --book long --library "$OUT/library" --json > "$OUT/status.json"
    if grep -q '"state":"done"' "$OUT/status.json"; then echo "$(date -Is) $name done" >> "$LOG"; break; fi
    sleep 60
done
graph=$(ls "$OUT/library/long"/graph-*.json 2>/dev/null | head -1)
[ -n "$graph" ] && cp "$graph" "$OUT/dataset-v9.json"
