---
schema: nbook.task/v2
taskId: t27-run-reliability
status: active
updated: 2026-11-04
---

# 运行可靠性：模型请求重试、卡死超时、循环检测与费用上限

## 目标与范围

让 Agent 能长时间无人值守：服务商失败自动重试，模型流卡死能超时，重复调用被发现，费用有告警和上限

合同：要改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（“不承诺”里的“自动重试服务商的失败”）与 [`harness/models.md`](../../../../../docs/specs/harness/models.md)；定稿前在计划里写明。

来源：开发者 2026-11-04 对照 omp 的设置项后决定开（[t12](../t12-builtin-tools/README.md) 决定 30）。参照 omp 的设置：

- `retry.*`：服务商失败退避重试，默认至多 10 次，尊重服务商要求的等待时间；
- `providers.streamFirstEventTimeoutSeconds`、`streamIdleTimeoutSeconds`：模型流卡住时超时；
- `model.toolCallLoopGuard`（连续 5 次相同调用插话纠正）、`model.loopGuard`、`features.unexpectedStopDetection`；
- `session.warnCost`、`maxCost`：费用告警与上限。

要讨论：做进内核，还是做成默认装上的扩展（t20 把“预算停止”列为扩展的例子，现行 Spec 说是否重来“由用户或扩展决定”）。

## 决定（开发者 2026-11-04）

1. 分工：重试放内核；卡死超时只在适配器上加设置（`pi-ai` 已有超时）；循环检测与费用上限做成默认装上的扩展。
2. 重试次数照 omp：最多 10 次，退避 0.5 到 8 秒，服务商要求的等待最长 5 分钟，再长就失败。
3. 回复流到一半断了也重试：工具要等回复完整才执行，重发没有副作用。
4. 费用默认不设上限，按会话累计，有告警线和上限；子代理做好后再并入。单价未知的模型不计入，设置里写明。
5. 第一版不做换模型回退和“说了要继续却停了”的检测；空回复算可重试的失败。
6. 不让 NeuroBook 把请求全文留在 `~/.omp`，错误文字里也不带这个路径。
7. 内层重试能关的关（只有 `openai-completions` 能关），其余接受内外两层叠加；不用 `bun patch` 改 `pi-ai`，也不包 `fetch` 截断。
8. 循环检测比 omp 主会话多一步：提醒之后又连续重复到阈值就停止运行，用户发新话后解除。
9. 请求全文的落盘做成写完立刻删，`~/.omp/logs/http-400-requests/` 目录仍可能被建出来；不改进程环境。

## 设计审查后的决定（开发者 2026-11-04）

10. 费用累计放进内核，告警与拦截仍是扩展：只靠扩展时旧会话的费用从 0 算。
11. `ompCall` 自己做第一事件计时，`pi-ai` 传 0：`anthropic-messages` 的第一事件超时会被内层再重试。
12. 空回复重发时带提醒，3 次用完以 `empty-reply` 失败。
13. 循环检测提醒后再犯，且工具结果也相同才停；结果在变只提醒。
14. 模型重复循环不重发，以 `thinking-loop` 失败。
15. 接受两处残留：`anthropic-messages` 内部 400 恢复成功时全文留在 `~/.omp`；手动压缩到费用上限时结果码是 `compaction-failed`。
16. 不再审第二轮设计，收口时做实现审查。

## 当前状态

设计审查已处理（[处理](evidences/design-review-disposition.md)）：omp 写 10 条后额度用完，Claude Opus 接手 12 条。开发者 2026-11-04 确认 [plan.md](plan.md) 第二稿。切片 0（Spec）在 master，切片 1–6 已合入 master（`5840abbf2`），收口验证见 [closing-verification.txt](evidences/closing-verification.txt)，实现审查 4 条都已修（[处理](evidences/impl-review-disposition.md)）。开发者 2026-11-04 批准晋升：[`agent/run-guards.md`](../../../../../docs/specs/agent/run-guards.md) 整份、`models/service.md` 与 `agent/contributions.md` 的相关条目为 `implemented`；`harness/runtime.md`、`harness/models.md` 整份仍是 `planned`，只在证据里记这次。分支与 worktree 已清理。

## 下一步

无。
