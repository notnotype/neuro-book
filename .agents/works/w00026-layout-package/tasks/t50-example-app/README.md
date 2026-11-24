---
schema: nbook.task/v2
taskId: t50-example-app
status: active
updated: 2026-11-24
---

# 官方示例应用

## 目标与范围

照公开入口写的一份最小示例应用（提案第二档第 6 项）；开工前先看 t47 的空项目冒烟与 t49 的两个宿主之后还缺什么，再定要不要做、做多大。

合同：不改 Spec；示例只用 [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 已实现的行为。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-24 开发者说“可以做”。对照 README 的“我要做 X”表，空缺集中在标签编组这一个形状（拖标签进别的编组、拖到边缘拆分），推荐做一个标签编组示例（[计划](plan.md)第 1 稿，规模与三项取舍记进[待确认清单](../../pending-confirmations.md)）。计划在设计审查（前端，Sonnet）。

## 下一步

处理设计审查，再按切片实施。
