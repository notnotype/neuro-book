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

提案第二稿已接受（开发者 2026-11-05，不开第二轮审查，所以第二稿没有经过复审），ADR 0044 已写。现行 Spec 还没改：t04 不改行为，不依赖它们。

## 下一步

t05 之前写 Spec：`ui/nested-grid.md` 改成 `nb-layout` 的合同（条目级 planned 或新 Spec，按 `writing-specs` 先列能力地图）；外壳、视图、命令、编辑器、资源树的改动按提案“对 Spec 的预期改动”，随对应切片落地。
