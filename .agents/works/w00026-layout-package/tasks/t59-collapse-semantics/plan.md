# t59 实施计划：收起与展开的语义统一（摩擦第 2 组）

探针在 [evidences/](evidences/)（`probe.probe.ts.txt`，输出 `probe-output.txt`，跑在 master `8a29a5514` 上，t57、t58 合入之前）；ide 示例改写草稿与行数在 `/tmp/claude-1000/w00026-plans/t59-probe/ide-draft/`（不入库），使用方清单 [evidences/consumers.txt](evidences/consumers.txt)。

## Context

- **要解决的问题**：t50 摩擦记录第 2 组，条目 4、17、19、35、41、42、45、47、55、56。
  - 展开回到哪有两个来源：`setCollapsed(false)` 回到意图，分隔条上的 Enter 回到 `restoreSize`。收起时 `restoreSize` 还会被改写。宿主猜不出存档该存什么。
  - `host.setCollapsed` 不走 `onApplied`，存档要接两处。
  - 没有“这块区此刻不能展开”。
  - 保留像素的条会被级联挤到 0，窗口太窄时也被一起压。
  - `useGridHost` 没有 `setSize`。
  - 收起到 0 的区两侧留两条分隔线的缝。
- **怎么来的**：开发者 2026-11-25 同意按推荐顺序做 t56 到 t59。t59 排在 t58 之后，进 0.3.0。0.x 的不兼容改动可以做，记进 `CHANGELOG.md`，本 Task 不发版。
- **工作方式**（开发者 2026-11-25 定）：
  - 编码派 coder 子代理；
  - 主会话审 diff、自己跑验证并合入；
  - 不做逐 Task 的计划审查与实现审查，t56 到 t59 做完后整段交 omp 一次。
- **期望结果**：
  - 展开只有一个来源，写在 `grid.md` 的一节里；
  - 宿主经 `useGridHost` 做的三种落账都走 `onApplied`；
  - 策略能表达“锁住收起状态”与“刚性”；
  - ide 示例的绕法删掉，模型约少 24 行（见“示例”一节）。
- **依据**：
  - [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 20、23、133 到 138、147 到 150、154，失败 5，以及“目标与非目标”的已知限制与不承诺；
  - [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 8、12、49；
  - ADR 0054（`@experimental` 标注、公开面就是入口清单）。
- **要推翻的已定决定**（每条都列进待确认）：
  - [待确认清单](../../pending-confirmations.md)第 95 行（t40）：“`setCollapsed` 翻标记重排，与 Enter 的邻居让位、恢复到 `restoreSize` 分开写”。本计划把 Enter 改成能翻时与 `setCollapsed` 结果相同（两个例外见输出 20 的改法）。第 98 行已把这条记为根治候选，“改已实现的输出 20，交开发者”。
  - 第 96 行（t40）“`restoreSize` 谁收起谁记”：网格的节点不再有 `restoreSize`。
  - t40 设计审查第 7 条的“程序收起不触发 `onApplied`，写进不承诺”：改成触发。
  - 第 99 行“`onApplied` 加第三个参数 `before`”：参数改成 `(change, before)`。
- **不受影响的已定决定**：
  - t52：结构操作不改兄弟的意图，`setSize` 只对保留像素的节点。`setSize` 只删掉“收起中改 `restoreSize`”那一句。
  - t53：离开的内容，以及降到零的叶停放、留到过渡结束，不受影响。
  - t44 第 114 行“nb-story 导航展开回到收起前的宽度”：行为不变，现在靠意图，不再靠记下的值。
- **同时在做的**：
  - t56 只补说明。第 5 组的说明条目不在本 Task；`grid.md` 的“收起与展开”一节由本 Task 重写，t56 不碰。
  - t57 做诊断出口。
  - t58 做 clone、试做、同向并入与深度计法，先做。t58 要跟着改的地方见“不做与风险”的 t58 一条。

### 探针结论（真实源码，`bun test`）

| 编号 | 复现的 | 结果 |
|---|---|---|
| P1 | 第 35 条：保留像素意图 400、策略 `restoreSize` 333、建树就收着 | `setCollapsed(false)` 后宽 400；分隔条上 Enter 后宽 333，而且落账把意图改写成 333 |
| P2 | 收起时改写 `restoreSize` | `setCollapsed(true)` 与 Enter 收起都把 333 改成 400；收着时 `setSize(250)` 把它改成 250 |
| P3 | 第 45 条：ide 主行，拖“中间｜右区”往右 900 | 条没给最小与最大：右区收起，右条从 28 变成 0。最小、最大都给 28：右条仍是 28 |
| P4 | 第 55 条：钉死的条，主行 600 宽 | 条只剩 24.19（`over-constrained`，`min-total`），区与编辑区同比例压 |
| P5 | 第 4 条：`useGridHost` 的 `setCollapsed` | 版本 1 变 2，`onApplied` 零次 |
| P6 | 第 17 条：两个区都收到 0、`sashSize` 4 | 每条线都是 4，收起的区旁边是两条线的缝；`sashSize` 用函数给条旁的线 0 之后是 `[0,4,4,0]`，只剩一条 |
| P7 | 按比例分的面板，两条路往返 | Enter 收起 `[400,800,0]`，b 的意图被改成 600；之后 `setCollapsed(false)` 得 `[300,600,300]`。`restoreToShare` 往返得 `[400,500,300]`。只用 `setCollapsed` 往返是 `[600,600,0]` 再 `[400,400,400]`，不漂。两块各 500，拖到收起 b：a 的意图被改成 1000，`setCollapsed(false)` 后只有 333 |
| P8 | 窄窗口（508）里 Enter 收起：`[a 保留 300, b, c 保留 300]` | 今天的预览 `[0,300,200]`，落账把 c 的意图写成 200。照翻标记重排算目标是 `[0,200,300]` |
| P9 | 候选规则 R2（见 `grid.ts` 一节），用改节点意图模拟 | 两块各 500、拖到收起 b：呈现 `[1000,0]` 不变，意图保持 500/500，展开回到 500。三块意图 `[300,300,300]`、呈现 `[400,400,400]`：拖 b｜c 把 c 收起，呈现 `[400,800,0]`，今天的反解把意图写成 `[300,600,300]`；R2 按 600/900 缩放 a、b，意图变成 `[200,400,300]`，呈现不变；展开 c 得 `[266.67,533.33,400]`，c 拿回份额 300/900，也就是收起前的 400，a、b 同比例让出 |
| P10 | 窄窗口 Enter 展开：`[a 收着 300, b, c 保留 300]` | 今天的预览 `[300,100,100]`，c 的意图被永久写成 100，放宽后 `[300,596,100]`。翻标记后的布局是 `[200,100,200]`（`fixed-overflow`），这份目标交给今天的 `resizeBranches` 会把 a、b、c 写成 200、50、200。所以要 R1：意图能呈现目标时不改 |

## 技术选型

无（库内部的几何与接口，不涉及通用问题）。

## 关键设计

### 一个原则：展开回到意图

网格的节点只有一份展开尺寸，就是它的意图（`size` 在父分支主轴上的分量）：

- 保留像素的节点回到意图的像素；
- 按比例分的节点回到它的份额。

收起不改意图，三条路都回到它：`setCollapsed(false)`、分隔条上的 Enter、区段按钮。拖动展开照旧跟随指针，松手按呈现写回意图（输出 23）。

`restoreSize` 只留给独立 `Splitter`：它没有意图，面板尺寸就是宿主给的呈现像素。`restoreToShare` 删掉：它等于网格现在的缺省行为，独立 `Splitter` 没有使用方。

宿主跨会话要存的只有意图（快照，或自己的记录）与 `collapsed`。

为什么选意图，不选“网格自己记一份恢复尺寸”：

- 保留像素的节点在第一次经网格收起之后，`restoreSize` 本来就恒等于意图（P2）。只有两种情况两者不同：宿主给的初值与意图不一致（P1），或宿主自己改了意图。这是两个来源制造出来的分歧，不是信息。
- 按比例分的节点，今天的 Enter 往返靠像素记忆补偿“收起时改写了兄弟权重”（P7）。下面的 R1、R2 让收起不再冲掉份额（P9），份额本身就够用。
- 工作台早就是这个语义：`ui/workbench-layout` 输出 12 写的是“按钮、命令与 Enter 恢复意图尺寸”，输出 8 写的是“其余的只更新彼此的比例，总量保持原来的份额”。L1 跟上 L2，工作台的投影里可以删掉 `restoreSize` 与 `restoreToShare` 的推导。

### `packages/nb-layout/src/grid-types.ts`、`grid-geometry.ts`：类型与归一

- `SashCollapsePolicy` 去掉 `restoreSize`、`restoreToShare`，加 `locked?: boolean`（语义见“锁住”一节）。`SashCollapseState` 跟着变。网格的节点、`GridLeafInput`、`GridBranchInput`、`GridRefResolution`、`GridCollapseResult.collapse` 都用它。
- 新类型 `SplitterCollapseState = SashCollapseState & {restoreSize: number}`，根入口导出，标 `@experimental`。
  - `vue/grid-splitter.ts` 的 `SplitterPanelConfig.collapse` 改成它。dev-panel、nb-agent-ui 写的是 `SplitterPanelConfig["collapse"]`，不用改。
  - `SashPanel.collapse` 写成 `SashCollapseState & {readonly restoreSize?: number}`：网格那条路不带，独立 `Splitter` 那条路带。
- `SashPanel`、`GridLeaf`、`GridBranch` 加 `rigid?: true`，`GridLeafInput`、`GridBranchInput`、`GridRefResolution` 加 `rigid?: boolean`（语义见“刚性”一节）。
- 白名单归一，三处都要加新字段。漏了会在建树、恢复与 t58 的 clone 里被静默丢掉：
  - `normCollapse`（`grid-geometry.ts:284`）：拷 `locked: true`；不再拷 `restoreSize`、`restoreToShare`。输入里出现这两个旧字段时忽略，不报错，不进节点。
  - `instantiate`（`grid.ts:106`）：`rigid` 只在 `sizing === "fixed"` 且为 `true` 时写成 `rigid: true`，按比例分的节点忽略。
  - `grid-snapshot.ts` 的 `RuntimeRecord` 与 `currentConstraints`：带上 `rigid`。恢复时 `rigid` 的来源和 `sizing` 一样：解析结果优先，其次当前树。
- `cloneNode`（`grid-tree.ts`）用展开运算拷节点，`rigid` 自动带上。`collapse` 照旧共用、整个替换，注释不改。

### `packages/nb-layout/src/sash-drag.ts`、`grid-gesture.ts`：显式收起与展开改成翻标记重排

新增内部函数 `reflowSashCollapse`，放在 `sash-drag.ts`、`solveSashCollapse` 旁边，不从入口导出：

```ts
/** 网格的显式收起与展开（Enter、区段按钮）：结果与 `setCollapsed` 翻这个标记后重新布局这一支相同（Spec 输出 20、166）。 */
export function reflowSashCollapse(input: {
    panels: readonly SashPanel[];   // size 是意图（branchSashPanels 给的）
    total: number;                  // 这一支此刻的呈现总量（按下时的 sizes 之和）
    index: number;
    collapsed: boolean;
}): {sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>; issues: readonly GridIssue<GridIssueCode>[]} | null;
```

做法：

1. 输入非法时返回 null，判据同 `solveSashCollapse` 的前几行。
2. 没有收起策略时给 `no-collapse-policy`，尺寸不变。状态已经是目标时，原样交回。
3. `flipped` 是把目标面板换成 `collapsed` 后的 `panels`，`next = allocateSashPanels(flipped, total)`。这就是 `restoreToShare` 现在取 `[index]` 的那一次分配，取整个数组。
4. 展开时，`flipped` 的最小尺寸之和大于 `total + EPSILON`，就不展开，给 `no-room-to-restore`：`available` 是 `total` 减其余面板的最小尺寸，`required` 是目标的最小尺寸。`fixed-overflow` 那一档（只压保留像素的兄弟）照常展开，和 `setCollapsed` 一样。
5. 收起时，`next` 之和小于 `total - EPSILON`（让出的空间没人吸收），就不收起，给 `no-room-to-collapse`。

`grid-gesture.ts` 的 `applyCollapse` 改调 `reflowSashCollapse`，传入：

- `panels`：`withCollapseOverrides(owner.panels, owner.snapState?.collapsed)`；
- `total`：`current` 之和。

其余收口不变：预览、`snapState.sizesPx`、两根轴交汇时的改道（输出 21 的已知限制照旧）。

挑哪一块做显式切换：`collapsibleIndex`（`grid-gesture.ts:298`）与 `splitter-session.ts:105` 跳过 `toggleable === false` 或 `locked === true` 的面板。

独立 `Splitter` 不改：`splitter-session.ts` 继续用 `solveSashCollapse`（邻居让位、恢复到 `restoreSize`）。删掉其中 `restoreToShare` 的分支（`sash-drag.ts:222`）。

### `packages/nb-layout/src/grid.ts`：落账保住意图（R1、R2）与 `setCollapsed` 的锁

`planBranchResize`（`grid.ts:220`）的顺序是：核对 → 应用本场的收起变化（`grid.ts:272`）→ 短路判断。在应用收起变化之后、`grid.ts:288` 的短路之前，加 R1；在 `grid.ts:331` 写 `sizes` 之前，加 R2。

- **R1**：用候选分支现有的意图（已翻过本场的收起标记）`allocateAxis(branch, axis, targetTotal, sashSize, [])`。每个孩子都与 `change.target` 相差不超过 `EPSILON` 时，`sizes` 取现有意图，直接返回。显式收起与展开的目标就是这么算出来的，所以落账只翻标记、不改意图（P8、P10）。现有的“目标等于基线”短路是它的特例，可以并进来，也可以留着；留着的话写一句“R1 的特例”。
- **R2**：照旧反解出 `assigned` 之后，如果这一支落账后还有收起着的按比例分的孩子，就把落账后展开着、按比例分、范围不是刚性的孩子按同一个倍数缩放，使它们的新意图之和等于它们的旧意图之和。
  - 倍数是 `旧和 / 新和`。两者任一不大于 `EPSILON` 时不缩放。
  - 缩放不改呈现：份额只在展开着的按比例分的孩子之间分，它们同比例变，分配结果不变。`grid.ts:326` 的复核照样通过，缩放写在复核之前。
  - 效果：收起着的按比例分的孩子展开时，拿回它收起前的份额（P9）。

`setCollapsed(id, collapsed, options?: GridCollapseOptions)`：

```ts
/** @experimental */
export type GridCollapseOptions = {
    /** 同时改锁（Spec 输出 168）；不给时锁不变。 */
    readonly locked?: boolean;
};
```

- 写回 `collapse = {...collapse, collapsed, ...(locked === true ? {locked: true} : {})}`；`locked === false` 时去掉这个键。
- `changed` 是收起标记或锁有没有变，都没变时树不变。
- 收起不再调 `collapsedRemembering`。这个函数与 `resizeBranches` 里补记恢复尺寸的那一段（`grid.ts:381` 到 `389`）都删掉，`collapsed` 的结果照旧按变化列出。
- 锁住的节点，宿主照常可以翻（输出 168）。

`resizeBranches`：本场要翻的孩子带 `locked: true` 时，在 `planBranchResize` 应用收起变化那一步失败：

```ts
gridFailure("collapse-locked", `${id} in branch ${branchId} is locked; only the host can collapse or expand it`, {id, branch: branchId})
```

`grid-failure.ts` 的 `GridFailureParams` 加 `"collapse-locked": {id: string; branch: string}`，`GridFailureCode` 跟着加。

`setSize`：删掉收着时改 `restoreSize` 的分支（`grid.ts:454` 到 `460`），`changed` 只看意图。刚性的节点也能设，夹进声明的主轴最小与最大（`constraintOnAxis`，不经刚性范围，见下）。

`Grid` 类型里 `setCollapsed`、`setSize` 的 JSDoc 改成链接新条目，不再写“和 Enter 是两种结果”。

### `packages/nb-layout/src/sash-drag.ts`：锁住的面板不过阈值

`solveSashDrag` 的收起判定（`sash-drag.ts:294`）与展开判定（`:301` 一带）都跳过 `policy.locked === true` 的面板：

- 锁住、展开着的：拖到最小尺寸就停，不收起；
- 锁住、收着的：照旧是刚性的收起尺寸，拖不开，位移照级联规则传给同侧的兄弟。

独立 `Splitter` 共用这段代码，同样遵守，`Splitter.md` 写一句。

### `packages/nb-layout/src/grid-geometry.ts`：刚性

**范围**：`constraintsOf`（`grid-geometry.ts:250`）现在是 `collapsedRigid(...) ?? constraintOnAxis(...)`，改成：

```
collapsedRigid(...) ?? rigidOf(node, axis) ?? constraintOnAxis(...)
```

- `rigidOf`：节点 `rigid === true` 时，返回 `{low: s, high: s}`，`s = clampAxis(node.size[axis], 声明的最小, 声明的最大)`。
- 只沿父分支主轴：沿用 `layoutOf` 里 `parentMain` 判收起刚性的同一处（`grid-geometry.ts:450` 一带的注释），刚性的判定跟收起走同一条路。
- `sashPanelsOf` 给出的 `SashPanel` 带上 `rigid`，范围因此是刚性的。拖动的级联补偿碰不到它（第 45 条），`resizeBranches` 的“刚性保持意图”分支（`grid.ts:312`）照旧。

**最后才让**：`allocatePanels` 的 `min-total` 分支（`grid-geometry.ts:150`）现在是全体最小值按比例。改成：

- 先算 `R`：`rigid` 面板的最小值之和；
- `R <= space` 时，刚性的取自己的最小值，其余按各自最小值比例分 `space - R`（其余最小值之和为 0 时都是 0）；
- `R > space` 时，刚性的按 `space / R` 比例压，其余都是 0。

诊断照旧报 `min-total`，`available`、`required` 不变。只认 `rigid` 标记，不认“最小等于最大”：工作台的活动栏、状态栏、入口条叶现在是最小等于最大，不标 `rigid`，窄窗口的行为不变（P4 的形状）。工作台要不要标，见待确认 5。

`setSize` 夹值用 `constraintOnAxis`，不受刚性范围影响，所以刚性的节点能改厚度。

### `packages/nb-layout/src/vue/useGridHost.ts`、`useGridLayout.ts`：统一通知与 `setSize`

新类型，`./vue` 入口导出，标 `@experimental`：

```ts
/** `onApplied` 的第一个参数：这次落账是哪一种（Spec 输出 170）。 */
export type GridHostChange =
    | {readonly kind: "gesture"; readonly commit: GridGestureCommit; readonly result: Extract<GridBranchesResizeResult, {ok: true}>; readonly collapsed: Readonly<Record<string, boolean>>}
    | {readonly kind: "collapse"; readonly id: string; readonly result: Extract<GridCollapseResult, {ok: true}>; readonly collapsed: Readonly<Record<string, boolean>>}
    | {readonly kind: "size"; readonly id: string; readonly result: Extract<GridSetSizeResult, {ok: true}>; readonly collapsed: Readonly<Record<string, boolean>>};
```

- `GridHostOptions.onApplied` 改成 `(change: GridHostChange, before: GridLayoutResult) => void`。
- `collapsed` 三种都有，是这次翻了收起标记的节点：
  - 手势：等于 `result.collapsed`；
  - 收起：标记变了是 `{[id]: collapsed}`，只改了锁时是 `{}`；
  - 设尺寸：`{}`。
- 宿主“哪块区被展开了”只读这一个字段（第 42 条后半）。
- 选一个参数带 `kind`，不另加回调，理由：
  - 存档只接一处，就是第 4 条要的；
  - 两个回调触发的事件重叠，宿主会问“存档写在哪个里”；
  - 现有使用方要改的只有 4 处，下面逐个列出。

`useGridLayout.ts`：把 `onGestureCommit` 里“发布、再在 try 里调 `onApplied`、抛出时报 `notify-failed`”的一段（`useGridLayout.ts:157` 到 `168`）抽成内部函数 `applyAndNotify(change, before)`，三种落账共用：

- 先 `publish()`，新布局的诊断经 `notifyAfterCommit` 发；
- 再调 `onApplied(change, before)`；
- 抛出时报 `notify-failed`，消息里写“The change was applied, but the host's onApplied threw: …”。

`useGridLayout` 再交出一个 `applyChange(change, before)` 给 `useGridHost` 用。`invalidate()` 不通知：宿主直接改了 `grid.*`，自己知道改了什么；BookFrame 一次刷新里连着几步，通知会让它收到中间状态。

`useGridHost.ts`：

- `setCollapsed(id, collapsed, options?: GridCollapseOptions)`：
  - 没有网格时返回 `not-ready`；
  - 先留 `before = layout.value`，再调 `grid.setCollapsed`；
  - `result.ok && result.changed` 时 `applyChange({kind: "collapse", id, result, collapsed: …}, before)`。
- 新 `setSize(id: string, px: number): GridSetSizeResult | GridFailure<"not-ready">`：同上，`kind: "size"`。
- 版本递增会让进行中的手势被拒，这一点不变（输出 149）。
- `GridHost` 类型与 JSDoc 跟着改。

### 使用方（先数总数再全列）

搜的是 `useGridHost|onApplied|setCollapsed|restoreSize|restoreToShare|solveSashCollapse|SashCollapse(State|Policy)|GridCollapseResult|setSize(`。在 `packages/` 下（不含 legacy、dist）命中 74 个文件，清单在 [evidences/consumers.txt](evidences/consumers.txt)。

nb-layout 自身的源码与测试按切片处理。另有 6 个文件只是同名不同物，不改：nb-agent-ui 的 `AgentDock.vue`、`AgentWizard.vue`（它们自己的 `setCollapsed`），Lab 的 `ViewportCanvas.vue`（`resetSize`），工作台的 `panel-commands`、`part-commands`、`view-commands` 测试（store 的 `setCollapsed`）。其余要改的：

| 使用方 | 现在 | 要改什么 | 多存或多触发 |
|---|---|---|---|
| 工作台 `WorkbenchSurface.vue:140` | `onApplied: (_commit, result, before) => emit("gesture-commit", before.sizes, …, result.collapsed)` | `(change, before) => { if (change.kind === "gesture") emit(…, change.result.collapsed) }` | 不会：工作台不调 `host.setCollapsed`、`host.setSize`，收起走文档再投影 |
| 工作台 `layout-doc-store.ts` | store 自己的 `setCollapsed` 改文档 | 不改 | 无 |
| `nb-workbench-layout/src/layout-project.ts:104` | `collapseOf` 推导 `restoreSize` 与 `restoreToShare` | 删掉两项，注释改成“展开回到意图（nb-layout 输出 166）”；`layout-project.test.ts:301` 不再断言 `restoreSize` | 无 |
| `nb-workbench-layout/src/intent-writeback.ts:26` | 注释写“`onApplied` 第三个参数” | 改成第二个参数 | 无 |
| nb-story `BookFrame.vue:123` | `onApplied(commit)` 读 `commit.changes` | 签名改成 `(change)`，`if (change.kind !== "gesture") return;` 再读 `change.commit.changes` | 不会：BookFrame 用 `grid.*` 再 `invalidate()` |
| nb-story `book-grid.ts:79,88,93` | 三处 `restoreSize`；`drawer2` 用 `collapseThreshold: 100_000` 加 `toggleable: false` 挡住手势 | 删 `restoreSize`；`drawer2` 改成 `locked: true`，删掉那两项与注释里的绕法；`book-grid.test.ts:93` 一带的展开断言不变（意图） | 无 |
| Lab `GridPanelsScene.vue:96` | `(_commit, result, before)` | `(change, before) => { if (change.kind === "gesture") … change.result.collapsed … }` | 不会：它不调 `host.setCollapsed` |
| Lab `NestedGridAcceptanceFixture.vue:147` | `(commit) =>`，数提交次数 | `(change) => { if (change.kind !== "gesture") return; const commit = change.commit; … }` | 不会：它只 `invalidate()`；`lab-nested-grid` 的计数 e2e 不变 |
| Lab `GridStructureScene.vue:28`、`StarterScene.vue:19` | `restoreSize` | 删；StarterScene 与 README 的起步一字不差（`readme.test.ts` 核对），两处同改 | StarterScene 的 `save` 会在点“收起左栏”时多存一次快照，内容一样；这正是第 4 条要的 |
| Lab `GridLeavingScene`、`LivePanelsScene`、`GridSwapScene` | 只用 `useGridHost` | 不改 | 无 |
| `nb-layout/src/vue/test-fixtures/LeavingHost.vue:42` | `restoreSize: 250` | 删 | 无 |
| dev-panel `App.vue:142`、`ArtifactPage.vue:182` 一带，nb-agent-ui `AgentMessages.vue:98` | 独立 `Splitter`，写 `restoreSize` | 不改（`SplitterCollapseState` 保留它） | 无 |
| 示例 desktop `App.vue:81` | `onApplied: persist` | 不改（`persist` 不读参数） | 无 |
| 示例 tabbed-panels | `onApplied: persist`；`toggleExplorer` 另调一次 `persist`；存档 `explorer: {collapsed, restoreSize}` | 删掉另调的那次与注释；`ExplorerState` 只剩 `collapsed`；`policyFor` 不给 `restoreSize`；读档时旧存档里的 `restoreSize` 忽略不校验 | 不会重复存 |
| 示例 ide | 见下一节 | 见下一节 | 不会：模型直接调 `grid.setCollapsed`，`settle()` 照旧 `invalidate` 加存档 |
| 插件 SDK `src/sdk/components.ts` | 转出 `NestedGrid`、`Splitter`、`SplitterPanelConfig` | 不改代码；`sdk.test.ts` 的快照会变（`GridNode` 的 `collapse` 少了 `restoreSize`，`SplitterPanelConfig.collapse` 换类型）。照 nb-layout `AGENTS.md` 的“稳定性标注与 API 报告”判断：插件传进 `NestedGrid` 的树里写 `restoreSize` 会多出属性，算不兼容。先看 `PLUGIN_API_SINCE` 是否已为下次发布提过（t34、t38 已有不兼容项在 `[Unreleased]`），没提就提，再照提示重写快照；应用的 `CHANGELOG` 补一条 | 无 |

**旧存档**：

- 工作台：存档里没有 `restoreSize`，它在 `layout-project.ts` 里从意图与最小值算出，存档格式不变。
- nb-story：存的是详情宽度与导航开关，没有 `restoreSize`。
- 网格快照 v2：本来不带策略，不变。
- tabbed-panels 示例：存档版本仍是 1，读档接受带或不带 `restoreSize` 的 `explorer`，新存档不写。
- ide 示例：存档格式不变，本来就不存 `restoreSize`。

### 示例 `packages/nb-layout/examples/ide/`

草稿在 `t59-probe/ide-draft/`（`model.diff`、`App.diff`、`README.diff`），coder 照它写，再按真实接口调。

- `model.ts`：
  - 条改成 `sizing: "fixed", rigid: true`，删掉最小、最大与“交叉轴要写 Infinity”的注释；
  - 区的叶收 `{size, collapsed, locked}`，去掉 `restoreSize` 与“只是初值”的注释；
  - 新增 `sashSize` 函数，条旁的三条线给 0（第 17 条），`sashLocked` 去掉条那一半；
  - `moveTool` 把搬空的区 `setCollapsed(from, true, {locked: true})`，搬进的区 `{locked: false}`；
  - `reconcile` 只剩“`shown` 为空补第一个”，不再收回、不再交回布尔值；
  - `fromSaved` 按存档直接建树（`locked` 按条是否为空），删掉先建缺省树、再 `setSize`、`setCollapsed` 的循环与两行顺序注释。
- `App.vue`：`afterApplied` 不再 `invalidate`，注释缩成一行。
- `README.md`：“绕过的空缺”里三条改写：存档、条、窄窗口。
- **行数**（按草稿，`wc -l`）：`model.ts` 395 → 371，`App.vue` 414 → 411，README 行数不变、三条变短。合计少 27 行。实施后 coder 按真实代码再量一次，写进证据。
- 测试 `src/examples-ide.test.ts`：
  - `reconcile` 交回值的两条（:195、:206）改成断言 `shown`；
  - 加“搬空的区锁住，手势展不开”：经 `createGridGestureSession` 拖它的线与 Enter，区仍是 0；
  - “窄窗口条仍是 28”（:161）的宽度加到 600；
  - :289、:294 去掉 `restoreSize` 的说法。
- e2e `e2e/ide.e2e.ts`：
  - 文件头的变异说明（:12、:22）改写：没有按钮的区靠锁，不再靠 `reconcile` 兜底；
  - :155 的注释（“Enter 读 restoreSize”）改掉；
  - :339 到 342 的三条线现在是 0 宽：断言改成 `data-disabled` 加条的厚度不变，不再去拖 0 宽的线（拖不到）；
  - :260 那条保留，它守的是锁。

## Spec 与文档改动

Spec 在主工作区 master 上改：开工前写进新条目与改动的句子，标 `（planned）`；要删掉的旧句在实施它的切片合入时删，同时去掉 planned 标记。编号只在末尾追加，t57 占了 158、159，t58 占了 160 到 165，新条目从 166 起。

### `docs/specs/ui/nested-grid.md`

**目标与非目标**：

- 已知限制第 22 行（“落账时，被压缩、这次没动的保留像素节点……待开发者定”）改为：
  > 窄窗口里拖分隔线落账时，被压缩、这次没动的保留像素节点的意图会被写成压缩后的值，放宽后回不到原宽。显式收起与展开不受影响，它们落账不改意图（输出 167）。
- 不承诺第 27 到 29 行三条删掉：两条路结果不同、按比例分的经 `setCollapsed` 不记恢复尺寸、`setCollapsed` 不触发 `onApplied`。“一个分支的子节点经 `setCollapsed` 全部收起时整行留白、没有诊断”单留一条。

**改已有条目**（新句标 `（planned）`）：

- **20 拖动：显式恢复**，整条换成：
  > **拖动：显式收起与展开**：按钮、分隔条上 Enter 的显式收起与展开，能翻时结果和 `setCollapsed` 翻这块面板的标记相同（输出 147）：按比例分的兄弟按份额吸收或让出，保留像素的兄弟不变，展开回到意图（输出 166）。翻了之后最小尺寸之和放不下时保持收起，给 `no-room-to-restore`；翻了之后让出的空间没有兄弟能吸收（兄弟都到上限、都已收起或都保留像素）时保持展开，给 `no-room-to-collapse`；这两种这场手势都没有提交。锁住的面板（输出 168）不参与显式切换。这两种拒绝与锁住的跳过是和 `setCollapsed` 仅有的不同：`setCollapsed` 照样翻，放不下时报 `over-constrained`，没人吸收时留白。（planned）
  - 删去：“才用记忆的恢复尺寸（谁记见输出 148）”与 `restoreToShare` 的整句。
- **147 收起与展开的入口**：
  - 签名改为 `grid.setCollapsed(id, collapsed, options?)`；
  - 删去“和分隔条上的 Enter（……）是两种结果”，改为“分隔条上的 Enter 能翻时结果相同；放不下或没人吸收时 Enter 拒绝、锁住的 Enter 跳过，`setCollapsed` 照样翻（输出 20、168）”；
  - 加一句：“`options.locked` 同时改锁（输出 168），不给时锁不变；`changed` 是收起标记或锁有没有变。”（planned）
- **148 恢复尺寸谁收起谁记**：实施合入时整条换成“148. （已删除：网格的节点没有恢复尺寸，展开回到意图，见输出 166）”。
- **149 宿主的收起入口**：加“第三个参数同输出 147；标记或锁变了时通知 `onApplied`（输出 170）”（planned）。
- **150 提交前的布局**：改为“`onApplied(change, before)` 的 `before` 是这次落账之前发布的布局：手势是手势开始时呈现的那份，`host.setCollapsed`、`host.setSize` 是调用之前的那份；`onApplied` 被调时宿主的 `layout` 已经是落账之后的。”（planned）
- **154 设一块保留像素的尺寸**：
  - 删去“收起中的节点同时把记忆的恢复尺寸改成……回到同一个尺寸”；
  - 加“刚性的节点同样可设，夹进声明的主轴最小与最大（输出 169）”（planned）；
  - `changed` 改为只看意图。
- **失败 5** 的码表加一行（planned）：

  | 码 | 什么时候 | `params` |
  |---|---|---|
  | `collapse-locked` | 按分支调整要翻一块锁住的面板的收起标记 | `id`、`branch` |

- **139 诊断** 表里 `no-room-to-collapse` 一行的“什么时候”改为“收起后让出的空间没有兄弟吸收（拖动或显式收起），保持展开”。

**新条目**（都标 `（planned）`）：

> 166. **展开回到意图**：网格的节点只有一份展开尺寸，就是它的意图（`size` 在父分支主轴上的分量）：保留像素的回到意图的像素，按比例分的回到它的份额。收起不改意图；`setCollapsed(false)`、按钮与分隔条上的 Enter 都回到它，拖动展开跟随指针、松手时按呈现写回（输出 23）。网格的收起策略里没有恢复尺寸（独立 `Splitter` 没有意图，它的 `restoreSize` 照旧）。宿主要跨会话保存收起状态，存意图（快照或自己的记录）与 `collapsed` 就够了。
>
> 167. **落账保住意图**：`resizeBranches` 里一个分支应用了本场的收起变化之后，用现有意图布局就得出目标时，这个分支的意图一个也不改：显式收起与展开都这样落账，窄窗口里被压缩的保留像素兄弟不会被写成压缩值。否则照输出 2 反解；反解之后这个分支里还有收起着的按比例分的孩子时，展开着的按比例分的孩子的新意图按同一个倍数缩放，使它们的和等于落账前的和。呈现不变，收起着的那块展开时拿回收起前的份额。例：两块按比例分各 500、拖到把 b 收起，a 呈现 1000、意图仍是 500，展开 b 回到 500。三块意图各 300、呈现各 400，拖 b｜c 把 c 收起（呈现 `[400,800,0]`）：a、b 的意图写成 200、400，和仍是 600；展开 c 得 `[266.67,533.33,400]`，c 回到收起前的 400。
>
> 168. **锁住收起状态**：收起策略带 `locked: true` 时，拖动不越过阈值收起它，也拉不开收着的它；分隔条上的 Enter 跳过它（同 `toggleable: false`，作用于另一侧）；`resizeBranches` 要翻它的标记时整批失败，给 `collapse-locked`（失败 5）。宿主的 `setCollapsed` 照常翻它；锁经 `setCollapsed` 的 `options.locked` 改，或建树、恢复时在策略里给。独立 `Splitter` 同样遵守。
>
> 169. **刚性的节点**：保留像素的节点标 `rigid: true` 时，它在父分支主轴上的最小与最大尺寸都是它的意图（先夹进声明的主轴最小与最大），拖动的级联补偿不改它。最小尺寸之和放不下时先按比例压别的节点，刚性的最后才让：刚性的之和也放不下时只在刚性的之间按比例压，别的为 0；诊断照旧是 `over-constrained`（`min-total`）。交叉轴不受影响；按比例分的节点标了不起作用。`rigid` 和 `sizing` 一样是运行期约束，不写快照。
>
> 170. **宿主的落账通知**：`useGridHost` 的 `onApplied(change, before)` 在三种落账之后各调一次：手势提交（`kind: "gesture"`，带 `commit`、`result`），`host.setCollapsed`（`kind: "collapse"`，带 `id`、`result`），`host.setSize`（`kind: "size"`，带 `id`、`result`）；后两种只在 `changed` 时调。三种都带 `collapsed`：这次翻了收起标记的节点（id → 是否收起）。宿主直接调 `grid.*` 再 `invalidate()` 的不通知。`onApplied` 抛出时同手势：库接住、报 `notify-failed`，落账照样算数（输出 140）。
>
> 171. **宿主的设尺寸入口**：`useGridHost` 的 `setSize(id, px)` 调 `grid.setSize`，`changed` 时版本递增、布局重发并通知 `onApplied`（输出 170），没变时版本不变；没有网格时返回 `not-ready`（`missing: "grid"`）、版本不变。

**实现合同**：

- “合同测试”一句里加 166 到 171；
- 输出 147、148 的映射换成新条目；
- “常用的是 …`resizeBranches` 与 `setCollapsed`”加上 `setSize`。

### `docs/specs/ui/workbench-layout.md`

输出 12（“按钮、命令与 Enter 恢复意图尺寸”）与新语义一致，不改。输出 49 不提 `onApplied` 的参数位置，不改。实施后核对一遍输出 11、12 的 e2e 仍守着它们。

### 包内文档

- `packages/nb-layout/src/grid.md`：
  - 新写一节“收起与展开”，放在“几何与手势”之后，内容依次是：
    1. 策略的字段（`collapsed`、`collapsedSize`、两个阈值、`toggleable`、`locked`）；
    2. 一句话：展开回到意图；
    3. 三个入口：拖动跟随指针；Enter 与按钮能翻时等于 `setCollapsed`，例外是两种拒绝与锁住的跳过；`setCollapsed` 与 `host.setCollapsed`；
    4. 落账保住意图（R1、R2 各一句）；
    5. 锁；
    6. 存档存什么；
    7. 分隔线：`sashSize` 不随收起变，要收起到 0 的节点旁只留一条线，就用函数形式给挨着刚性节点的线 0（P6 的写法）。
  - 删掉现在散在三处的说法：“setCollapsed …分隔条上的 Enter 是另一种结果”一段、“`restoreSize` 由网格在收起的那一刻记下”一段、`setSize` 段里的 `restoreSize` 一句、拖动求解段里 `restoreSize` 与 `restoreToShare` 的两句。
  - 刚性写进“几何与手势”。
- `src/vue/useGridHost.md`：
  - `onApplied` 的写法与 `GridHostChange` 的三种；
  - “收起与展开”一节改成“走 `onApplied`”；
  - 交回表加 `setSize`；
  - 删“分隔条上的 Enter 是另一种结果”。
- `src/vue/NestedGrid.md:90`：“Enter 切换相邻可收起面板”后加“（能翻时结果同 `setCollapsed`；放不下或没人吸收时不切换，锁住的跳过）”。
- `src/vue/Splitter.md`：
  - `collapse` 的类型写 `SplitterCollapseState`，`restoreSize` 只在这里有；
  - 加 `locked` 一句；
  - Splitter 的 Enter 语义不变，写明它和网格不同的原因：没有意图。
- `README.md`：
  - 起步里的 `restoreSize` 删掉，与 StarterScene 同改；
  - :104 那句改成“分隔条上按 Enter 或调 `setCollapsed` 也能收起、展开，展开回到意图”；
  - :111、:112 改成“落账、收起与设尺寸之后都调 `onApplied`，存盘就在这里”；
  - :133 的表加 `host.setSize`；
  - :156 到 168 的“约定”例子里删掉 `restoreSize`，“收起状态要跨会话保存”改成“存 `collapsed`”。
- `CHANGELOG.md` 的 `[Unreleased]`，每片写自己那条：
  - 不兼容：网格节点的收起策略去掉 `restoreSize`、`restoreToShare`；Enter 与区段按钮的结果改成同 `setCollapsed`；`onApplied` 的参数改成 `(change, before)`；`SplitterPanelConfig.collapse` 的类型改名 `SplitterCollapseState`。
  - 新增：`locked`、`rigid`、`GridCollapseOptions`、`host.setSize`、`GridHostChange`、失败码 `collapse-locked`。
  - 改动：`resizeBranches` 落账保住意图；`host.setCollapsed` 通知 `onApplied`。
  - 修复：窄窗口里 Enter 收起或展开会把被压缩的保留像素兄弟写窄（P8、P10）。
- `api/*.api.txt`：改了公开面的每片跑 `bun run api:check`，确认后 `bun run api:report`，与改动同一提交。

## 切片

每片一个提交，coder 自己跑本片的验证。主会话审 diff、重跑，再派下一片。所有片在一个 worktree（`w00026/t59-collapse-semantics`，从 t58 合入后的 master 开）。

1. **片 1 行为：展开回到意图、显式切换翻标记、R1、R2**（关键设计的“sash-drag 与 grid-gesture”“grid.ts”两节，不含锁）。
   - 类型暂不删字段：网格不再读 `restoreSize`、`restoreToShare`，`collapsedRemembering` 删掉。这片编译面不变，使用方不用动。
   - 测试：`src/grid.test.ts`：
     - 改期望：1283 到 1330 的一组；1390 一带的“两条路往返不一致”（改成两条路都是 `[600,400]`）；1420 到 1450 的“谁收起谁记”（改成意图不变、R2 的份额）；96、328 到 400 用到 `restoreSize` 初值的 Enter 用例。
     - 新增：P1、P8、P9、P10 四个形状。
   - 测试：`src/sash-drag.test.ts`（删 `restoreToShare` 的用例，加 `reflowSashCollapse` 的两种拒绝）。
   - 测试：`src/vue/NestedGrid.dom.test.ts`（键盘 Enter 的尺寸断言）。
   - 验证：`bun test src/grid.test.ts src/sash-drag.test.ts`，`bunx vitest run src/vue/NestedGrid.dom.test.ts`（在 nb-layout 目录），`bun run typecheck`。
2. **片 2 删字段**（机械）：
   - 删 `SashCollapsePolicy` 的 `restoreSize`、`restoreToShare`；加 `SplitterCollapseState`；`SplitterPanelConfig`、`SashPanel` 换类型；`normCollapse` 不再拷两个旧字段。
   - 使用方删 `restoreSize`：`layout-project.ts`、`book-grid.ts`、`GridStructureScene.vue`、`StarterScene.vue` 加 README 起步与约定例子、`LeavingHost.vue`、三个示例。tabbed-panels 的存档读写同时改。
   - CHANGELOG、`api:report`；插件 SDK 快照按上表处理。
   - 测试：`nb-workbench-layout/src/layout-project.test.ts`、`nb-story/src/web/shell/book-grid.test.ts`、`src/examples-tabbed-panels.test.ts`（删 `restoreSize` 坏档两例，加“旧存档带 `restoreSize` 仍能读”）、`src/readme.test.ts`、`src/grid-geometry.test.ts`、`src/vue/splitter.dom.test.ts`、`src/vue/grid-splitter.dom.test.ts`、应用的 `src/sdk/sdk.test.ts`。
   - 验证：nb-layout、nb-workbench-layout、nb-story、neuro-book 各自 `bun run typecheck`，加上述测试。
3. **片 3 锁**：
   - 类型加 `locked`，`normCollapse` 拷它；`solveSashDrag` 两处判定；`collapsibleIndex` 与 `splitter-session` 跳过；`setCollapsed` 的 `options`；`resizeBranches` 的 `collapse-locked`；`grid-failure.ts`。
   - nb-story `drawer2` 改成 `locked: true`。
   - CHANGELOG、`api:report`。
   - 测试：`src/grid.test.ts`（168 的四种：拖不收、拖不开、Enter 跳过、`resizeBranches` 拒；`setCollapsed` 改锁的 `changed`）、`src/sash-drag.test.ts`、`src/vue/splitter.dom.test.ts`（Splitter 的 Enter 跳过锁住的）、`book-grid.test.ts`。
4. **片 4 刚性**：
   - 类型、`instantiate`、快照的运行期记录与 `GridRefResolution`、`constraintsOf`、`sashPanelsOf`、`allocatePanels` 的 `min-total`、`setSize` 的夹值。
   - CHANGELOG、`api:report`。
   - 测试：`src/grid.test.ts`（169：级联不改、600 宽最后才让、全刚性放不下时只压刚性、`setSize` 改厚度、恢复时从解析结果取 `rigid`、按比例分的标了不起作用）、`src/grid-geometry.test.ts`、`src/sash-drag.test.ts`（级联遇到刚性）。
5. **片 5 宿主**：
   - `useGridLayout` 抽 `applyAndNotify`；`useGridHost` 的 `onApplied` 签名、`setCollapsed` 的 `options`、`setSize`。
   - 使用方：`WorkbenchSurface.vue`、`GridPanelsScene.vue`、`NestedGridAcceptanceFixture.vue`、`BookFrame.vue`、tabbed-panels 的 `toggleExplorer`、`intent-writeback.ts` 的注释。
   - CHANGELOG、`api:report`、插件 SDK 快照（`onApplied` 不在 SDK 里，预计不动，跑一次确认）。
   - 测试：`src/vue/useGridHost.dom.test.ts`（170 的三种、只在 `changed` 时、抛出报 `notify-failed`、`invalidate` 不通知；171）、`src/vue/useGridLayout.dom.test.ts`、`src/vue/dev-checks.dom.test.ts`（若有按旧签名写的回调）。
6. **片 6 示例与文档**：
   - ide 示例照草稿；tabbed-panels 的注释；`grid.md`、`useGridHost.md`、`NestedGrid.md`、`Splitter.md`、README 其余几处。
   - 测试：`src/examples-ide.test.ts`、`src/examples-tabbed-panels.test.ts`、`src/examples.test.ts`、`src/readme.test.ts`、`src/exports.test.ts`。
   - 验证：nb-layout `bun run test:e2e`（三个示例，含 ide、tabbed-panels），`bun run build:package`，`bun run api:check`。
7. **收口**（主会话）：
   - 跑“验证”一节的合入前清单；
   - 改 Spec：去 planned、删旧句、148 标已删除；
   - Task README 写证据与行数；
   - 交 t56 到 t59 整段的 omp 审查（开发者定的方式）。

片 1 到片 4 只动 nb-layout 内核与少量使用方，片 5、6 才碰 Vue 层与示例。片 2 是纯机械的删字段，可以派 haiku 档的 coder；其余派 opus 档（CLAUDE.md 的分派表：碰数据格式与跨包合同）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `ui/nested-grid` 输出 20（改） | `grid.test.ts` 显式切换一组（P8 形状、两种拒绝），`NestedGrid.dom.test.ts` 键盘 Enter，`workbench-shell.e2e.ts` :445、:463，`nb-story/e2e/frame.e2e.ts:84` |
| 输出 147（改）、149（改） | `grid.test.ts` 收起入口一组，`useGridHost.dom.test.ts`，`lab-grid-structure.e2e.ts:98` |
| 输出 150（改）、170 | `useGridHost.dom.test.ts`（三种 `kind`、`before`、只在 `changed` 时、抛出、`invalidate` 不通知），`lab-nested-grid.e2e.ts` 的提交计数，`tabbed-panels.e2e.ts` 的收起进存档 |
| 输出 154（改）、171 | `grid.test.ts` 的 `setSize` 一组（收着时不再改恢复尺寸、刚性可设），`useGridHost.dom.test.ts` |
| 输出 166 | `grid.test.ts` P1 形状（Enter 与 `setCollapsed` 都是 400），`examples-ide.test.ts` 读档后展开回到存的宽度，`ide.e2e.ts:155` |
| 输出 167 | `grid.test.ts` P8、P10（意图不变、放宽后回到 300），P9 两块与三块 |
| 输出 168、失败 5 `collapse-locked` | `grid.test.ts` 锁一组，`splitter.dom.test.ts`，`examples-ide.test.ts` 搬空的区，`ide.e2e.ts:260` |
| 输出 169 | `grid.test.ts` 刚性一组，`examples-ide.test.ts:145`（级联）、:161（600 宽） |
| 已知限制（改）、不承诺（删三条） | 同输出 167、170 |

## 验证

- 每片照“切片”里列的命令。
- **开工前基线**（在起点 master 上各跑一次并记下）：下面每个 e2e 文件，加 nb-layout 的 `bun run test:e2e`。
- **合入前一次**：
  - 内核与 Vue 层：nb-layout `bun run typecheck`、`bun run test`、`bun run build:package`、`bun run api:check`。
  - 其余包：nb-workbench-layout `bun test`，nb-story 受影响的单测，应用的 `bun run test:affected`。
  - e2e 共 7 个文件，不到 8 个：
    - 应用：`workbench-shell.e2e.ts`（边界的 Enter 与拖到零，输出 11、12）、`lab-grid-structure.e2e.ts`、`lab-nested-grid.e2e.ts`、`lab-grid-panels.e2e.ts`；
    - nb-story：`frame.e2e.ts`；
    - nb-layout：`ide.e2e.ts`、`tabbed-panels.e2e.ts`。
    - 照内存记录，直接跑 Playwright 前先构建三份产物；跑前看负载。
- **实施中只重跑**：片 1 改了 Enter 之后跑 `workbench-shell.e2e.ts` 的 :333、:445、:463 与 `frame.e2e.ts:84`；片 5 之后跑 `lab-nested-grid`、`lab-grid-panels`；片 6 之后跑 nb-layout 的两个示例 e2e。
- **真实页面**：
  - 合入前在开发服务上（`nbdev dev start`）点一遍工作台：侧栏分节在边界上 Enter 收成标题行再展开（三个以上分节时看兄弟是按份额让），底部面板 Enter 拖到零再恢复。
  - Lab 的 starter 与 grid-structure 场景点收起按钮。
- **未验证的边界**：
  - 两根轴交汇处按 Enter 的改道（已知限制，照旧）；
  - 工作台窄窗口不标刚性，行为不变，没有专门的新断言。

## 不做与风险

- **不做**：
  - 收起到 0 时库自动去掉分隔线：工作台输出 11、12 要求区域拖到零后边界还留着能拉回（`workbench-shell.e2e.ts:390` 守着）。第 17 条按 P6 由宿主的 `sashSize` 函数做，写进 `grid.md`。
  - 快照带 `collapsed`：数据格式的改动，又和 t58 的“快照可选地带策略”重叠，见待确认 4。
  - 库自动停用只能用来展开锁住面板的那条线：宿主照旧用 `sashDisabled` 去掉光标与读屏的“可调”。
  - 窄窗口里拖动落账写窄被压缩的保留像素兄弟（已知限制的剩余部分）。拖动的目标本来就不是意图能呈现的，R1 不成立；要修得另定“没动的节点保留意图”和级联预览怎么一致，t40 第二轮审查已证明这会和级联冲突。
  - 第 46 条（零尺寸载入的叶不停放）：不在第 2 组。
- **风险**：
  - **Enter 的兄弟分配变了**：有三个以上按比例分的兄弟时，以前是隔着分隔条的邻居吸收，现在是按份额。工作台侧栏的分节会看到。兜底：`workbench-shell.e2e.ts` 的 :445（真实工作台的分节），实施时核对它在三个分节时的断言读的是目标分节的尺寸；不够就在片 1 补一条三个分节的断言。
  - **R1 的判定要和预览同一份分配**：显式切换的目标由 `allocateSashPanels(branchSashPanels(...))` 算，落账时 R1 用 `allocateAxis` 复核。两者若在分隔条、收起到零的交叉轴最小值上差一点，R1 不成立，会退回反解，又写进压缩值。兜底：P8、P10 的用例要断言意图逐值不变，用真实的 `createGridGestureSession` 产生提交，不手造目标。
  - **R2 只在有收起着的按比例分的兄弟时缩放**：意图数值会和以前不同，呈现不变。工作台的回写读的是呈现（`applyGestureCommit` 的 `before`、`after`），不读 L1 的意图。兜底：`lab-grid-panels.e2e.ts`。
  - **t58 要跟着改的**：
    - t58 的 `grid.clone()` 若经 `instantiate` 与 `normCollapse`，`locked`、`rigid` 由本 Task 的白名单带上；若自己拷字段，要加这两项，不拷 `restoreSize`、`restoreToShare`。
    - t58 若给快照加“可选地带策略”，策略对象的格式里写 `rigid`、`locked`，不写那两个旧字段；读到旧字段时忽略。两者都进 0.3.0、都没发布，不需要迁移。
    - 本 Task 开工前读 t58 合入后的 `clone` 与快照代码，把具体文件写进片 2、片 3 的说明。
  - **插件 SDK 快照**：片 2 会让 `sdk.test.ts` 失败，要判断并照提示处理（上表）。

## 待确认项

1. **Enter 与区段按钮改成能翻时和 `setCollapsed` 结果相同**（两个例外：翻了之后放不下或没人吸收时 Enter 拒绝，`setCollapsed` 照样翻；锁住的 Enter 跳过）（改已实现的输出 20；推翻待确认清单第 95 行的“两种结果分开写”，采纳第 98 行的根治候选）。推荐：改。
   - 理由：两条路一个结果，展开就只有意图一个来源。
   - 顺带修掉一个更重的问题：窄窗口里今天的 Enter 会把旁边保留像素面板的意图永久写窄（P8，展开时 P10 写成 100）。
   - 代价：按比例分的兄弟不再由“隔着分隔条的那个”独自让位。
2. **网格节点的收起策略去掉 `restoreSize` 与 `restoreToShare`**（推翻第 96 行的“谁收起谁记”），`restoreSize` 只留给独立 `Splitter`。推荐：去掉。
   - 留着只会让宿主继续猜存什么；
   - 0.x 允许不兼容；
   - 仓库里要删的有 7 处，全在上表。
3. **`onApplied` 改成 `(change, before)`、`change` 带 `kind`**，不另加回调。推荐：改。理由见 `useGridHost` 一节，要改的使用方 4 处。备选是保留 `onApplied` 只给手势、另加 `onChanged`，存档就得接两处，第 4 条没解决。
4. **快照不带 `collapsed`**，宿主照旧另存收起状态。推荐：本 Task 不改快照格式，留给 t58 的“快照可选地带策略”一起定。
5. **工作台的活动栏、状态栏与入口条要不要标 `rigid`**（窄窗口里最后才让）。推荐：本 Task 不标，行为不变，另开 Task 时再看工作台窄窗口的截图。
6. **锁由宿主经 `setCollapsed` 的第三个参数改**，不另开 `setCollapseLocked`。推荐：照这样。锁与收起标记一起变的场合最多：ide 把区搬空时同时收起并锁住。
