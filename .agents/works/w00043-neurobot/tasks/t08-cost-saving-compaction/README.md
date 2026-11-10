---
schema: nbook.task/v2
taskId: t08-cost-saving-compaction
status: planned
updated: 2026-11-10
---

# 省钱的两种压缩触发

## 目标与范围

nb-harness 的压缩指令带原因与方法顺序；加缓存过期前压缩与空闲压缩（截止时刻由持久数据算、用户来消息先中止压缩）；nb-models 按服务商加凭据类型配缓存寿命；记下每次的花费与估算的节省。NeuroBook 不开这两种触发，行为不变。

合同：改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（压缩指令带原因与方法顺序、`CompactionJob` 的两个新原因、Profile 的压缩设置）、模型的 Spec（缓存寿命按服务商与凭据类型配置并随请求发出、单价未知时不做）、`docs/specs/harness/host-kit.md`（w00032 t32 新建；会话句柄层的计时、截止时刻、用户消息到达时中止）；NeuroBot 一侧的条件与数值写进 `bot/conversations.md`。NeuroBook 不开这两种触发，行为不变。

依赖：w00032 t32、t02 的 `nb-models`。nb-harness 与 nb-models 这部分可与 t06 同时做；接进 NeuroBot 在 t06 之后。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等 w00032 t32 合入。
