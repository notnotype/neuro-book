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

2026-11-05 开工：要点已交开发者确认，确认后才写提案与 ADR。

待定（括号里是建议）：

1. 编辑区边界：取消，编辑组只是一种面板（建议），或保留子树。取消后 `(A | B) | C` 的跨边界分歧没有了；工具视图可以停在编辑器旁边，只是不能和编辑器同一组标签，放到编辑组中央仍是浮动；至少留一个编辑组。
2. Part：标题栏、状态栏留在树外；活动栏留在树外，改成工具条，列出全部工具视图，点击显示、隐藏或聚焦，不管视图停在哪，手机底部导航用同一份数据（建议）。侧栏、右栏、面板、编辑区不再是固定区域，变成默认布局里有名字的节点；插件的 `location` 只决定第一次放哪，SDK 不改。
3. ViewContainer：取消，带标签的面板就是组，多个视图同屏就是树里分开的面板，可以收成标题行（建议）。失去的是“点一个入口，一组视图一起切换”。
4. 面板命令：删位置与对齐（拖动就能摆），保留显隐、拖到零、最大化，最大化对任意面板生效（建议）。
5. 紧凑呈现：删除，窄于 800 一律手机呈现（建议），t01 决定 9 原来写的是 600。

按建议写、不再单独问：每个标签一个编辑器实例（首次激活才建）；布局记录合成一条树文档，不迁移旧记录，尺寸丢一次；绑定项目时按项目存，否则按用户存；拖动时隐藏的具名节点继续浮出预备区。

## 下一步

开发者定完上面五条后写提案、ADR 与 Spec 改动清单，再按 `reviewing` Skill 审查。
