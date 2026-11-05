# t06 计划：扁平渲染层

## Context

现在的 `NestedGrid` 递归渲染：一个分支一个 `Splitter`，叶在层层嵌套的 flex 容器里。树的结构一变，叶就换父元素或重建，滚动和焦点要靠 `teleport-memory.ts` 补救，也做不了外框滑动。

[布局提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 6 节定了：叶和分隔线放在同一父元素下，按矩形摆放。t02 的原型验证过可行。这一片把三处宿主（外壳、编辑器区、视图容器）都换上，树的形状和外壳的七个 Part 都不动，那是 t07。

合同：[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 新增的七条输出与验收 8、9。

代码在 `.worktree/w00026-t06-flat-renderer`，分支 `feat/w00026-t06-flat-renderer`。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 找一块里可聚焦的元素 | `tabbable`（`^6`，`focus-trap` 已把它带进 `bun.lock`） | 成熟，处理 `inert`、隐藏与 `details`。手写选择器漏这些。`nb-ui` 没有现成的 |
| Tab 顺序 | 布局层接管 | `reading-flow` 不在基线内，重排 DOM 原型实测滚动会丢（提案“备选与取舍”） |

`boundary.test.ts` 的 Vue 层规则加上 `tabbable`。

## 关键设计

### `packages/nb-layout/src/grid-rects.ts`（新，纯 TS）

```ts
export function placeGrid<R>(node: GridNode<R>, layout: GridLayoutResult, dpr: number): GridPlacement<R>;
export function stableOrder(previous: ReadonlyArray<string>, next: ReadonlyArray<string>): string[];
```

`GridPlacement` 有 `leaves`（叶与矩形）、`sashes`（分支 id、序号、轴、矩形、前后节点 id、两端挨着的分隔线）、`order`（树序，叶与分隔线交替）。

- 沿树走一遍累加位置，边按 `Math.round(edge * dpr) / dpr` 取整，宽高由边相减。分隔线占用不取整。
- 分隔线两端的连接搬自 `GridBranchRenderer.childEdges`，语义不变。
- `stableOrder`：还在的保持原顺序，新的排在最后。DOM 按它渲染，`v-for` 不会搬节点。

### `packages/nb-layout/src/vue/SashHandle.vue`（新，私有）

从 `Splitter.vue` 抽出分隔线元素：`role="separator"` 与 aria、`data-sash*`、两层装饰、`snapLines`、向 scope 登记。`Splitter` 和新的 `NestedGrid` 共用，只有定位不同。

`Splitter` 同时拿掉 `branchId`、`sashLineEnds`、`inject` 上层 scope 这条分支，只剩独立使用一种。令牌名 `--nb-splitter-seam*`、`--sash-line-*` 不变。

aria 的取值范围由 `grid-splitter.ts` 的 `buildGridBranchPanels` 与 `panelBounds` 给，按分支算一次。`gridBranchSizesPx` 没人用了，删掉。

### `packages/nb-layout/src/vue/NestedGrid.vue`（改内部，接口不变）

`node`、`layout`、`disabled`、`contextKey`、`revision`、`onGestureCommit`、事件和插槽都不变，名字也不变（SDK 导出它）。手势部分（`createGridGestureSession`、预览、提交）一行不动。删除 `GridBranchRenderer.vue`。

```text
.nb-nested-grid（relative，overflow: clip，aria-owns，data-grid-scope）
├─ .nb-grid-frame[data-leaf]（absolute，transform + 宽高，overflow: clip）× 按 stableOrder
│   └─ .nb-grid-leaf[data-leaf-content]（最终尺寸；<slot name="leaf">）
└─ SashHandle × 按 order
```

- `overflow: clip` 不用 `hidden`：`scrollIntoView` 滚不动 `clip`，否则内容里的滚动会把外框挪走。
- `data-leaf` 留在外框上，现有 e2e 量的是外框。内容容器另带 `data-leaf-content`。
- **过渡**：`watch(props.layout)` 判断这次变化的来源。手势进行中或刚落账、根的尺寸变了、第一次布局，都不过渡；其余给根写 `data-animating`，过 `--motion-layout` 毫秒后撤掉。样式只在 `[data-animating]` 下写 `transition` 与 `will-change`。令牌为 0（减少动态效果）时不写。
- **内容尺寸**：内容容器的宽高直接写目标矩形，外框才过渡。
- **停放**：记每块最后的非零尺寸；矩形在任一轴为零时内容用它，加 `visibility: hidden` 与 `inert`。

### `packages/nb-layout/src/vue/useGridFocusOrder.ts`（新，私有）

根上监听 `keydown`（冒泡阶段，内容先处理）：

- **Tab**：`defaultPrevented` 或带修饰键时不管。在这一项的 `tabbable` 列表里不是头尾时也不管。到头尾了就按 `order` 找下一项，聚焦它的第一个（Shift 时最后一个）。
- **走出最后一项**：`closest("[data-grid-scope]")` 找外层 grid。有就给事件打一个标记（模块内的 `WeakSet`）让它冒上去，外层见到标记当作走到头。没有就把焦点放到根里首尾的哨兵上，让浏览器从那里移到 grid 外。
- **F6**：同一套走法，只走叶，最外层绕回。用 `focusin` 记每块上次的焦点。

用 DOM 找外层而不是 `inject`：外壳的内容是 Teleport 进叶的，组件树上不在外层 `NestedGrid` 下面。

### `packages/nb-ui/src/tokens.css`

加 `--motion-layout: 470ms`、`--ease-layout: cubic-bezier(.23, 1, .32, 1)`，减少动态效果时归零。`docs/specs/theme/system.md` 同步。

### 宿主

- `WorkbenchShellLayout.vue`：Teleport 的目标从 `[data-leaf]` 改成 `[data-leaf-content]`，紧凑呈现的那几个 div 也加上。`revealZoneRects` 的原点从 `[data-splitter=root]` 改成 grid 根。
- `EditorArea.vue`、`WorkbenchViewContainerHost.vue`：不用改。

### 要守住的

- 手势的预览、提交与 scope 仲裁（`useSashGesture`）不动。分隔线元素还在，`collectSashHits` 照常量它们。
- 十字交汇、拖动收起与展开、悬停线两端相连，现有用例都不改断言。
- 叶换位置不重建：这是这一片的目的，要有用例。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/nested-grid.md` | 七条输出与验收 8、9（已写）；实现合同里“每个分支一个 Splitter”随实现改 |
| `docs/specs/theme/system.md` | 两个 motion 令牌 |
| `packages/nb-layout/src/grid.md`、`src/vue/NestedGrid.md` | 渲染一节 |
| `packages/nb-layout/AGENTS.md`、`docs/modules/monorepo-boundaries.md` | 依赖加 `tabbable` |

## 切片

开发者 2026-11-05 准许工作量大的部分按难度派 Haiku 或 Sonnet。子代理的 diff 我审，验证我自己跑。

| 片 | 内容 | 谁写 | 验证 |
|---|---|---|---|
| 1 | `grid-rects.ts` 与测试 | 主会话 | `bun test` |
| 2 | 抽 `SashHandle.vue`，`Splitter` 去掉 grid 模式（`NestedGrid` 暂时还递归，靠它传的 props 走一个过渡写法） | Sonnet | `splitter.dom.test.ts` 不改断言 |
| 3 | `NestedGrid` 扁平化、过渡、停放、令牌，删 `GridBranchRenderer` | 主会话 | `NestedGrid.dom.test.ts`、Lab 场景 |
| 4 | Tab、F6、`aria-owns` | 主会话 | 新 e2e |
| 5 | 外壳接线 | 主会话 | `workbench-shell.e2e.ts` |
| 6 | 测试的选择器迁移：`data-panel-id`、`data-splitter` 换成 `data-leaf` 或分隔线（`NestedGrid.dom.test.ts`、`useGridLayout.dom.test.ts`、`lab-nested-grid.e2e.ts`）；分支的尺寸改量子叶的并集 | Haiku（规则写死，有测试兜底） | 这三份 |
| 7 | e2e 里量几何的用例按测试规范等终态，改动多时派 Sonnet | 视失败量 | 全部外壳 e2e |
| 8 | 文档，实现审查（`reviewer` + Sonnet），可维护性与 API 形状审查（多个 Sonnet 按角度，t03 记录里排在 t06 之后） | 主会话 | `docs:check` |

第 2 片的过渡：`GridBranchRenderer` 这时还在，`branchId`、`sashLineEnds` 暂留到第 3 片删。第 2 片只抽组件，不改行为。

## 验收映射

| 编号 | 覆盖 |
|---|---|
| `ui.nested-grid` 新增的摆放、取整 | `grid-rects.test.ts` |
| 过渡、停放 | `lab-nested-grid.e2e.ts` 新增 |
| Tab、F6、读屏顺序 | `lab-nested-grid.e2e.ts` 新增，读屏用 `ariaSnapshot()` 看顺序 |
| 验收 8 | 验收场景加“换树”按钮，拆分与换位后核对实例编号、输入、滚动、焦点；`editor-area.e2e.ts` 加：向左拆分后左边的组不重建 |
| 验收 9 | `deviceScaleFactor: 1.25` 的上下文量缝宽；过渡中读内容尺寸与 `ResizeObserver` 次数 |
| 现有的十字交汇、拖动收起、悬停线、外壳几何、卡片外观 | 现有 e2e 不改断言 |

## 验证

- 外壳 e2e 的回归基线：w00032 已修好（`ae4433132`）。新写的外壳用例如果用 `test.sample-views`，`NBOOK_EXCLUDE_PLUGINS` 要带上 `nbook.agent`。
- 真实浏览器走一遍：开关侧栏与面板、拆编辑组、拖分隔线。
- **量一次重内容**：100k 字章节开着时开关侧栏，记单帧耗时，进 `evidences/`。提案要求量，但无头软件渲染的帧率不可靠（t02 的结论），所以只作记录，不设门槛。
- 开发者用真实窗口确认手感，这是 t07 之前的确认点。

未验证的边界：Tab 与读屏顺序只测 Chromium；没有真实读屏软件，只看无障碍树。

## 不做与风险

**不做：**

- **卡片外观按邻接算**：`cards.ts` 还按固定拓扑算，t07 换。
- **去掉外壳的 Teleport 与停放区**：t07 换成一棵树以后才去得掉。这一片外壳的内容照旧 Teleport 进叶。
- **视图内容、编辑器每标签一实例**：t07。
- **实时布局**：t08。这一片只有程序触发的外框过渡。
- **`NestedGrid` 改名**：SDK 导出它，不值得这时动。t07 定树的模型时再看。

**风险：**

- **`transform` 是 `position: fixed` 的包含块**：查过，产品里视图内容的 `fixed` 都 Teleport 到 `body` 了（拖影、对话框、菜单），Monaco 没开 `fixedOverflowWidgets`。第三方插件的视图里如果直接写 `fixed`，会相对外框定位，Spec 边界一节写明了。提案选了 `transform`，审查没提到这一点。
- **程序触发的布局变化多了 470ms 过渡**：这是用户看得到的变化。量几何的 e2e 可能在动画中途量到旧值，第 7 片处理。开发者觉得长了改令牌就行。
- **叶不再重建**：拆编辑组时原来的组以前会重挂，现在不会。如果某处靠重挂刷新状态（例如 `onMounted` 里读尺寸），会暴露出来，由 `editor-area.e2e.ts` 兜底。
- **Tab 接管是这一片第一次真实验证**：提案列为风险。验收里 Monaco、TipTap 都要走一遍。
