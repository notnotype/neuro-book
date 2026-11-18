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

2026-11-07 开发者试用后：[t22 拖动重整](tasks/t22-drag-frame/README.md)（跟手的东西不走渲染，标签条都能实时布局）→ [t21 划过界面 CPU 高](tasks/t21-hover-cpu/README.md)。两个 Task 改同几个文件，t21 排在 t22 切片 1 之后，不并行。

2026-11-09 开发者试用后：[t23 拖动判定照 Trellis](tasks/t23-drop-base/README.md)（来源收起一次、按收起后的布局判，不分的边没有落点，标签条限位排序）。

2026-11-16 开发者同意 t27 计划第 2 稿与 t26 第 2 到 4 件，要求按 autonomous-delivery 推进：[t27 区域入口条与切换动画](tasks/t27-region-entry-strips/README.md) → [t26 深入审查的修复](tasks/t26-layout-deep-review/README.md)（含 `ui/nested-grid` 重写、`ui/workbench-layout` 晋升；nb-layout 做成通用库要先写提案、交开发者看）→ [t14 Splitter 迁移](tasks/t14-splitter-migration/README.md)。

2026-11-17：t27 拆成两个（[待确认清单](pending-confirmations.md)）：[t27](tasks/t27-region-entry-strips/README.md) 留一个容器一张卡片与侧栏切换容器的滚动，右栏与底部面板的入口条拆到 [t28](tasks/t28-panel-entry-strips/README.md)。顺序 t27 → t28 → t26 → t14。

2026-11-17：开发者要求重新设计面板头与分节全部收起的样子，新建 [t29](tasks/t29-panel-head-redesign/README.md)（评审板逐轮定稿）。t28 并成一行的头就是这个面板头，所以 t28 的 nb-layout 两片照常先做，画出入口条的那一片排在 t29 定稿之后；t29 定稿后的实现和 t28 那一片前后挨着做。

2026-11-17：t27 合入 master（`bcc1d3528`），实现审查在后台。

2026-11-18：t28 合入 master（`f8e7bcdaa`），实现审查在后台。t26 拆成三个（[待确认清单](pending-confirmations.md)）：[t26](tasks/t26-layout-deep-review/README.md) 留性能基线与代码修复；Spec 的晋升与重写拆到 [t30](tasks/t30-layout-specs-rewrite/README.md)；通用库的提案拆到 [t31](tasks/t31-general-layout-library/README.md)（交开发者看）。顺序 t26 与 t30 交错（t30 只改文档，在 t26 等 e2e 时做）→ t31 提案 → t14。

2026-11-18：t26 合入 master（`aa8de685e`），实现审查在后台。

- [t13 条移到四边](tasks/t13-bars-move/README.md) 搁置（骨架固定之后没有必要）。
- [t11 手机呈现](tasks/t11-phone-layout/README.md)、[t12 操作系统级浮动的验证](tasks/t12-os-window-spike/README.md)、[t14 Splitter 迁移](tasks/t14-splitter-migration/README.md) 这一轮先不做（开发者 2026-11-06；t14 于 2026-11-16 排到 t26 之后）。
- 已知问题（2026-11-18，t26 片 5 验证时发现，master 的 `ba3de16c6` 上同样有）：负载 9 到 10 时，编辑器标签实时布局快速拖到正文右边缘停下，预览有时停在“来源收起”，不换成拆分，松手也没拆（`editor-area.e2e.ts:2171`、`2207`，各重复 6 次约失败 1 次）。从代码推断与“来源收起后指针再动才重判”有关：指针在收起之前就停了。没有排 Task，要修时另建。
