# t34 统一失败形状与错误码：实施计划（第 2 稿）

第 2 稿按第一轮设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，15 条）改，逐条处理见 Task README。

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项（“错误与诊断一种形状”）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout（L0、L1）与 nb-workbench-layout（L2）的失败都改成 `{ok: false, code, message, params?}`，诊断（`issues`）改成 `{code, message, params?}[]` 且只发新增。今天三层各写各的：L0 是中文 `reason`，L1 的提交回调同样是 `reason`，L2 已经有 `code` 但几乎都是 `rejected`、另带中文 `detail`。

开发者已确认的（t31，2026-11-18 会话）：nb-layout 做成通用库，第一档现在做、第二档等 nb-story 改造时做；“都按推荐”。本 Task 不改布局行为，只改失败与诊断的形状、码与文字；唯一的行为变化是诊断的发法（“只发新增”与“一次求解合成一条”），两条都是提案写明的。

依据的 Spec：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)（失败 1 到 4、输出 68、“状态与转换”里的提交规则）、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（失败与恢复的码表）、[`ui/i18n`](../../../../../docs/specs/ui/i18n.md) 输出 13 的“开放错误域”。[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 写的是“无失败码”，不受影响。

工作方式：autonomous-delivery。代码在 t33 合入 master 之后从 master 开 worktree `w00026-t34-unified-errors`、分支 `refactor/w00026-t34-unified-errors`；Spec 与 Task 记录在 master 上改。

### 和提案不同的一处（待开发者追认）

提案“错误与诊断”写：`stale-context`、`stale-revision`、`handler-missing`、`handler-threw` “在代码与 Spec 里没有对应的失败，不预设”。代码里都有：`useGridLayout.onGestureCommit` 的五种拒绝（`vue/useGridLayout.ts:84` 到 `:98`）、`useSashGesture` 的处理器抛出（`:287`）、`NestedGrid.vue` 的没接回调（`:525`）与接纳后没发布（`:541`）。`onGestureCommit` 的返回类型改成码在本 Task 范围内，所以本 Task 定码：提交的返回类型里是 `not-ready`、`stale-context`、`stale-revision`、`stale-size`、`handler-missing`、`handler-threw`；`not-published` 与 `notify-failed` 只是诊断，不在提交的返回类型里。提案末尾已追加决策记录，记入待确认清单。

## 技术选型

无通用问题：错误形状是本仓库自己的合同，不引库。

## 关键设计

### 共同形状：`packages/nb-layout/src/grid-types.ts`

```ts
/** 失败与诊断共用的值：只用字符串、数字与字符串数组；非有限数写成字符串（`"NaN"`、`"Infinity"`），序列化进日志不丢。 */
export type GridParamValue = string | number | readonly string[];

/** 诊断。`code` 给程序分支；`message` 是库内的英文，只给日志看；`params` 给宿主拼自己的界面文字。码集合开放（见下）。 */
export interface GridIssue<C extends string = GridIssueCode> {
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, GridParamValue>>;
}

/** 失败：诊断加 `ok: false`。 */
export type GridFailure<C extends string = GridFailureCode> = GridIssue<C> & {readonly ok: false};
```

- 名字带 `Grid` 前缀，与 nb-layout 其余导出一致；L2 是 nb-layout 的使用方，直接用这两个泛型，不另写形状。
- `GridResult`、`GridResizeResult`、`GridBranchResizeResult`、`GridBranchesResizeResult` 的失败一支都换成 `GridFailure`。
- `GridRestoreResult` 改成判别联合：`{ok: true; dropped; clamped} | (GridFailure<GridRestoreFailureCode> & {dropped; clamped})`。
- 码按层各是一个字面量联合（提案“码按层定义”）。不按操作再收窄：码集合开放，调用方本来就要有默认分支；每个操作一个联合，类型数翻几倍，读者要记的更多。
- **码集合开放**：新增码不算破坏，只在变更记录写一行；库不保证穷尽，调用方写 `switch` 要有 `default`，用 `assertNever` 的写法会在新增码时编译失败，那是调用方的选择。码的写法对齐 `ui/i18n` 输出 13 的“开放错误域”：小写短横线，不含 `:`、`.`、空白，不超过 64 个字符，宿主可以直接拿码查自己目录里的 `errors.<码>`。不用 `string & {}` 去“开放”类型：那样丢掉补全与收窄。
- `message` 用英文：提案“错误与诊断”写明 `message` 是库内的英文；第二档的“默认英文文案”指界面文字目录（提案“去掉 nb-ui 依赖”一节），不是这里。不断言 `message` 的文字。

### L0 结构操作：`packages/nb-layout/src/grid.ts`

`GridFailureCode = "not-found" | "wrong-node-kind" | "wrong-axis" | "not-finite" | "invalid-argument" | "limit-exceeded" | "duplicate-id" | "into-own-subtree" | "not-conserved" | "stale-baseline" | "not-collapsible"`。34 处逐处（行号按 t33 之后的 `grid.ts`）：

| 行 | 码 | `params` |
|---|---|---|
| 192、195 | `limit-exceeded` | `{limit: "nodes" 或 "depth", max, actual}` |
| 226、401、452、472、497、554、581、591 | `not-found` | `{id}`（401、452 是分支 id，472、591 是父节点 id） |
| 229 | `invalid-argument` | `{field: "root", id}`：根节点没有可调整的父分支 |
| 232、264 | `wrong-axis` | `{id, orientation}`（父分支或该分支的方向） |
| 235 | `not-finite` | `{field: "delta", value}` |
| 272 | `invalid-argument` | `{field: "sizes-cover", id: 分支}` |
| 280 | 先判非有限：`not-finite` `{field: "size", id: 子节点}`；再判负数：`invalid-argument` `{field: "size-negative", id: 子节点}` |
| 286 | `not-conserved` | `{id: 分支, target, baseline}` |
| 292 | `stale-baseline` | `{id: 分支}` |
| 298 | 子节点不在：`not-found` `{id}`；不可收起：`not-collapsible` `{id, branch}` |
| 348 | `not-finite` | `{field: "intent", id: 分支}` |
| 475、594 | `wrong-node-kind` | `{id: 父节点, expected: "branch"}` |
| 478、513 | `duplicate-id` | `{id, with: "existing"}` |
| 509 | `duplicate-id` | `{id, with: "new-leaf"}` |
| 500、557、584 | `wrong-node-kind` | `{id, expected: "leaf"}` |
| 503 | `invalid-argument` | `{field: "orientation", value}` |
| 506 | `invalid-argument` | `{field: "side", value}` |
| 518 | 先判非有限：`not-finite` `{field: "ratio", value}`；再判越界：`invalid-argument` `{field: "ratio-range", value}` |
| 587 | `into-own-subtree` | `{id, parent}` |
| 617、632 | `not-found` | `{id: 父节点}` |

- 280、298、518 今天一个条件管两种情况，拆成先后两个条件，只改码，失败与否不变。
- 617、632（`moveLeaf` 里“目标父节点已不存在”）不可达：589 已经找到父节点，同分支的移动走另一条路，克隆树里塌陷的只有来源（审查用 5000 棵随机树、每棵 14 步的实验一次没命中）。行为不改，留作防御分支、归 `not-found`，不写用例，注释写明为什么不可达。
- `value` 是调用方传进来的数，非有限时写成字符串。

### L0 快照恢复：`packages/nb-layout/src/grid-snapshot.ts`

- `GridRestoreFailureCode = "invalid-snapshot" | "unsupported-version" | "duplicate-id" | "limit-exceeded"`：
  - `invalid-snapshot` `{field, id?}`，`field` 是 `envelope`、`node`、`id`、`ref`、`size`、`orientation`、`children`、`kind`（86、111、116、131、136、164、168、173、200）；
  - `unsupported-version` `{version}`（90、93）；`duplicate-id` `{id}`（120）；
  - `limit-exceeded` `{limit: "nodes" 或 "depth", max}`（107、126、177）：恢复为了不遍历巨型数组会提前返回，不给 `actual`。
- `dropped` 的元素从 `{ref, reason}` 改成 `{ref, code: "unknown-ref"}`：今天只有一种原因。
- nested-grid 失败 4 要求“部分引用过滤与整体格式非法分别报告”：前者在 `dropped`，后者是失败码，分开不变。

### L1 提交：`sash-gesture.ts`、`vue/useGridLayout.ts`、`vue/useSashGesture.ts`、`vue/NestedGrid.vue`、`vue/splitter-session.ts`

- `GridCommitFailureCode = GridFailureCode | "not-ready" | "stale-context" | "stale-revision" | "stale-size" | "handler-missing" | "handler-threw"`；`GridLayoutCommitResult = {ok: true} | GridFailure<GridCommitFailureCode>`。`SashGestureBinding.onCommit`（`sash-gesture.ts:62`）与 `NestedGrid` 的 `onGestureCommit` prop 返回它：
  - `not-ready` `{missing: "grid" 或 "host-size"}`（`useGridLayout.ts` 84、89）；
  - `stale-context` `{expected, actual}`（92）；`stale-revision` `{expected, actual}`（95）；`stale-size`（98）；
  - 102 原样转交 L0 的失败；
  - `handler-missing`（`NestedGrid.vue:526` 返回它，`:525` 的直接 `emit` 删掉，诊断只由 `useSashGesture` 一处发）；
  - `handler-threw`（`useSashGesture.ts:287`），`message` 带异常文字。

### L0、L1 诊断

`GridIssueCode`（L0）：

| 码 | `params` | 位置 |
|---|---|---|
| `over-constrained` | `{cause, ids, axis?}`，`cause` 是 `min-total`（`grid-geometry.ts` 149）、`fixed-overflow`（185）、`leaf-min`（486）、`sash-overflow`（502）、`cross-min`（507）、`range-overflow`（`sash-drag.ts` 247） | |
| `conflicting-bounds` | `{id, axis, min, max}` | `grid-geometry.ts` 361 |
| `unabsorbed-space` | `{cause: "no-share"（195）或 "branch"（533）, ids, rest}` | |
| `not-collapsible` | `{id}` | `sash-drag.ts` 178 |
| `no-room-to-collapse` | `{id}` | `sash-drag.ts` 311 |
| `no-room-to-restore` | `{id, available}` | `sash-drag.ts` 194、316 |
| `swap-skipped` | `{cause: "no-leaving" 或 "no-entering" 或 "busy", ids}` | `grid-swap.ts` 132、133、135 |

- **一次求解里同码同 `cause` 合成一条**（提案体验 10）：窄窗口压到最小值以下时，今天每个节点、每个分支各推一条。改成一次 `layout()` 里同 `code`、同 `cause` 的合成一条，`ids` 按求解时第一次出现的先后列出（遍历顺序固定，可测）。实现：求解时照旧往内部数组推 `GridIssue`，`layout()` 返回前按 `code` 加 `cause` 合并。
- `allocateSashPanels(…, issues?, context = "分隔面板")` 的中文 `context` 参数删掉：它只给文字加前缀；涉及的面板 id 进 `ids`。`allocateAxis` 的 `issues` 参数类型改成 `GridIssue[]`。
- `grid-swap.ts` 的 `{kind: "skip", reason}` 改成 `{kind: "skip", issue}`；`useGridMotion` 的 `onSwapSkipped` 收 `GridIssue`。
- 类型改成 `readonly GridIssue[]` 的：`GridLayoutResult.issues`、`GridGesturePreview.issues`（`grid-gesture.ts:59`）、`SashDragResult.issues`（`sash-drag.ts:55`）、`SashGestureSessionCore.issues`（`sash-gesture.ts:44`）、`splitter-session.ts` 的 `issues`。

L1 的两个出口：

- `NestedGrid` 的 `issues` 事件：`GridIssue<GridIssueCode | GridCommitFailureCode | "not-published">`。提交被拒发一条，码就是拒绝的码、`params` 原样；`not-published`：宿主接纳但没发布匹配布局（`:541`）。
- `useGridLayout` 的 `onIssues` 选项：`GridIssue<GridIssueCode | "notify-failed">`，带求解诊断与 `notify-failed`（已经落账、通知宿主时抛出，`useGridLayout.ts:110`）。它不经组件的事件（`NestedGrid.md:89` 已写明）；`handler-threw` 是没落账，两者分开。
- 应用的 `WorkbenchSurface.vue` 把两路合进自己的 `issues` 事件，事件类型写两者的并集，`WorkbenchSurface.md` 同改。

**只发新增**的判据（写进 nested-grid 输出 139）：

- 诊断的键是 `code` 加按键名排序后的 `params`。
- 手势里的求解诊断（`useSashGesture` 的 `flush` 每帧推 `session.issues`）：一场手势里同一个键只发一次，手势结束清空。
- 布局重算的诊断（`useGridLayout` 每次重算推 `next.issues`）：和上一次重算的键集比，只发上一次没有的；条件消失再出现会再发一次。
- 事件型的诊断（提交被拒、`not-published`、`notify-failed`、`swap-skipped`）：每发生一次发一条，不去重。
- 一个失败只发一条：没接 `onGestureCommit` 今天发两条（`NestedGrid.vue:525` 直接发一条，`useSashGesture.ts:291` 又发一条），改成只由后者发。
- scope 不再保留累积列表：`SashGestureScope.issues`（经 `SASH_GESTURE_SCOPE_KEY`、`useSashScope` 从 `./vue` 入口公开）删掉，`SashGestureOptions` 加 `onIssues(batch)`，`NestedGrid` 用它发事件。

### L2：`packages/nb-workbench-layout/src/layout-doc.ts`、`layout-drop.ts`

- `LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | GridFailure<LayoutFailureCode>`：`detail` 改名 `message`、改英文，补 `params`。`LayoutDocValidation`（`:1267`）同批把 `detail` 改名 `message`（`unsupported-version` 带 `{version}`）：同包两个失败结果用一种形状（ADR 0054 决策 4）。`validateNode` 返回的问题文字照旧只进 `message`，不分码。
- `LayoutFailureCode = "not-found" | "limit-exceeded" | "id-taken" | "policy-refused" | "invalid-argument" | "not-allowed"`：
  - `not-found` `{id}`；800（编辑组不在）照旧是 `not-found`，`{id, expected: "editor"}`：改成别的码会让命令从 `stale-target` 变成 `unavailable`；
  - `limit-exceeded` `{limit: "nodes" 或 "depth" 或 "floats", max}`（`finish` 的 484，浮动窗数 1115、1149）；L2 自己查规模，不转交 L0 的失败；
  - `policy-refused` `{by: "accepts" 或 "can-insert"}`：815、844、1030、1067（接受矩阵）、822、852（`canInsert`）；
  - `id-taken` `{id, kind: "tab" 或 "panel" 或 "branch"}`：754、771、893、1073、1119、1090、1148、661；
  - `invalid-argument` `{field}`，一种检查一个 `field`：528 `share`、529 `share-duplicate`、532 `share-siblings`、536 `share-zero`、707 `container-entry`、725 拆成 `entries-empty` 与 `entries-duplicate` 两个条件、727 `active-entry`；
  - `not-allowed` `{rule}`：其余各处，一种规则一个名字，同文的几处同名（例如 817、845 与 757 的“区域的锚不放标签”都是 `anchor-holds-no-tabs`，757 的另一半“分节只有一个标签”是 `single-section-tab`，1029、1066、1091 都是 `anchor-cross-edge`）。
- 返回问题文字的内部函数（`settleLanding` 628 到 688、`splitPanelInPlace`、`refusesMoreTabs`）改成返回码与 `params`，由调用处（747、757、1046、1079、1098）包成失败：归类在产生原因的地方做。最终的“行 → 码、`params`”表实施时写进 Task README，审查对照它。
- **改码不改分支**：应用按码分支的只有三处（`layout-doc-store.ts:227`、`view-commands.ts:91` 与 `:92`、`panel-commands.ts:126`），都只看 `not-found` 与 `limit-exceeded`。今天是 `rejected` 的不会变成这两个码：654（“面板不在树里”）归 `not-allowed`（`rule: "not-in-tree"`）。

### 应用：`packages/neuro-book/src/plugins/workbench`、Lab

- 自己构造失败的地方改成新形状：`shared/editor-panels.ts:70`、`web/state/layout-doc-store.ts` 50、175、176、232、360、511，`web/state/containers.ts` 168、180、200，`web/entry-drop.ts:144`，Lab 的 `WorkbenchSurfaceFixture.vue:116`。`not-found`、`limit-exceeded` 照旧（360 浮动窗太多补 `{limit: "floats", max}`）；今天写 `rejected` 的按原因归：232 不合骨架 → `not-allowed` `{rule: "skeleton"}`；511 视图不可移动 → `not-allowed` `{rule: "view-not-movable"}`；176、`entry-drop.ts:144` 实施时读原因再归，记进 Task README。
- `layout-doc-store.ts:88` 读 `checked.detail`、`:227` 读 `result.detail` 的改读 `message`。`structureFailure` 只进诊断日志（`plugin.ts:208`），日志文字从中文变英文。
- 应用里没有监听 `WorkbenchSurface` 的 `issues` 事件的地方：`WorkbenchShell.vue` 不监听，求解诊断在产品里没有消费者，只改类型。
- Lab 夹具：
  - `NestedGridAcceptanceFixture.vue`：`visibleIssues` 的去重（`:86` 到 `:92`，今天按字符串 `includes`）改成按“只发新增”的键；显示（`:585` 的 `join`、`:571` 的 `JSON.stringify`）显示 `message`；读恢复结果的 `res.reason ?? 中文兜底`（`:276`、`:297`）改成读 `code`，把码写进 `data-lab-restore-code`；
  - `GridSwapScene.vue`：今天 `issues = list` 整个替换，改成追加；`:70` 的 `join` 显示 `message`。
- e2e：`lab-nested-grid.e2e.ts:382` 的 `toContain("重复节点 id")` 改成断言 `data-lab-restore-code` 是 `duplicate-id`。

### 公开面变更清单

| 类型或接口 | 出口 | 插件 SDK | 变更记录 |
|---|---|---|---|
| `NestedGrid` 的 `onGestureCommit` 返回 | `nb-layout/vue` | 组件在 SDK 清单 | 不兼容的改动 |
| `NestedGrid` 的 `issues` 事件元素、只发新增 | `nb-layout/vue` | 是 | 不兼容的改动 |
| `GridGesturePreview.issues`（`gesture-update` 事件载荷） | `nb-layout` | 类型由 SDK 导出（`sdk/components.ts`） | 不兼容的改动 |
| `SashGestureScope.issues` 删、`SashGestureOptions.onIssues` 加、`SashGestureBinding.onCommit` 返回 | `nb-layout/vue`、`nb-layout` | 实施时按 `sdk/components.ts` 与 `plugin-sdk/pack.ts` 核对 | SDK 导出的才写 |
| `GridResult` 一族、`GridRestoreResult`、`GridLayoutResult.issues`、`SashDragResult.issues`、`allocateAxis`、`allocateSashPanels`（删 `context`） | `nb-layout` | 同上 | 同上 |
| `WorkbenchSurface` 的 `issues` 事件 | 应用内组件 | 否 | 不写 |
| `LayoutResult`、`LayoutDocValidation` | `nb-workbench-layout`（不发布） | 否 | 不写 |

- 第 3 片 `build:sdk` 前后比对：表里标了 SDK 的类型都按预期变化，别的不变。
- `PLUGIN_API_SINCE`（`src/shared/product.ts`）不在本 Task 改：[`releasing.md`](../../../../../docs/standards/releasing.md) 第 2 步要它改成“这次发布的版本”，版本号发布时才定。本 Task 写“不兼容的改动”一条，Task README 与交付汇报写明下次发布要做这一步。

### 测试迁移规则

- 按中文文案断言的改成断言 `code` 加 `params`。原来靠两句不同文案区分的失败，新断言靠 `params` 里的值（`id`、`expected`、`field`、`cause`、`rule`、`with`）仍能区分；上面几张表按这条定了每处的取值，断言只写 `code` 的不算迁完。
- 不断言 `message` 的文字。
- L2 的 `layout-doc.test.ts` 约 40 条 `toMatchObject({ok: false, code: "rejected"})` 改成新码，测某条规则的用例同时断言 `rule` 或 `field`。
- 行为变化补用例：窄到最小值以下一次布局，同一 `cause` 只有一条 `over-constrained`、`ids` 列全；同一场拖动里同一诊断只发一次；窄窗口连续重算，持续的诊断只发一次、消失再出现再发；没接 `onGestureCommit` 时一次只发一条 `handler-missing`。

## Spec 与文档改动

在 master 上、设计审查处理完之后、写代码之前：

- `ui/nested-grid`：
  - 失败与恢复追加失败 5（结构操作的失败形状与 L0 码表、各码 `params`）、失败 6（`onGestureCommit` 的返回合同与提交的码）、失败 7（快照恢复的码与 `dropped` 的码），标“（planned）”；229 行“失败 1 到 4”改成“1 到 7”；失败 1 说的是“必须给诊断、不抛”，失败 5 说形状，写明两者的关系；
  - 输出追加 139（诊断的形状与两个出口、只发新增的判据、一个失败只发一条）与 140（一次求解里同码同 `cause` 合成一条），标“（planned）”；输出 68 的“经 `issues` 交回原因”链接到 139；
  - 边界与兼容：码集合开放、新增码不算破坏、调用方要有默认分支，码的写法对齐 `ui/i18n` 输出 13 的开放错误域。
- `ui/workbench-layout`：失败与恢复的码表加 `id-taken`、`policy-refused`、`invalid-argument`、`not-allowed` 四行（planned），`rejected` 一行注明实现后拆成这四个；表头“返回 `{ok: false, code}`”改成新形状；291 行“不合骨架的结果在提交前被拒绝（`rejected`）”改成 `not-allowed`（planned）。
- `packages/neuro-book/CHANGELOG.md` 的“不兼容的改动”：公开面变更清单里标了 SDK 的几项。
- 包文档：nb-layout 的 `NestedGrid.md`（`issues`、`onGestureCommit`、`:89` 的 `notify-failed`）、`Splitter.md`（若写到 `issues`）、`src/grid.md`；nb-workbench-layout 的 README（“操作都是纯函数：失败返回问题码”一句写新形状）；应用的 `WorkbenchSurface.md`。
- 实现之后：两份 Spec 的 planned 条目去掉标记、实现合同与证据补路径。

## 切片

1. **失败的形状（L0 与 L1 提交）**：`GridFailure`、`GridParamValue`；`grid.ts` 34 处、快照恢复；L1 的提交码（含 `handler-missing`、`handler-threw`）。诊断管线这一片不动：`useSashGesture.ts:291` 拼的那句诊断文字改读 `message`，第 2 片换成诊断对象。Lab 夹具读恢复结果的两处与 `lab-nested-grid.e2e.ts:382` 同片改。验证：nb-layout `typecheck`、`test`。
2. **诊断（L0 与 L1）**：`GridIssue` 与各码、合成一条、只发新增、两个出口的类型、`handler-missing` 只发一条、`swap-skipped`、`allocateSashPanels` 删 `context`；Lab 两个夹具的去重与显示；`WorkbenchSurface` 的事件类型与 `.md`。验证：nb-layout `typecheck`、`test`；`bun run --cwd packages/neuro-book typecheck`。
3. **L2 与应用**：`LayoutResult`、`LayoutDocValidation`、归类、`layout-drop.ts`；应用的构造方与读 `detail` 的地方；变更记录；包文档。验证：nb-workbench-layout `typecheck`、`test`；应用 `typecheck`；`bun run test:affected`；`sdk.test`；`build:sdk` 前后比对（见公开面变更清单）；`docs:check`。
4. **收口**：并 master、e2e、实现审查、合入，master 上 Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 失败 5（planned） | `grid.test.ts` 逐码用例：可达的每处一条，断言 `code` 与 `params`（617、632 不可达，不写） |
| nested-grid 失败 6（planned） | `useGridLayout.dom.test.ts`：五种拒绝、转交 L0 失败；`splitter.dom.test.ts` 与 `NestedGrid.dom.test.ts`：处理器抛出、没接回调 |
| nested-grid 失败 7（planned） | 快照恢复的测试：各码与 `dropped`；e2e `lab-nested-grid` 的恢复用例读 `data-lab-restore-code` |
| nested-grid 失败 1 到 4 | 原有测试改成码后仍过 |
| nested-grid 输出 139（planned） | dom 测试：同一场拖动同一诊断只发一次；连续重算持续的诊断只发一次；没接回调只发一条；连续两次被拒，第二次事件只带第二条 |
| nested-grid 输出 140（planned） | `grid.test.ts` 或 `grid-geometry` 的测试：窄到最小值以下一次布局同一 `cause` 一条、`ids` 按顺序列全 |
| nested-grid 输出 68 | `NestedGrid.dom.test.ts`（今天 1234 到 1238 一带）与 `useGridMotion.dom.test.ts`（189 一带）：跳过时的诊断是 `swap-skipped` 与 `cause` |
| workbench-layout 失败与恢复码表 | `layout-doc.test.ts` 按 `code` 与 `rule`、`field`；`view-commands`、`panel-commands`、`layout-doc-store` 的测试：`not-found`、`limit-exceeded` 的分支照旧 |

## 验证

- 每片的包级 `typecheck` 与 `test`；第 2 片起加应用 `typecheck`；第 3 片之后 `test:affected`。
- e2e：`lab-nested-grid`、`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-views`、`workbench-dnd`、`workbench-shell`，7 个文件。开跑前看负载，按每个文件开跑时的负载判断失败；Lab 就绪等待的失败在负载 15 以下单独重跑。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行，不测）。

## 不做与风险

- 不做：开发模式下的配置错误报告（提案“拖不动时报错”，归 t36）；`validateNode` 的问题文字分码；界面文字改英文（第二档）；`PLUGIN_API_SINCE`（发布时改）；`SplitterGestureCancelReason`（`cancel`、`onCancel`、`session.reason`）：它是取消原因的枚举，不是失败文字，迁移时按名字排除，不改名不改值；nb-ui 里冻结的 Splitter 副本（t14 迁移前只修不加）。
- 风险：
  - 码一合并，测试可能在错的分支上照样通过：表里每处的 `params` 已定，审查时抽查原来靠文案区分的几组（`over-constrained` 的几个 `cause`、`duplicate-id` 的 `with`、L2 的 `field`）。
  - 只发新增后，靠整个列表替换的消费方会只剩最新一批：两个 Lab 夹具在第 2 片改；实施时再按 `@issues`、`onIssues`、`.issues` 搜一遍 `packages/`。
  - 应用诊断日志里的文字变英文：只进日志。
