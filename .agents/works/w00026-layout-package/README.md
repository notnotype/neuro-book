---
schema: nbook.work/v1
workId: w00026-layout-package
issueId: null
status: active
updated: 2026-11-05
---

# 布局工具独立成包

## 目标

把 Grid、Splitter 与拖放落点这类布局工具从 nb-ui 拆成单独的包 `@notnotype/nb-layout`，并用它重做工作台的布局：外壳、视图容器和编辑组合成一棵树，内容改成按矩形摆放在同一层，拖动同时支持落点指示和实时布局两种手感，支持浮动 View 与编辑器标签（应用内做完，操作系统级先验证），并做竖屏手机呈现（验证级）。决定与调研见 [t01](tasks/t01-requirements/README.md)

## 推进顺序

开发者 2026-11-06 要求按 [autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进其余 Task，本该开发者决定的记在[待确认清单](pending-confirmations.md)：

[t07](tasks/t07-single-tree/README.md) 片 7c、片 8 → [t16 统一标签条](tasks/t16-tab-strip/README.md) → [t17 每标签一实例](tasks/t17-per-tab-instance/README.md) → [t19 落点分区](tasks/t19-drop-zones/README.md) → [t08 实时布局](tasks/t08-live-drag/README.md) → [t09 应用内浮动](tasks/t09-in-app-float/README.md) → [t10 资源树拖动](tasks/t10-explorer-drag/README.md) → [t18 动效曲线](tasks/t18-motion-curve/README.md)。

2026-11-07：这条路径走完，都已合入。手感与待确认清单等开发者。

- [t13 条移到四边](tasks/t13-bars-move/README.md) 搁置（骨架固定之后没有必要）。
- [t11 手机呈现](tasks/t11-phone-layout/README.md)、[t12 操作系统级浮动的验证](tasks/t12-os-window-spike/README.md)、[t14 Splitter 迁移](tasks/t14-splitter-migration/README.md) 这一轮先不做（开发者 2026-11-06）。
