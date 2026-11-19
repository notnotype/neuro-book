---
schema: nbook.task/v2
taskId: t39-layout-helpers-and-starter
status: active
updated: 2026-11-19
---

# 宿主接线：useGridHost 与 useDragSession

## 目标与范围

按提案第一档第 5 项“库里补的小东西”的前两条：`useGridHost`（把 `NestedGrid` 要的几样打成一包，`NestedGrid` 量一次容器交给宿主，宿主不再另量）与 `useDragSession`（根出现时建会话，换根或作用域结束时销毁）；迁移工作台与 Lab 的五个宿主、三个拖动会话的调用方，验收就是盘点里列出的重复接线消失。新 API 的形状先写 Spec。

2026-11-19 拆分：收起与展开入口、L2 的意图回写拆到 [t40](../t40-collapse-and-intent-writeback/README.md)，拖不动时报错拆到 [t41](../t41-config-error-reporting/README.md)，README 起步与三份短文档拆到 [t42](../t42-readme-starter/README.md)：几块的形状互相独立，合在一份计划里送审会一轮轮互相牵扯（t34 的教训）。

合同：`NestedGrid` 新增 `extent` 事件，新增 `useGridHost`、`useDragSession`；已有行为不变。改 [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)。

## 当前状态

2026-11-19 经 nbdev 新建。盘点（Claude Haiku）见 [`evidences/inventory.txt`](evidences/inventory.txt)：五个宿主里 `:node`、`:layout`、`:revision`、`:on-gesture-commit` 一字不差，`contextKey` 同一个值写两到三遍；`NestedGrid` 没有 `extent` 事件，宿主量外层、`NestedGrid` 再量自己的根；`useGridLayout` 已返回 `node`、`layout`、`revision`、`invalidate`、`onGestureCommit`，接近提案说的 `useGridHost`；`createDragSession` 三处调用方是同一段挂载建、卸载销毁的样板，只有 `useSortable` 处理换根。

## 下一步

计划见 [`plan.md`](plan.md)（第 1 稿）。

1. 设计审查（Claude Sonnet，含站在使用方位置写接入草稿的 API 形状审查），阻塞。
2. 处理完写 Spec（planned），在 worktree `w00026-t39-host-wiring` 按三片实施。
