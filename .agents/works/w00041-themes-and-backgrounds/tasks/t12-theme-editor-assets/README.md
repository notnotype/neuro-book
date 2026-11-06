---
schema: nbook.task/v2
taskId: t12-theme-editor-assets
status: planned
updated: 2026-11-06
---

# 主题编辑器补图标集、工作态场景与场景提供者

## 目标与范围

t06 给主题声明加了图标集（`Look.icons`）、工作态场景（`Look.workingScene`）和场景提供者（`sceneProvider`），编辑器还不能编辑它们，“我的主题”也因为没有素材管线不收前两项。本 Task 补齐：用户层的 SVG 图标素材与第二张场景图的素材管线，编辑器的“图标”分区与“场景与取景”分区的新编辑项，复制、导出、导入对这三项的支持。

合同：[`theme.editor`](../../../../../docs/specs/theme/editor.md)、[`theme.skins`](../../../../../docs/specs/theme/skins.md) 的边界与兼容（设计审查后改 Spec）。计划：[plan.md](plan.md)。

## 开发者的决定

1. （2026-11-06）`/autonomous-delivery`：补齐这三项的编辑能力，含用户层素材管线（SVG 与第二张场景图）的取舍。取舍记在 [pending-confirmations.md](../../pending-confirmations.md)。

## 当前状态

2026-11-06 计划已写，待设计审查。

## 下一步

omp 设计审查，处理后改 Spec，再开 worktree 实施。
