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

计划第 3 稿（[`plan.md`](plan.md)），不再送审，实现审查兜底。待确认记进 [待确认清单](../../pending-confirmations.md)。Spec 已写（planned，`7fcb45bd6`）。实施中：worktree `w00026-t40-collapse`（分支 `w00026/t40-collapse`）。

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

第 2 稿（第二轮，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)，实验在真实源码上跑）：8 条，阻断 1、重要 1、建议 6，都成立，改成第 3 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 第 2 稿的“落账时没动的保留像素节点保留意图”和 Enter 的邻居吸收预览冲突，窄窗口里收侧栏以 `not-finite` 整批拒绝 | 这条规则拿掉，记为已知问题；根治要把 Enter 与按钮改成翻标记重排，改已实现的输出 20，交开发者（待确认清单） |
| 2 | 按比例分的面板经 `setCollapsed` 与 Enter 往返不一致 | 写进 Spec 输出 147，带数字，加验收 |
| 3 | 全部收起时整行留白、没有诊断 | 允许，写进“不承诺”，加验收 |
| 4 | `before` 要在 `resizeBranches` 之前取 | 写明在 `onGestureCommit` 入口快照；验收断言与之后的布局不同 |
| 5 | 迁移漏了 `WorkbenchShell.vue`、`.md`；store 测试是 7 处；`presented` 的分工写错 | 补全；分工改成“手势落账用 `before`，结构操作与可见标签用 `presented`” |
| 6 | `boundary.test.ts` 不断言导出面；`GridCollapseResult` 要进显式清单 | 新开 `entry.test.ts`；类型进 `index.ts`；SDK 不受影响（插件建不出网格），不写变更记录 |
| 7 | 两处容差被说成同一条规则 | 第 1 条拿掉后只剩 L2 的 0.5px，照原值，注释如实写来由没有记录 |
| 8 | 新 e2e 可能空过；`host.setCollapsed` 没有真实浏览器验证 | e2e 先断言已被压缩；`GridStructureScene` 加按钮与一条 e2e |

## 实施记录

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `ad94cb1a3` | `Grid.setCollapsed`、`GridCollapseResult`；收起时记 `restoreSize`；Enter 另一侧吸收不了时不收；`grid.md` |
| 2 | `70a5c25c0` | `host.setCollapsed`；`onApplied` 的 `before`；`NestedGrid.md`；Lab 结构场景的收起按钮与 e2e |
| 3 | 待提交 | `intent-writeback.ts`（两个入口，`rebaseIntents`、`fixedNodesOf` 不再导出）；工作台 Surface、Shell、store；三个 Lab 夹具 |

验证：

- 第 1 片：
  - nb-layout 370 与 244 条、类型检查通过；
  - 新用例 6 条，四个变异（不记 `restoreSize`、保留像素的也记基线、`changed` 恒真、去掉 Enter 的守恒判定）都会红；
  - `grid.test.ts:1184` 改成记录后的行为，另加一条从收起状态建树、恢复读 `restoreSize`。
- 第 2 片：
  - nb-layout 247 条、应用类型检查通过；
  - 三个变异（`before` 取成落账后的布局、没变化也重发、变了也不重发）都会红；
  - `lab-grid-structure` 14 条：新加的收起入口那条过，1 条在负载 20 时等 Lab 就绪超时，单独重跑通过。
- 第 3 片：
  - `lab-grid-panels.e2e.ts` 新加的意图回写用例，迁移前跑是红的（放宽后侧栏停在 209，回不到 280）；
  - 开始时把视口放大不管用（Lab 盒子的宽由地址的 `vp` 定），改用 `vp=1400x800` 打开、键盘调盒子的宽；
  - L2 新测试 6 条，两个变异（手势路径不冻结、结构操作路径不冻结）都会红；L2 267 条、store 49 条、应用类型检查通过；e2e 六个文件在跑。

## 下一步

1. 第 3 片的 e2e 跑完后提交；收口验证（`test:affected`）；实现审查（Claude Sonnet，不阻塞）；合入；晋升。
