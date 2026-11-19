#!/usr/bin/env bash
# t32 第 3 片的真实模型小抽取（先验 tier 的写入率与分布，见 plan.md 的“抽取”）：用真实模型（.env 的 NBOOK_LLM_*，gpt-6-luna）把样例书前
# 5 章抽一遍，跑的是 Work 分支 worktree 里的 nbstory。渠道失败重试用完时 nbstory 以 4 停下，这里接着跑同一本书，至多 8 次。
# 书库、日志与导出的图放在不进 Git 的本地目录；分布与一致度另跑 tier-stats.ts。
# 用法：extract-5.sh <运行名>，例如 extract-5.sh run-1
set -u
name="${1:?用法：extract-5.sh <运行名>}"
REPO=/home/<user>/CodeRepository/neuro-book
PKG=$REPO/.worktree/w00024-t32/packages/nb-story
OUT=$REPO/.local/agent/works/w00024-nb-story/tasks/t32-record-tiers/extract/$name
mkdir -p "$OUT"
LOG=$OUT/ingest.log
# 配置里只写端点地址与密钥环境变量名；价格按 deepseek-flash 低谷价（费用口径统一用它）。
bun --env-file=$REPO/.env -e '
const [config] = process.argv.slice(1);
await Bun.write(config, JSON.stringify({model: {baseUrl: process.env.NBOOK_LLM_BASE_URL, id: "gpt-6-luna", apiKeyEnv: "NBOOK_LLM_API_KEY", price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"}}}, null, 2));
' "$OUT/config.json"
bun -e "
import {sampleSourceText} from '$PKG/testing/sample.ts';
await Bun.write(process.argv[1], await sampleSourceText(5));
" "$OUT/样例前5章.txt"
for attempt in 1 2 3 4 5 6 7 8; do
    echo "$(date -Is) attempt $attempt" >> "$LOG"
    if [ "$attempt" = 1 ]; then
        bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest "$OUT/样例前5章.txt" --id sample5 --library "$OUT/library" --config "$OUT/config.json" >> "$LOG" 2>&1
        code=$?
    else
        bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest --book sample5 --library "$OUT/library" --config "$OUT/config.json" >> "$LOG" 2>&1
        code=$?
    fi
    echo "$(date -Is) exit $code" >> "$LOG"
    bun "$PKG/src/cli.ts" ingest --status --book sample5 --library "$OUT/library" --json > "$OUT/status.json"
    if grep -q '"state":"done"' "$OUT/status.json"; then echo "$(date -Is) $name done" >> "$LOG"; break; fi
    sleep 60
done
graph=$(ls "$OUT/library/sample5"/graph-*.json 2>/dev/null | head -1)
[ -n "$graph" ] && cp "$graph" "$OUT/dataset-v9.json"
