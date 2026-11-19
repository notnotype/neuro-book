---
schema: nbook.task/v2
taskId: t35-drop-nb-ui
status: active
updated: 2026-11-19
---

# nb-layout 去掉 nb-ui 依赖与 CSS 变量迁移

## 目标与范围

按提案第一档第 3 项：--nb-layout-* 变量带回退、:root 默认值（含减少动效）、layoutMotionMs、层级变量、文案注入；桥接样式放 nb-ui 的 tokens.css；主题合同 theme/system.md 与受影响的主题文件、e2e

合同：布局行为与装了 nb-ui 时的外观不变；变的是 nb-layout 读的变量名（经 nb-ui 桥接）与文案的注入点。改 [`theme/system.md`](../../../../../docs/specs/theme/system.md) 第 2 层（桥接与对照表），[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 里提到变量名的地方。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“去掉 nb-ui 依赖”“CSS 变量迁移”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-19 开工。计划见 [`plan.md`](plan.md)（第 1 稿）。盘点由 Claude Haiku 只读整理（`.local/agent/works/w00026-layout-package/tasks/t35-drop-nb-ui/reports/inventory/`）：导入 nb-ui 的只剩 3 个文件，Vue 层读 46 个变量名另有 JS 读 3 个，e2e 有 18 个文件按这些名字设或读样式（提案写的是 6 个），`--radius-sm` 在哪都没定义；提案说主题作者文档里有布局变量，实际没有。

## 下一步

1. 设计审查（前端包，Claude Sonnet），阻塞。
2. 处理完写 Spec，开 worktree 按计划四片实施。
