---
schema: nbook.task/v2
taskId: t06-flat-renderer
status: planned
updated: 2026-11-05
---

# 扁平渲染层

## 目标与范围

在 nb-layout 里实现按矩形摆放的渲染层：模型算出叶子与分隔线的矩形，都放在同一父元素下，取代递归的 NestedGrid；独立的 Splitter 保留给 nb-story 与 dev-panel，拿掉 branchId、sashLineEnds。处理 Tab 与读屏顺序（按 t02 的结论）。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 下一步

待补充。
