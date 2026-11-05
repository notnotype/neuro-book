---
schema: nbook.task/v2
taskId: t07-single-tree
status: planned
updated: 2026-11-05
---

# 合成一棵树：外壳、视图容器、编辑组

## 目标与范围

按 t03 的设计把 shell/layout、views/placement、container-grid 与 editor/groups 迁到一棵树，三层 Teleport 与 TeleportMemory 能去掉的去掉；布局记录按 t03 的方案迁移；改 Spec 并跑通现有验收。这是这个 Work 影响面最大的一段。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

**开工前的确认点**（开发者 2026-11-05）：t04、t05、t06 交付后，开发者用真实产品的手感再确认一次，确认后才开工。

**从 t06 留下的**（还有一批接入形状的遗留，见 [t06 记录](../t06-flat-renderer/README.md) 的“遗留”，先看）：DOM 序与树序不一致时，从 grid 外面 Tab 进来、点击空白处后按 Tab 仍按 DOM 序（t06 设计审查第 7 条，Chrome 复现）。t06 里只有外壳改面板位置才不一致，t07 之后会很常见，要用 `focusin` 处理：进入时落在树序的首或尾，叶外框或可给 `tabindex="-1"` 接住点击。外壳的 `shellNodeRects` 与 `placeGrid` 算同一件事，这里一起去掉。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 下一步

待补充。
