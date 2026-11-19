---
schema: nbook.task/v2
taskId: t40-collapse-and-intent-writeback
status: active
updated: 2026-11-19
---

# 收起与展开入口、L2 的意图回写

## 目标与范围

按提案第一档第 5 项（从 t39 拆出），两件互不依赖的事：

- **L1 收起与展开的入口**：库提供设置面板收起状态的入口，内部找兄弟吸收差额（体验审查第 5 条）；写明 `restoreSize` 谁维护：谁收起谁记（第 6 条）。
- **L2 意图回写**：nb-workbench-layout 提供 `applyGestureCommit`、`rebaseForOperation`（t26 api-03），迁移工作台 store 的 `commitGesture` 与 Lab 的 `GridPanelsScene`。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新输出 147 到 149、失败 5 加一个 `field`；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 新输出 49。行为改变一处：不带 `restoreToShare` 的面板，分隔条上 Enter 恢复回到收起前的尺寸（原来回到建树时给的 `restoreSize`）；工作台每次从投影重建网格，不受影响。

## 当前状态

计划第 2 稿（[`plan.md`](plan.md)），送第二轮设计审查。待确认三条记进 [待确认清单](../../pending-confirmations.md)。

## 设计审查

第 1 稿（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，实验在真实 nb-layout 与 nb-workbench-layout 上跑）：11 条，阻断 0、重要 5、建议 6，都成立，改成第 2 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 照 Enter 的求解收起时没人能吸收，落账 `not-conserved`；Enter 今天也一样 | `setCollapsed` 改成翻标记、按分配重排，天然守恒；Enter 没人能吸收时保持展开、给 `no-room-to-collapse` |
| 2 | 照 Enter 的“邻居让位”会把保留像素的邻居撑大，和翻标记后重排不同 | 同上；两种语义在 Spec 分开写（待确认） |
| 3 | `resizeBranches` 把没动的被压缩的保留像素节点写成压缩值，放宽后回不去；`restoreSize` 的已知限制是同一根因 | 落账时没动的保留像素节点保留意图（新输出 151）；保留像素的面板 `restoreSize` 记意图 |
| 4 | 迁移漏了 `WorkbenchSurfaceFixture`、`EditorAreaFixture`；`rebaseIntents` 仍能漏参调用 | 四处都迁移；`rebaseIntents`、`fixedNodesOf` 不再从入口导出（待确认） |
| 5 | Lab 的 e2e 证明不了 Lab 的修正 | `lab-grid-panels.e2e.ts` 加一条窄视口拖动再放宽，迁移前确认红 |
| 6 | 没变化也会 `invalidate`；`solveSashCollapse` 返回 null 没对应；诊断第三个出口 | 翻标记的做法不经求解器；没变化不 `invalidate`；`setCollapsed` 自己没有诊断，重发布局的诊断照常经 `onIssues` |
| 7 | 程序收起不触发 `onApplied`，结果也不带记下的值 | 结果带 `collapse`（含 `restoreSize`）；不触发 `onApplied` 写进“不承诺” |
| 8 | 改 1184 的期望后 Grid 层没有“恢复读 `restoreSize`”的用例 | 另留一条从收起状态建树、恢复到 200 的用例 |
| 9 | store 加状态与插件侦听不值得（工作台里不可达） | store 不加，调用处注释写明；库照样交回 `rejected` |
| 10 | store 的 `presented` 在实时预览期间不更新，和 `before` 会分叉 | 工作台也用 `before`：Surface 发出、store 的 `commitGesture` 加参数 |
| 11 | 参照：VS Code 按优先级吸收、有读取入口、有双击重置 | 读取经结果的 `collapse` 与 `find`；双击重置不在范围 |

## 下一步

1. 第二轮设计审查，阻塞等结论。
2. 写 Spec（planned），开 worktree 按三片实施。
