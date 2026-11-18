---
schema: nbook.task/v2
taskId: t08-cost-saving-compaction
status: shelved
updated: 2026-11-18
---

# 省钱的两种压缩触发

## 目标与范围

nb-harness 的压缩指令带原因与方法顺序；kit 里加两种新触发（缓存过期前、空闲）与应用无关的判断条件和截止时刻的计算（从最后一次对话请求算起），到点发起的计时由 NeuroBot 的对话管理持有；nb-models 按服务商、模型能力与凭据类型查缓存寿命，设置里配档位，模型适配器显式传档位；已发出的压缩请求让它做完；记下每次的花费与估算的节省。NeuroBook 不开这两种触发，行为不变。

合同：改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（压缩指令带原因与方法顺序、`CompactionJob` 的两个新原因、Profile 的压缩设置）、模型的 Spec（缓存寿命按服务商与凭据类型配置并随请求发出、单价未知时不做）、`docs/specs/harness/host-kit.md`（w00032 t32 新建；两种新触发的判断条件与截止时刻的计算）；NeuroBot 一侧的条件与数值写进 `bot/conversations.md`。NeuroBook 不开这两种触发，行为不变。

依赖：w00032 t32、t02 的 `nb-models`。nb-harness 与 nb-models 这部分可与 t06 同时做；接进 NeuroBot 在 t06 之后。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

2026-11-18 搁置：开发者定“省钱压缩第一版先不做，以后可以做”，做法与量级估算记在 bot 提案的路线。

## 下一步

等 w00032 t32 合入。
