# t58 计划：结构操作能试做、树能复制

## Context

- **为什么做**：t50 摩擦记录第 1 组（条目 1、2、6、7、15、20、27、31，[friction.md](../t50-example-app/friction.md)）。标签编组与桌面两个示例为“这次拆分放不放得下”各写了一段“快照加读档复制一棵树、照做一遍、读 `over-constrained`”；桌面要按桌面叶父节点的形状在 `addLeaf` 与 `splitLeaf` 之间选，还要守“先加后删”，否则只剩一扇时会丢窗。开发者 2026-11-25 定按 t56 → t57 → t58 → t59 串行做（[Work README](../../README.md)）。
- **期望结果**：库有 `grid.clone()`（连策略与选项一起复制）、`restoreGrid`（不看结果拿不到网格）；`splitLeaf` 同向时并入父分支、可以“平分”，成了“在一块叶旁边插入”的唯一操作；根不再被展平成一块保留像素的叶；快照恢复与结构操作的层数计法一致。示例的复制、读档与平铺分支删短。
- **现状**（实测，探针 [`t58-probe/probe-output.txt`](evidences/probe-output.txt)，下文记作 P1 到 P9，P10 在 `probe-mixed-output.txt`；源码在 `/tmp/claude-1000/w00026-plans/t58-probe/`，入库时拷进本 Task 的 `evidences/`）：
  - P1：横排里横着拆，造出同向嵌套分支 `root[a, s1[b, c]]`；一直拆最后一块，第 15 次被拒（`Nesting too deep: 17 > 16`）。
  - P2：拆到放不下时 `splitLeaf` 返回 `{ok: true}`，`layout().issues` 里有 5 条 `over-constrained`（`min-total`、`leaf-min`）。
  - P3：17 层的快照 `restore` 成功，之后在根上 `addLeaf` 也被拒（`17 > 16`）；18 层才被恢复拒绝。`createGrid` 建 17、18 层的树都不查。`grid-snapshot.ts` 从 0 数（`:216` 的 `convert(envelope.root, 0, null)`、`:118` 的 `depth > GRID_MAX_DEPTH`），`grid.ts:162` 的 `treeScale` 从 1 数。
  - P9：树已超深（经 `createGrid`）时，浅处的 `moveLeaf` 也被拒：守卫取 `Math.max(scale.depth, 新深度)`（`grid.ts:483`、`529`、`623`）。
  - P4a：根 `[explorer 保留像素 240, group]` 删掉 group，根被展平成 explorer，宽 1200、没有诊断，`find("root")` 为 null（`grid.ts:146` 的 `collapse`）。P6：不展平时是 240 加 `unabsorbed-space`（960）。
  - P4b：中间分支展平：分支 id、约束、收起策略丢掉，留下的叶宽从 240 变 341.71（t52 已写进已知限制）。
  - P5：快照只有结构与意图；新网格只给 `{ref}` 恢复，保留像素、最小尺寸、收起都没了；原地恢复回落到当前树（`grid-snapshot.ts` 的 `currentConstraints`）。恢复失败而宿主不看结果，树仍是 null；新网格忘给 `sashSize`，缝是 0。
  - P7a：按比例分的目标，嵌套与并入的呈现只差缝的分摊（398.67 对 397.33）。P7b：兄弟意图全是 0 时，嵌套是 147、147、298；若把“目标为 0 取 1”搬到并入，兄弟 d 被压成 0；全 0 并入是三等分。P7c：窄容器里嵌套与并入一样。
  - P8：桌面第二扇，`addLeaf` 进横排是 400、400、400；`splitLeaf` 桌面叶（嵌套、0.5）是 602、299、299，即摩擦第 15 条的“只分到四分之一”。同向并入只改树形、不改这个份额。
  - P10：目标意图为 0、兄弟为正时目标呈现为 0；以平均一份作底数拆，两块各 199.33。
- **使用方**（`grep -rlE "\.(splitLeaf|addLeaf|removeLeaf|moveLeaf|restore|serialize)\(|createGrid\("`，去掉旧包与 dist 共 18 个文件，逐个看过，与网格无关的 5 个是 dev-panel、nb-harness、nb-history、agent 插件的同名方法）：
  - 调结构操作的只有：nb-layout 自己的测试；Lab `GridStructureScene`（同向拆分 `a`）、`StarterScene`（异向）、`LivePanelsScene`（拆与删，同向异向都有，复制时忽略了 `restore` 的结果）；`useGridLayout.dom.test.ts:398`（异向）；两个示例。
  - 工作台（`nb-workbench-layout`、`plugins/workbench/web`）只 `createGrid` 投影出来的树，不调结构操作、不调 `restore`；布局文档由 `layout-doc-validate.ts:55` 自己校验，根算第 1 层、上限 16。
  - nb-story 的 `book-grid.ts` 与 `BookFrame.vue` 只 `createGrid`、`setCollapsed`、`setSize`。插件 SDK 不重导出网格。
- **t52 的决定**（[plan.md](../t52-grid-structure-semantics/plan.md)）：增删移动不改兄弟的意图（输出 153）、结构操作不读布局（输出 154 的“不读布局”）；展平与拆分照旧，写成已知限制；“拆保留像素的叶要不要失败”交开发者。本计划守住前两条；对后两条的修订见“关键设计”第三、四节与待确认 1，并写明理由。
- **工作方式**：编码派 coder 子代理，主会话验收，不做逐 Task 的审查，t56 到 t59 做完整段交一次 omp。Spec 与 Task 记录由主会话在主工作区 master 上改；coder 在 worktree `.worktree/w00026-t58-grid-structure`（分支 `w00026/t58-grid-structure`，从 t57 合入后的 master 开）只改代码、包内文档、示例与测试。
- **版本**：0.3.0 的第一批不兼容改动（t59 也进 0.3.0），不发版；见待确认 3。

## 技术选型

无（纯 TS 的树操作，沿用 `grid.ts` 现有的写法）。

## 关键设计

### 试做的机制：只加 `grid.clone()`，不加 `canSplit`

一个机制：宿主在副本上照做一遍，读副本的结果与布局。不另加 `canSplit` 或“放不下就拒绝”的选项，理由：

1. 两个示例的试做都是组合操作：标签编组是“拆出新编组，再拿走标签、来源空了删叶”，桌面是“拆出窗叶，再删被换下的窗”。`canSplit` 只能回答一步。
2. 桌面还要副本上新叶的矩形作落点反馈的区域（`previewTile` 的 `area`），查询给不出来。
3. “放不放得下”要读布局（容器尺寸）；结构操作不读布局是 t52 定的原则（输出 154），给 `splitLeaf` 加容器尺寸会打破它。
4. “这次才放不下、原来就放不下的不算”是宿主的产品规则，库替它省不掉这两行。

### `packages/nb-layout/src/grid.ts`：`clone` 与 `restoreGrid`

- 把 `instantiate` 移到模块级（它不读闭包）；把 `createGrid` 的闭包体抽成内部的 `buildGrid<T>(initial: GridNode<T> | null, options: GridOptions<T>): Grid<T>`。`createGrid(root, options)` 等于 `buildGrid(root ? instantiate(root) : null, options)`，两个重载签名不变。
- `Grid<T>` 加方法：

  ```ts
  /**
   * 复制一份独立的网格（Spec 输出 164）：树、意图、约束、`sizing`、收起策略与状态，连同建网格时的选项（`sashSize`、`encodeRef`）。
   * 两份互不影响；`ref` 是同一个宿主对象，不复制。用在“先在副本上照做一遍、看结果与布局，再决定做不做”。
   */
  clone(): Grid<T>;
  ```

  实现：`buildGrid(tree ? copyTree(tree) : null, options)`，`options` 原样传给副本，所以以后给 `GridOptions` 加的项副本自动带上。
- 新导出的函数（`@experimental`）：

  ```ts
  /**
   * 从快照建一份新网格（Spec 输出 165）：结果不成功就没有 `grid`，宿主不看结果拿不到网格。
   * 策略与约束只来自 `resolveRef`（新网格没有当前树可回落）；要回落到当前树的，用原地的 `grid.restore`。
   * @experimental
   */
  export function restoreGrid<T extends string>(snapshot: unknown, resolveRef: GridRefResolver<T>, options?: GridOptions<T>): GridRestoredGrid<T>;
  /** @experimental */
  export function restoreGrid<T>(snapshot: unknown, resolveRef: GridRefResolver<T>, options: GridOptions<T> & {encodeRef: GridRefEncoder<T>}): GridRestoredGrid<T>;
  ```

  实现：`const grid = buildGrid<T>(null, options); const result = grid.restore(snapshot, resolveRef); return result.ok ? {...result, grid} : result;`。原地的 `grid.restore` 保留：它在当前树上回落约束与收起状态（输出 148，P5c），这是特性。
- 不加“快照带策略”（待确认 2）。

### `packages/nb-layout/src/grid-tree.ts`：`copyTree`

- 新增 `copyTree<T>(node)`：同 `cloneNode`，另把 `collapse` 拷一份（`{...node.collapse}`），`ref` 共用。只给 `clone` 用；`cloneNode` 不改（手势预览每帧调它，副本上改收起状态的写法已经是整个替换 `collapse`）。
- 不变量写进注释：节点上的策略字段都是纯数据（数、字符串、布尔，或这些组成的一层对象）；以后加了嵌套对象的字段要在这里拷。t59 改收起策略的形状（加“不能展开”、改 `restoreSize` 的来源）时，只要新字段是 `collapse` 上的标量，`clone` 不用改；测试用 `toEqual(原树)` 加“改副本不改原树”守住（见“测试”）。

### `packages/nb-layout/src/grid.ts`：`splitLeaf` 同向并入、平分、保留像素的目标

- **检查的先后**（失败都不改树）：`not-found` → `wrong-node-kind` → 目标保留像素 `wrong-sizing`（`params: {id, expected: "weight"}`，待确认 1）→ `orientation` → `side` → `branchId` 与新叶同 id → 两个 id 已被占用 → `ratio` → 规模守卫。`branchId` 照旧必填、照旧查重，并入时不用：成败不取决于树此刻的形状，宿主不用先看父分支。
- **`ratio`**：类型改成 `number | "even"`，缺省 0.5。不是 `"even"` 时照旧要有限（`not-finite`，`field: "ratio"`）且严格介于 0 与 1（`invalid-argument`，`field: "ratio-range"`）。
- **并入的条件**：目标有父分支，且 `split.orientation === hit.parent.orientation`。目标是根叶，或方向不同，照旧新建分支（现有代码不动，只多一处：`ratio === "even"` 时按 0.5）。
- **并入的做法**（`main = axisOf(parent.orientation)`）：
  - 新叶 `created = instantiate({...split.leaf, size: extentOf(main, 0, 0)})`，插在目标的前（`before`）或后（`after`），兄弟的意图都不动（输出 153）。
  - `ratio` 是数：底数 `base` = 目标在 `main` 上的意图，为 0 时取 `meanWeightShare(parent, main)`（P10：目标此刻呈现为 0，按平均一份拆两块才看得见）；目标改成 `base × (1 − ratio)`，新叶 `base × ratio`。这一支的意图全是 0 时 `base` 是 0，两块都是 0、与兄弟一起均分，`ratio` 不生效（P7b：不能沿用“为 0 取 1”，否则兄弟被压成 0）。
  - `ratio` 是 `"even"`：新叶取 `meanWeightShare(parent, main)`（插入之前算，含目标），目标不让。等于 `addLeaf` 不给意图（输出 153），桌面第二扇因此还是三等分（P8 的 400、400、400）。
  - 呈现与嵌套时一样把目标那份对半（P7a，只差缝的分摊、不到 2px），所以现有宿主看到的只是树变平、不再越拆越深。
  - 分隔线与过渡不受并入影响：渲染与过渡按两侧节点认分隔线（`grid-rects.ts:386` 的 key 是 `sash:${JSON.stringify([前, 后])}`，`grid-motion.ts:227` 按 `before`、`after` 找旧线），原来 a|b 那条线并入后仍是同一个元素、不会整排滑动；变的只是 `data-sash` 的序号（`分支 id:序号`，`NestedGrid.md` 的“分隔线的身份”早已写明结构变了序号会变）。
  - 同一分支里的序号随之后移：并入之后对这个分支按序号调 `moveLeaf`、`addLeaf` 的宿主，序号要按新的孩子数算（以前新叶在新分支里，不占父分支的序号）。CHANGELOG 写进同一条。
- **新叶保留像素**（`split.leaf.sizing: "fixed"`）：意图来自比例，单位不对，现在就有，不在本 Task 改，写进已知限制。
- **规模守卫**：并入加 1 个节点、深度不变；新建分支加 2 个、目标深度加 1（见下一节的守卫写法）。

### `packages/nb-layout/src/grid.ts`：根不展平成保留像素或可收起的节点

- 改 `collapse(parent, survivor)`（`grid.ts:146`）：`parent` 是根、`survivor` 保留像素（`sizing === "fixed"`）或带收起策略时，根分支留着、只剩这一个孩子（`tree` 不换）。别的情况照旧：根展平成按比例分、没有收起策略的孩子；中间分支照旧展平（t52 的已知限制不变）。
- 理由：根总是占满容器，展平之后保留像素的意图与收起策略都没了着落（P4a 的 1200 宽、`setCollapsed` 对根返回 `invalid-argument`）；留着根，布局照现有规则给 240 加 `unabsorbed-space`（P6），不需要任何继承规则。t52 否决的是“展平时继承尺寸”（快照、分轴约束、收起策略身份三处出问题），这里是“不展平”，不碰那三处。范围只到根，见待确认 4。
- 对标签编组：最后一个编组关掉后根留着、侧栏 240 宽；示例的“最后一个标签不能关”照旧保留（关完就没有能拆的编组），不算进省下的行数。

### `packages/nb-layout/src/grid.ts`、`grid-snapshot.ts`：层数的计法

- 统一成“根算第 1 层，最多 16 层”，与 `treeScale`、工作台的 `layout-doc-validate.ts` 相同。`grid-snapshot.ts` 改成 `convert(envelope.root, 1, null)`，判 `depth > GRID_MAX_DEPTH` 不变；消息改成 `The snapshot is nested deeper than 16 levels (the root is level 1)`。17 层的快照以前能恢复，现在 `limit-exceeded`。结构操作造不出 17 层，只有手写或外来的快照会有（P3）。
- 规模守卫只判这次操作新造出来的那一处，不再取整棵树的最大深度（去掉 `Math.max(scale.depth, …)`）：
  - `addLeaf`：`depthOf(parentId) + 1`；
  - `splitLeaf`：并入 `depthOf(targetId)`，新建分支 `depthOf(targetId) + 1`；
  - `moveLeaf`：`depthOf(parentId) + 1`，仍按移动前的树判（t52 写的“偏保守”不变）。
  - 节点数照旧按整棵树加这次新增的个数。`treeScale` 只剩节点数有用，改名 `countNodes`。
- 效果：经 `createGrid` 建了超深的树时，浅处的增删移动不再被拒（P3、P9），深处照旧拒。`createGrid` 本身照旧不查规模（宿主的记录先自己校验，工作台就是这样），写进 `grid.md`。

### `packages/nb-layout/src/grid-types.ts`、`grid-failure.ts`、`index.ts`

- `GridSplitInput.ratio?: number | "even"`，注释写两种的意思与“并入时的底数”。
- `Grid<T>` 加 `clone`；新类型 `GridRestoredGrid<T> = ({readonly ok: true; readonly grid: Grid<T>} & GridRestoreReport) | (GridFailure<GridRestoreFailureCode> & GridRestoreReport)`（`GridRestoreReport` 已有、不导出）。
- `GridFailureParams["wrong-sizing"]` 的 `expected` 改成 `"fixed" | "weight"`（待确认 1 不做时不改）。
- `index.ts` 的根入口清单加 `restoreGrid`（函数）与 `GridRestoredGrid`（类型），一行一个名字。新名字都标 `@experimental`（现有报告里没有 `@stable` 的符号，加引号重跑 `grep -rn '@stable' --include='*.ts' packages/nb-layout/src` 为 0）。
- `bun run --cwd packages/nb-layout api:report` 重写 `api/index.api.txt` 并提交；`GridSnapshot*` 不变，所以不碰工作台的 `LAYOUT_DOC_VERSION`（ADR 0054 第 10 条）。

### 示例：`packages/nb-layout/examples/{tabbed-panels,desktop}/src/model.ts`

改后的草稿已在 `/tmp/claude-1000/w00026-plans/t58-probe/examples-after/`（`*.diff`），coder 照它改：

- 两个 `clone()` 都换成 `new …(this.grid.clone(), …)`，注释改成一句“网格连同策略与分隔线宽度一起复制”。`canSplit`、`previewTile` 不动（“这次才放不下”的比较留在宿主）。
- 两个 `fromSaved` 换成 `restoreGrid(raw.grid, 解析, {sashSize: SASH_SIZE})`，之后 `const grid = restored.grid`。
- `policyFor` 的注释把“四处”改成“三处”（复制不再要策略表）。
- 桌面 `applyTile`：去掉 `parentOf` 与按父形状的三元，改成一次 `this.grid.splitLeaf(DESKTOP, {branchId: this.nextBranchId(), orientation: "horizontal", side, leaf: windowLeaf(id), ratio: "even"})`；“只剩一扇时先删会展平、`addLeaf` 找不到分支”的说明删掉，保留“先做会被拒的那一步”。`parentOf` 还给 `checkTree` 用，留着。
- 实测行数：标签编组 330 → 322（删 14 加 6），桌面 502 → 491（删 21 加 10）。摩擦记录写的“各约 30 行”是整段试做；省下的是复制与平铺分支这两块，试做本身的几行比较仍在。
- 示例的存档不用迁移：`restoreGrid` 不规范化，存档里旧的同向嵌套原样读进来（规范化会改掉已存的分支 id），之后的拆分才并入；桌面 `checkTree` 的锚点规则对新旧两种树都成立。只有 17 层的存档读不进来，示例自己造不出。

### 其它使用方

- Lab `LivePanelsScene.vue` 的 `copyOf`：换成 `grid.value.clone()`（现在忽略了 `restore` 的结果，场景没有策略所以没出事）。它的竖列里竖着拆（拖到 c、d 的上下边）会并入：嵌套时 c、新叶、d 是 1/4、1/4、1/2，并入后按比例分掉 c 那份；场景的叶都不给 `size`、全 0，所以是三等分（P7b）。`lab-live-panels.e2e.ts` 只断言 `c:right` 与 `b:top` 两种落点（都是异向，不变）。
- Lab `GridStructureScene` 的 `split-before`：同向，并入成 `root[n, a, b, c]`，`branchId: "a-split"` 不再出现。`lab-grid-structure.e2e.ts:166` 的 `[data-sash='a-split:0']` 改成 `[data-sash='root:0']`（n 与 a 之间）。同文件别的用例逐个看过：`:61` 是“拆分、关闭、换位”，`close-new` 之后才 `move-to-end`，那时以前也已展平成 `root[a, b, c]`，结果不变；`:373`、`:405` 的 `move-to-end` 前没有拆分；其余用 `root:0`、`root:1` 的用例不拆分。异向路径的 e2e 由同文件的“起步例子”一例（竖着拆 editor）覆盖，不加场景动作。
- `StarterScene`、README 起步例子、`useGridLayout.dom.test.ts:398`：异向，不变。
- 工作台、nb-story、插件 SDK：不受影响（见 Context）。`nb-workbench-layout/src/layout-doc.ts:6` 的注释说“`createGrid` 的结构操作语义不动：现有宿主和测试依赖它只塌陷单子分支”，coder 核对一句是否仍准确，不准就改注释（不改行为）。
- nb-story 的网页读 nb-layout 的产物，字节会变；要不要同批提 nb-story 的版本由开发者在发版时定（`docs/standards/releasing.md` 的“阶段与版本”）。

## 测试

改在 `packages/nb-layout/src/grid.test.ts`，期望值手算（容器取“意图之和加缝”，呈现与意图一一对应），不从实现抄：

- 新增 describe“拆分叶：同向并入（输出 160、161）”：
  - 横排 `[left 300, editor 700]` 横着拆 editor、`ratio 0.25`、`before`：树是 `root[left, added, editor]`，`find(branchId)` 为 null；容器 1002 时呈现 300、175、525；left 的意图不变。
  - 并入不加深：同向连拆 20 次都成功，树深保持 2（对照 P1 的第 15 次被拒）。
  - `branchId` 与已有 id 重复时并入也 `duplicate-id`，树不变。
  - 兄弟全 0：拆后三块等分（`ratio` 不生效）；目标 0、兄弟为正：两块各得平均一份的一半（P10 的 199.33 换成手算的整数容器）。
  - `ratio: "even"`：并入时新叶取平均一份、目标意图不变（第二扇三等分）；新建分支时等于 0.5。
  - `ratio` 写别的字符串：`not-finite`，`value` 是那个字符串。
  - 保留像素的目标：同向与异向都 `wrong-sizing`（`expected: "weight"`），树不变（待确认 1）。
- 改现有用例（前提被并入推翻，列旧值与新值进 Task README）：
  - `:715`“side=before …”：改成新建分支的情形（竖着拆），保留“两半按 ratio 分掉目标原本的分配”；横着拆的数字移到上面的新用例。
  - `:761`“拆分后的树可按快照往返”：`resizeOne(restored, "pair", …)` 改成竖着拆、`axis: "height"`，或在根上调整；数字按新树手算。
  - `:774`“节点数与深度上限”：节点数那半改成异向拆分（加 2 个，255 → 257 被拒），另加并入在 255 个节点时成功、256 个时被拒；深度那半的链改成竖着拆 `deep-end`（横向链里竖着拆才加深）。另加：经 `createGrid` 建的 17 层树，在根上 `addLeaf` 成功、在最深处拆分被拒；浅处的 `moveLeaf` 成功（P3、P9）。
- 快照（输出与失败 7）：16 层恢复成功；17 层 `limit-exceeded`（新增，以前能恢复）；`:848` 的 18 层照旧被拒。
- 根不展平（输出 163）：`[explorer 保留像素 240, group]` 删 group：根还是分支、`find("root")` 在，explorer 呈现 240，`issues` 有 `unabsorbed-space`；按比例分但带收起策略的幸存者同样留着根；`:527` 删到只剩按比例分的叶时根变成叶，照旧通过（不改）。
- `clone`（输出 164）：`clone().root()` `toEqual` 原树、`serialize()` 相等、`layout()` 相等（含 `sashSizes`，证明 `sashSize` 带过去）；对象 ref 用 `encodeRef` 建的网格，副本能 `serialize`；副本上 `splitLeaf`、`setCollapsed`、`setSize` 之后原树逐值不变，反过来也一样；副本叶的 `ref` 与原树是同一个对象（`toBe`）。
- `restoreGrid`（输出 165）：成功时有 `grid`、`dropped`、`clamped`，`sashSize` 来自选项；失败（坏快照、版本不认识）时没有 `grid`、带 `dropped` 与 `clamped`；解析只给 `{ref}` 时节点是按比例分、没有约束（新网格没有当前树可回落，对照原地 `restore` 的回落）。类型层面用一处 `// @ts-expect-error` 读失败分支的 `grid`。
- 码表用例（`:1688` 起）：`splitLeaf` 加 `wrong-sizing`（`expected: "weight"`）与 `ratio` 为字符串的 `not-finite`。
- 示例测试：
  - `src/examples-tabbed-panels.test.ts:83`“拆分被库拒绝时”：`splitWithTab("b", "group-1", "right")` 与后面的 `canSplit("b", "group-1", "right", WIDE)` 两处都改成 `"bottom"`（`group-1` 的父 `split-2` 是横向，往右拆会并入、永远到不了上限，`checked` 为假）；层数循环照旧，恢复上限变成根算第 1 层后，被拒发生在更浅的一档。
  - `src/examples-desktop.test.ts:152`：标题“加到分支的头或尾，三块平分”改成写行为“第二扇在桌面叶另一侧，三块平分”，断言不变。
- 变异检查（主会话验收时做，先提交再改，恢复用 `git show HEAD:<文件> > <文件>`）：并入改回嵌套，新并入用例红；`"even"` 改成按 0.5，平分用例与桌面三等分红；根例外去掉，根不展平用例红；`copyTree` 改成共用 `collapse`，“改副本不改原树”红；恢复改回从 0 数，17 层用例红。

## Spec 与文档改动

### `docs/specs/ui/nested-grid.md`（主会话在主工作区写，planned；编号取写入时末尾之后，t57 占了 158、159，下面从 160 起）

新增：

> 160. **拆分：同向并入**：`splitLeaf` 的方向与目标叶的父分支相同时，新叶插进这个父分支、挨着目标（`before` 在前、`after` 在后），不新建分支；`branchId` 照样要合法、不重复，只是没用上。目标是根叶或方向不同时照旧新建分支（验收 7）。并入时新叶与目标分掉目标在父分支主轴上的意图：底数是目标的意图，为 0 时取这一支的平均一份（输出 153 的规则）；新叶得底数乘 `ratio`，目标留下其余；这一支的意图全是 0 时两块都取 0，和兄弟一起均分。兄弟的意图不动（输出 153）。并入不加深，只加一个节点（planned）。
>
> 161. **拆分：平分**：`ratio` 可以是 `"even"`：并入时新叶取这一支的平均一份（同输出 153 的“按比例分的新叶”），目标的意图不动；新建分支时等于 0.5（planned）。
>
> 162. **拆分：保留像素的目标**：目标叶保留像素时 `splitLeaf` 返回 `wrong-sizing`（`expected: "weight"`），树不变：它的意图是像素，新叶与目标都分不到有意义的份额（planned）。
>
> 163. **根不展平成保留像素或可收起的节点**：增删或移动之后根分支只剩一个孩子、它保留像素或带收起策略时，根分支留着；布局照常（保留像素的照旧呈现，余下留白并给 `unabsorbed-space`）。其余只剩一个孩子的分支照旧换成这个孩子（planned）。
>
> 164. **复制网格**：`grid.clone()` 交回一份独立的网格：树、意图、约束、`sizing`、收起策略与状态，连同建网格时的选项（`sashSize`、`encodeRef`）。之后改其中一份，另一份的树、快照与布局都不变；叶的 `ref` 是同一个宿主对象（planned）。
>
> 165. **从快照建网格**：`restoreGrid(snapshot, resolveRef, options)` 按失败 7 校验快照，成功时交回 `{ok: true, grid, dropped, clamped}`，失败时是失败 7 的形状、没有 `grid`。约束、`sizing` 与收起策略只来自 `resolveRef`；原地的 `grid.restore` 照旧回落到当前树（输出 148）（planned）。

修改（逐条标在提交说明里）：

- 失败 5 码表：
  - `limit-exceeded` 的“什么时候”改成“这次操作会让节点数超过 256，或让新加、移动的叶落到第 16 层之下（根算第 1 层）”；
  - `wrong-sizing` 的“什么时候”加“拆分的目标叶保留像素”，`params` 的 `expected` 写成 `fixed` 或 `weight`；
  - `not-finite` 的比例写成“比例不是有限数也不是 `"even"`”。
- 失败 7 码表 `limit-exceeded`：加“根算第 1 层”。
- 验收 7 改成两句：“Given 任一侧的叶，When 沿与父分支不同的方向拆分并调整新 sash，Then 新分支继承原外部分配、两个子叶按比例分掉原意图，外层另一侧尺寸不变；When 沿父分支的方向拆分，Then 新叶并进父分支、与目标按比例分掉目标的意图，兄弟不变、树不加深；重复身份、非法比例、保留像素的目标与节点、深度上限被拒绝且树不变。”
- 实现合同：
  - 不变量“拆分叶只开放比例”加半句“同向时并进父分支（输出 160）”；
  - 公开入口那句的常用名单加 `clone`、`restoreGrid`。
- 实现后（收口）：去掉 planned；“合同测试”一行补输出 160 到 165。

### 包内文档（coder 在 worktree）

- `packages/nb-layout/src/grid.md`：
  - “拆分叶”整节重写成新建分支与同向并入两段、`ratio` 两种写法与底数、保留像素的目标失败、层数计法；删掉“深度的计法与快照恢复差一层（已知问题）”。
  - 新增一节“复制与试做”：`clone` 复制什么、`ref` 共用、试做的写法（副本上照做、读结果与 `layout().issues`）。
  - “快照与引用”：`restoreGrid` 是从存档建网格的推荐写法，原地 `restore` 的回落；层数从 1 数。
  - “已知限制”：
    - 展平一条加“根例外”；
    - “拆分保留像素的叶”一条删掉，改写进“拆分叶”一节：目标保留像素时返回 `wrong-sizing`（随包文档不引 Spec 编号）；
    - 加“拆分时新叶保留像素，意图来自比例，单位不对”；
    - 加“`createGrid` 不查规模”。
- `packages/nb-layout/README.md`：
  - “我要做 X”表：“保存与恢复”改成 `grid.serialize()`、`restoreGrid(快照, 解析引用, 选项)`，加一行“先试一遍再决定做不做”：`grid.clone()`；
  - “约定”的恢复示例改用 `restoreGrid`；
  - “层数与节点数的上限”改正：拆分、插入、移动按“这次新造出来的一处”判，恢复超过 16 层整体拒绝，`createGrid` 不查；
  - “窗口太窄不报错”补“想先知道，在 `grid.clone()` 上照做一遍读它的 `issues`”。
  - `readme.test.ts` 会核对名字。
- `packages/nb-layout/CHANGELOG.md` 的 `[Unreleased]`：
  - `### 不兼容的改动`：
    - `splitLeaf` 同向并入；
    - 拆保留像素的叶返回 `wrong-sizing`；
    - 快照恢复根算第 1 层，17 层的快照被拒；
    - 根只剩保留像素或可收起的节点时不展平。
  - `### 新增`：`grid.clone()`；`restoreGrid` 与 `GridRestoredGrid`；`ratio: "even"`。
  - `### 修复`：超深的树里浅处的增删移动不再被规模上限拒绝。

## 切片

0. **主会话，开工前**：
   - 在主工作区写 Spec 的 planned 条目与修改，单独提交；
   - 在起点上跑一遍“验证”里的 e2e 清单记作基线；
   - 拷探针进 `evidences/`。
1. **结构语义**（关键设计的并入、平分、保留像素的目标、根不展平、层数计法；`grid-types.ts`、`grid-failure.ts`）：
   - 改 `grid.test.ts` 的拆分、结构、快照、码表用例；
   - 改 `src/examples-tabbed-panels.test.ts:83`；
   - Lab：`GridStructureScene` 不改，只改 `lab-grid-structure.e2e.ts:166` 的选择器；
   - 自跑：`bun run --cwd packages/nb-layout typecheck`、`bun test packages/nb-layout/src/grid.test.ts packages/nb-layout/src/examples-tabbed-panels.test.ts packages/nb-layout/src/examples-desktop.test.ts`；
   - 提交。
2. **复制与从快照建网格**（`buildGrid`、`clone`、`copyTree`、`restoreGrid`、`index.ts`）：
   - 新用例进 `grid.test.ts`；
   - 跑 `api:report` 并提交 `api/index.api.txt`；
   - 自跑：`typecheck`、`bun test packages/nb-layout/src/grid.test.ts packages/nb-layout/src/exports.test.ts`、`bun run --cwd packages/nb-layout api:check`；
   - 提交。
3. **示例、使用方与文档**：
   - 两个示例的 `model.ts`；`examples-desktop.test.ts:152` 的标题；`LivePanelsScene.vue` 的 `copyOf`；
   - `grid.md`、README、CHANGELOG；
   - 版本：`packages/nb-layout/package.json` 提到 `0.3.0`，三个示例的 `@notnotype/nb-layout` 改成 `^0.3.0`（`examples.test.ts` 核对）。`scripts/release/pack-smoke.ts` 从示例的 `package.json` 读版本（`:276-281`），不改。改完在仓库根跑 `bun install`：根 `bun.lock` 记着工作区包 nb-layout 的版本（`"version": "0.2.0"`），`bun.lock` 有变化就进同一个提交，否则冻结安装与发版演练的“`bun.lock` 干净”检查会拦下。示例不是工作区成员（经根 `node_modules` 的工作区链接读源码，`scripts/examples.ts` 开头），不在示例目录里装依赖；
   - 自跑：`bun run --cwd packages/nb-layout test`（bun 与 vitest，含 `readme.test.ts`、`examples.test.ts`）、`typecheck`（含示例的类型检查）、`bun run --cwd packages/neuro-book typecheck`；
   - 提交。
4. **主会话收口**：
   - 跑“验证”；变异检查；
   - 主工作区 Spec 去掉 planned、补证据；Task README 记旧值与新值、偏离计划之处；
   - 合入；t52 README 的遗留问题标为“t58 定了”。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 160、161、162 | `grid.test.ts`“拆分叶：同向并入”；`examples-desktop.test.ts` 的第二扇三等分；`lab-grid-structure.e2e.ts` 的拆分与过渡 |
| 输出 163 | `grid.test.ts` 根不展平 |
| 输出 164 | `grid.test.ts` 的 `clone`；`examples-tabbed-panels.test.ts`、`examples-desktop.test.ts` 的试拆与“试做不改原来的模型” |
| 输出 165 | `grid.test.ts` 的 `restoreGrid`；两个示例的存档与读档测试 |
| 失败 5（`limit-exceeded`、`wrong-sizing`、`not-finite`） | `grid.test.ts` 的上限与码表用例 |
| 失败 7（`limit-exceeded`） | `grid.test.ts` 快照的 16、17、18 层 |
| 验收 7 | `grid.test.ts`；`lab-grid-structure.e2e.ts`（同向的 `split-before`、异向的起步例子） |

## 验证

- 单测与类型：
  - `bun run --cwd packages/nb-layout test`；
  - `bun run --cwd packages/nb-layout typecheck`；
  - `bun run --cwd packages/nb-layout api:check`；
  - `bun run test:affected`（会带上 `nb-workbench-layout` 与 `nb-story` 的受影响测试）；
  - `bun run --cwd packages/neuro-book typecheck`；
  - `bun run --cwd packages/nb-workbench-layout typecheck`；
  - `bun run --cwd packages/nb-story typecheck`。
- e2e，合入前跑一次（5 个文件）：
  - 示例：`bun run --cwd packages/nb-layout test:e2e`，先构建全部示例，跑 `tabbed-panels.e2e.ts`、`desktop.e2e.ts`、`ide.e2e.ts`。ide 不受影响，脚本整份跑，不单独排除；
  - 应用：`lab-grid-structure.e2e.ts`、`lab-live-panels.e2e.ts`，先按 `docs/testing/README.md` 重建三份产物。
  - 跑之前看负载。
- 实施中改动后只重跑：
  - 改了示例只重跑对应的一份：`bun scripts/examples.ts build` 之后 `npx playwright test -c e2e/playwright.config.ts <文件>`；
  - 改了 Lab 选择器只重跑 `lab-grid-structure.e2e.ts`。
- 发布冒烟一次：第 3 片提交后，工作树干净时 `prox bun run release:smoke`。它把示例照第三方的装法装到这次的包上，类型检查并构建；示例用了 `clone`、`restoreGrid`，只有它证明发出去的包里有这两个名字。
- 未验证的边界：
  - 在真实工作台里布局的样子不受影响，这一条从代码推断（工作台不调结构操作），不跑工作台 e2e；
  - 开发服务上的手感不看（没有界面改动）。

## 不做与风险

- 不做：
  - `canSplit` 与“放不下就拒绝”的选项（见“试做的机制”）；
  - 快照带策略（待确认 2）；
  - 中间分支的展平规则（t52 的已知限制照旧，待确认 4）；
  - 拆分时新叶保留像素的单位问题；
  - 读档时规范化旧的同向嵌套；
  - `createGrid` 查规模；
  - t56、t57、t59 的范围：`restoreSize`、`setCollapsed` 通知、`host.setSize` 都不碰。
- 风险：
  - **自己写宿主、同向 `splitLeaf` 之后按 `branchId` 找新分支或按序号操作父分支的第三方，结果会变**：仓库里只有 `lab-grid-structure.e2e.ts:166` 按分支 id 取分隔线。CHANGELOG 写明“同向时不新建分支，要按叶找；父分支的序号多了一位”。分隔线的元素身份按两侧节点，过渡不受影响（见“`splitLeaf` 同向并入”）。
  - **并入后约束的算法有差别**：嵌套时新分支的最小值是两块之和，并入后各算各的。窄容器下压缩可能不同；P7c 的一例相同，没有穷举，由现有 e2e 的拆分用例兜底。
  - **与 t59 撞文件**：`grid.ts`、`grid-types.ts`、`grid.md`、CHANGELOG。t59 在 t58 合入后的 master 上开分支。`clone` 靠 `copyTree` 拷 `collapse`，t59 若给策略加嵌套对象，要同改 `copyTree`；它的 `toEqual` 用例会提醒字段漏拷，不会提醒共用。
  - **Spec 编号与 t56、t57 撞**：编号按写入时的末尾顺延，计划与测试名里的编号在第 0 片写完 Spec 后统一替换。

## 待确认

1. **拆保留像素的叶直接失败**（t52 交开发者的问题）。推荐失败：
   - 返回 `wrong-sizing`、`expected: "weight"`，同向异向都一样；
   - 嵌套时现在就画错（t52 实测：导航高只剩约 1），并入时像素乘比例会被当成份额，两种都没有正确的结果；
   - 仓库里没有拆保留像素的叶的调用方。
   - 不同意时：同向遇到保留像素的目标照旧新建分支（今天的行为），写进已知限制。
2. **快照带策略**：推荐不做。
   - Spec“副作用与数据”写明运行期约束来自当前宿主，旧快照里的约束不能覆盖新版宿主；
   - ADR 0054 第 10 条：改快照格式要同批给工作台写 `LAYOUT_DOC_VERSION` 迁移；
   - 内存里的复制已由 `clone` 解决；
   - 收起状态存什么属于 t59 的“展开回到哪”。
3. **版本在 t58 提到 0.3.0**：推荐提。
   - 示例要用新名字，范围就得是 `^0.3.0`，`examples.test.ts` 要求它接得住包自己的版本；
   - 按发版手册，提了版本号就是“这个包这次发”。t59 合入之前发应用版本的话，0.3.0 会只带 t58 发出去。
   - 推荐在 Work README 写一句“nb-layout 0.3.0 等 t59 合入再发”；真要在中间发版时，接受 t58 单独成 0.3.0、t59 进 0.4.0。
4. **根例外的范围**：推荐只管根。
   - 中间分支展平的信息丢失（P4b）照旧是 t52 的已知限制。
   - 更一般的“展平会丢东西就不展平”能顺带消掉那条限制，但会让树里留下单孩子分支、改变更多宿主看到的树形；等有使用方撞到再定。
5. **`ratio: "even"` 的形状**：推荐放在 `ratio` 上（`number | "even"`），一个字段、没有两个字段谁优先的规则。
   - 对照 VS Code 的 `Sizing.Split` 与 `Sizing.Distribute`（同一个参数两种值）。
   - 不加它的话，桌面仍要按父形状在 `addLeaf` 与 `splitLeaf` 之间选，摩擦第 15、27 条删不掉。
6. **`restoreGrid` 加不加**：推荐加。
   - 第 31 条的主要现场（示例复制、Lab `copyOf`）由 `clone` 消掉了；
   - 第三方从存档读布局仍会写“`createGrid(null)` 加 `restore`”，忽略结果时自动保存会拿空树或缺省布局盖掉原件；
   - `restoreGrid` 不看结果就拿不到网格，代价是多一个导出；原地 `restore` 保留。
