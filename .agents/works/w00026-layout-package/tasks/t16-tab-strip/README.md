---
schema: nbook.task/v2
taskId: t16-tab-strip
status: active
updated: 2026-11-06
---

# 统一标签条

## 目标与范围

nb-layout 提供一个标签条，工具面板和编辑组共用：语义、方向键、改顺序、多行与让位都只写一份，固定、未保存标记走插槽与分区。提案第 5 节的形状。关闭改成工作台发起的两阶段（requestClose）。排在 t07 之后、t08 之前。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、21；[workbench.editor](../../../../../docs/specs/workbench/editor.md) 输出 53 到 59。计划见 [`plan.md`](plan.md)。

## 当前状态

计划第一稿已写，设计审查中。

## 下一步

设计审查 → 片 1。

从 t07 片 7b 审查留下的：关掉多行（`wrapTabs` 为假）且标签条横向滚动时，键盘拖动把滚出视口的标签也算成落点，停靠点落到标签条外面（工具面板的标签条只数看得见的，编辑组没有）。换成统一标签条时一起解决。
