---
schema: nbook.task/v2
taskId: t03-design
status: active
updated: 2026-11-05
---

# 提案、ADR 与 Spec 改动：一棵树与 nb-layout

## 目标与范围

写提案与 ADR，取代外壳设计稿里七个固定 Part 的拓扑：哪些 Part 留在树外（Trellis 把标题栏和状态栏放在树外）、区域规则怎么表达（放置、允许的落点、能否浮动）、编辑器节点移到外层的开放范围、面板的位置对齐最大化命令、紧凑呈现是否保留、三条布局记录怎么迁移、插件声明视图的 location 与编辑器的 group 接口还算不算数、ADR 0029 的发布包。再列 ui/workbench-shell、ui/nested-grid、workbench/views、workbench/editor、workbench/files-explorer 的改动。依据 t01 的全部决定与 t02 的结论。

合同：取代 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md) 的拓扑部分，改 [`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)、[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)。

## 当前状态

提案第一稿（`1170d771b`）已审一轮：omp 审模型与数据（14 条），Sonnet 审前端（25 条），Sonnet 拉远看（10 条）。方向没有被推翻，主要问题是模型与所有权没写清、现行行为没有去向。报告与逐条归类在 [`evidences/`](evidences/design-review-triage.txt)。

等开发者定：多窗口的合并方式、手机呈现的门槛、Splitter 的归属、实时布局松手提交什么、整宽面板、一棵树前的确认点与条的排期。

## 下一步

开发者定完后改写提案第二稿，交开发者确认，再审第二轮（同一对象最多三轮）。接受时写 ADR 与 Spec。
