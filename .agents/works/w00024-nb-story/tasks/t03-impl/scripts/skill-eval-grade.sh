#!/usr/bin/env bash
# story.cli 验收 5 的判分：t22 判分器 v2 一审（与 t34 第四轮的基线 11/48 同一个判分器、同一份题与标准答案、同一份原文），
# 再跑 skill-eval-check.ts 做确定性检查（有出处、不提阅读位置之后）并按 t22 的规则数“答错”。
# 判分结果按题缓存，重跑只补缺的；跑两遍，补渠道偶发的失败。用法：skill-eval-grade.sh
set -u
REPO=/home/<user>/CodeRepository/neuro-book
T34=$REPO/.worktree/w00005-novel-understanding-spike/.agents/works/w00005-novel-understanding-spike/tasks/t34-v9-100ch
T22=$T34/../t22-eval-v2-grading
SRC=$T34/../t23-eval-50ch/evidences/source-ch001-100.json
Q=$T34/questions-knowledge16.json
EVAL=$REPO/.agents/works/w00024-nb-story/tasks/t03-impl/evidences/skill-eval
LOG=$REPO/.local/agent/works/w00024-nb-story/tasks/t03-impl/eval/logs/judge.log
export LUNA_TIMEOUT_MS=1800000
for sweep in 1 2; do
    for run in run1 run2 run3; do
        JUDGE_SOURCE=$SRC JUDGE_CONCURRENCY=2 bun --env-file=$REPO/.env $T22/scripts/judge-v2.ts $Q $EVAL/answers/$run $EVAL/judge/$run >> $LOG 2>&1 &
    done
    wait
done
bun "$(dirname "$0")/skill-eval-check.ts" "$Q" "$EVAL" > "$EVAL/report.md"
cat "$EVAL/report.md"
