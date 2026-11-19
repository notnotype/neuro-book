# t40 收起与展开入口、L2 的意图回写：实施计划（第 2 稿）

第 2 稿按第一轮设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，11 条，阻断 0、重要 5、建议 6，都成立）改，逐条处理见 Task README。最大的改动：

- `setCollapsed` 不再走分隔条 Enter 的“邻居吸收”，改成只翻收起标记、按分配规则重排（第 1、2 条）。
- `resizeBranches` 不再把压缩值写进没动的保留像素节点（第 3 条）。
- `rebaseIntents` 不再从入口导出，四个手写回写的地方都迁移（第 4 条）。
- 工作台也改用 `before`（第 10 条）。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第一档“库里补的小东西”的第 3、4 条；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 从 t39 拆出（[待确认清单](../../pending-confirmations.md)）。
- 两件事各在一个包、各有一份 Spec，彼此不依赖：
  - **L1 收起与展开的入口**（体验审查第 5、6 条，[`t31 evidences/experience-review.txt`](../t31-general-layout-library/evidences/experience-review.txt)）：
    - 今天第三方想收起或展开一块面板，只能自己读布局、算守恒的目标，再调 `resizeBranches`。
    - `SashCollapsePolicy.restoreSize`（显式恢复回到的尺寸）库里没人更新：用户拖宽左栏、再收起，按 Enter 恢复时回到建树时给的值。
  - **L2 意图回写**（t26 深度审查 api-03，[`t26 evidences/deep-review-api.txt`](../t26-layout-deep-review/evidences/deep-review-api.txt)）：
    - 手势落账后、结构操作之前，宿主要手写一段回写：收起记到区域的锚上，拉开隐藏的区域时清掉隐藏，挑出没动的保留像素节点，再 `rebaseIntents`。
    - 漏一个输入不报错，只是过一会儿布局不对。仓库里现成有三处漏参的副本：Lab 的 `GridPanelsScene`、`WorkbenchSurfaceFixture` 不传 `frozen`；`EditorAreaFixture` 把所有保留像素节点都冻结、不比较前后。
    - 审查实验（`exp/api03.test.ts`，真实 `projectLayoutDoc`）：窗口 700 时拖编辑区的边界、再放宽到 1400，Lab 的写法让左栏从 280 变成 160、回不去；store 的写法回到 280。
  - **审查新发现的 L1 缺陷**（第 1、3 条，都已用真实函数复现）：
    - 分隔条上 Enter 收起时没人能吸收（兄弟都到上限、都已收起），预览照出，落账以 `not-conserved` 失败。
    - `resizeBranches` 把这次没动、但被压缩的保留像素节点的意图写成压缩值：窄窗口里收起一块面板，放宽后旁边那块保留像素的面板永久少一截（`exp/compress.test.ts`：c 从 300 变 100）。
- 开发者已确认的决定：上面两件照提案做；提案原话是收起入口“形状在 Spec 里定”，`restoreSize`“推荐谁收起谁记”。

## 技术选型

无。

## 关键设计

### L1 收起与展开的入口：`packages/nb-layout/src/grid.ts`

```ts
setCollapsed(id: string, collapsed: boolean): GridCollapseResult;

type GridCollapseResult =
    | {ok: true; changed: boolean; collapse: SashCollapseState}
    | GridFailure<GridFailureCode>;
```

- 语义：只翻 `id` 的收起标记，尺寸意图不动，下一次 `layout()` 按分配规则重排。这和宿主改了自己的记录、重新建树得到的布局相同。
  - 谁吸收：按比例分的兄弟吸收差额，保留像素的兄弟不变（`grid-geometry.ts` 的分配约定）。
  - 展开回到它的意图：保留像素的面板回到意图的像素；按比例分的面板回到按权重此刻该得的那一份。拖动收起时意图本来就留在展开值（`planBranchResize` 对收起的子节点不写意图）。
  - 总量天然守恒，所以没有“没人能吸收”的失败。放不下时由 `layout()` 照常压缩并给诊断。
- 和分隔条上的 Enter 不同：Enter 是隔着那条分隔条的邻居由近到远让位，恢复到 `restoreSize`。Spec 分开写两条。
  - 为什么不让两者一样：Enter 发生在一条具体的分隔条上，用户看着那条边界，邻居让位符合直觉；按 id 收起没有分隔条，让分配规则决定，结果才和宿主改记录后重排一致。
  - VS Code 的 `SplitView.setViewVisible` 也是按优先级而不是按邻近决定谁吸收（审查者凭记忆，未核对；不作依据）。
- 不要容器尺寸：不读布局，`Grid` 也不记上一次布局。
- `toggleable: false` 不过滤：它只决定分隔条上的 Enter 挑哪一侧。
- 结果：
  - `changed` 是收起标记有没有变；`collapse` 是调用之后这个节点的收起策略（含记下的 `restoreSize`），宿主要存盘时从这里取。
  - 已经是那个状态：`changed: false`，树不变。
  - 失败沿用现有的码与参数，不加新码：
    - `id` 不存在：`not-found`；
    - `id` 是根：`invalid-argument`，`field: "root"`（同 `resize`）；
    - 没有收起策略：`not-collapsible`，参数 `id`、`branch`。

### L1 `restoreSize` 谁维护：同一文件

- 谁收起谁记：一个子节点的收起标记从展开翻成收起时，记下它的恢复尺寸。
  - 记什么：
    - 保留像素的面板记它在父分支主轴上的意图。意图本来就是它的像素记忆，被压缩时也不变。
    - 按比例分的面板，意图是权重，给不出像素，只能记收起前呈现的像素。
  - 下限是 `collapsedSize`。
  - 在哪记：
    - `resizeBranches`（拖动收起、分隔条上的 Enter）：按比例分的面板取这次变化的基线；
    - `setCollapsed`：没有布局，按比例分的面板不改 `restoreSize`。按比例分的面板想要“恢复到合适的那一份”，用 `restoreToShare`（这是它的正路）。写进 Spec 的“不承诺”。
- 带 `restoreToShare` 的面板照样记，只是不读。
- 收起策略不写快照（不变）。`restore()` 的解析结果没给 `collapse` 时沿用当前树的，记下的值保留（审查已核对 `grid-snapshot.ts:159、208`）。
- 工作台不受影响：它每次从投影重建网格，`restoreSize` 每次由投影按意图给（`layout-project.ts:111`）。

### L1 落账不写坏保留像素节点：`grid.ts` 的 `planBranchResize`

- 保留像素的子节点，这次目标与基线相差不超过 `EPSILON` 时保留原意图，不写成目标（被压缩时目标就是压缩值）。
- 和 L2 的 `frozen` 是同一条规则，只是在 L1 自己的落账路径上也守住。
- 用审查的 `exp/compress.test.ts` 作回归：窄窗口里收起 a，c 的意图仍是 300，放宽后 c 回到 300。

### L1 分隔条上的 Enter：没人能吸收时保持展开：`sash-drag.ts` 的 `solveSashCollapse`

- 收起分支算出的尺寸和不守恒（另一侧到上限吸收不了）时，不改，保持展开，给 `no-room-to-collapse` 诊断（拖动路径已有这个码，`sash-drag.ts:285、330`）。
- 这样手势会话不发布不守恒的预览，落账不再以 `not-conserved` 失败。

### L1 Vue：`packages/nb-layout/src/vue/useGridHost.ts`、`useGridLayout.ts`

- `GridHost` 加 `setCollapsed(id: string, collapsed: boolean): GridCollapseResult | GridFailure<"not-ready">`：
  - 调 `grid.setCollapsed`；`changed` 为真时 `invalidate()`，版本递增、布局重发；没变化不 `invalidate`，不打断进行中的手势。
  - 没有网格时返回 `not-ready`（`missing: "grid"`，同失败 6）。不需要尺寸。
  - 重发布局时的诊断照常经 `onIssues`（输出 145 的一个出口不变）；`setCollapsed` 自己没有诊断。
  - 进行中的手势：`invalidate()` 让版本递增，那场手势的提交按 `stale-revision` 被拒、预览回滚（失败 6 已有的行为）。
  - `onApplied` 不为它触发：`onApplied` 是手势提交的落账通知；程序收起的结果直接交回调用方，`collapse` 里有要存的值。Spec 写进“不承诺”。
- `onApplied` 加第三个参数 `before: GridLayoutResult`：这次提交之前发布的布局。
  - 审查已核对：提交前先核对版本，期间任何发布都会递增版本，所以落账时的上一份布局就是手势开始时呈现的那份。
  - 理由：L2 的 `applyGestureCommit` 要比较提交前后的尺寸，才能挑出没动的保留像素节点。今天工作台靠 store 里记的 `presented`，它在实时预览期间不更新（`layout-doc-store.ts:408-412`），和手势开始时的布局可能不同，只是碰巧没出事。

### L2 意图回写：`packages/nb-workbench-layout/src/intent-writeback.ts`（新增）

```ts
export function applyGestureCommit(doc: LayoutDoc, projection: LayoutProjection, gesture: {
    readonly before: Readonly<Record<string, GridExtent>>;
    readonly after: Readonly<Record<string, GridExtent>>;
    readonly collapsed: Readonly<Record<string, boolean>>;
}): {readonly doc: LayoutDoc; readonly rejected: ReadonlyArray<{readonly id: string; readonly failure: GridFailure<LayoutFailureCode>}>};

export function rebaseForOperation(doc: LayoutDoc, projection: LayoutProjection, presented: Readonly<Record<string, GridExtent>>): LayoutDoc;
```

- 两个函数是工作台现有代码原样搬进库：`applyGestureCommit` 是 `commitGesture` 去掉 `schedule` 的部分加上 `untouchedFixed`（容差 0.5px 成为库里的常量），`rebaseForOperation` 是 `rebased()`。审查逐项对照过等价。
- `rebaseIntents` 不再从入口导出：它的 `collapsedTo`、`frozen` 漏传不报错，正是 api-03 说的陷阱。
  - 入口是 `export *`，所以把 `rebaseIntents`（今在 `layout-doc.ts`）、`fixedNodesOf`（今在 `layout-project.ts`，只有回写用它）挪进新模块 `intent-writeback.ts`，和两个新函数放在一起；
  - `index.ts` 只显式转出 `applyGestureCommit`、`rebaseForOperation`；
  - 测试从模块直接导入。
- 被拒的收起与显隐写入跳过、其余照常写回（同今天），逐项交回 `rejected`，不吞。
  - 审查核对：从投影出发，工作台里这条路不可达（投影只给能收起的节点配收起策略，区域节点已换成锚）。
  - 所以工作台的 store 不加状态与诊断，在调用处注释写明不可达及理由；第三方从返回值拿到。
- 迁移：
  - 工作台：
    - `WorkbenchSurface.vue` 的 `onApplied` 把 `before.sizes` 一起发出（`gesture-commit` 事件加一个参数）；
    - store 的 `commitGesture(before, after, collapsed)` 改调 `applyGestureCommit`，`rebased` 改调 `rebaseForOperation`，删掉 `untouchedFixed`；`presented` 只留给可见标签的计算；
    - `layout-doc-store.test.ts` 的五处调用补上 `before`。
  - Lab 四个夹具：
    - `nb-layout/GridPanelsScene.vue`：`onApplied` 用第三个参数；
    - `WorkbenchSurfaceFixture.vue`、`editor-scene/EditorAreaFixture.vue`：接 Surface 的新事件；
    - 三处都改调这两个函数，删掉手写的回写。
    - 这是行为修正：三处今天都会写坏意图（见 Context）。

## Spec 与文档改动

- [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)：
  - 新输出（都标 planned）：
    - 147“收起与展开的入口”：`setCollapsed` 的语义、和 Enter 的区别、结果与失败；
    - 148“恢复尺寸谁收起谁记”：记什么、在哪记、按比例分的面板经 `setCollapsed` 不记；
    - 149“宿主的收起入口”：`host.setCollapsed`、没变化不 `invalidate`、进行中的手势、`onApplied` 不为它触发；
    - 150“提交前的布局”：`onApplied` 的 `before`；
    - 151“落账不写坏保留像素节点”。
  - 输出 20 加：没人能吸收时 Enter 保持展开，给 `no-room-to-collapse`；“记忆的恢复尺寸”链到 148。
- [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)：
  - 新输出 49“意图回写的两个入口”（planned）：`applyGestureCommit` 的四步、被拒的项跳过并交回；`rebaseForOperation` 不写保留像素的节点。
  - 输出 8 链到 49；实现合同的“公开入口”写上这两个名字，并写明 `rebaseIntents`、`fixedNodesOf` 不导出。
- 包内文档：
  - `grid.md`：`setCollapsed`、`restoreSize` 的维护者、落账不写坏保留像素节点；
  - `NestedGrid.md` 的“接入”：收起与展开写 `host.setCollapsed`；
  - `grid-types.ts` 里 `restoreSize` 的注释；
  - `nb-workbench-layout/README.md` 与 `layout-doc.ts` 头注释里“只有一条写入路径：`rebaseIntents`”改成两个入口；`layout-project.ts` 头注释里提到 `rebaseIntents` 的地方跟着改。

## 切片

1. **L1 核心**：
   - `setCollapsed`、`restoreSize` 的记录、落账不写坏保留像素节点、Enter 没人能吸收时保持展开；
   - `grid.test.ts`、`sash-drag.test.ts`；
   - `grid.test.ts:1184`“连按几轮不漂”改成记录后的行为（恢复到收起前的 400），另留一条从收起状态建树、恢复读 `restoreSize`（200）的用例。
   - 提交 `feat(nb-layout)`。
2. **L1 Vue**：
   - `host.setCollapsed`、`onApplied` 的 `before`；
   - `useGridHost.dom.test.ts`、`useGridLayout.dom.test.ts`、`NestedGrid.md`。
   - 提交 `feat(nb-layout)`。
3. **L2 与迁移**：
   - 两个函数与测试、入口不再导出 `rebaseIntents`、`fixedNodesOf`；
   - 工作台 Surface 与 store、四个 Lab 夹具。
   - `lab-grid-panels.e2e.ts` 加一条（先在迁移前跑，确认红）。
   - 提交 `feat(nb-workbench-layout)`。

每片自跑：nb-layout（或 nb-workbench-layout）的 `bun test` 与 `bunx vitest run`、应用 `bun run typecheck`；第 3 片另跑 store 测试与下面的 e2e。

## 验收映射

| Spec | 测试 |
|---|---|
| `ui/nested-grid` 输出 147 | `grid.test.ts`：<br>- 收起后布局与“同一棵树把标记翻了再建”相同；保留像素的兄弟不变、按比例分的吸收（审查 `exp/semantics.test.ts` 的那棵树）。<br>- 展开回到意图。<br>- 兄弟都到上限、都已收起时照样成功、守恒。<br>- 已是那个状态 `changed: false`。<br>- 失败三种：`not-found`、根、`not-collapsible`。 |
| 输出 148 | `grid.test.ts`：<br>- 拖宽后经拖动收起、经 Enter 收起，恢复回到收起前的尺寸；<br>- 保留像素的面板被压缩时记的是意图；<br>- 经 `setCollapsed` 收起保留像素的面板记意图，按比例分的面板不改；<br>- `restore()` 不给 `collapse` 时记下的值保留。 |
| 输出 149 | `useGridHost.dom.test.ts`：<br>- `host.setCollapsed` 后版本递增、布局重发、诊断经 `onIssues`；<br>- 没变化时版本不变；<br>- 没有网格时 `not-ready`；<br>- `onApplied` 不触发。 |
| 输出 150 | `useGridLayout.dom.test.ts`：`onApplied` 的 `before` 是提交前发布的布局，与之后的不同。 |
| 输出 151 | `grid.test.ts`：审查 `exp/compress.test.ts` 的复现，放宽后 c 回到 300；去掉这条规则会红。 |
| 输出 20 的补充 | `sash-drag.test.ts` 与 `grid.test.ts` 的手势会话：没人能吸收时 Enter 不改、给 `no-room-to-collapse`，`finish()` 没有提交。 |
| `ui/workbench-layout` 输出 49 | `nb-workbench-layout` 的 `layout-doc.test.ts`（真实 `projectLayoutDoc`）：<br>- api-03 的复现（审查 `exp/api03.test.ts`），去掉容差判定会红；<br>- 单分节区域拖到零记在锚上；<br>- 隐藏的区域拉开时清掉隐藏；<br>- 被拒的收起跳过、出现在 `rejected` 里，尺寸照常写回；<br>- `rebaseForOperation` 不写保留像素的节点。<br>`boundary.test.ts`：入口有两个新函数，没有 `rebaseIntents`、`fixedNodesOf`。 |
| 工作台的行为不变 | `layout-doc-store.test.ts`（补上 `before` 后原样通过）；e2e `workbench-shell`、`workbench-containers`、`workbench-views`、`editor-area`、`lab-workbench-surface`。 |
| Lab 的修正 | `lab-grid-panels.e2e.ts` 新加一条：窄视口拖编辑区之间的边界、放宽，左栏回到原宽；迁移前跑一次确认红。 |

## 验证

- 每片的单元测试与类型检查（见切片）。
- e2e：第 3 片之后跑上表六个文件（不到 8 个）；先看负载。
- 收口：`bun run test:affected --since master`。
- 未验证的边界：第三方在 `useGridHost` 之外直接调 `grid.setCollapsed` 又忘了 `invalidate()`，没有机检；只在 Spec 与 `grid.md` 写明。

## 不做与风险

- 不做 `toggleCollapse`：有 `setCollapsed` 加结果里的 `collapse` 就够了。
- 不给统一的“树变了”通知（审查第 7 条的另一种做法）：程序收起的调用方自己拿到结果。
- 不做分隔条双击重置（VS Code 有，`useSashGesture` 没有）：不在本 Task 范围。
- 行为变化：
  - 不带 `restoreToShare` 的面板，Enter 恢复回到收起前的尺寸，原来回到建树时给的值；
  - 被压缩、这次没动的保留像素节点的意图不再被写成压缩值；
  - 没人能吸收时 Enter 不再收起，原来预览收起、落账失败。
  - 仓库里只有 Lab 的网格夹具与 nb-layout 自己的测试走这几条路，工作台每次从投影重建网格。切片 1 用 `git grep restoreSize` 与 e2e 再核一遍。
- `rebaseIntents`、`fixedNodesOf` 从 nb-workbench-layout 的入口拿掉是不兼容的改动。这个包不在插件 SDK 里，仓库里的调用方本 Task 都迁移。

## 待确认

1. `setCollapsed` 只翻标记、按分配规则重排，和分隔条上 Enter 的“邻居让位、恢复到 `restoreSize`”分开写（推荐）。另一种做法是让它和 Enter 一样，但那样保留像素的邻居会被撑大，没人能吸收时还要另给一种结果。
2. `restoreSize`：保留像素的面板记意图，按比例分的面板记收起前的像素；经 `setCollapsed` 收起的按比例分的面板不记，要“恢复到合适的那一份”用 `restoreToShare`（推荐）。
3. `rebaseIntents`、`fixedNodesOf` 不再从 nb-workbench-layout 的入口导出，只留 `applyGestureCommit`、`rebaseForOperation`（推荐）。另一种做法是保留导出、把参数改成必填：调用方仍要懂“没动的保留像素节点”是什么。
