---
schema: nbook.task/v2
taskId: t65-float-dock-fade
status: planned
updated: 2026-11-26
---

# 浮动窗拖回树里时投影与圆角随过渡淡去

## 目标与范围

拖动停靠（工作台）与贴边平铺（桌面示例）时，窗的投影、底色与圆角随过渡淡去，合 ui/nested-grid 输出 110；框架按钮回到停靠的路径不变

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 110（已实现的条目，拖动路径不合）；输出 172（松手的起点）。

## 当前状态

2026-11-26 开发者同意先修（t60 发现、记在 Work 的“后续”）。现象：拖动停靠（工作台）与贴边平铺（桌面示例）时，松手后第一帧投影与圆角就是 0，只有位置在过渡；框架按钮“回到停靠”那条路径的 e2e（`workbench-float.e2e.ts:482`）是过的。t60 第二段试过在起点那次渲染保留 `data-float`（条件 `releasedLeaves.has(id) && growing.has(item.key)`），浏览器里不起作用，已撤掉（`921b0f5ff`）。

## 下一步

派 coder 先在浏览器里查清原因（逐帧读外框的 `data-float`、`data-moving`、`data-float-gesture` 与计算样式的 `border-radius`、`box-shadow`、`transition`），再修，主会话验收合入。
