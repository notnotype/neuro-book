---
schema: nbook.task/v2
taskId: t52-grid-structure-semantics
status: active
updated: 2026-11-22
---

# nb-layout 结构操作的语义：不压固定栏、setSize

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“原地增删不压固定栏、加设宽度入口”，见 [t51 的“决定”](../t51-layout-api-gaps/README.md)）：结构操作与 `resize` 不改保留像素兄弟的意图、`setSize`；展平与拆分的老问题写成已知限制。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新增输出 153、154（planned）。

## 当前状态

2026-11-22：[计划](plan.md)第 3 稿。第 1 轮设计审查（重要 8、建议 6，[证据](evidences/design-review.txt)）与 API 形状审查（重要 8、建议 5，[证据](evidences/api-review.txt)）之后收回到开发者定的范围；第 2 轮设计与 API 合审（重要 4、建议 4，[证据](evidences/review-2.txt)）的 8 条都成立，改进第 3 稿，不再审，直接实施。

交开发者的问题（已知限制里）：`splitLeaf` 拆保留像素的叶要不要直接失败（`wrong-sizing`）。本 Task 只写进文档。

## 下一步

实施（worktree `.worktree/w00026-t52-grid-structure`）→ 实现审查。
