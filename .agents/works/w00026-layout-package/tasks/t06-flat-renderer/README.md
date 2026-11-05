---
schema: nbook.task/v2
taskId: t06-flat-renderer
status: planned
updated: 2026-11-05
---

# 扁平渲染层

## 目标与范围

在 nb-layout 里实现按矩形摆放的渲染层：模型算出叶子与分隔线的矩形，都放在同一父元素下，取代递归的 NestedGrid；独立的 Splitter 保留给 nb-story 与 dev-panel，拿掉 branchId、sashLineEnds。处理 Tab 与读屏顺序（按 t02 的结论）。

合同：[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 的摆放、取整、过渡、停放、Tab、F6、读屏顺序与验收 8、9。计划：[`plan.md`](plan.md)。

## 当前状态

开发者 2026-11-05 确认计划要点（“没问题”）：470ms 外框过渡放在这一片，新增依赖 `tabbable`，工作量大的切片按难度派 Haiku 或 Sonnet。

## 下一步

开发者确认计划后，按 `plan.md` 的切片实施。
