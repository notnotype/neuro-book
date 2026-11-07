---
schema: nbook.task/v2
taskId: t20-drop-rules
status: active
updated: 2026-11-07
---

# 落点按缝与边重排，预览改成空位

## 目标与范围

开发者 2026-11-07 试用 t08、t09 之后提的要求：

- 落点：中央并入同一标签组；四周往这个方向分屏；缝插到两个窗口之间。限制是去掉落点：骨架 `活动栏 | 侧栏 | 编辑区 | 右栏` 不许中途插入，侧栏只上下分，面板只左右分。
- 四周两种语义都支持（只分本窗口、同方向一起分）。“要考虑某些面板可能是固定的”：编辑区分屏不能分走侧栏的空间。
- 面板上被拒绝时松手取消；只有窗口外、标题栏、状态栏这些没有面板的地方才开浮动窗。
- 头的样式：工具面板一个视图只写标题，多个视图画标签带；侧栏这一列总是只写标题；编辑组总是标签条。
- 三个 bug：侧栏全部收成标题行时整页变矮；还没落下就显示标题头（Trellis 不是这样）；并入标签时面板应变暗加边框，样式可配置。
- 可以 clone Trellis 参考：副本在 `.local/trellis`（不入库，许可证与 AGPL 不兼容，只读行为，不抄代码）。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md)。计划见 [`plan.md`](plan.md)。

执行位置：`.worktree/w00026-t20-drop-rules`，分支 `feat/w00026-t20-drop-rules`。

## 当前状态

片 1（全部收起不再变矮）已修：根因是分支在交叉轴上的上限取了子节点的最小值，一列全收起后上限只剩 65px，把整行压扁（860 高的窗口整页只剩 223）。改成取最大值。

开发者 2026-11-07 确认计划（四周缺省只分本窗口）。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，16 条：重要 10、建议 6）的处理：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 `between` 两端为 null 定位不了 | 成立，改 | 不动 `between`，加 `spread{panel, edge}`：摘掉来源后按幸存的 `panel` 找父分支，分支塌陷就按 `split` |
| 2 均分的总量与 n 没定义 | 成立，改 | 计划写成函数规则，复用 `countsInShare`；不叫“均分”，设置值是 `shared` |
| 3 编辑组下缘挨着面板时不对称 | 成立，改 | `spread` 插在面板之前，面板固定不动 |
| 4 缝的几何 | 成立，改 | 纯函数 `layoutSeamsOf`，相邻性按几何判；几何加 `frame`；预备区排在缝之后 |
| 5 6px 的依据读错 | 部分成立 | Trellis 半径是 `max(缝宽, 4)`，默认缝宽 6，所以也是 6，不是起拖门槛。保留 6（已告诉开发者要手试）；`SEAM_PX` 是另一件事（缝归哪块） |
| 6 键盘到不了缝 | 成立，改 | 候选列缝，`pointOfCandidate` 给缝的中点 |
| 7 别人的标签条用 `removeTab` 会卸实例 | 成立，改 | 别人的标签条也拿卡片；插入线画在盖层里 |
| 8 盖层矩形借 `previewRevealRects` | 成立，改 | 新写 `previewPanelRect`；`previewable` 为假不画盖层 |
| 9 预备区不能一律不画头 | 成立，改 | 只有“来源是这块唯一的标签”才是空位；有自己标签的走并入 |
| 10 被拒绝和 `layoutDropPanelAt` 不是一个意思 | 成立，改 | 新写 `layoutDropOverPanel` |
| 11 被拒绝没有通道，光标压不过 | 成立，改 | `rejected` 引用，标记写在根元素；文件拖动不给光标反馈（Spec 写明） |
| 12 设置路径与 `moveView` | 成立，改 | 传 getter；`moveView` 直接用 `edgeTargetOf`；`seamAccepts` 缺省没有缝落点 |
| 13 令牌与文案 | 成立，改 | 令牌登记三处；文案用现有的“添加为标签”；落点指示模式不改 |
| 14 头的取值来源 | 成立，改 | 都按已提交文档；Spec 写活动栏隐藏、`role`、没有插入位 |
| 15 缝上的分区 | 成立，改 | 缝上没有分区 |
| 16 验收映射 | 成立，改 | 补进计划 |

实现（三片加修正）：`7508c77e6` 落点规则，`40847dd9d` 预览，`4939e3e65` 头的样式，修正单独一提交。和计划不同的地方：

- 判定顺序里缝先于标签条（Trellis 同样）；文案用现有的“添加为标签”。
- `homeOf` 去掉了 `shown` 参数：卡片总从已提交的面板缩，不用看预览。
- `settleEmptyPanel` 提到 `placeLeaf` 之前（实现审查 2）。

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，8 条：重要 1、建议 7）的处理：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 嵌套分支的缝不对称 | 不成立 | `V[sidebar, H[x,y], z]` 进不来：列只上下分，`fitsSkeleton` 拒绝。实验绕过了骨架。不改 |
| 2 拖空的具名来源还占份额 | 成立，改 | 先隐藏再放，补尺寸不等的用例 |
| 3 `shared` 放到面板上缘从编辑区取空间 | 不成立 | 工作台里面板这一排没有上下边（`layoutEdgeTarget` 返回 null，算中央），只有库的缺省策略能走到。不用问开发者 |
| 4 缝宽为 0 时键盘落到邻列的缝 | 不成立 | 除条两侧外缝至少 1px（输出 5），这时外层缝的中点在别的缝的交叉范围外 |
| 5 提示条上被拒绝会开窗 | 成立，改 | `layoutDropOverPanel` 量 `frame`，补用例 |
| 6 原位被当成空位 | 不成立 | `candidateDoc` 开头 `drop.inPlace` 就返回 null，`shownAction` 也是 null，走不到 `slotPanel` |
| 7 测试缺口 | 成立，改 | 补“移动到”不跟设置走的 e2e，恢复全序断言；`homeOf` 的旧契约删了，所以旧用例不恢复 |
| 8 类型断言 | 成立，改 | `pointOfCandidate` 用分支收窄；`asDoc` 一处 |

验证：`test:affected --since master --typecheck` 只有已知失败（`plugins/agent` 的跨插件导入、`permission-page`、`AgentModeSwitchWizard`、`qa-service`）；`actions.test.ts`、`asset-urls.test.ts` 负载高时各超时一次，单独跑通过。e2e：`workbench-dnd`、`workbench-float`、`workbench-live-drag` 修正后 69 过；`workbench-views`、`workbench-shell`、`editor-area`、`files-explorer`、`lab-grid-panels` 头的样式那片后过，`editor-area` 的实时布局部分修正后再跑过。亮色截图看过空位、并入、被拒绝。

收尾时加的：状态栏成了开窗的主要入口，新开的窗整个夹回树区域（`workbench-float` 13 条加新用例过）。

未验证：`LAYOUT_SEAM_HIT_PX = 6` 的手感；文件在工具面板上被拒绝时没有光标反馈（Spec 写明）。

不做：一排全部拖到零时留下空白带（开发者没提）。

## 下一步

开发者手试：放到缝、四周两种分法、并入盖层、空位、被拒绝、头的样式。
