#!/usr/bin/env bash
# 渠道名已中性化，运行时按本机 omp 配置替换。
# story.cli 验收 5：外部 Agent 按 nbstory Skill 作答。omp（模型 relay-a/gpt-6-luna:max）读 Skill、只经 nbstory 命令了解
# 这本书，把 t34 的 16 道知情、身份题各答 3 次。每题按题目要求的阅读位置提问（requiredPrefix 章结束）。
# 已有答案的跳过，中断后重跑即续。判分另见 skill-eval-grade.sh。
# 用法：skill-eval.sh [并发数，默认 4]；EVAL_IDS=H24,B21 只答这几题，EVAL_RUNS="run1" 只答这几遍（试跑用）
set -u
CONCURRENCY=${1:-4}
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
REPO=/home/<user>/CodeRepository/neuro-book
TASK=$REPO/.agents/works/w00024-nb-story/tasks/t03-impl
# 作答用的代码固定在评测 worktree（与 feat/w00024-nb-story 的 be274336c 相同），不随打磨中的分支变。
WT=$REPO/.worktree/w00024-t03-eval/packages/nb-story
Q=$REPO/.worktree/w00005-novel-understanding-spike/.agents/works/w00005-novel-understanding-spike/tasks/t34-v9-100ch/questions-knowledge16.json
LOCAL=$REPO/.local/agent/works/w00024-nb-story/tasks/t03-impl/eval
OUT=$TASK/evidences/skill-eval/answers
MODEL=relay-a/gpt-6-luna:max
# omp 的工作目录放在仓库之外：在仓库里会加载开发 Agent 的 AGENTS.md 与仓库 Skill。目录里只有 nbstory Skill。
WORK=${EVAL_WORK:-/home/<user>/.claude/jobs/568d0811/tmp/eval-work}

mkdir -p "$WORK/.claude/skills" "$OUT" "$LOCAL/sessions" "$LOCAL/logs"
rm -rf "$WORK/.claude/skills/nbstory" && cp -r "$WT/skill" "$WORK/.claude/skills/nbstory"
# nbstory 命令与独立书库（书 id fox，100 章样例书）。
export PATH=$LOCAL/bin:$PATH XDG_DATA_HOME=$LOCAL/data
nbstory books > /dev/null || { echo "书库不可用" >&2; exit 1; }

log() { echo "$(date -Is) $*" >> "$LOCAL/logs/eval.log"; }

answer() {
    local run=$1 id=$2 at=$3 question=$4
    local dir=$OUT/$run file=$OUT/$run/batch-$id.json
    [ -s "$file" ] && return 0
    mkdir -p "$dir"
    local prompt="书库里有一本小说《转生反派萝莉，找茬魔法少女》（书 id fox，书库在默认位置）。我读到第 $at 章结束。请按 nbstory Skill 回答下面的问题。

- nbstory 命令已在 PATH 上，直接运行 \`nbstory <命令>\`。
- 只通过 nbstory 命令了解这本书（read 可以读原文）；不要读取、搜索文件系统里的任何其他文件，不要上网，不要修改书库。
- 不要提及第 $at 章之后的任何内容。

问题：$question

最后一条回复只写答案正文（中文），每个关键结论后写出处“章.段”。"
    local try text start=$SECONDS
    for try in 1 2 3; do
        text=$(cd "$WORK" && omp -p --model "$MODEL" --config "$SCRIPTS/skill-eval-omp.yml" --approval-mode yolo --skills nbstory --max-time 30m \
            --session-dir "$LOCAL/sessions/$run-$id" "$prompt" < /dev/null 2>> "$LOCAL/logs/$run-$id.stderr")
        if [ -n "${text// /}" ] && [ ${#text} -gt 80 ]; then
            ID=$id AT=$at MS=$(( (SECONDS - start) * 1000 )) TEXT=$text MODEL=$MODEL python3 -c '
import json, os
print(json.dumps({"id": os.environ["ID"], "prefix": int(os.environ["AT"]), "model": os.environ["MODEL"], "ms": int(os.environ["MS"]),
                  "answers": [{"id": os.environ["ID"], "answer": os.environ["TEXT"].strip()}]}, ensure_ascii=False, indent=1))' > "$file.tmp" && mv "$file.tmp" "$file"
            log "$run $id ok (try $try, $(( SECONDS - start ))s)"
            return 0
        fi
        log "$run $id empty (try $try)"
        # 失败的会话留着排查，重试换一个目录。
        [ -d "$LOCAL/sessions/$run-$id" ] && mv "$LOCAL/sessions/$run-$id" "$LOCAL/sessions/$run-$id.failed-$try"
        sleep 60
    done
    log "$run $id FAILED"
}

log "start concurrency=$CONCURRENCY model=$MODEL omp=$(omp --version)"
jobs=()
while IFS=$'\t' read -r id at question; do
    [ -n "${EVAL_IDS:-}" ] && [[ ",$EVAL_IDS," != *",$id,"* ]] && continue
    for run in ${EVAL_RUNS:-run1 run2 run3}; do jobs+=("$run"$'\t'"$id"$'\t'"$at"$'\t'"$question"); done
done < <(python3 -c '
import json, sys
for q in json.load(open(sys.argv[1]))["questions"]:
    print(q["id"], q["requiredPrefix"], q["question"].replace("\t", " ").replace("\n", " "), sep="\t")' "$Q")

running=0
for job in "${jobs[@]}"; do
    IFS=$'\t' read -r run id at question <<< "$job"
    answer "$run" "$id" "$at" "$question" &
    running=$((running + 1))
    if [ $running -ge "$CONCURRENCY" ]; then wait -n; running=$((running - 1)); fi
done
wait
log "done: $(ls "$OUT"/run*/batch-*.json 2>/dev/null | wc -l) answers"
