---
schema: nbook.task/v2
taskId: t59-collapse-semantics
status: done
updated: 2026-11-25
---

# 收起与展开的语义统一（摩擦第 2 组）

## 目标与范围

统一展开回到哪并写在一处，setCollapsed 也通知 onApplied，策略加不能展开与刚性，useGridHost 补 setSize；IDE 示例的绕法随之删短（0.x 不兼容改动）

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 166 到 171，输出 20、147 到 150、154、诊断 `no-room-to-collapse`、失败 5 `collapse-locked`、已知限制与不承诺的 planned 改动。计划见 [plan.md](plan.md)，探针与使用方清单在 [evidences/](evidences/)。

## 结果

2026-11-25 完成，分两段由 coder 子代理实施（片 1 到 4 内核，片 5、6 宿主、示例与文档），主会话每段审 diff、变基后复跑，最后整段验收并合入 master：

- 展开回到意图（输出 166）：网格节点的收起策略去掉 `restoreSize`、`restoreToShare`（独立 `Splitter` 改用 `SplitterCollapseState`，`restoreSize` 只在那里）；分隔条上的 Enter 与区段按钮改成翻标记后按意图重排，能翻时结果同 `setCollapsed`，放不下或没人吸收时拒绝（输出 20、147）。
- 落账保住意图（输出 167）：意图本来就布局出目标时一个也不改（R1），窄窗口里 Enter 不再把旁边保留像素的面板写窄；反解后还有收起着的按比例分的孩子时按同一倍数缩回原来的和（R2）。
- 锁（输出 168、失败 5 `collapse-locked`）与刚性（输出 169）；`setCollapsed` 多了 `options.locked`；nb-story 第二张卡改用锁。
- 宿主（输出 149、150、170、171）：`onApplied(change, before)` 统一接手势、`host.setCollapsed`、新的 `host.setSize` 三种落账，`invalidate()` 不通知；工作台、Lab、nb-story、tabbed-panels 跟着改。
- ide 示例改用锁、刚性的条与 0 宽接缝、按意图直接建树：`model.ts` 395 行到 370 行，`App.vue` 414 到 411。
- 文档：`grid.md` 新写“收起与展开”一节，useGridHost、NestedGrid、Splitter、README、两份 CHANGELOG 跟着改；API 报告与插件 SDK 快照重新生成。

改了期望的旧用例（旧 → 新）：b|c 上的 Enter `[400,800,0]` → `[600,600,0]`；从收着建树再按 Enter，c 不再取 restoreSize 200，得 `[400,400,400]`；拖动后 Enter 再 `setCollapsed` `[375,625]` → `[600,400]`；`setCollapsed` 不触发 `onApplied` 改成标记变了通知一次；ide 示例窄窗口最小总宽 692 → 684（条旁的线变成 0 宽）、条旁分隔线改断言 `sashSizes`、“分隔线把它展开了也收回去”改成“区锁住：拖与 Enter 都不提交”。删掉“恢复尺寸谁收起谁记”与 restoreToShare 两条。

- 变异检查（coder 做）：第一段 14 项都红（R1、R2、两种拒绝、锁的四处、刚性的六处）；第二段宿主 4 项、示例 2 项都红，ide e2e 的文件头说法逐条实测。
- 主会话复跑（合入前、变基后）：nb-layout 测试（bun 709、vitest 369）、typecheck、`api:check`、`build:package`；nb-workbench-layout 测试与 typecheck；nb-story typecheck 与 `src/web/shell`；应用 typecheck、`src/sdk`、workbench 与 lab 的单测；`docs:check`、`governance:check`；两份构建。负载 4 时 e2e：应用 4 个文件 78 passed，nb-story `frame` 8 passed，nb-layout 示例 48 passed。`release:smoke` 由第二段 coder 在干净工作树上跑过（过）。第一段起点的基线有 5 条负载下的 Lab 超时与 1 条 desktop 时序失败，改后都过。
- 开发服务走查（worktree 自己的状态目录，不碰主工作区的开发服务，不减弱动效）：侧栏两个分节，Enter 421 → 32 → 421，兄弟吸收再还回；搬成三个分节（420、210、210），Enter 收起第一节后两兄弟各 404，展开回到 420、210、210；底部面板挨着编辑区的边界 Enter 200 → 0 → 200。页面错误与控制台的 error、warning 都没有。

与计划的偏离：

- 片 2 加了内部类型 `GridBranchPanelConfig`（`vue/grid-splitter.ts`，不导出）：网格节点投影带不出 `restoreSize`，直接用 `SplitterPanelConfig` 过不了 vue-tsc。
- 片 3 在 `Splitter.vue` 的 `panelConstraintsKey` 加了 `locked`：不加时宿主改锁，会话输入不重建。
- 片 1 没加“侧栏三个分节”的 e2e：要先搬视图进侧栏，改在 `workbench-shell.e2e.ts:445` 断言下面那个分节的吸收与回到原高；三个分节在开发服务上看过（上面）。
- ide 示例的锁按“条是否为空”每次重算，不按计划在 `moveTool` 里给：草稿漏了收着、什么也没显示的区被搬空时没上锁。
- `host.setCollapsed` 落账后 `onIssues` 再抛错，现在像手势一样被接住交 `reportError`，不再冒到调用方（同走 `applyAndNotify`，已写进 CHANGELOG）。
- Spec 输出 148 标已删除，它说的“原地 `restore` 回落到当前树”挪进输出 165。
- 已知限制加一条（主会话定，不改代码）：一个分支里只有保留像素的孩子、还有没人吸收的留白时，Enter 展开的预览按呈现的总量重排，比松手后的布局小（例 `[a 200 收着, b 200]` 在 604 宽里预览 `[100,100]`，落账回到 `[200,200]`）。手势提交要守恒，预览用不到留白。

没做：刚性的分支在布局里被压的情况没有用例（只在恢复与 clone 里出现）；工作台的活动栏、状态栏、入口条照待确认 5 没标 rigid；`PLUGIN_API_SINCE` 发版时再改。nb-layout 0.3.0 还没发布。

## 批量实现审查（t56 到 t59）

2026-11-25 按开发者定的方式，t59 合入后把 t56 到 t59 整段（按路径限定，排除范围里别的会话的三个提交）交 omp `@review` 一次只读审查，约 30 分钟跑完：阻断 0、重要 1、建议 0（[报告](evidences/impl-review-omp-t56-t59.txt)）。

- 重要 1（t58，成立，已改）：`grid.clone()` 把调用方传进来的选项对象原样留着，调用方建完网格再改它，副本的 `sashSize`、`encodeRef` 就和原网格不一致（审查者复现：原网格 4、副本 12；`old:x` 对 `new:x`）。改成建网格时浅拷一份选项，`clone` 用这份（`ecbb377ca`）；补在 `clone` 相等那条用例里，变异检查（改回原样留着）让它失败；nb-layout 全量测试与 `api:check` 通过。
- 审查者另提一句 `NestedGrid.dom.test.ts` 里“记忆尺寸”的旧用词，断言已经是回到意图，不另改。

## 历程

2026-11-25 计划由规划子代理起草（先跑探针，在 t57、t58 合入之前的 master 上），主会话核对后定稿，Spec 编号顺延到 166 起；待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)。t58 合入后开 worktree，分两段派 coder，分支 `w00026/t59-collapse-semantics`，已合入并删除。实现审查并入 t56 到 t59 的一次 omp 批量审查。
