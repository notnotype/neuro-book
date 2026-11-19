#!/usr/bin/env bash
# 验收 11 的一次回归抽取（t20 提示词层验证，同 t06 的脚本，只改了路径）（docs/specs/story/ingest.md 验收 11）：用真实模型（.env 的 NBOOK_LLM_*，gpt-6-luna）把样例书前
# 20 章抽一遍，跑的是 Work 分支 worktree 里的 nbstory。渠道失败重试用完时 nbstory 以 4 停下，这里接着跑同一本书，至多 8 次。
# 书库、日志与导出的图放在不进 Git 的本地目录；尺子另跑（ruler/check.ts）。
# 用法：regress-20.sh <运行名>，例如 regress-20.sh run-1
set -u
name="${1:?用法：regress-20.sh <运行名>}"
REPO=/home/<user>/CodeRepository/neuro-book
PKG=$REPO/.worktree/w00024-t20/packages/nb-story
OUT=$REPO/.local/agent/works/w00024-nb-story/tasks/t20-ingest-pipeline-fixes/regress/$name
mkdir -p "$OUT"
LOG=$OUT/ingest.log
# 配置里只写端点地址与密钥环境变量名；价格按 deepseek-flash 低谷价（费用口径统一用它）。
bun --env-file=$REPO/.env -e '
const [config] = process.argv.slice(1);
await Bun.write(config, JSON.stringify({model: {baseUrl: process.env.NBOOK_LLM_BASE_URL, id: "gpt-6-luna", apiKeyEnv: "NBOOK_LLM_API_KEY", price: {input: 1, output: 4, cacheRead: 0.02, currency: "CNY"}}}, null, 2));
' "$OUT/config.json"
bun -e "
import {sampleSourceText} from '$PKG/testing/sample.ts';
await Bun.write(process.argv[1], await sampleSourceText(20));
" "$OUT/样例前20章.txt"
for attempt in 1 2 3 4 5 6 7 8; do
    echo "$(date -Is) attempt $attempt" >> "$LOG"
    if [ "$attempt" = 1 ]; then
        bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest "$OUT/样例前20章.txt" --id sample20 --library "$OUT/library" --config "$OUT/config.json" >> "$LOG" 2>&1
        code=$?
    else
        bun --env-file=$REPO/.env "$PKG/src/cli.ts" ingest --book sample20 --library "$OUT/library" --config "$OUT/config.json" >> "$LOG" 2>&1
        code=$?
    fi
    echo "$(date -Is) exit $code" >> "$LOG"
    bun "$PKG/src/cli.ts" ingest --status --book sample20 --library "$OUT/library" --json > "$OUT/status.json"
    if grep -q '"state":"done"' "$OUT/status.json"; then echo "$(date -Is) $name done" >> "$LOG"; break; fi
    sleep 60
done
graph=$(ls "$OUT/library/sample20"/graph-*.json 2>/dev/null | head -1)
[ -n "$graph" ] && cp "$graph" "$OUT/dataset-v9.json"
