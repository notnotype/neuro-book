# t38 诊断的形状、码与只发新增：实施计划（第 2 稿）

第 2 稿按第一轮设计审查（常规 [`evidences/design-review.txt`](evidences/design-review.txt) 6 条、拉远看 [`evidences/zoom-out.txt`](evidences/zoom-out.txt) 5 条）改，逐条处理见 Task README。

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项的诊断一半与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout（L0 求解、L1 组件与组合式函数）的诊断从中文字符串改成 `{code, message, params?}`，`message` 是库内的英文；通知宿主时只发新增。失败的一半在 [t34](../t34-unified-errors/README.md) 做完（`GridFailure`、`GridParamValue = string | number`），已合入 master。

今天的问题（代码事实）：

- 诊断是中文句子，宿主只能按文字分支，拼不出自己的界面文字。
- 每次布局重算，`useGridLayout` 把这次的全部诊断交给 `onIssues`；窗口拖窄时每个像素都重发一遍（提案“错误与诊断”：“每次布局都发的诊断合并成一条”）。
- 手势里 `useSashGesture` 把每帧的诊断追加进 `scope.issues`（留最后 8 条），`NestedGrid` 用 `watch` 把整个列表再发一次：同一条诊断一场拖动里发几十次，旧条目跟着重发（提案：“`issues` 事件只发新增的，累计列表由宿主自己积累”）。
- 没接 `onGestureCommit` 时一个失败发两条。
- 键盘调整分隔线不发诊断；按 Enter 恢复空间不足的诊断被会话自己覆盖掉（`grid-gesture.ts` 的 `solve` 在 `applyCollapse` 失败后落到 `solveSashDrag`，`owner.issues` 被换成空），从会话里拿不到。

谁消费：今天应用里没有监听 `WorkbenchSurface` 的 `issues` 的地方，只有两个 Lab 夹具；第一个外部使用方是第二档要改造的 nb-story（ADR 0054）。诊断的用处是日志、开发时排查约束配错，以及宿主按码拼自己的提示（例如“窗口太窄，侧栏被压到最小”）。

开发者已确认的：t31（2026-11-18）“都按推荐”；2026-11-19 同意 t34 拆开，诊断在本 Task 重新设计，“先定结果是状态快照、通知只发边沿的合同再写计划”。继承的约束：诊断码不与失败码同名。

**待开发者定的一处**：第一轮拉远看审查认为“通知只发边沿”没有消费者撑着，建议拿掉按键去重，只留快照与事件型通知、每帧原样交本批（拉远看第 1、3 条）。这碰到开发者同意过的方向与已接受提案的两句原文，作者不替开发者驳回，记入待确认清单；本稿照已定方向写，按键去重放在独立的一片（第 3 片），开发者要拿掉时整片不做，其余不受影响。

工作方式：autonomous-delivery。代码从 master 开 worktree `w00026-t38-grid-diagnostics`（分支 `refactor/w00026-t38-grid-diagnostics`）；Spec 与 Task 记录在 master 上改。

### 和第 3 稿、提案不同的地方（提案已追加决策记录，待开发者追认）

1. **不合成**：提案说“合并成一条一个码”。改成每条诊断带它所在的节点 `id`，键是码、`cause`、轴与 `id`；同一次求解里同一个键最多一条（核实见“每一处的码与参数”），不用合成，参数天然对得上。代价：窄窗口下一次通知最多 O(节点数) 条（节点上限 256），不是“一条”；之后每个键只通知一次。
2. **参数只有标量**：没有节点 id 数组。宿主要知道某个分支里牵涉哪些子节点，按 `id` 在树里找。
3. **宿主回调抛出**：第 1 稿“抛出时 `console.error`、不重新抛出”撤回。改成控制流保证收尾：先清状态、后调宿主回调，`onPointerUp` 用 `try`/`finally` 保证 `finish` 一定跑，异常照常冒出去；只有一处必须接住：`onGestureCommit` 里落账之后重算的通知，接住后交 `reportError`（浏览器标准，派发 `error` 事件，全局处理看得到），没有它时退回 `console.error`。

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
/** t34 的失败改写成诊断加 `ok: false`：结构不变。 */
export interface GridFailure<C extends string = string> extends GridIssue<C> {
    readonly ok: false;
}
export type GridIssueCode = "over-constrained" | "unabsorbed-space" | "conflicting-bounds" | "no-collapse-policy" | "no-room-to-collapse" | "no-room-to-restore" | "swap-skipped";
/** 只由组件与组合式函数发出、求解不会产生的两个码。 */
export type GridHostIssueCode = "not-published" | "notify-failed";
```

- **保留的参数名**：`cause`（为什么）、`axis`、`id`（在哪）三个名字在所有诊断里意思相同，进通知的键；其余参数是度量。失败里细分用的是 `field`（哪一项输入不合法），两者意思不同，各用各的。
- **默认分支**：码集合开放；`cause` 只细分一个码，宿主不认识的 `cause` 按码处理。
- 构造照 t34 的 `grid-failure.ts`：库内一张“码 → `params` 形状”的映射加 `gridIssue(code, message, params)`，一个码几种形状的按 `cause` 判别；不导出映射。
- 诊断码与失败码不相交：类型级测试写成失败三个联合与 `GridIssueCode | GridHostIssueCode` 的交集是 `never`。
- 度量参数过 `round`（`grid-geometry.ts:44`，保留两位小数），和 `message` 里的数一致，不带浮点尾巴。

### 每一处的码与参数

`id` 是诊断所在的节点（分支、叶或分隔线两侧的面板）。度量的定义写在表里，同一行的 `available` 与 `required` 可以直接比：

| 位置 | 码 | `cause` | `id` | 度量 |
|---|---|---|---|---|
| `grid-geometry.ts` 149 | `over-constrained` | `min-total` | 分支 | `axis`；`available` 扣掉分隔条后的主轴空间，`required` 最小值合计 |
| 185 | `over-constrained` | `fixed-overflow` | 分支 | `axis`；`available` 留给固定尺寸面板的预算（`budgetForFixed`），`required` 压缩前固定尺寸合计 |
| 533 | `unabsorbed-space` | 没有展开的按比例分的子节点时 `no-weight`，否则 `capped` | 分支 | `axis`、`rest` |
| 361 | `conflicting-bounds` | 无 | 节点 | `axis`、`min`、`max` |
| 486 | `over-constrained` | `leaf-min` | 叶 | `axis`；`available` 这根轴的空间，`required` 最小值 |
| 502 | `over-constrained` | `sash-overflow` | 分支 | `axis`；`available` 主轴空间，`required` 分隔条合计 |
| 507 | `over-constrained` | `cross-min` | 分支 | `axis`（交叉轴）；`available` 交叉轴空间，`required` 最小值 |
| `sash-drag.ts` 247 | `over-constrained` | `range-overflow` | 分支（调用方给） | `axis`（调用方给）、`total`、`min`（下限合计）、`max`（上限合计） |
| 311 | `no-room-to-collapse` | 无 | 面板 | 无 |
| 194、316 | `no-room-to-restore` | 无 | 面板 | `available` 能给它的空间，`required` 它的下限 |
| 178 | `no-collapse-policy` | 无 | 面板 | 无。只出现在直接调用 `solveSashCollapse` 的结果里：两个会话都先挑有收起策略的面板，挑不到就什么都不做 |
| `grid-swap.ts` 132、133 | `swap-skipped` | `no-leaving`、`no-entering` | 无 | 无（叶的列表只在 `message` 里：宿主据 `cause` 就知道哪一边空了） |
| 135 | `swap-skipped` | `busy` | 还在过渡里的叶 | 无 |
| `NestedGrid.vue` 542 | `not-published` | 无 | 无 | 无 |
| `useGridLayout.ts` 118 | `notify-failed` | 无 | 无 | 无（`message` 带异常文字） |
| 提交被拒（`useSashGesture.ts` 293） | 失败的码 | 失败本身（`GridFailure`，带 `ok: false`）原样进通知 | | |

- **195 不再单独发**：195（`allocateSashPanels` 里没有按比例分的节点、剩余没被吸收）与 533（`measure` 里子节点合计小于空间）在同一个分支上同时发，说的是同一件事（第一轮第 2 条，实验两个固定尺寸叶、容器 600 得到两条）。533 覆盖 195 的全部情况，`cause` 在 533 处按有没有展开的按比例分的子节点判；533 照 195 的做法受祖先收起的 `quiet` 约束。
- **同一次求解里同一个键最多一条**：`measure` 对每个节点只调一次，`allocateAxis` 每个分支每次一次；149 提前返回；361 已经用 `reportedConstraints` 去重；`leaf-min` 按轴各一条；`no-room-*` 的面板 id 在树里唯一。`range-overflow` 由调用方补 `id` 与 `axis`：`SashDragInput` 加可选的 `scope: {id, axis}`，`grid-gesture.ts` 传 `owner.sash.branchId` 与轴，`splitter-session.ts` 传自己的分支 id，交叉处两根轴各一条、键不同。
- **会话里的诊断不被覆盖**（第一轮第 1 条）：`grid-gesture.ts` 的 `solve` 里 `applyCollapse` 没有真实变化时保留它的诊断，不再落到 `solveSashDrag` 把 `owner.issues` 换成空；`solve` 收集本帧诊断时也收 `applyCollapse` 的。`splitter-session.ts` 的 `collapseOn` 照同样核对一遍。
- 原来靠文字里的 id 区分的三条测试改用参数：`grid-swap.test.ts:111` 断言 `cause: "busy"`、`id: "a2"`；`NestedGrid.dom.test.ts:1238` 断言 `cause: "no-leaving"`；`grid.test.ts:981` 断言有 `id: "editor"` 的、没有 `id` 是 `side`、`top`、`pair` 的。
- `allocateSashPanels`（`index.ts` 公开）去掉 `issues`、`context` 两个参数：仓库里传它们的只有 `allocateAxis`。内部另写不导出的 `allocatePanels(panels, available, report?)`，`allocateAxis` 传带分支 id 与轴的闭包；`allocateSashPanels` 是它的薄封装。
- 结果类型改成 `readonly GridIssue[]`：`GridLayoutResult.issues`、`GridGesturePreview.issues`、`SashDragResult.issues`、`solveSashCollapse` 的返回、`SashGestureSessionCore.issues`、`splitter-session.ts` 的 `issues`；`allocateAxis` 的 `issues` 参数是 `GridIssue[]`。`grid-swap.ts` 的 `{kind: "skip", reason}` 改成 `{kind: "skip", issue}`，`useGridMotion` 的 `MotionDecision.swapSkipped` 与 `onSwapSkipped` 改收 `GridIssue`。

### 结果是快照，通知只发边沿

- **快照**：`layout()` 的 `issues`、预览与会话的 `issues`、`solveSashDrag` 与 `solveSashCollapse` 的结果，是这一次求解的全部诊断，逐条、参数完整，不去重。要看“现在有哪些问题、数是多少”读它们。
- **边沿**：两个通知出口只发新出现的键。键是码、`cause`、`axis`、`id`（没有的算空），由 L0 一个纯函数 `issueKey` 算；去重由 L0 一个小的闸门 `createIssueGate()` 做：`take(batch)` 交回这批里键没见过的（同一批里同键的只交第一条，按上面的核实不会出现），`replace(batch)` 用这批的键换掉已见过的键集（布局重算用），`reset()` 清空。闸门不从入口导出，`useGridLayout` 与 `useSashGesture` 共用，Bun 里直接测。通知不说诊断什么时候消失：要知道现在的状态，读快照。
- **布局重算**（`useGridLayout` 的 `onIssues`）：每次重算交出这次有、上一次重算没有的键，然后用这次的键集换掉上一次的；消失再出现会再发。发布空布局（`useGridLayout.ts` 62 到 71）时清空；`contextKey` 与上一次重算的不同时清空（`recompute` 记下上一次的值）；`grid` 换实例不清空（宿主每次投影都可能换实例，持续的诊断不重发）。
- **手势**（`NestedGrid` 的 `issues` 事件）：指针每帧与松手补的最后一帧（`flush`），以及键盘的 Enter、方向键、Home、End 每次求解之后（不管有没有预览：Enter 恢复空间不足时预览是 null），把会话的 `issues` 交给闸门；一场手势里同一个键只发一次，开始新手势时清空（`begin` 是所有手势的入口，取消、失效、卸载不用单独清）。预览布局自己的诊断（`preview.layout.issues`）不经通知：松手落账后的那次布局重算照常经 `onIssues` 发。
- **事件型**：提交被拒（失败本身，`ok: false`、码与参数原样）、`not-published`、`swap-skipped`、`notify-failed`，每发生一次发一条，不经闸门。没接 `onGestureCommit` 时只发一条：删掉 `NestedGrid.vue:526` 直接发的那条。
- **出口**：`SashGestureScope.issues`（经 `SASH_GESTURE_SCOPE_KEY`、`useSashScope` 从 `./vue` 公开）删掉；`SashGestureOptions` 加 `onIssues(batch)`，`NestedGrid` 用它发 `issues` 事件，删掉 `watch(() => scope.issues)`。`NestedGrid` 的事件元素是 `GridIssue<GridIssueCode | "not-published"> | GridFailure`：带 `ok: false` 的是被拒的提交（已回滚），其余是诊断（已降级或没生效）。`useGridLayout.onIssues` 的元素是 `GridIssue<GridIssueCode | "notify-failed">`。应用的 `WorkbenchSurface.vue` 把两路合进自己的 `issues` 事件，类型写并集。

### 宿主回调抛出时的收尾（第一轮第 3 条、拉远看第 4 条）

- `useSashGesture`：`onPointerUp` 写成 `try { flush() } finally { 释放捕获; finish() }`；`cancel` 与 `finish` 先把 `binding`、`dragging`、`active`、键盘状态清掉，最后才调宿主的回调（`onPreview(null)`、`onCancel`、`onIssues`）。宿主的 `@gesture-update`、`@gesture-cancel`、`@issues` 哪个抛出，手势都已经结束，异常照常冒出去（Vue 开发构建里 `emit` 会把监听的异常抛出来，生产构建与设了 `errorHandler` 的应用里交给 Vue）。
- `useGridLayout`：`onGestureCommit` 落账之后的重算若通知抛出，提交已经落账，不能让异常冒到 `useSashGesture` 变成 `handler-threw`：这一处接住，交 `globalThis.reportError`，没有时 `console.error`。别处（`watch` 触发的重算）照常冒出去，由 Vue 的错误处理接。
- 实施时先核对 happy-dom 与 Bun 有没有 `reportError`，以及测试里怎样接住它派发的 `error` 事件；没有就只测 `console.error` 那一支，并写进 Task README。

### 应用与 Lab：`packages/neuro-book/src/plugins`

- `workbench/web/components/WorkbenchSurface.vue` 与 `.md`：事件类型。应用里没有监听它的 `issues` 的地方，只改类型。
- Lab `NestedGridAcceptanceFixture.vue`：`visibleIssues` 按 `issueKey` 去重（今天按字符串 `includes`），显示 `message`；`GridSwapScene.vue`：今天 `issues = list` 整个替换，改成追加，显示 `message`。`lab-grid-swap.e2e.ts:240` 断言空文字，不用改。
- 插件 SDK：`sdk/components.ts` 加导出 `GridIssue`、`GridIssueCode`、`GridHostIssueCode`；nb-layout 根入口显式写出这几个类型名（`sdk.test.ts` 按入口里写出的名字核对）。

### 公开面变更清单

| 类型或接口 | 出口 | 插件 SDK | 变更记录 |
|---|---|---|---|
| `NestedGrid` 的 `issues` 事件：元素从字符串改成对象，只发新增 | `nb-layout/vue` | 是 | 不兼容的改动 |
| `GridGesturePreview.issues` 与 `GridGesturePreview.layout.issues`（`gesture-update` 载荷，`GridLayoutResult` 经它到插件） | `nb-layout` | 是 | 同上 |
| `GridIssue`、`GridIssueCode`、`GridHostIssueCode` | `nb-layout` | 新导出 | 新增 |
| `SashGestureScope.issues` 删、`SashGestureOptions.onIssues` 加、`SashDragInput.scope` 加 | `nb-layout/vue`、`nb-layout` | 否 | 不写 |
| `SashDragResult.issues`、`solveSashCollapse`、`allocateAxis`、`allocateSashPanels`（删两个参数）、`useGridLayout` 的 `onIssues` | `nb-layout`、`nb-layout/vue` | 否 | 不写 |

- 变更记录写事实：按字符串读诊断的插件不会报错，只是读到错的值（`join` 得到 `[object Object]`、`includes` 永远是假），要改成读 `code`；重新编译时类型检查会报错。两项都算不兼容，下次发版按发版手册第 2 步提兼容起点（Work README“发版前”一行补上这两项）。

### 测试迁移规则

- 按中文诊断文字断言的（`grid-geometry.test.ts`、`sash-drag.test.ts`、`grid.test.ts`、`grid-swap.test.ts`、`NestedGrid.dom.test.ts`、`useGridMotion.dom.test.ts` 等，`issues.join()` 与 `includes`）改成断言 `code` 与 `params`（至少 `cause`、`id`），不断言 `message`。
- “只通知一次”一类的判据写两半：先断言确实发了、恰好一次（快照里也有这条），再断言之后没有再发；否则“从来没发”也会过。每个新行为做一次变异（去掉闸门、不清键集、不保留 `applyCollapse` 的诊断），确认用例会红。
- 新增用例：
  - 闸门（Bun）：同批去重、`take` 只交新的、`replace` 后消失再出现会再交、`reset`。
  - 会话（Bun）：键盘 Enter 恢复空间不足时会话的 `issues` 里有 `no-room-to-restore`（第一轮第 1 条的输入：`a` 收起、下限 200，`b` 下限 150，总 301）；交叉处两根轴都装不下时各有一条 `range-overflow`、`id` 不同；一个分支只有一条 `unabsorbed-space`（两个固定尺寸叶、容器 600）；`fixed-overflow` 的 `available` 小于 `required`。
  - `useGridLayout.dom.test.ts`：窄窗口逐像素重算，持续的诊断只通知一次；变宽再变窄再通知；换 `contextKey` 再通知；换 `grid` 实例不再通知；`onIssues` 在 `onGestureCommit` 落账后的重算里抛出时，提交照样返回 `{ok: true}`。
  - `NestedGrid.dom.test.ts`：一场拖动一次、下一场再发（窄容器里的 `range-overflow`：叶要设大的最小宽度，harness 的宽是 1000）；键盘 Enter 发 `no-room-to-restore`；没接回调只发一条；`not-published` 真的发出（改写 `useGridLayout.dom.test.ts:208` 的空断言，先变异确认会红）；`@issues`、`@gesture-update`、`@gesture-cancel` 各自抛出时手势都结束（`dragging` 为假、高亮清掉）。
  - 诊断码与失败码不相交的类型级测试；诊断码的写法按开放错误域核对（同 t34 的失败码测试）。

## Spec 与文档改动

在 master 上、设计审查处理完之后、写代码之前：

- `ui/nested-grid`：
  - 输出追加 139（诊断的形状、码表与参数、保留的参数名、`cause` 的默认分支、两个出口、带 `ok: false` 的是被拒的提交、诊断码与失败码不相交、`no-collapse-policy` 只在直接求解的结果里）与 140（结果是快照、通知只发边沿：键、两种作用域与清空、事件型不经闸门、一个失败一条、上界 O(节点数)、要看现在的状态读快照；宿主回调抛出时手势与提交照常收尾），标“（planned）”；
  - 输出 68 的“经 `issues` 交回原因”链接到 139（`swap-skipped`）；
  - “状态与转换”里“通知异常只报 `issues`、不反悔几何”一句补“宿主的回调抛出时手势已经结束，异常照常冒出；落账后重算的通知抛出交 `reportError`”。
- `packages/neuro-book/CHANGELOG.md`：“不兼容的改动”两项、“新增”一项。
- 包文档：nb-layout 的 `NestedGrid.md`（`issues` 事件、`gesture-update` 载荷）、`src/grid.md`（若写到诊断字符串）；应用的 `WorkbenchSurface.md`。
- Work README：“发版前”一行补这两项。
- 实现之后：planned 去掉、实现合同与证据补路径。

## 切片

1. **L0 诊断**：`GridIssue`、码、构造、每一处的码与参数（含 195 并进 533、`range-overflow` 的 `scope`）、`allocatePanels` 与 `allocateSashPanels`、结果类型、`grid-swap` 的 `skip`、两个会话不覆盖 `applyCollapse` 的诊断；L0 测试迁移与会话用例。验证：nb-layout 与 nb-workbench-layout 的类型检查与测试（L1 先读 `message` 拼回字符串，下一片换）。
2. **L1 出口与收尾**：`useSashGesture`（`onIssues`、删 `scope.issues`、键盘、收尾顺序与 `try`/`finally`）、`NestedGrid`（删 `watch` 与直接发的那条、`not-published`、`swap-skipped`、被拒的提交原样发）、`useGridLayout`（`notify-failed`、落账后重算通知的 `reportError`）、`useGridMotion`；这一片每批原样发、不去重。dom 测试：键盘、没接回调一条、`not-published`、三种回调抛出、提交照常。
3. **只发新增**：`issueKey` 与 `createIssueGate`，`useGridLayout` 按重算、`useSashGesture` 按手势接上闸门；闸门与两个出口的去重用例。开发者若按拉远看拿掉边沿，这一片不做。
4. **应用、Lab、SDK 与文档**：`WorkbenchSurface`、两个 Lab 夹具、SDK 导出、变更记录、包文档、Work README。验证：应用三份类型配置、`sdk.test`、`test:affected --since master`、`docs:check`。
5. **收口**：并 master、e2e、实现审查、合入，Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 输出 139（planned） | L0 各测试按码与 `cause`、`id`、度量断言（每一处一条）；会话用例；类型级不相交测试与码的写法测试 |
| nested-grid 输出 140（planned） | 闸门的 Bun 用例；`useGridLayout.dom.test.ts` 与 `NestedGrid.dom.test.ts` 的去重、作用域、事件型与回调抛出用例 |
| nested-grid 输出 68 | `NestedGrid.dom.test.ts:1238` 一带与 `useGridMotion.dom.test.ts`：`swap-skipped` 与 `cause` |

## 验证

- 每片三个包的类型检查、两个包的测试；第 4 片之后 `test:affected --since master`。
- e2e：`lab-nested-grid`、`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-shell`，5 个文件。开跑前看负载。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行）。

## 不做与风险

- 不做：L2（nb-workbench-layout）的诊断（它没有诊断出口）；`collapsePolicyProblem` 的返回形状（t36）；`validateNode` 的问题分码；开发模式下的配置错误报告（t36）；界面文字（第二档）；`swap-skipped` 的叶列表进参数（标量放不下列表，`cause` 已说清哪一边空了）。
- 风险：
  - 只发新增后，靠整个列表替换的消费方会只剩最新一批：两个 Lab 夹具在第 4 片改；实施时再按 `@issues`、`onIssues`、`.issues` 搜一遍 `packages/`。
  - `reportError` 在测试环境里的行为要先核对（见上）。
