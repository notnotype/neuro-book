---
schema: nbook.task/v2
taskId: t17-per-tab-instance
status: active
updated: 2026-11-06
---

# 每标签一实例

## 目标与范围

每个打开的编辑器标签有自己的实例，切走隐藏不卸载，移到别的组不重建，撤销历史跟着走；每种编辑器保留最近 20 个，其余卸载且不丢光标、滚动与撤销。提案第 2 节。排在 t07 之后、t08 之前，t08 的卡片带真内容走依赖它。

合同：[workbench.editor](../../../../../docs/specs/workbench/editor.md) 术语、输出 7、10、49；[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 14、27、33。计划见 [`plan.md`](plan.md)。

## 当前状态

计划第一稿已写，等 t16 合入后做设计审查。

## 下一步

设计审查 → 片 1。
