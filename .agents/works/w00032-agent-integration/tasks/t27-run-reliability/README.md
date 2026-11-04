---
schema: nbook.task/v2
taskId: t27-run-reliability
status: planned
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

## 当前状态

2026-11-04 经 nbdev 新建，尚未开工，排在 t18 之前。

## 下一步

t12 合入后写计划。
