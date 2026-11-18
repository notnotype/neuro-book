---
schema: nbook.task/v2
taskId: t11-dogfood
status: planned
updated: 2026-11-10
---

# 第一版自用与调参

## 目标与范围

看板娘实际跑一段：记长会话的打开耗时、压缩的花费与节省，按真实数据改 Spec 里的数值；判断 nb-harness 要不要检查点快照；原始记录留作记忆评测的材料。

合同：按真实数据改上面各份 Spec 里的数值（压缩的下限与间隔、核心记忆的上限等）；结论写进本 Task。压缩相关的设置键在 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（t08 加），数值在 `bot/conversations.md`。

依赖：t10，第一版各项都合入。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

2026-11-18：第一版改成 NeuroBook 里的 bot，等 t10 之后的版本合入再做。

## 下一步

等第一版合入。
