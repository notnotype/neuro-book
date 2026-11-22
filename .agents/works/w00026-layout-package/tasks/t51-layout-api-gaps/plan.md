# t51 计划：nb-layout 补公开面（第 1 稿）

## Context

- **为什么做**：nb-story 是 nb-layout 的第一个外部使用方（ADR 0054 第 8 条）。t44（三栏换 `NestedGrid`）的接入记录与 t45（并排看卡片）三轮计划审查找出的缺口，开发者 2026-11-22 定先补库、再做 t45，并定三样都做（[Task README](README.md) 的“决定”）。
- **依据**：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)（输出 37、38 叶的过渡，82 到 92 内容层，147、148 收起与恢复，失败 5 结构操作的失败形状）；nb-layout 的 `src/grid.md`、`src/vue/NestedGrid.md`、`src/vue/Splitter.md`、`src/vue/useGridHost.md`、README；t45 的[结构探针](../t45-story-side-by-side-cards/evidences/structure-probe.txt)与三轮审查。
- **本 Task 前的探针**（[证据](evidences/probe.txt)）：
  - 结构操作在仓库里只有 nb-layout 自己的测试与两个 Lab 场景（`GridStructureScene`、`StarterScene`）在用；工作台与应用从布局文档重建网格，不调用它们。
  - 父组件缓存某个键最后一次的插槽 VNode、数据没了之后重用，子组件实例不卸载、状态还在，不再重用时才卸载（Vue 按同类型同属性打补丁，不更新组件）。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t51-layout-api`（分支 `w00026/t51-layout-api`）。只改 `packages/nb-layout/` 与两个 Lab 场景（及它们的 e2e）；工作台、nb-story 不改（nb-story 用新入口是 t45 的事）。ADR 0054 第 5 条：MIT 的包不从 AGPL 的代码搬内容，新机制在库里重写，不搬 nb-story 或应用的写法。

## 技术选型

无。

## 关键设计

### 一、结构操作不压保留像素的兄弟：`src/grid.ts`

- 现在 `addLeaf`、`removeLeaf`（与 `moveLeaf` 里的拿走、放进）经 `shiftSiblings` 把插进或拿走的意图按比例摊给全部兄弟，保留像素的兄弟也被改（t45 探针：插进一块抽屉，导航 188 变 150、旧抽屉 400 变 280，再删掉也回不去）。
- 改成：
  - 插进或拿走的是保留像素的节点：兄弟的意图都不动。按比例分的兄弟本来就按比例分剩下的空间，不用改意图；
  - 插进或拿走的是按比例分的节点：只有按比例分的兄弟按比例让出或吸收（同现在的 `shareAxis`，只是候选集合去掉保留像素的）；没有按比例分的兄弟时谁都不动；
  - 收起中的兄弟照旧参与（意图不变的规则对它们同样成立）。
- `splitLeaf` 不变（新分支继承目标叶的外部意图）；`removeLeaf` 删到只剩一个孩子时展平分支不变（`grid.md` 写明，宿主要一组栏常在就保留两个孩子或重建）。
- 输出：新条目 152。

### 二、设置保留像素节点的意图：`grid.setSize` 与 `host.setSize`

- `grid.setSize(id, px)`：只改这个保留像素节点沿父分支主轴的意图，兄弟不动；不读布局、不要容器尺寸。返回 `{ok: true, changed}`；失败 `not-found`、`wrong-node-kind`（按比例分的节点，`params.expected: "fixed"`）、`invalid-argument`（非有限或负数）、根节点（没有父分支）`invalid-argument`。收起中的节点改的是意图，展开时回到它。
- `useGridHost` 加 `host.setSize(id, px)`：同 `setCollapsed` 的写法，意图变了才重发布局、版本递增，进行中的手势结束。
- 不做“运行时改收起策略”的入口（t45 第 2 轮审查第 2 条提到两张时要去掉 `drawer` 的收起策略）：开发者这次定的三样里没有它；t45 重写计划时先看有了原地增删与 `setSize` 之后还要不要，要的话另提。
- 输出：新条目 153。

### 三、离开的内容项由库留到过渡结束：`src/vue/NestedGrid.vue`、`useContentLayer.ts`

- 现在内容项从 `contents` 里去掉就立即卸载（`order.items` 里没了），宿主要在关的过程中接着画，只能自己记着、留在 `contents` 里，再按 `moving` 去掉（t44 的 `paneDrawer`、t45 计划的 `closing`）。
- 改成：
  - 组件为每个内容项记下最后一次 `content` 插槽的 VNode。内容项从 `contents` 里去掉时，如果这次布局变化开了过渡（`moving` 为真），它变成“离开的内容”：留在渲染列表里，重用记下的 VNode（插槽不再调用，里面的组件实例不卸载、状态还在），按它原来那块叶这次的过渡摆放（叶缩回去或离开时跟着，同现在挂在缩回去的叶上的内容），带 `data-leaving`、`inert`，不接指针；
  - 这次过渡结束（`moving` 回到假）时卸载；没有开过渡（拖动落账、减少动态效果、矩形没动、`dragging` 为真）时当即卸载，同现在；
  - 离开中同一个 key 又出现在 `contents` 里：回到普通内容项，插槽照常调用；
  - 焦点在离开的内容里：照旧发 `content-parked`，宿主决定焦点去哪；
  - `lifted` 的那一项不走这条（它由宿主一直留在 `contents` 里，见工作台的写法），`swap` 里滑出去的内容照现在的交换规则走。
- 判定“这次布局变化开了过渡”放在网格判过渡的同一处（`useGridMotion` 的那一轮），不读宿主的状态。
- 宿主不用再读 `outgoingLeaves` 来留内容：`NestedGrid.md` 改写那一段，`outgoingLeaves` 仍保留给“按缩回去之前的样子画挨着的东西”（工作台的卡片）。
- 输出：新条目 154。

### 四、分隔线的显示名：`NestedGrid` 的 `paneLabel`、`Splitter` 的 `label`

- `NestedGrid` 加属性 `paneLabel?: (id: string) => string | undefined`：分隔线读屏名称里的相邻两块（`splitter.resizeWidth`、`resizeHeight` 的 `before`、`after`）取它的返回；没给、返回 `undefined` 或空串时用节点 id（同现在）。分隔线挨着的是分支时也问它（宿主给分支起名，或者不给、用 id）。
- `Splitter` 的面板配置加 `label?: string`，同样只用于读屏名称。
- 缺省不变：nb-story 的 `frame.e2e.ts`、工作台五个 e2e 与 `scripts/perf/layout-frames.ts` 按 id 匹配，宿主要用显示名时自己改。
- 输出：新条目 155。

### 测试

- `src/grid.test.ts`：插进与拿走保留像素的叶时兄弟意图不变（含收起中的兄弟）；插进与拿走按比例分的叶时只有按比例分的兄弟变；没有按比例分的兄弟时谁都不动；`moveLeaf` 跨分支同样；`setSize` 的成功、`changed: false`、各失败码；`setSize` 在收起中的节点上，展开回到新意图。
- `src/vue/useGridHost` 的 dom 测试：`host.setSize` 重发布局、版本递增；没变不发。
- `src/vue/NestedGrid.dom.test.ts`：离开的内容——过渡开着时去掉一项，它还在（`data-leaving`、`inert`）、里面组件没卸载、宿主再渲染也不卸载；过渡结束后卸载；减少动态效果时当即卸载；离开中同 key 回来变回普通项；焦点在里面时发 `content-parked`。happy-dom 里过渡的结束按组件真实的计时走（`--nb-layout-motion-layout` 设成很短的时长、等可观察的 `data-leaving` 消失），不用假计时器。
- `paneLabel`、`label`：`splitter.dom.test.ts` 与 `NestedGrid.dom.test.ts` 各一条读屏名称用显示名、不给时用 id。
- Lab：`GridStructureScene` 加“删一个带内容的叶”时的离开，`lab-grid-structure.e2e.ts` 加一条真实浏览器里逐帧看离开的内容还在、过渡结束后没了；`StarterScene`（与 README 一字不差）不改行为。
- 回归：动 `NestedGrid` 之前先在分支起点跑基线：`workbench-live-drag`、`workbench-dnd`、`editor-area`、`workbench-views`、`lab-grid-structure` 与 nb-story 的 `frame.e2e.ts`，以及 `scripts/perf/layout-frames.ts`；改完同一份再跑，对照。

## Spec 与文档改动

- `ui/nested-grid`：新增输出 152 到 155（planned，实现后去掉）；“失败与恢复”失败 5 的码表加 `setSize` 的几种；“实现合同”的公开入口加 `setSize`、`paneLabel`。
- nb-layout：`src/grid.md`（结构操作的意图规则、`setSize`、展平单孩子分支的提醒）、`src/vue/NestedGrid.md`（离开的内容、`paneLabel`、改写 `outgoingLeaves` 那段）、`src/vue/Splitter.md`（`label`）、`src/vue/useGridHost.md`（`setSize`）、README 的“我要做 X”表。
- `CHANGELOG.md` 的 `[Unreleased]`：插件 SDK 重导出 `NestedGrid`，新属性 `paneLabel` 与离开的内容属于“新增”；结构操作的语义变化插件够不着（SDK 不导出 `createGrid`），不写。

## 切片

1. 基线（e2e 与性能脚本）；结构操作的意图规则与 `setSize`、`host.setSize`，单测；`grid.md`、`useGridHost.md`。
2. 离开的内容由库留住，dom 测试与 Lab 场景、e2e；`NestedGrid.md`。
3. 显示名，dom 测试；`Splitter.md`、README。
4. 收口：Spec 去掉 planned、回归对照、CHANGELOG、Task README；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `ui/nested-grid` 输出 152 | `grid.test.ts` |
| 输出 153 | `grid.test.ts`、`useGridHost` dom 测试 |
| 输出 154 | `NestedGrid.dom.test.ts`、`lab-grid-structure.e2e.ts` |
| 输出 155 | `splitter.dom.test.ts`、`NestedGrid.dom.test.ts` |
| 输出 37、38、82 到 92 不退 | 回归的六个 e2e 文件与性能脚本对照基线 |

## 验证

见切片。未验证边界：触屏；120Hz。

## 不做与风险

- 不做：改收起策略的入口；工作台、nb-story 用这些新入口（t45 用）；`removeLeaf` 展平单孩子分支的行为。
- 风险：
  - 离开的内容重用缓存的 VNode：宿主在插槽里用了会变的闭包（例如事件处理读宿主的数据），离开期间它读到的是没了的数据。离开中的内容是 `inert` 的，不接指针也不能聚焦，事件进不来；写进 `NestedGrid.md` 的提醒。
  - 离开的内容挂在已经离开的叶上（叶也被删了）：按叶的离开摆放（`leavingPlacements`），dom 测试与 Lab e2e 都覆盖“删一个带内容的叶”。
  - 结构操作改语义：Lab 的 `GridStructureScene` 与 `lab-grid-structure.e2e.ts` 里按旧语义写的数值要跟着改，改的每一处在 Task README 里列出旧值与新值。
