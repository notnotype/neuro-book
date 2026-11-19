# t34 统一失败形状与错误码：实施计划（第 4 稿）

第 2 稿按第一轮设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，15 条）改，第 3 稿按第二轮（[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)，12 条）改，逐条处理见 Task README。第 3 稿（`bd652653e`）第三轮（[`evidences/design-review-r3.txt`](evidences/design-review-r3.txt)）后仍有 6 条重要问题，开发者 2026-11-19 同意拆开：本 Task 只做失败的形状，诊断挪到 [t38](../t38-grid-diagnostics/README.md)，L2 拆码延后。第 4 稿按这个范围收窄，并吸收第三轮里属于失败形状的几条（3、6、7 的一部分、10、11），不再送设计审查（已满三轮，收窄的部分开发者认为可以直接做），实现审查兜底。

## Context

按已接受的提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 第一档第 2 项（“错误与诊断一种形状”）与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 的失败一半：nb-layout 的结构操作、快照恢复与 L1 的提交回调，失败都改成 `{ok: false, code, message, params?}`。今天 L0 是中文 `reason`，L1 的提交回调同样是 `reason`，L2（nb-workbench-layout）已经有 `code`、另带中文 `detail`。

开发者已确认的：t31（2026-11-18）nb-layout 做成通用库、第一档现在做、“都按推荐”；2026-11-19 对 t34 停下时的推荐答“同意”：拆成失败形状与诊断两个 Task，L2 的 `rejected` 拆成四个码延后，这一档 L2 只把 `detail` 改名 `message`、改英文。本 Task 不改布局行为，也不改诊断：诊断照旧是中文字符串，提交被拒仍经诊断字符串发出（后半句变成英文的 `message`），这些在 t38 改。

依据的 Spec：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)（失败 1 到 4、“状态与转换”里的提交规则）、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)（失败与恢复的码表）、[`ui/i18n`](../../../../../docs/specs/ui/i18n.md) 输出 13 的“开放错误域”与 `TextRef.params`。

工作方式：autonomous-delivery。代码在 worktree `w00026-t34-unified-errors`（分支 `refactor/w00026-t34-unified-errors`，从 master 开）；Spec 与 Task 记录在 master 上改。

### 和提案不同的地方

提案末尾的决策记录与待确认清单：

1. **提交的码**（开发者 2026-11-19 追认）：提案说 `stale-context`、`stale-revision`、`handler-missing`、`handler-threw` 不预设；代码里都有对应的失败，本 Task 定码。
2. **个别码**（同日追认）：229（根节点没有父分支）归 `invalid-argument`，617、632（目标父节点已不存在）归 `not-found`；另把 401、452 拆成 `not-found` 与 `wrong-node-kind`（第三轮第 3 条）。
3. **L2 拆码延后**（同日同意）：提案第一档第 2 项写 L2 的 `rejected` 归并成码；本档 L2 码不变，只改字段名与语言。拆码今天没有使用方：应用按码分支的三处只看 `not-found`、`limit-exceeded`（第一轮第 13 条），nb-workbench-layout 也不发布。

## 技术选型

无通用问题：错误形状是本仓库自己的合同，不引库。

## 关键设计

### 共同形状：`packages/nb-layout/src/grid-types.ts`

```ts
/** 失败里的参数值：只用字符串与数字，和 `ui/i18n` 的 `TextRef.params` 同型，宿主可以直接交给翻译端口。 */
export type GridParamValue = string | number;

/** 失败。`code` 给程序分支；`message` 是库内的英文，只给日志看；`params` 给宿主拼自己的界面文字。码集合开放（见下）。 */
export interface GridFailure<C extends string = string> {
    readonly ok: false;
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, GridParamValue>>;
}
```

- 名字带 `Grid` 前缀，与 nb-layout 其余导出一致；L2 直接用这个泛型，不另写形状。
- 诊断的形状（`GridIssue`）不在本 Task 定义，归 t38：它是去掉 `ok` 的同一个形状，t38 可以把 `GridFailure` 改写成 `GridIssue & {ok: false}`，结构不变、不算破坏。数组值（诊断的 `ids`）同样在 t38 定（第三轮第 4 条）。失败里没有要数组的参数：下面几张表的值都是一个 id、一个字段名或一个数。
- **构造时检查 `params`**：每层一张内部的映射类型（码 → `params` 形状），一个码有几种形状的写成按 `field` 判别的联合，例如：

  ```ts
  type L0FailureParams = {
      "not-found": {id: string};
      "wrong-node-kind": {id: string; expected: "leaf" | "branch"};
      "invalid-argument":
          | {field: "root"; id: string}
          | {field: "sizes-cover"; id: string}
          | {field: "size-negative"; side: "baseline" | "target"; id: string}
          | {field: "orientation" | "side"; value: string}
          | {field: "ratio-range"; value: string};
      // …
  };
  function failure<C extends keyof L0FailureParams>(code: C, message: string, params: L0FailureParams[C]): GridFailure<C>;
  ```

  拼错字段名、漏字段在编译期报错。映射不导出，导出的仍是上面的通用形状（第三轮第 7 条建议导出成判别联合，不采纳：以后把返回值的 `params` 收窄成判别联合，对读它的宿主是兼容的变化，等有宿主要用再做）。
- `GridResult`、`GridResizeResult`、`GridBranchResizeResult`、`GridBranchesResizeResult` 的失败一支都换成 `GridFailure<GridFailureCode>`。
- `GridRestoreResult` 改成判别联合：`{ok: true; dropped; clamped} | (GridFailure<GridRestoreFailureCode> & {dropped; clamped})`。
- 码按层各是一个字面量联合（提案“码按层定义”），不按操作再收窄：码集合开放，调用方本来就要有默认分支；每个操作一个联合，类型数翻几倍。几个失败联合之间共用的码（`not-found`、`limit-exceeded`、`duplicate-id`）意思与 `params` 形状相同。
- **码集合开放**：新增码不算破坏，只在变更记录写一行；库不保证穷尽，调用方写 `switch` 要有 `default`。码的写法对齐 `ui/i18n` 输出 13 的“开放错误域”：小写短横线，不含 `:`、`.`、空白，不超过 64 个字符，宿主可以直接拿码查自己目录里的 `errors.<码>`。不用 `string & {}` 去“开放”类型：那样丢掉补全与收窄。
- `message` 用英文：提案“错误与诊断”写明 `message` 是库内的英文；第二档的“默认英文文案”指界面文字目录，不是这里。测试不断言 `message` 的文字。

### L0 结构操作：`packages/nb-layout/src/grid.ts`

`GridFailureCode = "not-found" | "wrong-node-kind" | "wrong-axis" | "not-finite" | "invalid-argument" | "limit-exceeded" | "duplicate-id" | "into-own-subtree" | "not-conserved" | "stale-baseline" | "not-collapsible"`。34 处逐处（行号按 master 上的 `grid.ts`）：

| 行 | 码 | `params` |
|---|---|---|
| 192、195 | `limit-exceeded` | `{limit: "nodes" 或 "depth", max}` |
| 226、472、497、554、581、591 | `not-found` | `{id}`（472、591 是父节点 id） |
| 401、452 | 先判不在：`not-found` `{id: 分支}`；再判是叶：`wrong-node-kind` `{id, expected: "branch"}` |
| 229 | `invalid-argument` | `{field: "root", id}`：根节点没有可调整的父分支 |
| 232 | `wrong-axis` | `{id, parent, orientation}`：`orientation` 是父分支的方向 |
| 264 | `wrong-axis` | `{id, orientation}`：`id` 是分支自己，`orientation` 是它的方向 |
| 235 | `not-finite` | `{field: "delta", value}` |
| 272 | `invalid-argument` | `{field: "sizes-cover", id: 分支}` |
| 280 | 逐个子节点，baseline 先于 target；每一侧先判非有限：`not-finite` `{field: "size", side, id: 子节点}`，再判负数：`invalid-argument` `{field: "size-negative", side, id: 子节点}` |
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

- 280、298、401、452、518 今天一个条件管两种情况，拆成先后两个条件；失败与否不变，只是码不同。
- 617、632（`moveLeaf` 里“目标父节点已不存在”）不可达：589 已经找到父节点，同分支的移动走另一条路，克隆树里塌陷的只有来源（第一轮审查用 5000 棵随机树、每棵 14 步的实验一次没命中）。行为不改，留作防御分支，不写用例，注释写明为什么不可达。
- `value` 一律是 `String(调用方传的值)`：运行期可能是任意值，非有限数因此也是字符串，序列化进日志不丢。
- `limit-exceeded` 不带实际数量：快照恢复为了不遍历巨型数组会提前返回，给不出准确的数；两处同形。
- `serializeTree` 对非字符串 ref 抛的 `TypeError`（`grid-snapshot.ts:37`）是调用方的编程错误，不是失败结果，只把文字改成英文。

### L0 快照恢复：`packages/nb-layout/src/grid-snapshot.ts`

`GridRestoreFailureCode = "invalid-snapshot" | "unsupported-version" | "unresolved-root" | "duplicate-id" | "limit-exceeded"`：

- `invalid-snapshot` `{field}` 或 `{field, id}`，`field` 是 `envelope`、`node`、`id`、`ref`、`size`、`orientation`、`children`、`kind`（86 与 `convert` 里的各处）；
- `unsupported-version` `{version: String(版本)}`（90、93）；
- `unresolved-root`（209）：格式没问题，根是叶、它的引用解析不了，整体恢复不出来；`dropped` 里照常有那条引用。和 `invalid-snapshot` 分开：宿主要据此判断是“引用暂时缺”还是“原件坏了”（失败 3、4）；
- `duplicate-id` `{id, with: "existing"}`；
- `limit-exceeded` `{limit: "nodes" 或 "depth", max}`。
- `dropped` 的元素从 `{ref, reason}` 改成 `{ref, code: "unknown-ref"}`：今天只有一种原因。

### L1 提交：`sash-gesture.ts`、`vue/useGridLayout.ts`、`vue/useSashGesture.ts`、`vue/NestedGrid.vue`

- `GridCommitFailureCode = GridFailureCode | "not-ready" | "stale-context" | "stale-revision" | "stale-size" | "handler-missing" | "handler-threw"`，定义在 `grid-types.ts`（`sash-gesture.ts` 在根入口，也要用）。`GridLayoutCommitResult = {ok: true} | GridFailure<GridCommitFailureCode>`。`SashGestureBinding.onCommit`（`sash-gesture.ts:62`）、`NestedGrid` 的 `onGestureCommit` prop（`NestedGrid.vue:48`）返回它：
  - `not-ready` `{missing: "grid" 或 "host-size"}`（`useGridLayout.ts` 84、89）；
  - `stale-context` `{expected, actual}`（92）、`stale-revision` `{expected, actual}`（95）：`expected` 是宿主此刻的值，`actual` 是提交带来的值；`stale-size`（98）没有 `params`；
  - 102 原样转交 L0 的失败；
  - `handler-missing`：`NestedGrid.vue:526` 返回它；
  - `handler-threw`（`useSashGesture.ts:287`），`message` 带异常文字。
- 诊断不动：`useSashGesture.ts:291` 拼的“本次调整没有落账：…”改读 `message`；`NestedGrid.vue:525` 直接发的那一条、`:541` 的“没有发布匹配布局”、`useGridLayout.ts:110` 的“已落账但通知失败”原样留着，t38 处理。

### L2：`packages/nb-workbench-layout/src/layout-doc.ts`

- `LayoutResult = {readonly ok: true; readonly doc: LayoutDoc} | GridFailure<LayoutFailureCode>`，`LayoutFailureCode` 仍是 `"not-found" | "limit-exceeded" | "rejected"`：`detail` 改名 `message`、改英文，不加 `params`（第三轮第 5 条说的 L2 `params` 来源问题因此不出现）。包内的 `failure(code, detail)`（`:111`）改成 `failure(code, message)`，返回 `GridFailure`。
- `LayoutDocValidation`（`:1267`）同批把 `detail` 改名 `message`，`invalid(...)` 的 32 处与 `validateNode` 的问题文字一起改英文（第三轮第 6 条）；码 `unsupported-version`、`invalid` 不变，拆码时再看要不要改名。
- 同包两个失败结果因此是一种形状（ADR 0054 决策 4）。L2 的测试今天只断言 `code: "rejected"`、读 `detail` 只用在 `throw new Error(...)` 里，没有按文字区分的断言，改名不丢区分度。

### 应用：`packages/neuro-book/src/plugins/workbench`、Lab

- 自己构造 `LayoutResult` 失败的地方改字段名、改英文：`shared/editor-panels.ts:70`、`web/state/layout-doc-store.ts` 50、173 一带、232、360、511，`web/state/containers.ts` 168、180、200，`web/entry-drop.ts:144`，Lab 的 `WorkbenchSurfaceFixture.vue`（实施时按类型检查找全）。码照旧。本地的 `notFound(detail)`、`failure(detail)` 辅助函数改成收 `message`。
- `layout-doc-store.ts:88` 读 `checked.detail`、`:227` 读 `result.detail` 的改读 `message`。`structureFailure` 只进诊断日志，日志文字从中文变英文。
- Lab 夹具 `NestedGridAcceptanceFixture.vue`：读恢复结果的 `res.reason ?? 中文兜底`（`:276`、`:297`）改成读 `code`，去掉中文兜底，把码写进 `data-lab-restore-code`、版本写进 `data-lab-restore-version`；`droppedRefs` 改成 `{ref, code}`；显示失败的地方显示 `message`。
- e2e：`lab-nested-grid.e2e.ts:382` 读 `data-lab-restore-reason` 的 `toContain("重复节点 id")` 改成断言 `data-lab-restore-code` 是 `duplicate-id`；397 的 `toContain("99")` 改成 `data-lab-restore-code` 是 `unsupported-version`、`data-lab-restore-version` 是 `99`。

### 公开面变更清单

| 类型或接口 | 出口 | 插件 SDK | 变更记录 |
|---|---|---|---|
| `NestedGrid` 的 `onGestureCommit` 返回 `{ok: false, code, message, params?}`（原来是 `reason`） | `nb-layout/vue` | 是（组件在 SDK 清单） | 不兼容的改动 |
| `GridFailure`、`GridParamValue`、`GridCommitFailureCode`、`GridLayoutCommitResult` | `nb-layout`、`nb-layout/vue` | 加进 `sdk/components.ts` 的类型导出：插件给 `onGestureCommit` 写类型要用到 | 新增 |
| `SashGestureBinding.onCommit` 返回 | `nb-layout` | 否 | 不写 |
| `GridResult` 一族、`GridRestoreResult` | `nb-layout` | 否 | 不写 |
| `LayoutResult`、`LayoutDocValidation` | `nb-workbench-layout`（不发布） | 否 | 不写 |

- 第 2 片 `build:sdk` 前后比对：`onGestureCommit` 的类型按预期变化、新增的几个类型名出现，别的不变。
- `PLUGIN_API_SINCE`（`src/shared/product.ts`）不在本 Task 改：[`releasing.md`](../../../../../docs/standards/releasing.md) 第 2 步要它改成“这次发布的版本”，`product.test.ts` 要求它不晚于 `PRODUCT_VERSION`，现在写不出那个版本。防遗忘：Work README 加一行“发版前”，写明下次发布按第 2 步提兼容起点（“不兼容的改动”那一条本 Task 写进 `[Unreleased]`）；交付汇报同样写明。

### 测试迁移规则

- 按中文文案断言失败的改成断言 `code` 加 `params`。原来靠两句不同文案区分的失败，新断言靠 `params` 里的值（`id`、`expected`、`field`、`side`、`with`）仍能区分；断言只写 `code` 的不算迁完。
- 不断言 `message` 的文字。
- `throw new Error(result.reason)`、`throw new Error(result.detail)` 一律改读 `message`。
- 诊断字符串的断言（`issues.join()` 里的中文）不动：诊断归 t38。实施时按被替换的中文失败文字（“未知节点 id”“工作面已切换”“布局快照”等）在测试、Lab 与 e2e 里搜一遍，确认没有经诊断字符串断言失败文字的地方（盘点时只有 `lab-nested-grid.e2e.ts:382`，读的是恢复结果，已列入）。
- 新增用例：401、452 各一条用叶 id 的（`wrong-node-kind`）；280 两侧都坏时报 baseline 一侧；`unresolved-root` 带 `dropped`；`handler-missing`、`handler-threw` 读码。

## Spec 与文档改动

在 master 上、写代码之前：

- `ui/nested-grid`：失败与恢复追加失败 5（结构操作的失败形状与 L0 码表、各码 `params`）、失败 6（`onGestureCommit` 的返回合同与提交的码）、失败 7（快照恢复的码、`unresolved-root` 与 `dropped` 的码），标“（planned）”；失败 1 说“必须给诊断、不抛”，失败 5 说形状，写明两者的关系；边界与兼容加：码集合开放、新增码不算破坏、调用方要有默认分支，码的写法对齐 `ui/i18n` 输出 13。
- `ui/workbench-layout`：失败与恢复表头“返回 `{ok: false, code}`”改成 `{ok: false, code, message}`（planned），码表不变。
- `packages/neuro-book/CHANGELOG.md`：“不兼容的改动”写 `onGestureCommit` 的返回；“新增”写 SDK 新导出的几个类型。
- 包文档：nb-layout 的 `NestedGrid.md`（`onGestureCommit` 的类型）、`src/grid.md`（若写到 `reason`）；nb-workbench-layout 的 README（“操作都是纯函数：失败返回问题码”一句写新形状）。
- Work README：“发版前”一行。
- 实现之后：两份 Spec 的 planned 条目去掉标记、实现合同与证据补路径。

## 切片

1. **nb-layout**：`GridFailure`、`GridParamValue` 与内部构造函数；`grid.ts` 34 处、快照恢复（含 `unresolved-root`）、`serializeTree` 的文字；L1 的提交码；nb-layout 的测试；`layout-project.test.ts` 313、420；Lab 夹具读恢复结果的几处、`lab-nested-grid.e2e.ts` 382、395。验证：nb-layout、nb-workbench-layout、应用的 `typecheck`，nb-layout 与 nb-workbench-layout 的 `test`，`lab-nested-grid` 一个文件的 e2e（夹具属性名与 e2e 读法只有 e2e 能对上，第三轮第 10 条）。
2. **L2 与应用**：`LayoutResult`、`LayoutDocValidation` 改名与英文；应用的构造方与读 `detail` 的地方、测试里读 `detail` 的地方；SDK 的类型导出；变更记录；包文档；Work README 的“发版前”。中文改英文的部分说明写清规则后可以派子代理，diff 由主会话审。验证：同第 1 片，加 `bun run test:affected`、`sdk.test`、`build:sdk` 前后比对、`docs:check`。
3. **收口**：并 master、e2e、实现审查、合入，master 上 Spec 去掉 planned、补实现合同。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 失败 5（planned） | `grid.test.ts` 逐码用例：可达的每处一条，断言 `code` 与 `params`（617、632 不可达，不写） |
| nested-grid 失败 6（planned） | `useGridLayout.dom.test.ts`：五种拒绝、转交 L0 失败；`splitter.dom.test.ts` 或 `NestedGrid.dom.test.ts`：处理器抛出、没接回调 |
| nested-grid 失败 7（planned） | 快照恢复的测试：各码、`unresolved-root` 带 `dropped`；e2e `lab-nested-grid` 的两条恢复用例读 `data-lab-restore-code` |
| nested-grid 失败 1 到 4 | 原有测试改成码后仍过 |
| workbench-layout 失败与恢复（表头的形状） | `layout-doc.test.ts`、`layout-doc-store.test.ts` 的失败用例读 `message`；`view-commands`、`panel-commands`、`layout-doc-store` 的测试：`not-found`、`limit-exceeded` 的分支照旧 |

## 验证

- 每片三个包的 `typecheck`、两个包的 `test`；第 2 片之后 `test:affected`。
- e2e：第 1 片 `lab-nested-grid`；收口 `lab-nested-grid`、`lab-grid-panels`、`lab-workbench-surface`、`workbench-views`、`workbench-dnd`、`workbench-shell`，6 个文件。开跑前看负载，按每个文件开跑时的负载判断失败；Lab 就绪等待的失败在负载 15 以下单独重跑、和 master 对照。
- 未验证的边界：第三方宿主按 `message` 文字分支（合同明说不行，不测）。

## 不做与风险

- 不做：诊断（形状、码、只发新增、两个出口、`SashGestureScope.issues`、`swap-skipped`，归 t38）；L2 的 `rejected` 拆码（延后到有使用方）；开发模式下的配置错误报告（提案“拖不动时报错”，归 t36）；`collapsePolicyProblem` 的返回形状（t36 定入口时一起定）；界面文字改英文（第二档）；`PLUGIN_API_SINCE`（发布时改）；`SplitterGestureCancelReason`（`cancel`、`onCancel`、`session.reason`）：它是取消原因的枚举，不是失败文字，迁移时按名字排除，不改名不改值；nb-ui 里冻结的 Splitter 副本。
- 风险：
  - 码一合并，测试可能在错的分支上照样通过：表里每处的 `params` 已定、构造时按映射类型检查，实现审查抽查原来靠文案区分的几组（`duplicate-id` 的 `with`、`invalid-argument` 的 `field`、401 与 452 的拆分）。
  - 过渡期诊断字符串中英混写（前半句中文、后半句英文的 `message`）：只进日志与 Lab，t38 换成诊断对象。
  - 应用诊断日志里 L2 的失败文字变英文：只进日志。
