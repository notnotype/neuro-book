# t52 计划：nb-layout 结构操作的语义（第 1 稿）

## Context

- **为什么做**：开发者 2026-11-22 定“原地增删不压固定栏、加设宽度的入口”（[t51 的“决定”](../t51-layout-api-gaps/README.md)）。t51 第 1 稿的设计审查与 API 形状审查（[设计](../t51-layout-api-gaps/evidences/design-review.txt)第 3、4、5 条，[API](../t51-layout-api-gaps/evidences/api-review.txt)第 4、5、6、7、8、10 条）实测出结构操作更多的老问题，一并在这里定。
- **现状**（审查与 t45 探针实测）：
  - `addLeaf`、`removeLeaf`、`moveLeaf` 经 `shiftSiblings`（`shareAxis`）把插进或拿走的意图摊给全部兄弟：保留像素的兄弟被改（导航 188 变 150），收起中的兄弟被写成 0，按比例分的意图被当成像素夹进最小尺寸（两块意图各 1、最小 80 的面板，插第三块后变成 80、80、1，呈现 259、259、80）。
  - 删到只剩一个孩子的分支被展平，留下的节点只拿到分支的 `size`，`sizing`、约束、收起策略都丢了（保留像素的侧栏变成按比例分）；`splitLeaf` 的新分支写死 `sizing: "weight"`，留下的固定叶落进新方向、意图 0.5。
  - 宿主改树只能逐步调 `grid.xxx` 再 `host.invalidate()`；忘了通知时画面不变、没有诊断。
- **调用方**：结构操作在仓库里只有 nb-layout 自己的测试与 Lab 的 `GridStructureScene`、`StarterScene` 在用（t51 的[探针](../t51-layout-api-gaps/evidences/probe.txt)）；工作台从布局文档重建网格，不受影响。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t52-grid-structure`（分支 `w00026/t52-grid-structure`）。只改 `packages/nb-layout/` 与两个 Lab 场景（若数值变了）及其 e2e。

## 技术选型

无。

## 关键设计：`src/grid.ts`

### 一、增删与移动不改兄弟的意图

- 节点的意图按它的 `sizing` 解释：保留像素的是像素，按比例分的是同一分支里按比例分的兄弟之间的相对份额（单位由宿主定，同一分支里一致即可）。份额本来就按比例分剩下的空间，插进或拿走一块之后自然重新分，不需要改兄弟。
- 所以 `addLeaf`、`removeLeaf`、`moveLeaf` 一律不改兄弟的意图：保留像素的兄弟不动（开发者的决定），按比例分的兄弟也不动（份额自然重分，审查实测的“被夹成 80”与“收起中被写成 0”都随之消失）。现在 `shiftSiblings` 只剩 `resize(id, axis, delta)` 在用，`resize` 的语义本 Task 不改（`grid.md` 写明它是意图单位的单节点入口）。
- 按比例分的新叶没给主轴意图（`size` 省略或主轴为 0）时，取这一支里按比例分的兄弟意图的平均值（平分一份）；一个按比例分的兄弟都没有时取 1。给了就照用，宿主要按兄弟的单位给（`grid.md` 写明）。
- 保留像素的新叶没给主轴意图时报 `invalid-argument`（`field: "size-missing"`）：现在静默成 0 宽（API 审查第 10 条）。建树（`createGrid`）同样核对。
- 跨方向移动（`moveLeaf` 到方向不同的分支）：被移动的节点在新主轴上没有正的意图时，按“按比例分的新叶”处理（改成按比例分、取平均份额）；有就照用。
- 输出：`ui/nested-grid` 新增条目 153。

### 二、展平与拆分继承尺寸规则

- 展平（删到只剩一个孩子、分支被它替换）：留下的节点继承被展平分支在父分支里的外部属性：`size`、`sizing`、`minimumSize`、`maximumSize`、`collapse`。它自己原来沿父轴的这些属性作废（它原来在分支里沿的是分支的轴）。
- `splitLeaf`：新分支继承目标叶的外部属性（同上五项）；目标叶与新叶在新分支里改成按比例分，按 `ratio` 分份额，约束沿新轴保留各自的（叶自己的 `minimumSize`、`maximumSize` 两个分量本来就分轴）。收起策略留在新分支上（收起的是“这一块”），目标叶不再带。
- 输出：新增条目 154。

### 三、设置保留像素节点的意图：`grid.setSize(id, px)`

- 只改这个保留像素节点沿父分支主轴的意图，兄弟不动；不读布局。收起中的节点同时把 `collapse.restoreSize` 改成新值（展开与分隔条上的 Enter 回到同一个宽度，设计审查第 5 条）。
- 返回 `{ok: true, changed, collapse?}`（`collapse` 同 `setCollapsed` 的结果形状，有收起策略时给）。
- 失败：`not-found`；根节点 `invalid-argument`（`field: "root"`，已有）；按比例分的节点新码 `wrong-sizing`（`params: {id, expected: "fixed"}`，码集合开放，ADR 0054 第 4 条）；非有限 `not-finite`（`field: "size"`）；负数 `invalid-argument`（`field: "size-negative"`）。现有 `GridFailureParams` 的 `not-finite`、`invalid-argument` 加这两种形状。
- 名字：轴是父分支的主轴，文档写明（竖向分支里设的是高度）；不叫 `setWidth`。
- 输出：新增条目 155；失败 5 的码表加 `wrong-sizing`，失败 6（提交的返回）原样转交。

### 四、宿主一次改多步：`host.update(edit)`

- `useGridHost` 加 `update(edit: (grid) => R): R`：回调里随意调网格的变更入口（结构操作、`setSize`、`setCollapsed`），返回后只发布一次布局、版本递增一次（进行中的手势结束）。没有网格时不调回调，返回 `not-ready` 的失败。
- 不另做 `host.setSize`：`host.update((grid) => grid.setSize(...))`。`host.setCollapsed` 保留（已有、已有宿主在用）。
- “直接改 `grid` 再 `invalidate()`”降为文档里的高级写法；开发模式检查（`setLayoutDevChecks`）加一条：手势开始时网格的意图与最近一次发布的布局对不上（宿主改了树没通知），警告一次。
- 输出：新增条目 156。

## 测试

- `src/grid.test.ts`：
  - 增删移动不改兄弟：保留像素与按比例分混排的分支里插进、拿走两种节点，兄弟意图逐值不变；收起中的兄弟不变；按比例分的新叶省略意图时取平均份额（三块平分插第四块，四块等分）；保留像素的新叶缺意图报 `size-missing`；跨方向移动。
  - 展平：保留像素的分支删到一个孩子，留下的节点是保留像素、带分支的约束与收起策略，呈现宽度不变；按比例分的分支同理。
  - 拆分：拆保留像素的叶，新分支保留像素、宽度不变；新分支带收起策略。
  - `setSize`：成功、`changed: false`、收起中的节点同步 `restoreSize`、各失败码。
  - 现有用例里按旧语义写的数值，逐处核对：只是兄弟意图不再被改的，改断言并在 Task README 列旧值与新值；改了呈现结果的，逐条说明。
- `src/vue/useGridHost.dom.test.ts`：`update` 只发布一次、版本递增一次；没有网格时 `not-ready`。
- 开发模式检查的新警告：`dev-checks.dom.test.ts` 一条。
- Lab：`GridStructureScene` 加一个保留像素的侧栏，插进、删掉一块，`lab-grid-structure.e2e.ts` 加一条在真实浏览器里侧栏宽度不变；原有用例按需更新数值。
- 回归：t51 在分支起点跑过的六个 e2e 文件（基线见 [t51 README](../t51-layout-api-gaps/README.md)）里与结构操作有关的 `lab-grid-structure.e2e.ts` 重跑；其余不调用结构操作，不重跑。

## Spec 与文档改动

- `ui/nested-grid`：新增输出 153 到 156（planned，实现后去掉）；失败 5 码表加 `wrong-sizing`、`size-missing`；“实现合同”公开入口加 `setSize`、`host.update`。
- nb-layout：`src/grid.md`（意图的单位、结构操作不改兄弟、展平与拆分继承、`setSize`、`resize` 照旧）、`src/vue/useGridHost.md`（`update`）、README 的“我要做 X”表与“约定”（意图的单位、`maximumSize` 的 0 是上限 0）。
- `CHANGELOG.md` 的 `[Unreleased]`：插件 SDK 不导出 `createGrid`，结构操作的变化插件够不着，不写。

## 切片

1. 意图规则（增删移动、缺意图、跨方向）与展平、拆分；单测；`grid.md`。
2. `setSize` 与失败码；`host.update` 与开发检查；单测；`useGridHost.md`、README。
3. Lab 场景与 e2e；收口：Spec 去掉 planned、Task README；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 153 | `grid.test.ts`；`lab-grid-structure.e2e.ts` 新用例 |
| 输出 154 | `grid.test.ts` |
| 输出 155 | `grid.test.ts` |
| 输出 156 | `useGridHost.dom.test.ts`、`dev-checks.dom.test.ts` |

## 不做与风险

- 不做：运行时改收起策略（开发者定的三样里没有，t45 重写计划时再看）；`resize` 的语义；离开的内容（t53）。
- 风险：
  - 按比例分的兄弟不再被改，宿主照旧语义给新叶“像素量级”的意图时，新叶会拿到比以前大的份额（以前兄弟被压小、新叶拿到它要的像素）。仓库里没有这样的调用方；`grid.md` 与 README 写清单位。
  - 展平改成继承分支的属性：快照里展平之后的节点属性变了，旧快照不受影响（快照存的是展平之后的结果）。
