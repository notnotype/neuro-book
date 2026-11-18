# t34 统一失败形状与错误码：实施计划（第 3 稿）

第 2 稿按第一轮设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，15 条）改，第 3 稿按第二轮（[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)，12 条）改，逐条处理见 Task README。

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项（“错误与诊断一种形状”）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout（L0、L1）与 nb-workbench-layout（L2）的失败都改成 `{ok: false, code, message, params?}`，诊断改成 `{code, message, params?}`、通知时只发新增。今天三层各写各的：L0 是中文 `reason`，L1 的提交回调同样是 `reason`，L2 已经有 `code` 但几乎都是 `rejected`、另带中文 `detail`。

开发者已确认的（t31，2026-11-18 会话）：nb-layout 做成通用库，第一档现在做、第二档等 nb-story 改造时做；“都按推荐”。本 Task 不改布局行为，只改失败与诊断的形状、码与文字；唯一的行为变化是诊断的通知方式（只发新增、同键合成一条），提案写明要做。

依据的 Spec：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)（失败 1 到 4、输出 68、“状态与转换”里的提交规则）、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（失败与恢复的码表）、[`ui/i18n`](../../../../../docs/specs/ui/i18n.md) 输出 13 的“开放错误域”。[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 写的是“无失败码”，不受影响。

工作方式：autonomous-delivery。代码在 t33 合入 master 之后从 master 开 worktree `w00026-t34-unified-errors`、分支 `refactor/w00026-t34-unified-errors`；Spec 与 Task 记录在 master 上改。

### 和提案不同的地方（待开发者追认）

提案末尾已追加决策记录，记入待确认清单：

1. **提交的码**：提案说 `stale-context`、`stale-revision`、`handler-missing`、`handler-threw` 没有对应的失败、不预设；代码里都有（`useGridLayout.ts:84` 到 `:98` 五种拒绝、`useSashGesture.ts:287` 处理器抛出、`NestedGrid.vue:525` 没接回调、`:541` 接纳后没发布）。提交的返回类型里定 `not-ready`、`stale-context`、`stale-revision`、`stale-size`、`handler-missing`、`handler-threw`；`not-published`、`notify-failed` 只是诊断。
2. **合成与只发新增**：提案说“每次布局都发的诊断合并成一条一个码”“`issues` 只发新增，累计由宿主自己积累”。计划把它落成：求解与预览的结果里诊断照旧逐条、完整；通知宿主时按键（码、`cause`、轴）只发新出现的，同键合成一条。提案的诊断形状是 `{code, message}`，计划加了 `params`；`SashGestureScope.issues` 这个公开的累计列表删掉。
3. **个别码**：提案候选表把 229（根节点没有父分支）归 `wrong-node-kind`、617 与 632（目标父节点已不存在）归 `stale-baseline`；计划改成 `invalid-argument`、`not-found`（第一轮审查第 11、8 条）。

## 技术选型

无通用问题：错误形状是本仓库自己的合同，不引库。

## 关键设计

### 共同形状：`packages/nb-layout/src/grid-types.ts`

```ts
/** 诊断与失败里的值：只用字符串、数字与字符串数组；非有限数写成字符串（`"NaN"`、`"Infinity"`），序列化进日志不丢。 */
export type GridParamValue = string | number | readonly string[];

/** 诊断。`code` 给程序分支；`message` 是库内的英文，只给日志看；`params` 给宿主拼自己的界面文字。码集合开放（见下）。 */
export interface GridIssue<C extends string = string> {
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, GridParamValue>>;
}

/** 失败：诊断加 `ok: false`。 */
export type GridFailure<C extends string = string> = GridIssue<C> & {readonly ok: false};
```

- 名字带 `Grid` 前缀，与 nb-layout 其余导出一致；L2 是 nb-layout 的使用方，直接用这两个泛型，不另写形状。泛型参数缺省 `string`，各层用自己的码联合实例化。
- **构造时检查 `params`**：每层一张内部的映射类型（码 → `params` 形状，例如 `{"not-found": {id: string}; "wrong-node-kind": {id: string; expected: "leaf" | "branch"}; …}`）与一个内部构造函数 `failure(code, message, params)`、`issue(code, message, params)`，按映射检查字段；导出的类型仍是上面的通用形状。下面几张表就是这几张映射，拼错字段名、漏字段在编译期报错。
- `GridResult`、`GridResizeResult`、`GridBranchResizeResult`、`GridBranchesResizeResult` 的失败一支都换成 `GridFailure`。
- `GridRestoreResult` 改成判别联合：`{ok: true; dropped; clamped} | (GridFailure<GridRestoreFailureCode> & {dropped; clamped})`。
- 码按层各是一个字面量联合（提案“码按层定义”），不按操作再收窄：码集合开放，调用方本来就要有默认分支；每个操作一个联合，类型数翻几倍。
- **失败码与诊断码不相交**：同一个码不会一会儿是“提交被拒、已回滚”，一会儿是“求解降级、没回滚”。`GridFailureCode`、`GridCommitFailureCode`、`GridRestoreFailureCode` 与 `GridIssueCode` 没有交集，加一条类型级测试（`Extract<…, GridIssueCode>` 是 `never`）。几个失败联合之间共用的码（`not-found`、`limit-exceeded`、`duplicate-id`）意思与 `params` 形状相同。
- **码集合开放**：新增码不算破坏，只在变更记录写一行；库不保证穷尽，调用方写 `switch` 要有 `default`，用 `assertNever` 的写法会在新增码时编译失败，那是调用方的选择。码的写法对齐 `ui/i18n` 输出 13 的“开放错误域”：小写短横线，不含 `:`、`.`、空白，不超过 64 个字符，宿主可以直接拿码查自己目录里的 `errors.<码>`。不用 `string & {}` 去“开放”类型：那样丢掉补全与收窄。
- `message` 用英文：提案“错误与诊断”写明 `message` 是库内的英文；第二档的“默认英文文案”指界面文字目录（提案“去掉 nb-ui 依赖”一节），不是这里。不断言 `message` 的文字。

### L0 结构操作：`packages/nb-layout/src/grid.ts`

`GridFailureCode = "not-found" | "wrong-node-kind" | "wrong-axis" | "not-finite" | "invalid-argument" | "limit-exceeded" | "duplicate-id" | "into-own-subtree" | "not-conserved" | "stale-baseline" | "not-collapsible"`。34 处逐处（行号按 t33 之后的 `grid.ts`）：

| 行 | 码 | `params` |
|---|---|---|
| 192、195 | `limit-exceeded` | `{limit: "nodes" 或 "depth", max}` |
| 226、401、452、472、497、554、581、591 | `not-found` | `{id}`（401、452 是分支 id，472、591 是父节点 id） |
| 229 | `invalid-argument` | `{field: "root", id}`：根节点没有可调整的父分支 |
| 232 | `wrong-axis` | `{id, parent, orientation}`：`orientation` 是父分支的方向 |
| 264 | `wrong-axis` | `{id, orientation}`：`id` 是分支自己，`orientation` 是它的方向 |
| 235 | `not-finite` | `{field: "delta", value}` |
| 272 | `invalid-argument` | `{field: "sizes-cover", id: 分支}` |
| 280 | 逐个子节点，先判非有限：`not-finite` `{field: "size", side: "baseline" 或 "target", id: 子节点}`；再判负数：`invalid-argument` `{field: "size-negative", side, id: 子节点}` |
| 286 | `not-conserved` | `{id: 分支, target, baseline}` |
| 292 | `stale-baseline` | `{id: 分支}` |
| 298 | 子节点不在：`not-found` `{id}`；不可收起：`not-collapsible` `{id, branch}` |
| 348 | `not-finite` | `{field: "intent", id: 分支}` |
| 475、594 | `wrong-node-kind` | `{id: 父节点, expected: "branch"}` |
| 478、513 | `duplicate-id` | `{id, with: "existing"}` |
| 509 | `duplicate-id` | `{id, with: "new-leaf"}` |
| 500、557、584 | `wrong-node-kind` | `{id, expected: "leaf"}` |
| 503 | `invalid-argument` | `{field: "orientation", value: String(值)}` |
| 506 | `invalid-argument` | `{field: "side", value: String(值)}` |
| 518 | 先判非有限：`not-finite` `{field: "ratio", value}`；再判越界：`invalid-argument` `{field: "ratio-range", value}` |
| 587 | `into-own-subtree` | `{id, parent}` |
| 617、632 | `not-found` | `{id: 父节点}` |

- 280、298、518 今天一个条件管两种情况，拆成先后两个条件；280 仍是逐个子节点各判一遍（今天的顺序），不改成先全体判非有限。失败与否不变。
- 617、632（`moveLeaf` 里“目标父节点已不存在”）不可达：589 已经找到父节点，同分支的移动走另一条路，克隆树里塌陷的只有来源（审查用 5000 棵随机树、每棵 14 步的实验一次没命中）。行为不改，留作防御分支，不写用例，注释写明为什么不可达。
- `value` 一律是 `String(调用方传的值)`：运行期可能是任意值；非有限数因此也是字符串。
- `limit-exceeded` 不带实际数量：快照恢复为了不遍历巨型数组会提前返回，给不出准确的数；两处同形。
- `serializeTree` 对非字符串 ref 抛的 `TypeError`（`grid-snapshot.ts:37`）是调用方的编程错误，不是失败结果，只把文字改成英文。

### L0 快照恢复：`packages/nb-layout/src/grid-snapshot.ts`

- `GridRestoreFailureCode = "invalid-snapshot" | "unsupported-version" | "unresolved-root" | "duplicate-id" | "limit-exceeded"`：
  - `invalid-snapshot` `{field, id?}`，`field` 是 `envelope`、`node`、`id`、`ref`、`size`、`orientation`、`children`、`kind`（86、111、116、131、136、164、168、173、200）；
  - `unsupported-version` `{version: String(版本)}`（90、93）；
  - `unresolved-root`（209）：格式没问题，根是叶、它的引用解析不了，整体恢复不出来；`dropped` 里照常有那条引用。和 `invalid-snapshot` 分开：宿主要据此判断是“引用暂时缺”还是“原件坏了”（失败 3、4）；
  - `duplicate-id` `{id, with: "existing"}`（120）；
  - `limit-exceeded` `{limit: "nodes" 或 "depth", max}`（107、126、177）。
- `dropped` 的元素从 `{ref, reason}` 改成 `{ref, code: "unknown-ref"}`：今天只有一种原因。

### L1 提交：`sash-gesture.ts`、`vue/useGridLayout.ts`、`vue/useSashGesture.ts`、`vue/NestedGrid.vue`、`vue/splitter-session.ts`

- `GridCommitFailureCode = GridFailureCode | "not-ready" | "stale-context" | "stale-revision" | "stale-size" | "handler-missing" | "handler-threw"`；`GridLayoutCommitResult = {ok: true} | GridFailure<GridCommitFailureCode>`。`SashGestureBinding.onCommit`（`sash-gesture.ts:62`）与 `NestedGrid` 的 `onGestureCommit` prop 返回它：
  - `not-ready` `{missing: "grid" 或 "host-size"}`（`useGridLayout.ts` 84、89）；
  - `stale-context` `{expected, actual}`（92）、`stale-revision` `{expected, actual}`（95）：`expected` 是宿主此刻的值，`actual` 是提交带来的值；`stale-size`（98）；
  - 102 原样转交 L0 的失败；
  - `handler-missing`：`NestedGrid.vue:526` 返回它，`:525` 的直接 `emit` 删掉，诊断只由 `useSashGesture` 一处发；
  - `handler-threw`（`useSashGesture.ts:287`），`message` 带异常文字。

### L0、L1 诊断

`GridIssueCode`（L0）。每条诊断都带 `ids`（身份），有的带 `cause`、`axis`、`branch`（身份）与度量（数值，不进键）：

| 码 | `cause` 与位置 | `ids` 是什么 | 其余 `params` |
|---|---|---|---|
| `over-constrained` | `min-total`（`grid-geometry.ts` 149）、`fixed-overflow`（185） | 这个分支里 `low > 0` 的子节点 | `branch`、`axis`；度量 `available`、`required` |
| `over-constrained` | `leaf-min`（486） | 这片叶 | `axis`；度量 `available`、`required` |
| `over-constrained` | `sash-overflow`（502）、`cross-min`（507） | 这个分支 | `axis`；度量 `available`、`required` |
| `over-constrained` | `range-overflow`（`sash-drag.ts` 247） | 这次拖动涉及的面板 | 度量 `available`、`required` |
| `unabsorbed-space` | `no-share`（195） | 这个分支的子节点 | `branch`、`axis`；度量 `rest` |
| `unabsorbed-space` | `branch`（533） | 这个分支 | `axis`；度量 `rest` |
| `conflicting-bounds` | 无（361） | 这个节点 | `axis`；度量 `min`、`max` |
| `no-collapse-policy` | 无（`sash-drag.ts` 178） | 这块面板 | 无 |
| `no-room-to-collapse` | 无（`sash-drag.ts` 311） | 这块面板 | 无 |
| `no-room-to-restore` | 无（`sash-drag.ts` 194、316） | 这块面板 | 度量 `available` |
| `swap-skipped` | `no-leaving`、`no-entering`、`busy`（`grid-swap.ts` 132、133、135） | 涉及的叶 | 无 |

- `allocateSashPanels` 只知道面板、不知道所在分支：`allocateAxis` 给它传一个内部的范围参数（分支 id 与轴），取代今天拼进文字的中文 `context` 参数（`context` 删掉；仓库里只有 `allocateAxis` 传它）。`Splitter` 直接调用时没有分支，`branch`、`axis` 不出现。
- `allocateAxis` 的 `issues` 参数类型改成 `GridIssue[]`。
- `grid-swap.ts` 的 `{kind: "skip", reason}` 改成 `{kind: "skip", issue}`；`useGridMotion` 的 `MotionDecision.swapSkipped`（`:77`、`:142`）与 `onSwapSkipped`（`:163`）改收 `GridIssue`。
- 类型改成 `readonly GridIssue[]` 的：`GridLayoutResult.issues`、`GridGesturePreview.issues`（`grid-gesture.ts:59`）、`SashDragResult.issues`（`sash-drag.ts:55`）、`SashGestureSessionCore.issues`（`sash-gesture.ts:44`）、`splitter-session.ts` 的 `issues`。
- `collapsePolicyProblem`（`grid-geometry.ts:117`，入口导出，只有 nb-layout 自己的测试在用）返回的中文文字不在本 Task：它是收起策略的校验辅助，不是失败结果；t36 定入口清单时决定它还导不导出，留着导出再改成诊断形状。

**结果里逐条，通知时只发新增**：

- `layout()` 的结果、`gesture-update` 事件的载荷（`GridGesturePreview.issues`）、`SashGestureSessionCore.issues` 是状态快照：逐条、完整，不合成、不去重。
- 通知宿主的两个出口（下文）才去重：
  - 诊断的**键**是 `code`、`cause`、`axis`（有的才算）。`ids`、`branch` 与度量不进键：窗口变窄时卷进来的节点越来越多、`rest` 每个像素都变，都不算新诊断。
  - 一批里同键的几条**合成一条**：`params` 取第一条的，`ids` 换成这几条 `ids` 的并集，按第一次出现的先后排（求解的遍历顺序固定，可测）。
  - 手势里的诊断（`useSashGesture` 的 `flush` 每帧推 `session.issues`）：一场手势里同一个键只发一次，手势结束清空。
  - 布局重算的诊断（`useGridLayout` 每次重算推 `next.issues`）：和上一次重算的键集比，只发上一次没有的；条件消失再出现会再发。空布局分支（`grid` 或尺寸为空，`useGridLayout.ts:63` 到 `:69`）与 `contextKey` 变化时清空键集：隐藏后再显示、换了工作面，算重新出现。
  - 事件型的诊断（提交被拒、`not-published`、`notify-failed`、`swap-skipped`）：每发生一次发一条，不去重。
  - 一个失败只发一条：没接 `onGestureCommit` 今天发两条（`NestedGrid.vue:525` 直接发一条，`useSashGesture.ts:291` 又发一条），改成只由后者发。
  - 键盘手势今天不发诊断（`pushIssues` 只在 `finish` 与指针的 `flush` 调用），本 Task 不补，写进 Spec 的已知限制。
- scope 不再保留累积列表：`SashGestureScope.issues`（经 `SASH_GESTURE_SCOPE_KEY`、`useSashScope` 从 `./vue` 入口公开）删掉，`SashGestureOptions` 加 `onIssues(batch)`，`NestedGrid` 用它发事件。今天经 `watch` 在下一个 tick 合成一次，改成同步回调后，一次松手可能发两个事件（`flush` 一批、`finish` 一批），不合并。`finish` 里通知挪到收尾（`active` 清空、`refreshHoverAfterGesture`）之后：宿主的回调抛出时，分隔线的高亮不会留着；异常照常抛出，不吞。

L1 的两个出口：

- `NestedGrid` 的 `issues` 事件：`GridIssue<GridIssueCode | GridCommitFailureCode | "not-published">`。提交被拒发一条，码就是拒绝的码、`params` 原样；`not-published`：宿主接纳但没发布匹配布局（`:541`）。失败码与诊断码不相交，宿主凭码就知道是哪一类。
- `useGridLayout` 的 `onIssues` 选项：`GridIssue<GridIssueCode | "notify-failed">`，带求解诊断与 `notify-failed`（已经落账、通知宿主时抛出，`useGridLayout.ts:110`）。它不经组件的事件（`NestedGrid.md:89` 已写明）；`handler-threw` 是没落账，两者分开。
- 应用的 `WorkbenchSurface.vue` 把两路合进自己的 `issues` 事件，事件类型写两者的并集，`WorkbenchSurface.md` 同改。

### L2：`packages/nb-workbench-layout/src/layout-doc.ts`、`layout-drop.ts`

- `LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | GridFailure<LayoutFailureCode>`：`detail` 改名 `message`、改英文，补 `params`。`LayoutDocValidation`（`:1267`）同批把 `detail` 改名 `message`（`unsupported-version` 带 `{version}`）：同包两个失败结果用一种形状（ADR 0054 决策 4）。`validateNode` 返回的问题文字照旧只进 `message`，不分码。
- `LayoutFailureCode = "not-found" | "limit-exceeded" | "duplicate-id" | "policy-refused" | "invalid-argument" | "not-allowed"`：
  - `not-found` `{id}`；800（编辑组不在）照旧是 `not-found`，`{id, expected: "editor"}`：改成别的码会让命令从 `stale-target` 变成 `unavailable`；
  - `limit-exceeded` `{limit: "nodes" 或 "depth" 或 "floats", max}`（`finish` 的 484，浮动窗数 1115、1149）；L2 自己查规模，不转交 L0 的失败；
  - `duplicate-id` `{id, kind: "tab" 或 "panel" 或 "branch"}`：754、771、893、1073、1119、1090、1148、661。和 L0 同名：都是“id 已被占用”，第 2 稿的 `id-taken` 改回这个名字；
  - `policy-refused` `{by: "accepts" 或 "can-insert"}`：815、844、1030、1067（接受矩阵）、822、852（`canInsert`）；
  - `invalid-argument` `{field}`，一种检查一个 `field`：528 `share`、529 `share-duplicate`、532 `share-siblings`、536 `share-zero`、707 `container-entry`、725 拆成 `entries-empty` 与 `entries-duplicate` 两个条件、727 `active-entry`；
  - `not-allowed` `{rule}`：其余各处，一种规则一个名字，同文的几处同名（例如 817、845 与 757 的“区域的锚不放标签”都是 `anchor-holds-no-tabs`，757 的另一半“分节只有一个标签”是 `single-section-tab`，1029、1066、1091 都是 `anchor-cross-edge`）。
- 返回问题文字的内部函数（`settleLanding` 628 到 688、`splitPanelInPlace`、`refusesMoreTabs`）改成返回码与 `params`，由调用处（747、757、1046、1079、1098）包成失败：归类在产生原因的地方做。最终的“行 → 码、`params`”表实施时写进 Task README，审查对照它。
- **改码不改分支**：应用按码分支的只有三处（`layout-doc-store.ts:227`、`view-commands.ts:91` 与 `:92`、`panel-commands.ts:126`），都只看 `not-found` 与 `limit-exceeded`。今天是 `rejected` 的不会变成这两个码：654（“面板不在树里”）归 `not-allowed`（`rule: "not-in-tree"`）。

### 应用：`packages/neuro-book/src/plugins/workbench`、Lab

- 自己构造失败的地方改成新形状：`shared/editor-panels.ts:70`、`web/state/layout-doc-store.ts` 50、175、176、232、360、511，`web/state/containers.ts` 168、180、200，`web/entry-drop.ts:144`，`layout-drop.ts:393`，Lab 的 `WorkbenchSurfaceFixture.vue:116`。`not-found`、`limit-exceeded` 照旧（360 浮动窗太多补 `{limit: "floats", max}`）；今天写 `rejected` 的按原因归：232 不合骨架 → `not-allowed` `{rule: "skeleton"}`；511 视图不可移动 → `not-allowed` `{rule: "view-not-movable"}`；176、`entry-drop.ts:144` 实施时读原因再归，记进 Task README。
- `layout-doc-store.ts:88` 读 `checked.detail`、`:227` 读 `result.detail` 的改读 `message`。`structureFailure` 只进诊断日志（`plugin.ts:208`），日志文字从中文变英文。
- 应用里没有监听 `WorkbenchSurface` 的 `issues` 事件的地方（`WorkbenchShell.vue` 不监听）：求解诊断在产品里没有消费者，只改类型。
- Lab 夹具：
  - `NestedGridAcceptanceFixture.vue`：`visibleIssues` 的去重（`:86` 到 `:92`，今天按字符串 `includes`）改成按上面的键；显示（`:585` 的 `join`、`:571` 的 `JSON.stringify`）显示 `message`；`droppedRefs`（`:99`、`:256`）改成 `{ref, code}`；读恢复结果的 `res.reason ?? 中文兜底`（`:276`、`:297`）改成读 `code`，去掉中文兜底，把码写进 `data-lab-restore-code`、版本写进 `data-lab-restore-version`；
  - `GridSwapScene.vue`：今天 `issues = list` 整个替换，改成追加；`:70` 的 `join` 显示 `message`。
- e2e：`lab-nested-grid.e2e.ts` 382 的 `toContain("重复节点 id")` 改成断言 `data-lab-restore-code` 是 `duplicate-id`；395 的 `toContain("99")` 改成 `data-lab-restore-code` 是 `unsupported-version`、`data-lab-restore-version` 是 `99`。

### 公开面变更清单

| 类型或接口 | 出口 | 插件 SDK | 变更记录 |
|---|---|---|---|
| `NestedGrid` 的 `onGestureCommit` 返回 | `nb-layout/vue` | 是（组件在 SDK 清单） | 不兼容的改动 |
| `NestedGrid` 的 `issues` 事件元素、只发新增 | `nb-layout/vue` | 是 | 不兼容的改动 |
| `GridGesturePreview.issues`（`gesture-update` 事件载荷） | `nb-layout` | 是（`sdk/components.ts` 导出这个类型） | 不兼容的改动 |
| `GridIssue`、`GridFailure`、`GridParamValue`、`GridIssueCode`、`GridCommitFailureCode` | `nb-layout` | 加进 `sdk/components.ts` 的类型导出：插件给 `@issues`、`onGestureCommit` 写类型要用到这些名字 | 新增 |
| `SashGestureScope.issues` 删、`SashGestureOptions.onIssues` 加、`SashGestureBinding.onCommit` 返回 | `nb-layout/vue`、`nb-layout` | 否 | 不写 |
| `GridResult` 一族、`GridRestoreResult`、`GridLayoutResult.issues`、`SashDragResult.issues`、`allocateAxis`、`allocateSashPanels`（删 `context`） | `nb-layout` | 否 | 不写 |
| `WorkbenchSurface` 的 `issues` 事件 | 应用内组件 | 否 | 不写 |
| `LayoutResult`、`LayoutDocValidation` | `nb-workbench-layout`（不发布） | 否 | 不写 |

- 第 3 片 `build:sdk` 前后比对：表里标“是”的按预期变化、新增的几个类型名出现，别的不变。
- `PLUGIN_API_SINCE`（`src/shared/product.ts`）不在本 Task 改：[`releasing.md`](../../../../../docs/standards/releasing.md) 第 2 步要它改成“这次发布的版本”，而 `product.test.ts` 要求它不晚于 `PRODUCT_VERSION`，现在写不出那个版本（第二轮审查认可）。防遗忘：Work README 加一行“发版前”，写明下次发布按第 2 步提兼容起点，并改掉变更记录“改动”里“这一版接受按 0.12.1 起的版本写的插件”那句；交付汇报同样写明。

### 测试迁移规则

- 按中文文案断言的改成断言 `code` 加 `params`。原来靠两句不同文案区分的失败，新断言靠 `params` 里的值（`id`、`expected`、`field`、`side`、`cause`、`rule`、`with`）仍能区分；上面几张表按这条定了每处的取值，断言只写 `code` 的不算迁完。
- 不断言 `message` 的文字。
- `throw new Error(result.reason)`、`throw new Error(result.detail)` 一律改读 `message`。第 1 片：`nb-workbench-layout` 的 `layout-project.test.ts` 313、420 读 `reason`。第 3 片读 `detail` 的约 36 处：`layout-doc.test.ts`（含约 40 条 `toMatchObject({ok: false, code: "rejected"})`，改新码并断言 `rule` 或 `field`）、`layout-present.test.ts`、`layout-doc-store.test.ts`（含 `:78` 读 `LayoutDocValidation.detail`）、`layout-project.test.ts`、`adjacency.test.ts`、`layout-drop.test.ts`、`layout-constraints.test.ts`、`default-tree.test.ts`、`containers.test.ts`。
- `useGridLayout.dom.test.ts:208` 断言 `harness.issues` 里没有“没有发布匹配布局”：那句只由 `NestedGrid` 发、从不进 `onIssues`，今天就是空断言。改成真的检查：在 `NestedGrid` 上用一个不发布匹配布局的宿主触发 `not-published`，断言事件里有它；先变异（去掉 `:541` 的发出）确认会红。
- 行为变化补用例：
  - 窄窗口逐像素重算（用 `unabsorbed-space` 与 `over-constrained` 各一组，`rest`、`ids` 每次都变），持续的诊断只通知一次；变回不窄再变窄，再通知一次；
  - 一批里同键的几条合成一条，`ids` 按顺序列全；
  - 同一场拖动里同一诊断只通知一次；
  - 没接 `onGestureCommit` 时一次只发一条 `handler-missing`；
  - 宿主的 `onIssues` 抛出时，分隔线高亮照常清掉；
  - 失败码与诊断码不相交的类型级测试。

## Spec 与文档改动

在 master 上、设计审查处理完之后、写代码之前：

- `ui/nested-grid`：
  - 失败与恢复追加失败 5（结构操作的失败形状与 L0 码表、各码 `params`）、失败 6（`onGestureCommit` 的返回合同与提交的码）、失败 7（快照恢复的码、`unresolved-root` 与 `dropped` 的码），标“（planned）”；“失败 1 到 4”改成“1 到 7”；失败 1 说“必须给诊断、不抛”，失败 5 说形状，写明两者的关系；
  - 输出追加 139（诊断的形状、两个出口、失败码与诊断码不相交）与 140（通知时只发新增：键、同键合成、三种作用域、空布局与换工作面清空、事件型不去重、一个失败一条；结果与 `gesture-update` 载荷是快照），标“（planned）”；输出 68 的“经 `issues` 交回原因”链接到 139；
  - 边界与兼容：码集合开放、新增码不算破坏、调用方要有默认分支，码的写法对齐 `ui/i18n` 输出 13 的开放错误域；已知限制加“键盘调整分隔线时不发诊断”。
- `ui/workbench-layout`：失败与恢复的码表加 `duplicate-id`、`policy-refused`、`invalid-argument`、`not-allowed` 四行（planned），`rejected` 一行注明实现后拆成这四个；表头“返回 `{ok: false, code}`”改成新形状；“不合骨架的结果在提交前被拒绝（`rejected`）”改成 `not-allowed`（planned）。
- `packages/neuro-book/CHANGELOG.md`：“不兼容的改动”写公开面变更清单里 SDK 为“是”的三项；“新增”写 SDK 新导出的几个类型。
- 包文档：nb-layout 的 `NestedGrid.md`（`issues`、`onGestureCommit`、`:89` 的 `notify-failed`）、`Splitter.md`（若写到 `issues`）、`src/grid.md`；nb-workbench-layout 的 README（“操作都是纯函数：失败返回问题码”一句写新形状）；应用的 `WorkbenchSurface.md`。
- Work README：“发版前”一行（见公开面变更清单）。
- 实现之后：两份 Spec 的 planned 条目去掉标记、实现合同与证据补路径。

## 切片

1. **失败的形状（L0 与 L1 提交）**：`GridIssue`、`GridFailure`、`GridParamValue` 与内部构造函数；`grid.ts` 34 处、快照恢复（含 `unresolved-root`）、`serializeTree` 的文字；L1 的提交码（含 `handler-missing`、`handler-threw`）。诊断管线这一片不动：`useSashGesture.ts:291` 拼的那句诊断文字改读 `message`，第 2 片换成诊断对象。同片改：`layout-project.test.ts` 313、420，Lab 夹具读恢复结果与 `droppedRefs` 的几处，`lab-nested-grid.e2e.ts` 382、395。验证：nb-layout、nb-workbench-layout、应用的 `typecheck`；nb-layout 与 nb-workbench-layout 的 `test`。
2. **诊断（L0 与 L1）**：诊断码与表、`allocateSashPanels` 的范围参数、`swap-skipped` 与 `MotionDecision`、只发新增与同键合成、两个出口的类型、`handler-missing` 只发一条、`finish` 里通知挪到收尾之后、`useGridLayout.dom.test.ts:208`；Lab 两个夹具的去重与显示；`WorkbenchSurface` 的事件类型与 `.md`。验证：同第 1 片。
3. **L2 与应用**：`LayoutResult`、`LayoutDocValidation`、归类、`layout-drop.ts`；应用的构造方与读 `detail` 的地方、约 36 处测试；SDK 的类型导出；变更记录；包文档；Work README 的“发版前”。验证：同第 1 片，加 `bun run test:affected`、`sdk.test`、`build:sdk` 前后比对（见公开面变更清单）、`docs:check`。
4. **收口**：并 master、e2e、实现审查、合入，master 上 Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 失败 5（planned） | `grid.test.ts` 逐码用例：可达的每处一条，断言 `code` 与 `params`（617、632 不可达，不写） |
| nested-grid 失败 6（planned） | `useGridLayout.dom.test.ts`：五种拒绝、转交 L0 失败；`splitter.dom.test.ts` 与 `NestedGrid.dom.test.ts`：处理器抛出、没接回调 |
| nested-grid 失败 7（planned） | 快照恢复的测试：各码、`unresolved-root` 带 `dropped`；e2e `lab-nested-grid` 的两条恢复用例读 `data-lab-restore-code` |
| nested-grid 失败 1 到 4 | 原有测试改成码后仍过 |
| nested-grid 输出 139（planned） | 失败码与诊断码不相交的类型级测试；`NestedGrid.dom.test.ts`：提交被拒的诊断码与拒绝的码相同，`not-published` 真的发出（改写后的 `useGridLayout.dom.test.ts:208` 一带） |
| nested-grid 输出 140（planned） | dom 测试：窄窗口逐像素重算只通知一次、消失再出现再通知；同键合成、`ids` 列全；同一场拖动只通知一次；没接回调只发一条；`onIssues` 抛出时高亮照常清掉 |
| nested-grid 输出 68 | `NestedGrid.dom.test.ts`（今天 1234 到 1238 一带）与 `useGridMotion.dom.test.ts`（189 一带）：跳过时的诊断是 `swap-skipped` 与 `cause` |
| workbench-layout 失败与恢复码表 | `layout-doc.test.ts` 按 `code` 与 `rule`、`field`；`view-commands`、`panel-commands`、`layout-doc-store` 的测试：`not-found`、`limit-exceeded` 的分支照旧 |

## 验证

- 每片三个包的 `typecheck`、两个包的 `test`；第 3 片之后 `test:affected`。
- e2e：`lab-nested-grid`、`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-views`、`workbench-dnd`、`workbench-shell`，7 个文件。开跑前看负载，按每个文件开跑时的负载判断失败；Lab 就绪等待的失败在负载 15 以下单独重跑、和 master 对照。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行，不测）。

## 不做与风险

- 不做：开发模式下的配置错误报告（提案“拖不动时报错”，归 t36）；`collapsePolicyProblem` 的返回形状（归 t36 定入口时一起定）；`validateNode` 的问题文字分码；键盘手势的诊断（已知限制）；界面文字改英文（第二档）；`PLUGIN_API_SINCE`（发布时改）；`SplitterGestureCancelReason`（`cancel`、`onCancel`、`session.reason`）：它是取消原因的枚举，不是失败文字，迁移时按名字排除，不改名不改值；nb-ui 里冻结的 Splitter 副本（t14 迁移前只修不加）。
- 风险：
  - 码一合并，测试可能在错的分支上照样通过：表里每处的 `params` 已定、构造时按映射类型检查，审查时抽查原来靠文案区分的几组（`over-constrained` 的几个 `cause`、`duplicate-id` 的 `with`、L2 的 `field`）。
  - 只发新增后，靠整个列表替换的消费方会只剩最新一批：两个 Lab 夹具在第 2 片改；实施时再按 `@issues`、`onIssues`、`.issues` 搜一遍 `packages/`。
  - 应用诊断日志里的文字变英文：只进日志。
