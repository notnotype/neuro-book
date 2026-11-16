---
schema: nbook.task/v2
taskId: t01-impl
status: planned
updated: 2026-11-16
---

# nb-history 接入的计划与实施

## 目标与范围

按 [w00032 t13](../../../w00032-agent-integration/tasks/t13-history/README.md) 的定稿把 nb-history 接进 NeuroBook：归属插件 `nbook.history`；Agent、人与外部程序的写入都记账，插件写入也记来源；收件箱的接受（立即、下一条消息时、手动）与还原；每轮改动文件条由 nb-history 提供，告诉 Agent 文件变化；会话回退与文件回退分开；保留、合并保存、大文件不存快照。决定的原文以 w00032 t13 的“定稿”一节为准。

来源：w00032 t13（讨论 2026-10-28 至 10-30，开发者 2026-11-16 定移出 w00032、单独成 Work）。

合同：设计讨论时行为合同未变；开工写计划时定改哪些 Spec。

## 当前状态

2026-11-16 从 w00032 t13 移来，尚未开工。

## 下一步

开工时按 implementation-planning 写计划；收件箱对话框按 design-review 出稿。
