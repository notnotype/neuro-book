---
schema: nbook.task/v2
taskId: t40-collapse-and-intent-writeback
status: active
updated: 2026-11-19
---

# 收起与展开入口、L2 的意图回写

## 目标与范围

按提案第一档第 5 项（从 t39 拆出），两件互不依赖的事：

- **L1 收起与展开的入口**：库提供设置面板收起状态的入口，内部找兄弟吸收差额（体验审查第 5 条）；写明 `restoreSize` 谁维护：谁收起谁记（第 6 条）。
- **L2 意图回写**：nb-workbench-layout 提供 `applyGestureCommit`、`rebaseForOperation`（t26 api-03），迁移工作台 store 的 `commitGesture` 与 Lab 的 `GridPanelsScene`。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新输出 147 到 149、失败 5 加一个 `field`；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 新输出 49。行为改变一处：不带 `restoreToShare` 的面板，分隔条上 Enter 恢复回到收起前的尺寸（原来回到建树时给的 `restoreSize`）；工作台每次从投影重建网格，不受影响。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)），三条待确认写在计划末尾。等 t39 合入后送设计审查（Claude Sonnet：两个包都是前端包里的纯 TS）。

## 下一步

1. t39 合入后启动设计审查，阻塞等结论。
2. 处理审查，写 Spec（planned），开 worktree（基于合入 t39 之后的 master）按三片实施。
