# t38 诊断的形状、码与只发新增：实施计划（第 1 稿）

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项的诊断一半与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout（L0 求解、L1 组件与组合式函数）的诊断从中文字符串改成 `{code, message, params?}`，`message` 是库内的英文；通知宿主时只发新增。失败的一半在 [t34](../t34-unified-errors/README.md) 做完（`GridFailure`、`GridParamValue = string | number`）。

今天的问题（代码事实）：

- 诊断是中文句子，宿主只能按文字分支，拼不出自己的界面文字。
- 每次布局重算，`useGridLayout` 把这次的全部诊断交给 `onIssues`；窗口拖窄时每个像素都重发一遍。
- 手势里 `useSashGesture` 把每帧的诊断追加进 `scope.issues`（留最后 8 条），`NestedGrid` 用 `watch` 把整个列表再发一次 `issues` 事件：同一条诊断一场拖动里发几十次，已经发过的旧条目也跟着重发。
- 没接 `onGestureCommit` 时一个失败发两条（`NestedGrid.vue` 直接发一条，`useSashGesture` 又发一条）。
- 键盘调整分隔线不发诊断，`no-collapse-policy` 与按 Enter 的恢复空间不足因此发不到宿主（t34 第三轮第 9 条）。

开发者已确认的：t31（2026-11-18）“都按推荐”；2026-11-19 同意把 t34 拆开，诊断在本 Task 重新设计，“先定结果是状态快照、通知只发边沿的合同再写计划”（t34 README 停下时的推荐原话）。继承的约束：诊断码不与失败码同名（[t38 README](README.md)）。

工作方式：autonomous-delivery。代码在 t34 合入 master 之后从 master 开 worktree `w00026-t38-grid-diagnostics`（分支 `refactor/w00026-t38-grid-diagnostics`）；Spec 与 Task 记录在 master 上改。

### 和第 3 稿、提案不同的地方

t34 第 3 稿的诊断设计三轮审查没收敛，问题都出在“合成”上：同键的几条合成一条后，`branch`、度量只对应第一条，`ids` 却是并集（第三轮第 1 条）；`ids` 是数组，交不给 `ui/i18n` 的文字参数（第 4 条）。这一稿把合成整个拿掉：

1. **不合成**：提案说“每次布局都发的诊断合并成一条一个码”。改成每条诊断带它所在的节点 `id`，键是码、`cause`、轴与 `id`；同一次求解里同一个键最多一条（每个节点每次求解只量一次，核实见“关键设计”），不用合成，参数天然对得上。
2. **参数只有标量**：没有 `ids` 数组。宿主要知道某个分支里牵涉哪些子节点，按 `id` 在树里找。
3. **抛错的回调不打断手势**：宿主的诊断回调抛出时，库照常收尾，异常用 `console.error` 报出来（和 Vue 生产构建处理事件回调异常的做法一样），不重新抛出。

这三条追加进提案的决策记录，记入待确认清单。

## 技术选型

无通用问题。

## 关键设计

### 共同形状：`packages/nb-layout/src/grid-types.ts`

```ts
/** 诊断（Spec `ui/nested-grid` 输出 139）：码给程序分支，`message` 是英文、只给日志看，`params` 只有字符串与数字。 */
export interface GridIssue<C extends string = string> {
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, GridParamValue>>;
}
/** t34 的失败改写成诊断加 `ok: false`：结构不变，读失败的宿主不受影响。 */
export interface GridFailure<C extends string = string> extends GridIssue<C> {
    readonly ok: false;
}
export type GridIssueCode = "over-constrained" | "unabsorbed-space" | "conflicting-bounds" | "no-collapse-policy" | "no-room-to-collapse" | "no-room-to-restore" | "swap-skipped";
/** 只由组件与组合式函数发出、求解不会产生的两个码。 */
export type GridHostIssueCode = "not-published" | "notify-failed";
```

- 构造照 t34 的 `grid-failure.ts`：库内一张“码 → `params` 形状”的映射加 `gridIssue(code, message, params)`，按 `cause` 判别；不导出映射。
- 诊断码与失败码不相交：类型级测试写成 `GridFailureCode | GridRestoreFailureCode | GridCommitFailureCode` 与 `GridIssueCode | GridHostIssueCode` 的交集是 `never`（第三轮第 12 条）。

### 每一处的码与参数

`id` 是诊断所在的节点（分支、叶或分隔线两侧的面板），`axis` 是那根轴，度量是数字（四舍五入到 0.01 前的原值）：

| 位置 | 码 | `cause` | `id` | 其余 |
|---|---|---|---|---|
| `grid-geometry.ts` 149 | `over-constrained` | `min-total` | 分支 | `axis`、`available`、`required`（最小值合计） |
| 185 | `over-constrained` | `fixed-overflow` | 分支 | `axis`、`available`、`required`（压缩前固定尺寸合计） |
| 195 | `unabsorbed-space` | `no-weight` | 分支 | `axis`、`rest` |
| 533 | `unabsorbed-space` | `capped` | 分支 | `axis`、`rest` |
| 361 | `conflicting-bounds` | 无 | 节点 | `axis`、`min`、`max` |
| 486 | `over-constrained` | `leaf-min` | 叶 | `axis`、`available`、`required` |
| 502 | `over-constrained` | `sash-overflow` | 分支 | `axis`、`available`、`required` |
| 507 | `over-constrained` | `cross-min` | 分支 | `axis`（交叉轴）、`available`、`required` |
| `sash-drag.ts` 247 | `over-constrained` | `range-overflow` | 无 | `required`（分支总量） |
| 178 | `no-collapse-policy` | 无 | 面板 | 无 |
| 311 | `no-room-to-collapse` | 无 | 面板 | 无 |
| 194、316 | `no-room-to-restore` | 无 | 面板 | `available` |
| `grid-swap.ts` 132、133 | `swap-skipped` | `no-leaving`、`no-entering` | 无 | 无（叶的列表只在 `message` 里） |
| 135 | `swap-skipped` | `busy` | 还在过渡里的叶 | 无 |
| `NestedGrid.vue` 542 | `not-published` | 无 | 无 | 无 |
| `useGridLayout.ts` 118 | `notify-failed` | 无 | 无 | 无（`message` 带异常文字） |
| 提交被拒（`useSashGesture.ts` 293） | 失败的码 | 失败的 `params` 原样 | | |

- 同一次求解里同一个键（码、`cause`、`axis`、`id`）最多一条：`layoutOf` 的 `measure` 对每个节点只调一次，`allocateAxis` 每个分支每次一次；`allocateSashPanels` 里 149 提前返回，185 与 195 的码或 `cause` 不同；361 已经用 `reportedConstraints` 去重。`range-overflow` 没有 `id`：交叉处一次手势两根轴都装不下时，同一批里有两条同键的，通知时只发第一条（见下）。
- 原来靠文字里的 id 区分的三条测试，改用参数：`grid-swap.test.ts:111` 断言 `cause: "busy"`、`id: "a2"`；`NestedGrid.dom.test.ts:1238` 断言 `cause: "no-leaving"`；`grid.test.ts:981` 断言有 `id: "editor"` 的、没有 `id` 是 `side`、`top`、`pair` 的。
- `allocateSashPanels`（`index.ts` 公开）去掉 `issues`、`context` 两个参数：仓库里传它们的只有 `allocateAxis`。内部另写不导出的 `allocatePanels(panels, available, report?)`，`report(cause, params)` 由 `allocateAxis` 传一个带分支 id 与轴的闭包；`allocateSashPanels` 是它的薄封装（第三轮第 8 条）。
- 结果类型改成 `readonly GridIssue[]`：`GridLayoutResult.issues`、`GridGesturePreview.issues`、`SashDragResult.issues`、`solveSashCollapse` 的返回、`SashGestureSessionCore.issues`、`splitter-session.ts` 的 `issues`；`allocateAxis` 的 `issues` 参数是 `GridIssue[]`。`grid-swap.ts` 的 `{kind: "skip", reason}` 改成 `{kind: "skip", issue}`，`useGridMotion` 的 `MotionDecision.swapSkipped` 与 `onSwapSkipped` 改收 `GridIssue`。

### 结果是快照，通知只发边沿

- **快照**：`layout()` 的 `issues`、预览与会话的 `issues`、`solveSashDrag` 与 `solveSashCollapse` 的结果，是这一次求解的全部诊断，逐条、参数完整，不去重。宿主要看“现在有哪些问题、数是多少”读它们。
- **边沿**：两个通知出口只发新出现的键。键是码、`params.cause`、`params.axis`、`params.id`（没有的算空）。同一批里同键的只发第一条。通知不说诊断什么时候消失：要知道现在的状态，读快照。
- **布局重算**（`useGridLayout` 的 `onIssues`）：每次重算发这次有、上一次重算没有的键，然后把这次的键集记成“上一次”；消失再出现会再发。发布空布局（没有网格或没有尺寸，`useGridLayout.ts` 62 到 71）时清空键集；`contextKey` 与上一次重算的不同时清空（`recompute` 记下上一次的值）；`grid` 换实例不清空（宿主每次投影都可能换实例，持续的诊断不重发）。
- **手势**（`NestedGrid` 的 `issues` 事件）：指针每帧与松手补的最后一帧（`flush`），以及键盘的 Enter、方向键、Home、End 每次预览之后，把会话的 `issues` 交给通知；一场手势里同一个键只发一次，开始新手势时清空键集（取消、失效、卸载都不用单独清）。预览布局自己的诊断（`preview.layout.issues`）不经通知：松手落账后的那次布局重算照常经 `onIssues` 发。
- **事件型**：提交被拒（码就是失败的码，`params` 原样）、`not-published`、`swap-skipped`、`notify-failed`，每发生一次发一条，不去重。没接 `onGestureCommit` 时只发一条：删掉 `NestedGrid.vue:526` 直接发的那条，由 `useSashGesture` 统一发。
- **出口**：`SashGestureScope.issues`（经 `SASH_GESTURE_SCOPE_KEY`、`useSashScope` 从 `./vue` 公开）删掉；`SashGestureOptions` 加 `onIssues(batch: readonly GridIssue[])`，`NestedGrid` 用它发 `issues` 事件，删掉 `watch(() => scope.issues)`。`NestedGrid` 的事件元素是 `GridIssue<GridIssueCode | GridCommitFailureCode | "not-published">`；`useGridLayout.onIssues` 的元素是 `GridIssue<GridIssueCode | "notify-failed">`。应用的 `WorkbenchSurface.vue` 把两路合进自己的 `issues` 事件，类型写并集。
- **回调抛出**：`useSashGesture` 与 `useGridLayout` 各自只经一个内部的 `notify(batch)` 调宿主的回调：`try` 调用，`catch` 里 `console.error` 报出异常、照常往下走。这样 `flush` 里抛出时 `onPointerUp` 后面的 `finish` 照常跑（第三轮第 2 条），`onGestureCommit` 里重算的通知抛出时提交照样是落账成功、不变成 `handler-threw`。Vue 开发构建里 `emit` 会把监听的异常抛出来（`runtime-core` 的 `logError`），走的也是这一处。

### 应用与 Lab：`packages/neuro-book/src/plugins`

- `workbench/web/components/WorkbenchSurface.vue` 与 `.md`：事件类型。应用里没有监听 `WorkbenchSurface` 的 `issues` 的地方，只改类型。
- Lab `NestedGridAcceptanceFixture.vue`：`visibleIssues` 按键去重（今天按字符串 `includes`），显示 `message`；`GridSwapScene.vue`：今天 `issues = list` 整个替换，改成追加，显示 `message`。`lab-grid-swap.e2e.ts:240` 断言空文字，不用改。
- 插件 SDK：`sdk/components.ts` 加导出 `GridIssue`、`GridIssueCode`、`GridHostIssueCode`；nb-layout 根入口显式写出这几个类型名（`sdk.test.ts` 按入口里写出的名字核对，t34 同样做过）。

### 公开面变更清单

| 类型或接口 | 出口 | 插件 SDK | 变更记录 |
|---|---|---|---|
| `NestedGrid` 的 `issues` 事件：元素从字符串改成诊断对象，只发新增 | `nb-layout/vue` | 是 | 不兼容的改动：已经构建、按字符串读诊断的插件运行时会出错 |
| `GridGesturePreview.issues`（`gesture-update` 事件载荷） | `nb-layout` | 是 | 同上 |
| `GridIssue`、`GridIssueCode`、`GridHostIssueCode` | `nb-layout` | 新导出 | 新增 |
| `SashGestureScope.issues` 删、`SashGestureOptions.onIssues` 加 | `nb-layout/vue` | 否 | 不写 |
| `GridLayoutResult.issues`、`SashDragResult.issues`、`solveSashCollapse`、`allocateAxis`、`allocateSashPanels`（删两个参数）、`useGridLayout` 的 `onIssues` | `nb-layout`、`nb-layout/vue` | 否 | 不写 |

- 两条“不兼容”按 t33、t34 两行待确认里的哪个判据都成立（已经构建的插件照字符串读会出错），下次发版按发版手册第 2 步提兼容起点（Work README“发版前”一行已有，补上这两项）。

### 测试迁移规则

- 按中文诊断文字断言的（`grid-geometry.test.ts`、`sash-drag.test.ts`、`grid.test.ts`、`grid-swap.test.ts`、`NestedGrid.dom.test.ts`、`useGridMotion.dom.test.ts` 等，`issues.join()` 与 `includes`）改成断言 `code` 与 `params`（至少 `cause`、`id`），不断言 `message`。
- 行为变化补用例：
  - 窄窗口逐像素重算（`useGridLayout.dom.test.ts` 的 harness，`extent` 改值后 `await nextTick()`）：持续的诊断只通知一次；变宽再变窄，再通知一次；换 `contextKey` 后再通知一次；换 `grid` 实例不再通知。
  - 同一场拖动里同一个诊断只通知一次；下一场拖动再通知（窄容器里的 `range-overflow`）。
  - 键盘：Enter 收起一块没有收起策略的面板，发 `no-collapse-policy`。
  - 没接 `onGestureCommit` 时只发一条。
  - `not-published` 真的发出（改写 `useGridLayout.dom.test.ts:208` 的空断言：在 `NestedGrid` 上用接纳但不发布的宿主，先变异去掉发出确认会红）。
  - 回调抛出：`@issues` 的监听抛错，窄容器里拖出诊断、不等 rAF 就松手，断言手势结束（`dragging` 为假、`active` 为空）、提交照常；`onIssues` 抛错时 `onGestureCommit` 照样返回 `{ok: true}`。
  - 诊断码与失败码不相交的类型级测试。

## Spec 与文档改动

在 master 上、设计审查处理完之后、写代码之前：

- `ui/nested-grid`：
  - 输出追加 139（诊断的形状、码表与各码的参数、两个出口、诊断码与失败码不相交）与 140（结果是快照、通知只发边沿：键、同批同键只发第一条、两种作用域与清空、事件型不去重、一个失败一条、回调抛出不打断收尾），标“（planned）”；
  - 输出 68 的“经 `issues` 交回原因”链接到 139（`swap-skipped`）；
  - “状态与转换”里“通知异常只报 `issues`、不反悔几何”一句补“宿主的诊断回调抛出不打断手势与提交”。
- `packages/neuro-book/CHANGELOG.md`：“不兼容的改动”两项、“新增”一项。
- 包文档：nb-layout 的 `NestedGrid.md`（`issues` 事件、`gesture-update` 载荷）、`src/grid.md`（若写到诊断字符串）；应用的 `WorkbenchSurface.md`。
- Work README：“发版前”一行补这两项。
- 实现之后：planned 去掉、实现合同与证据补路径。

## 切片

1. **L0 诊断**：`GridIssue`、码、构造、每一处的码与参数、`allocatePanels` 与 `allocateSashPanels`、结果类型、`grid-swap` 的 `skip`；L0 测试迁移。验证：nb-layout 与 nb-workbench-layout 的类型检查与测试（L1 先读 `message` 拼回字符串，下一片换）。
2. **L1 通知**：`useSashGesture`（`onIssues`、删 `scope.issues`、按手势去重、键盘、`notify`）、`NestedGrid`（删 `watch` 与直接发的那条、`not-published`、`swap-skipped`）、`useGridLayout`（按重算去重、`contextKey`、`notify-failed`、`notify`）、`useGridMotion`；dom 测试与新增用例。验证：nb-layout 测试、三个包的类型检查。
3. **应用、Lab、SDK 与文档**：`WorkbenchSurface`、两个 Lab 夹具、SDK 导出、变更记录、包文档、Work README。验证：应用三份类型配置、`sdk.test`、`test:affected --since master`、`docs:check`。
4. **收口**：并 master、e2e、实现审查、合入，Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 输出 139（planned） | L0 各测试按码与 `cause`、`id` 断言（每一处一条）；诊断码与失败码不相交的类型级测试 |
| nested-grid 输出 140（planned） | `useGridLayout.dom.test.ts`：逐像素重算只通知一次、消失再出现、换上下文、换实例；`NestedGrid.dom.test.ts`：一场拖动一次、下一场再发、键盘、没接回调一条、`not-published`、回调抛出 |
| nested-grid 输出 68 | `NestedGrid.dom.test.ts:1238` 一带与 `useGridMotion.dom.test.ts`：`swap-skipped` 与 `cause` |

## 验证

- 每片三个包的类型检查、两个包的测试；第 3 片之后 `test:affected --since master`。
- e2e：`lab-nested-grid`、`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-shell`，5 个文件。开跑前看负载。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行）。

## 不做与风险

- 不做：L2（nb-workbench-layout）的诊断（它没有诊断出口）；`collapsePolicyProblem` 的返回形状（t36）；`validateNode` 的问题分码；开发模式下的配置错误报告（t36）；界面文字（第二档）。
- 风险：
  - 只发新增后，靠整个列表替换的消费方会只剩最新一批：两个 Lab 夹具在第 3 片改；实施时再按 `@issues`、`onIssues`、`.issues` 搜一遍 `packages/`。
  - 回调抛出只 `console.error`：宿主的全局错误处理看不到。要看到就在自己的回调里 `try`。
  - `range-overflow` 没有 `id`：交叉处两根轴同时装不下时只通知一条，另一条在快照里。
