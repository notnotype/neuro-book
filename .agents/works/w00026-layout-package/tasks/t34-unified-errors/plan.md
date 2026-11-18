# t34 统一失败形状与错误码：实施计划（第 1 稿）

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项（“错误与诊断一种形状”）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)：nb-layout（L0、L1）与 nb-workbench-layout（L2）的失败都改成 `{ok: false, code, message, params?}`，诊断（`issues`）改成 `{code, message, params?}[]` 且只发新增。今天三层各写各的：L0 是中文 `reason`，L1 的提交回调同样是 `reason`，L2 已经有 `code` 但几乎都是 `rejected`、另带中文 `detail`。

开发者已确认的（t31，2026-11-18 会话）：nb-layout 做成通用库，第一档现在做、第二档等 nb-story 改造时做；“都按推荐”。本 Task 不改布局行为，只改失败与诊断的形状、码与文字。

依据的 Spec：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)（失败 1 到 4、输出 68、状态与转换里的提交规则）、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（失败与恢复的码表）。[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 写的是“无失败码”，不受影响。

工作方式：autonomous-delivery。代码在 t33 合入 master 之后从 master 开 worktree `w00026-t34-unified-errors`、分支 `refactor/w00026-t34-unified-errors`；Spec 与 Task 记录在 master 上改。

### 和提案不同的一处（待开发者追认）

提案“错误与诊断”写：`stale-context`、`stale-revision`、`handler-missing`、`handler-threw` “在代码与 Spec 里没有对应的失败，不预设”。读代码发现它们都在：`useGridLayout.onGestureCommit` 有“网格尚未就绪”“承载盒尺寸不可用”“工作面已切换”“布局已变化（版本）”“容器尺寸已变化”五种拒绝（`vue/useGridLayout.ts:84` 到 `:98`），`useSashGesture` 有“提交处理器抛出异常”（`:287`），`NestedGrid.vue` 有“宿主没有提供 onGestureCommit”（`:525`）与“宿主接纳了但没有发布匹配布局”（`:541`）；nested-grid 的“状态与转换”也写了缺 grid 或容器尺寸时不接受提交。`onGestureCommit` 的返回类型改成码在本 Task 范围内，这些失败必须有码，所以本 Task 给它们定码（见“关键设计”的 L1 一节）。按规则在提案末尾追加决策记录、正文不动，并记入待确认清单。

## 技术选型

无通用问题：错误形状是本仓库自己的合同，不引库。

## 关键设计

### 共同形状：`packages/nb-layout/src/grid-types.ts`

```ts
/** 失败。`code` 给程序分支；`message` 是库内的英文，只给日志看；`params` 给宿主拼自己的界面文字。码集合开放：调用方要有默认分支。 */
export interface GridFailure<C extends string = GridFailureCode> {
    readonly ok: false;
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, string | number>>;
}

/** 诊断：同样的三样，没有 `ok`。 */
export interface GridIssue<C extends string = GridIssueCode> {
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, string | number>>;
}
```

- `GridResult`、`GridResizeResult`、`GridBranchResizeResult`、`GridBranchesResizeResult` 的失败一支都换成 `GridFailure`；L2 与 L1 也用这两个泛型，不另写形状。
- `message` 用英文：提案“错误与诊断”写明 `message` 是库内的英文；第二档的“默认英文文案”指界面文字目录（提案“去掉 nb-ui 依赖”一节），不是这里。
- `params` 的值只用字符串与数字，ids 列表用逗号连起来的字符串：可以直接序列化进诊断日志，宿主拼文字时不用判类型。
- 码集合开放写进 Spec 的“边界与兼容”与包 README；类型仍是字面量联合，调用方用 `switch` 时自己写 `default`。不用 `string & {}` 去“开放”类型：那样丢掉补全与收窄。

### L0 结构操作的码：`packages/nb-layout/src/grid.ts`

35 处逐处归类，每个码的 `params` 固定：

| 码 | `params` | 位置（`grid.ts` 行） |
|---|---|---|
| `not-found` | `{id}` | 226、401、452、472、497、554、581、591 |
| `wrong-node-kind` | `{id, expected}`，`expected` 是 `leaf`、`branch` 或 `child`（根没有父分支） | 229、475、500、557、584、594 |
| `wrong-axis` | `{id, orientation}` | 232、264 |
| `not-finite` | `{field, id?}`，`field` 是 `delta`、`size`、`intent`、`ratio` | 235、280（非有限数的那一半）、348、518（非有限数的那一半） |
| `invalid-argument` | `{field, id?, value?}` | 272（`field: "sizes"`，没覆盖全部子节点）、280（负数）、503（`orientation`）、506（`side`）、518（有限但不在 0 与 1 之间） |
| `limit-exceeded` | `{limit, max, actual}`，`limit` 是 `nodes` 或 `depth` | 192、195 |
| `duplicate-id` | `{id}` | 478、509、513 |
| `into-own-subtree` | `{id, parent}` | 587 |
| `not-conserved` | `{branch, target, baseline}` | 286 |
| `stale-baseline` | `{id}` | 292、617、632 |
| `not-collapsible` | `{branch, id}` | 298 |

- 规则：`not-finite` 只给非有限数；有限但越界、为负的给 `invalid-argument`。280 与 518 今天一个条件管两种情况，拆成两个条件，只改码，失败与否不变。
- `limit-exceeded`、`not-found` 两个名字与 L2 相同、意思相同，L2 原样转交 L0 的失败时码不变。

### L0 快照恢复：`packages/nb-layout/src/grid-snapshot.ts`

- `GridRestoreResult` 的 `reason?: string` 换成失败时的 `code`、`message`、`params?`（`ok: true` 时没有这三样）。码：`invalid-snapshot`（不是对象、非法节点、缺 id、尺寸、方向、children、kind 非法）、`unsupported-version`（旧单轴版本与未知版本，`params: {version}`）、`duplicate-id`、`limit-exceeded`。
- `dropped` 的元素从 `{ref, reason}` 改成 `{ref, code: "unknown-ref"}`：今天只有一种原因。
- nested-grid 失败 4 要求“部分引用过滤与整体格式非法分别报告”：前者在 `dropped`，后者是失败码，分开不变。

### L0 诊断：`grid-geometry.ts`、`sash-drag.ts`、`grid-gesture.ts`、`grid-swap.ts`

`GridIssueCode`：

| 码 | `params` | 位置 |
|---|---|---|
| `over-constrained` | `{ids, axis?}` | `grid-geometry.ts` 149、185、486、502、507；`sash-drag.ts` 247 |
| `conflicting-bounds` | `{id, axis, min, max}` | `grid-geometry.ts` 361 |
| `unabsorbed-space` | `{id?, rest}` | `grid-geometry.ts` 195、533 |
| `not-collapsible` | `{id}` | `sash-drag.ts` 178、311 |
| `no-room-to-restore` | `{id, available}` | `sash-drag.ts` 194、316 |
| `swap-skipped` | `{cause, ids}`，`cause` 是 `no-leaving`、`no-entering`、`busy` | `grid-swap.ts` 132、133、135 |

- **一次求解合成一条 `over-constrained`**（提案“错误与诊断”、体验 10）：窄窗口压到最小值以下时，今天每个节点、每个分支各推一条，每次布局都发。改成一次 `layout()` 里所有 `over-constrained` 合成一条，`params.ids` 列出涉及的节点。实现：求解时照旧往一个内部数组推，`layout()` 返回前按码合并；内部数组的元素先就是 `GridIssue`，合并只看码。
- `grid-swap.ts` 的 `{kind: "skip", reason}` 改成 `{kind: "skip", issue: GridIssue<"swap-skipped">}`，`useGridMotion` 的 `onSwapSkipped` 收 `GridIssue`。
- `GridLayoutResult.issues`、`GridGesturePreview.issues`（`grid-gesture.ts:59`）、`SashDragResult.issues`（`sash-drag.ts:55`）、`SashGestureSession.issues`（`sash-gesture.ts:44`）的类型都改成 `readonly GridIssue[]`。

### L1 提交与诊断：`vue/useGridLayout.ts`、`vue/useSashGesture.ts`、`sash-gesture.ts`、`vue/NestedGrid.vue`

- `GridCommitFailureCode = GridFailureCode | "not-ready" | "stale-context" | "stale-revision" | "stale-size" | "handler-threw"`；`GridLayoutCommitResult = {ok: true} | GridFailure<GridCommitFailureCode>`。`SashGestureController.onCommit` 与 `NestedGrid` 的 `onGestureCommit` prop 返回它。
  - `not-ready`：网格尚未就绪、承载盒尺寸不可用（84、89），`params: {missing: "grid" | "host-size"}`；
  - `stale-context`：`{expected, actual}`（92）；`stale-revision`：`{expected, actual}`（95）；`stale-size`（98）；
  - `handler-threw`：提交处理器抛出（`useSashGesture.ts:287`），`message` 带异常文字；
  - 102 原样转交 L0 的失败。
- `NestedGridIssueCode = GridIssueCode | GridCommitFailureCode | "handler-missing" | "not-published" | "notify-failed"`：
  - 提交被拒（`useSashGesture.ts:291`）发一条诊断，码就是拒绝的码，`params` 原样带上；
  - `handler-missing`：没接 `onGestureCommit`（`NestedGrid.vue:525`）；`not-published`：宿主接纳但没发布匹配布局（`:541`）；
  - `notify-failed`：已经落账、通知宿主时抛出（`useGridLayout.ts:110`），和 `handler-threw` 分开：前者几何已改、不反悔，后者没落账（nested-grid 状态与转换已写这条区别）。
- **`issues` 只发新增**：`useSashGesture` 今天把诊断累积在 `issues` ref 里、只留最后 8 条，`NestedGrid` 监听它、每变一次就把整个列表再发一遍。改成 scope 收一个 `onIssues(batch)` 回调，`NestedGrid` 每次只发这一批；scope 不再保留累积列表。`issues` 是 `SASH_GESTURE_SCOPE_KEY` 注入对象上的字段，实施时核对它是否从入口导出：导出了就写进变更记录。
  - 消费方改成自己累积：Lab 的 `NestedGridAcceptanceFixture.vue`（今天已有 `pushIssues`）、`GridSwapScene.vue`（今天 `issues = list` 整个替换，改成追加）。`WorkbenchSurface.vue` 只转发，产品外壳不监听，不用改语义。
- `useGridLayout` 的 `onIssues` 选项收 `readonly GridIssue[]`。

### L2：`packages/nb-workbench-layout/src/layout-doc.ts`、`layout-drop.ts`

- `LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | GridFailure<LayoutFailureCode>`：`detail` 改名 `message`、改英文，补 `params`。
- `LayoutFailureCode = "not-found" | "limit-exceeded" | "id-taken" | "policy-refused" | "invalid-argument" | "not-allowed"`，44 处 `rejected` 归类：
  - `policy-refused`（宿主给的规则拒绝）：815、844、1030、1067（接受矩阵）、822、852（`canInsert`）、757（标签数上限），`params: {by: "accepts" | "can-insert" | "tab-limit"}`；
  - `id-taken`：754、771（标签）、893（新分支）、1073、1119（新面板）、1090、1148（面板已存在）、661，`params: {id, kind: "tab" | "panel" | "branch"}`；
  - `invalid-argument`：528、529、532、536（比例）、707、725、727（入口顺序），`params: {field}`；
  - `not-allowed`（工作台骨架的规则）：其余各处，`params: {rule}`，`rule` 是固定的英文短名（例如 `anchor-holds-no-tabs`、`anchor-not-movable`、`named-not-movable`、`anchor-cross-edge`、`float-dock-first`、`keep-root`、`editor-not-collapsible`、`float-not-collapsible`、`single-section`、`not-in-tree`），一处一个，测试按 `rule` 断言。
  - 返回问题文字的内部函数（`settleLanding` 628 到 688、`splitPanelInPlace`、`refusesMoreTabs`）改成返回码与 `params`，由调用处（747、757、1046、1079、1098）包成失败：归类在产生原因的地方做，不在包装处做。上面的行号表按今天的产生处列；实施时把最终的“行 → 码、`params`”表写进 Task README，审查对照它。
- **改码不改分支**：应用按码分支的只有三处（`layout-doc-store.ts:227`、`view-commands.ts:91` 与 `:92`、`panel-commands.ts:126`），都只看 `not-found` 与 `limit-exceeded`。今天是 `rejected` 的不会变成这两个码：654（“面板不在树里”，语义像 `not-found`）归 `not-allowed`（`rule: "not-in-tree"`），否则命令会从 `unavailable` 变成 `stale-target`。
- `validateLayoutDoc` 的问题列表不在本 Task：它是读回记录时的校验报告，进诊断日志，不是操作结果。

### 应用：`packages/neuro-book/src/plugins/workbench`、Lab

- 自己构造失败的地方改成新形状：`shared/editor-panels.ts:70`、`web/state/layout-doc-store.ts` 50、175、176、232、360、511，`web/state/containers.ts` 168、180、200，`web/entry-drop.ts:144`，Lab 的 `WorkbenchSurfaceFixture.vue:116`。码：`not-found`、`limit-exceeded` 照旧；今天写 `rejected` 的按原因归到 L2 的码（232 不合骨架 → `not-allowed`、`rule: "skeleton"`；511 视图不可移动 → `not-allowed`、`rule: "view-not-movable"`；176、`entry-drop.ts:144` 实施时读原因再归，记进 Task README）。
- 读 `detail` 的改读 `message`（`layout-doc-store.ts:227` 进诊断日志）。诊断日志里这些文字会从中文变英文：只进日志、不给用户看（`plugin.ts:208`）。
- 求解诊断进诊断日志的地方（`plugin.ts:205` 一带按行记录）改成记 `message`，事件里带上 `code`。

### 测试迁移规则

- 按中文文案断言的改成断言 `code` 加 `params`：原来靠两句不同文案区分的两种失败（例如“未知节点”与“未知父节点”），新的断言必须靠 `params` 里的值（`id`、`expected`、`rule`）仍能区分；断言只写 `code` 的不算迁完。
- 不断言 `message` 的文字：它只给日志看，改措辞不算破坏。
- 合并 `over-constrained`、`issues` 只发新增这两条是行为变化，各自补用例：窄到最小值以下一次布局只有一条 `over-constrained`；连续两次被拒的提交，第二次的 `issues` 事件只带第二条。

## Spec 与文档改动

在 master 上、设计审查处理完之后、写代码之前：

- `ui/nested-grid`：
  - 失败与恢复追加失败 5（结构操作与提交的失败形状、L0 码表与各码 `params`）、失败 6（`onGestureCommit` 的返回合同与 L1 的码）、失败 7（快照恢复的码与 `dropped` 的码），条目标“（planned）”；
  - 输出追加 139（`issues` 的形状，只发新增）与 140（一次求解合成一条 `over-constrained`），标“（planned）”；输出 68 的“经 `issues` 交回原因”链接到 139；
  - 边界与兼容加一句：码集合开放、新增码不算破坏，调用方要有默认分支。
- `ui/workbench-layout`：失败与恢复的码表加 `id-taken`、`policy-refused`、`invalid-argument`、`not-allowed` 四行（planned），`rejected` 一行注明实现后拆成这四个；表头一句“返回 `{ok: false, code}`”改成新形状。
- `packages/neuro-book/CHANGELOG.md` 的“不兼容的改动”：插件 SDK 的 `NestedGrid` 的 `onGestureCommit` 返回 `{ok: false, code, message}`，`issues` 事件的元素是 `{code, message, params?}`、只带新增。
- 包文档：nb-layout 的 `NestedGrid.md`、`Splitter.md`（若写到了 `issues`、`reason`）、`src/grid.md`；nb-workbench-layout 的 README（“操作都是纯函数：失败返回问题码”一句写新形状）。
- 实现之后：两份 Spec 的 planned 条目去掉标记、实现合同与证据补路径。

## 切片

1. **L0**（关键设计“共同形状”“结构操作的码”“快照恢复”“诊断”）：类型、35 处、快照、求解与拖动诊断、交换跳过；L0 测试按迁移规则改；`over-constrained` 合并的用例。nb-layout 编不过的 L1 文件同片做最小改动让类型通过（L1 的码在第 2 片），应用不动。验证：`bun run --cwd packages/nb-layout typecheck`、`test`。
2. **L1**：提交的码、诊断的码、`issues` 只发新增；Lab 两个夹具改成自己累积；dom 测试。验证：nb-layout `typecheck`、`test`。
3. **L2 与应用**：`LayoutResult`、44 处归类、`layout-drop.ts`；应用的构造方、读 `detail` 的地方、诊断日志；变更记录；包文档。验证：nb-workbench-layout `typecheck`、`test`；`bun run --cwd packages/neuro-book typecheck`；`bun run test:affected`；`sdk.test`；`build:sdk` 前后比对，只有 `NestedGrid` 的两处类型变化；`docs:check`。
4. **收口**：并 master、e2e、实现审查、合入，master 上 Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 失败 5（planned） | `grid.test.ts` 逐码用例：35 处每处至少一条，断言 `code` 与 `params` |
| nested-grid 失败 6（planned） | `useGridLayout.dom.test.ts`、`splitter.dom.test.ts`、`useSashGesture` 一带的 dom 测试：五种拒绝、处理器抛出、转交 L0 失败 |
| nested-grid 失败 7（planned） | `grid-snapshot` 的测试：各码与 `dropped` |
| nested-grid 失败 1 到 4 | 原有测试改成码后仍过 |
| nested-grid 输出 139（planned） | dom 测试：连续两次被拒，第二次事件只带一条；e2e `lab-nested-grid`、`lab-grid-swap` |
| nested-grid 输出 140（planned） | `grid-geometry` 或 `grid.test.ts`：窄到最小值以下一次布局一条 `over-constrained`，`ids` 列全 |
| nested-grid 输出 68 | `lab-grid-swap` e2e 与 `grid-swap` 的测试：跳过时的诊断是 `swap-skipped` 与 `cause` |
| workbench-layout 失败与恢复码表 | `layout-doc.test.ts` 按 `code` 与 `params.rule`；`view-commands`、`panel-commands`、`layout-doc-store` 的测试：`not-found`、`limit-exceeded` 的分支照旧 |

## 验证

- 每片的包级 `typecheck` 与 `test`；第 3 片之后 `test:affected`。
- e2e：`lab-nested-grid`、`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-views`、`workbench-dnd`、`workbench-shell`，7 个文件。开跑前看负载，按每个文件开跑时的负载判断失败；Lab 就绪等待的失败在负载 15 以下单独重跑。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行，不测）。

## 不做与风险

- 不做：开发模式下的配置错误报告（提案“拖不动时报错”，归 t36）；`validateLayoutDoc` 的问题列表改码；界面文字改英文（第二档）；`SplitterGestureCancelReason`（`cancel`、`onCancel`、`session.reason`）：它是取消原因的枚举，不是失败文字，迁移时按名字排除，不改名不改值。
- 风险：
  - 码一合并，测试可能在错的分支上照样通过：迁移规则要求断言 `params`，审查时抽查原来靠文案区分的几组。
  - `issues` 只发新增后，靠整个列表替换的消费方会只剩最新一批：已知的两个 Lab 夹具在第 2 片改；实施时再按 `@issues`、`onIssues` 搜一遍 `packages/`。
  - 应用诊断日志里的文字变英文：只进日志。
