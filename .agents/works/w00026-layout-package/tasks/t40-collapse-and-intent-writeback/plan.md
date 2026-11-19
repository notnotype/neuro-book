# t40 收起与展开入口、L2 的意图回写：实施计划（第 1 稿）

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档“库里补的小东西”的第 3、4 条；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 从 t39 拆出（[待确认清单](../../pending-confirmations.md)）。
- 两件事各在一个包、各有一份 Spec，彼此不依赖，可以分开审、分开合入：
  - **L1 收起与展开的入口**（体验审查第 5、6 条，[`t31 evidences/experience-review.txt`](../t31-general-layout-library/evidences/experience-review.txt)）：
    - 今天第三方想让一块面板收起或展开，只能自己调 `resizeBranches`：从布局里读出父分支每个子节点此刻的像素当基线，自己算守恒的目标，再把 `collapsed` 带上。体验审查者写了 22 行。
    - `SashCollapsePolicy.restoreSize`（显式恢复回到的尺寸）库里没有任何地方更新它。用户把左栏拖宽、再收起，按 Enter 恢复时回到建树时给的值。
  - **L2 意图回写**（t26 深度审查 api-03，[`t26 evidences/deep-review-api.txt`](../t26-layout-deep-review/evidences/deep-review-api.txt)）：
    - 手势落账后，宿主要手写约 20 行把结果写回布局文档（工作台 `layout-doc-store.ts` 的 `commitGesture`）：
      - 收起状态写到区域的锚上；
      - 拉开隐藏的区域时清掉隐藏；
      - 挑出“这次没动的保留像素节点”（容差 0.5px）；
      - 再 `rebaseIntents`。
    - 结构操作之前要先 `rebaseIntents(…, collapsedTo, fixedNodesOf(…))`。
    - 漏任何一个输入都不报错，只是过一会儿布局不对。Lab 的 `GridPanelsScene` 就漏了：它不传 `frozen`，也不按锚记收起。
- 开发者已确认的决定：上面两条照提案做；形状在 Spec 里定（提案原话“形状在 Spec 里定”“推荐谁收起谁记”）。

## 技术选型

无。

## 关键设计

### L1 收起与展开的入口：`packages/nb-layout/src/grid.ts`

`Grid` 加一个方法：

```ts
setCollapsed(id: string, collapsed: boolean, container: GridExtent): GridCollapseResult;

type GridCollapseResult =
    | {ok: true; intents: Readonly<Record<string, GridExtent>>; collapsed: Readonly<Record<string, boolean>>; issues: readonly GridIssue<GridIssueCode>[]}
    | GridFailure<GridFailureCode>;
```

- 走和分隔条 Enter 同一条路，不另写求解：
  1. 用 `layout(container)` 取父分支直接子节点此刻的主轴像素当基线；
  2. `branchSashPanels(父分支, sashSize)` 给出面板，交给 `solveSashCollapse`，算出守恒的目标；
  3. 把基线、目标与 `collapsed` 交给 `resizeBranches`，原子落账。
- 哪一侧让位：面板后面有兄弟时用它后面那条分隔条（后面的兄弟按“由近到远”让位，与 Enter 相同），它是最后一个时用前面那条。这个规则写进 Spec。
- 容器尺寸由调用方给：`Grid` 不记上一次布局，基线必须和宿主看到的布局同一个容器算。
- `toggleable: false` 不过滤：`toggleable` 只决定分隔条上的 Enter 挑哪一侧；按 id 调用的调用方已经选定了对象，和直接调 `solveSashCollapse` 一样（`grid-types.ts` 的注释已经这样写）。
- 结果：
  - 已经是那个状态：`{ok: true}`，`intents`、`collapsed` 为空，树不变。
  - 恢复时空间不够：`{ok: true}`，`collapsed` 为空，`issues` 带 `no-room-to-restore`，树不变。这和 Enter 一致：这种情况不是失败，是保持收起。
  - 失败都沿用现有的码与参数，只加一个 `field` 值：
    - `id` 不存在：`not-found`；
    - `id` 是根：`invalid-argument`，`field: "root"`（同 `resize`）；
    - 没有收起策略：`not-collapsible`，参数 `id`、`branch`；
    - 容器尺寸不可用（非有限或不大于 0）：`invalid-argument`，`field: "container"`，`value` 写成字符串。这是新加的 `field` 值，失败 5 的表要补。
  - 不发 `no-collapse-policy` 诊断：按 id 调用时“没有策略”是调用方的错，用失败表达。手势路径照旧发这个诊断。

### L1 `restoreSize` 由谁维护：同一文件的 `resizeBranches`

- 谁收起谁记：`resizeBranches` 落账时，一个子节点的收起状态从展开翻成收起，就把它的 `collapse.restoreSize` 改成这次变化的基线（收起前呈现的主轴像素），下限是 `collapsedSize`。
- 拖动收起、分隔条上的 Enter、`setCollapsed` 都经 `resizeBranches`，所以只有这一处写。
- 记的是呈现的像素，不是意图：
  - 对按比例分的面板，意图是权重，给不出像素，所以只能记呈现的像素。
  - 已知限制：面板收起时正被压缩（放不下），记下的是压缩后的尺寸，恢复回到这个较小的值。保留像素的面板意图里还留着原值，下一次布局按意图给，影响只在 Enter 那一下。写进 Spec 的“不承诺”。
- 带 `restoreToShare` 的面板照样记，只是不读。
- 收起策略不写快照（不变）：
  - `restore()` 的解析结果没给 `collapse` 时沿用当前树的，记下的值保留；
  - 宿主自己记收起策略、要跨会话保存的，从 `find(id)` 读 `collapse.restoreSize`。这一句写进 Spec。
- 工作台不受影响：它每次从投影重建网格，收起策略的 `restoreSize` 每次由投影按意图给（`layout-project.ts:111`）。
- 为什么不废掉 `restoreSize`、改成“显式恢复回到意图”：
  - 对保留像素的面板，意图本来就是记忆。
  - 但按比例分的面板的意图是权重，没有像素记忆；不带 `restoreToShare` 时只能靠 `restoreSize`。
  - 所以保留字段、补上维护者，改动最小。

### L1 Vue：`packages/nb-layout/src/vue/useGridHost.ts`、`useGridLayout.ts`

- `GridHost` 加 `setCollapsed(id: string, collapsed: boolean): GridCollapseResult | GridFailure<"not-ready">`：
  - 用宿主此刻的尺寸（`extent`）调 `grid.setCollapsed`；
  - 树有变化（`intents` 非空或 `collapsed` 非空）时 `invalidate()`，版本递增、布局重发；
  - 没有可用尺寸或没有网格时返回 `not-ready`（`missing: "host-size"` 或 `"grid"`，同失败 6 的码），不改树。
- 这样 Vue 宿主收起一块面板只写一行。不经它、直接调 `grid.setCollapsed` 的宿主要自己 `invalidate()`：和别的结构操作一样，Spec 写明。
- 进行中的手势：`invalidate()` 让版本递增，那场手势的提交按 `stale-revision` 被拒、预览回滚（失败 6 已有的行为）。Spec 写明。
- `onApplied` 不为 `setCollapsed` 触发：`onApplied` 是手势提交的落账通知，带 `GridGestureCommit`；`setCollapsed` 的结果直接交回调用方。Spec 写明，免得在 `onApplied` 里存盘的宿主以为两条路都会到。
- `onApplied` 加第三个参数 `before: GridLayoutResult`：这次提交之前发布的布局，也就是手势开始时宿主呈现的布局。
  - 理由：L2 的 `applyGestureCommit` 要比较提交前后的尺寸，才能挑出没动的保留像素节点。
  - 今天工作台靠 store 里记的 `presented`：它由 Surface 的 `watch(host.layout)` 更新，`onApplied` 同步跑在这个侦听之前，所以读到的还是旧值。这是靠侦听先后碰巧成立的。
  - 第三方照抄时读不到这个先后，所以由库直接交出。
  - 工作台的 store 继续用自己的 `presented`：它本来就要记呈现尺寸（可见标签的计算要用），两者是同一个值。`commitGesture` 的签名不变，store 的测试不用改。

### L2 意图回写：`packages/nb-workbench-layout/src/layout-doc.ts`（从入口导出）

```ts
/** 手势落账后写回文档：收起记到锚上、拉开隐藏的区域时清隐藏、没动的保留像素节点不写，再写回意图。 */
export function applyGestureCommit(doc: LayoutDoc, projection: LayoutProjection, gesture: {
    readonly before: Readonly<Record<string, GridExtent>>;
    readonly after: Readonly<Record<string, GridExtent>>;
    readonly collapsed: Readonly<Record<string, boolean>>;
}): {readonly doc: LayoutDoc; readonly rejected: ReadonlyArray<{readonly id: string; readonly failure: GridFailure<LayoutFailureCode>}>};

/** 结构操作之前把呈现尺寸写回意图；保留像素的节点不写（它们的呈现只可能是被压缩了）。 */
export function rebaseForOperation(doc: LayoutDoc, projection: LayoutProjection, presented: Readonly<Record<string, GridExtent>>): LayoutDoc;
```

- 两个函数都是把工作台现有代码原样搬进库：
  - `applyGestureCommit` 是 `commitGesture` 去掉 `presented` 赋值与 `schedule` 的部分，加上 `untouchedFixed`；容差 0.5px 成为库里的常量，不导出。
  - `rebaseForOperation` 是 `rebased()`。
- 被拒的收起与显隐写入跳过、其余照常写回（同今天），但不再吞掉：逐项交回 `rejected`。
  - 今天 `commitGesture` 对 `setPanelCollapsed`、`setPanelHidden` 失败时静默跳过。它们有合法的拒绝：底部面板的分节不收、区域只剩一节时那一节不收、编辑组不收、浮动窗不收（`layout-doc.ts` 的 `setPanelCollapsed`）。
  - 投影只给文档收得起的节点配收起策略（`layout-project.ts` 的 `assignByParent`：底部面板一排不配，区域只剩一节时状态记在锚上），所以工作台里出现拒绝说明投影与文档的规则对不上。
  - 不改成“整次失败”：那样一项被拒会连带丢掉这次手势的尺寸写回，比今天更糟。
- 工作台的 store 拿到非空的 `rejected` 时：
  - 文档照常更新；
  - 记一条诊断：store 加 `state.writebackRejected`（最后一次的被拒项），`plugin.ts` 照 `structureFailure` 的做法侦听它，记 `workbench.layout.writeback` 警告；
  - 不回滚网格：它下一次按文档重投影，回到文档的样子。
- 不经 `fitsSkeleton`、`settleContainers`：收起与隐藏不改树的形状，也不改入口顺序；这两步留在工作台的 `apply` 里（今天 `commitGesture` 也不经它们）。
- 迁移：
  - 工作台 `layout-doc-store.ts`：`commitGesture` 改调 `applyGestureCommit`，`rebased` 改调 `rebaseForOperation`；删掉 `untouchedFixed`。
  - Lab `GridPanelsScene.vue`（以 t39 分支上的版本为准，它已经用 `useGridHost`）：
    - `onApplied` 改调 `applyGestureCommit`，`before` 取 `onApplied` 的第三个参数；
    - `commit` 改调 `rebaseForOperation`。
    - 这是行为修正，不只是换名：它今天不传 `frozen`、不按锚记收起，`lab-grid-panels.e2e.ts` 要跑。

## Spec 与文档改动

- [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)：
  - 新输出 147“收起与展开的入口”（planned）：`setCollapsed` 的语义、哪侧让位、不过滤 `toggleable`、三种结果。
  - 新输出 148“恢复尺寸谁收起谁记”（planned）：记什么、何时记、压缩时的已知限制、快照与 `find`。
  - 新输出 149“宿主的收起入口与提交前的布局”（planned）：`host.setCollapsed`、`invalidate` 与进行中的手势、`onApplied` 不为它触发、`onApplied` 的 `before`。
  - 输出 20 的“记忆的恢复尺寸”链到 148。
  - 失败 5 的 `invalid-argument` 加 `field: "container"`。
- [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)：
  - 新输出 49“意图回写的两个入口”（planned）：`applyGestureCommit` 的四步、被拒的项跳过并交回；`rebaseForOperation` 不写保留像素的节点。
  - 输出 8 链到 49。
  - 实现合同的“公开入口”加这两个名字。
- 包内文档：
  - `grid.md` 加 `setCollapsed` 与 `restoreSize` 的维护者；
  - `NestedGrid.md` 的“接入”加一段收起与展开的写法（`host.setCollapsed`）；
  - `grid-types.ts` 里 `restoreSize` 的注释改成“收起时由 `resizeBranches` 记下”。

## 切片

1. **L1 核心**：`setCollapsed`、`restoreSize` 的记录、失败的 `field`；`grid.test.ts`。改 `grid.test.ts:1184`“连按几轮不漂”的期望：现在恢复回到收起前的 400，不再是建树时的 200；用例名改成说明这一点。提交 `feat(nb-layout)`。
2. **L1 Vue**：`host.setCollapsed`、`onApplied` 的 `before`；`useGridHost.dom.test.ts`、`useGridLayout.dom.test.ts`；`NestedGrid.md`。提交 `feat(nb-layout)`。
3. **L2 与迁移**：两个函数与测试；工作台 store、Lab `GridPanelsScene`。提交 `feat(nb-workbench-layout)`。

每片自跑：nb-layout（或 nb-workbench-layout）的 `bun test` 与 `bunx vitest run`、应用 `bun run typecheck`；第 3 片另跑工作台 store 测试与下面的 e2e。

## 验收映射

| Spec | 测试 |
|---|---|
| `ui/nested-grid` 输出 147 | `grid.test.ts`：收起与展开（后面的兄弟让位、最后一个时前面的让位、守恒）；已是那个状态；恢复空间不够给 `no-room-to-restore`；`toggleable: false` 照样收；失败四种（`not-found`、根、`not-collapsible`、`container`）。 |
| 输出 148 | `grid.test.ts`：拖宽后经拖动收起、经 Enter 收起、经 `setCollapsed` 收起，三条路的 Enter 恢复都回到收起前的尺寸；`restore()` 不给 `collapse` 时记下的值保留；被压缩时记的是压缩后的值。 |
| 输出 149 | `useGridHost.dom.test.ts`：`host.setCollapsed` 后版本递增、布局重发；没有尺寸时 `not-ready`、树不变；`onApplied` 不触发。`useGridLayout.dom.test.ts`：`onApplied` 的 `before` 是提交前发布的布局（与 `after` 不同）。 |
| 失败 5 的 `container` | 同 147。 |
| `ui/workbench-layout` 输出 49 | `nb-workbench-layout` 的 `layout-doc.test.ts`（真实 `projectLayoutDoc`）：<br>- api-03 的复现：窗口窄到侧栏被压缩，拖编辑区与面板之间的边界，再放宽，侧栏回到原宽；把容差判定去掉会红。<br>- 单分节区域拖到零，记在锚上，不记在分节上。<br>- 隐藏的区域从边界拉开，隐藏清掉。<br>- 被拒的收起（例如底部面板的分节）跳过并出现在 `rejected` 里，尺寸照常写回。<br>- `rebaseForOperation` 不写保留像素的节点。 |
| 工作台的行为不变 | `layout-doc-store.test.ts` 原样通过；e2e `workbench-shell`、`workbench-containers`、`workbench-views`、`editor-area`、`lab-workbench-surface`。 |
| Lab 的修正 | `lab-grid-panels.e2e.ts`。 |

## 验证

- 每片的单元测试与类型检查（见切片）。
- e2e：第 3 片之后跑上表六个文件（不到 8 个）；先看负载。
- 收口：`bun run test:affected --since master`。
- 未验证的边界：第三方在 `useGridHost` 之外自己调 `grid.setCollapsed` 又忘了 `invalidate()`，没有机检；只在 Spec 与 `grid.md` 写明。

## 不做与风险

- 不做 `toggleCollapse`：有 `setCollapsed` 加 `find(id).collapse.collapsed` 就够了。
- 不给 `onApplied` 之外的通知。
- 不改工作台 `commitGesture` 的签名：它的 `presented` 与 `before` 是同一个值。改了要动 store 的测试，换不来什么。
- 风险：`restoreSize` 的记录改变了不带 `restoreToShare` 的面板的 Enter 恢复结果。
  - 仓库里只有 Lab 的 `GridStructureScene` 与 `grid.test.ts` 用这条路。
  - 搜过 e2e，没有断言 Enter 恢复的像素值；切片 1 再用 `git grep restoreSize` 核一遍。
- 风险：工作台多一条诊断路径，只在投影与文档的收起规则对不上时走到。

## 待确认

1. `setCollapsed` 放在 `Grid` 上，同时在 `useGridHost` 上给一个用宿主尺寸的版本（推荐）。另一种做法是只放在 `Grid` 上，宿主自己传尺寸、自己 `invalidate()`：库的接口少一个，但每个宿主多两步、多一个会忘的。
2. `restoreSize` 记呈现的像素，不记意图；压缩时的结果作为已知限制（推荐）。
3. `onApplied` 加 `before`（推荐）。另一种做法是让第三方照工作台那样自己记呈现尺寸：靠侦听的先后碰巧成立。
