---
schema: nbook.task/v2
taskId: t52-grid-structure-semantics
status: active
updated: 2026-11-22
---

# nb-layout 结构操作的语义：不压固定栏、展平与拆分继承尺寸规则、setSize

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“原地增删不压固定栏、加设宽度入口”，见 [t51 的“决定”](../t51-layout-api-gaps/README.md)）：结构操作不改兄弟的意图、展平与拆分继承尺寸规则、`setSize`、宿主一次改多步的 `host.update`。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新增输出 153 到 156（planned）。

## 当前状态

2026-11-22：[计划](plan.md)第 1 稿，等设计审查与 API 形状审查（Claude Sonnet 各一）。

## 下一步

处理审查 → 实施。
