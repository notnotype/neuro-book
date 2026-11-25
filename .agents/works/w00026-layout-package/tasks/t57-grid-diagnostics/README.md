---
schema: nbook.task/v2
taskId: t57-grid-diagnostics
status: done
updated: 2026-11-25
---

# 网格诊断有出口：工作台接 issues、拖动会话的约定有开发检查（摩擦第 4 组）

## 目标与范围

工作台把 WorkbenchSurface 的 issues 接到应用的诊断出口（开发者 11-23 定）；nb-layout 补摩擦第 4 组：漏调 settleMotion、漏标 data-drag-feedback 的开发检查，没接 onIssues 时的缺省出口，拖动会话的时序与先后写进说明

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 158、159；[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 5、23；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) “失败与恢复”的网格诊断一条与验收 34。计划见 [plan.md](plan.md)。

## 结果

2026-11-25 完成，三片由 coder 子代理实施，主会话审 diff、变基后自己复跑验证并合入 master：

- nb-layout：没给 `onIssues` 的 `useGridHost` 在开发检查打开时警告一次“没有出口”（输出 158）；`NestedGrid` 的 `dragging` 变真时过渡还在走就警告一次（输出 159，sync 侦听，同一次更新里改布局开始的过渡不算）；实时布局会话任何起拖（键盘、`live` 不给来源的也算）都先 `settleMotion()`（layout-drag 输出 23）。拖动会话的时序与先后、`invalidate()` 的时机写进包文档；README 起步例子、四个 Lab 场景与 desktop、tabbed-panels 两个示例补了 `onIssues`。
- 工作台：新的 `grid-diagnostics.ts` 把网格诊断与被拒的提交记进窗口的诊断，事件 `workbench.grid`，按码分 debug、warn、error；`WorkbenchShell` 的必填 prop `reportGridIssues` 由插件入口接上（workbench-layout 失败与恢复、验收 34）。
- 变异检查（coder 做，三项都让对应用例失败）：侦听改成 pre、会话改回旧顺序、拿掉外壳的 `@issues` 接线。
- 主会话复跑（变基后）：nb-layout 测试、typecheck、`api:check`，应用 typecheck、workbench 与 lab 的单元测试，`docs:check`、`governance:check` 都过；e2e workbench-shell、workbench-live-drag、lab-live-panels 全过，lab-scenes 变基后跑了四次（一次合跑、三次单独）都在就绪前超时（AddToolsDialog 两次、EditorGroup 一次、Lab 首页一次，负载 11 到 22），每次换一处、都不用 nb-layout；起点之后 master 没改 nb-layout、workbench 与 agent，按 coder 改后那轮完整跑出的结果算（只有原有的 ThemeEditor 404）。coder 的改前改后对照（应用 8 个文件、三个 Lab 文件、nb-layout 示例）结果一样。
- 接受的副作用：键盘拿起时即使没有可去的区域、拖动没开始，也先把过渡送到终点，滚动直接跳到终点；与“任何起拖都送到终点”一致。
- 没做：计划里的两步手工检查（开发服务 900 宽看 Verbose 控制台、临时拿掉 Lab 起步例子的 `onIssues`）；实时拖动期间 debug 条数没量；被拒提交的 warn 只有单元测试覆盖；nb-story 的拖动没在真实浏览器里拖过。

## 历程

2026-11-25 计划由规划子代理起草（先跑探针），主会话核对后定稿，四项待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)；编码派 coder 子代理，分支 `w00026/t57-diagnostics`，已合入并删除。实现审查并入 t56 到 t59 结束后的一次 omp 批量审查。
