# t06 计划：扁平渲染层

## Context

现在的 `NestedGrid` 递归渲染：一个分支一个 `Splitter`，叶在层层嵌套的 flex 容器里。树的结构一变，叶就换父元素或重建，滚动和焦点要靠 `teleport-memory.ts` 补救，也做不了外框滑动。

[布局提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 6 节定了：叶和分隔线放在同一父元素下，按矩形摆放。t02 的原型验证过可行。这一片把三处宿主（外壳、编辑器区、视图容器）都换上，树的形状和外壳的七个 Part 都不动，那是 t07。

合同：[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 新增的输出与验收 8、9。设计审查的处理见 [`README.md`](README.md)。

代码在 `.worktree/w00026-t06-flat-renderer`，分支 `feat/w00026-t06-flat-renderer`。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 找一块里可聚焦的元素 | `tabbable`（`^6`，`focus-trap` 已把它带进 `bun.lock`） | 成熟，处理 `inert`、隐藏与 `details`。手写选择器漏这些。`nb-ui` 没有现成的 |
| Tab 顺序 | 布局层接管，只在 DOM 序与树序不一致时 | `reading-flow` 不在基线内，重排 DOM 原型实测滚动会丢（提案“备选与取舍”） |
| F6 | 走命令系统 | 布局层自己监听会绕开键位冲突检测，也进不了命令面板 |

`boundary.test.ts` 的 Vue 层规则加上 `tabbable`。

## 关键设计

### `packages/nb-layout/src/grid-rects.ts`（新，纯 TS）

```ts
export function placeGrid<R>(node: GridNode<R>, layout: GridLayoutResult, extent: GridExtent, dpr: number): GridPlacement<R>;
export function stableOrder(previous: ReadonlyArray<string>, treeOrder: ReadonlyArray<string>): string[];
export function nextFocusStop(input: FocusStopInput): {readonly stop: number; readonly edge: "first" | "last"} | null;
```

`GridPlacement`：`leaves`（叶、矩形）、`sashes`（分支 id、序号、轴、矩形、占用、前后节点 id、两端挨着的分隔线、分支主轴长度）、`order`（树序，叶与分隔线交替）。

- **取整**：沿主轴在设备像素上走，不对每条边各自取整。叶的终点 `round(end * dpr)`；缝的设备宽 `max(1, round(sash * dpr))`（占用大于 0 时）；下一块从“上一块的终点加缝宽”开始。否则缝 1px 在 dpr 1.25 下约 58% 的容器宽度两条缝不等（审查枚举）。前提是根的左上角在设备像素格上，外壳成立，内层 grid 的外框已取整。
- **交叉轴**取父分支的完整长度，不用 `layout.sizes` 的交叉轴：现在的 flex 是 `align-items: stretch`，叶带交叉轴上限时 `sizes` 比容器小。根的长度取 `extent`。主轴照 `sizes`，放不满时留空，与现在相同（`issues` 里有诊断）。
- **清洗**：非有限、负值当 0，防止 `translate(NaNpx)`。`sashSizes` 缺项取 1，与 `Splitter` 的 `DEFAULT_SASH_SIZE` 相同（`extent` 为 null 时布局是空的、树还在）。
- 分隔线两端的连接搬自 `GridBranchRenderer.childEdges`，语义不变。
- **`stableOrder`**：已有的叶保持相对次序，新叶紧接在树序里它前面的已有叶之后。Vue 带 key 的 `v-for` 在中间插入不搬已有节点（审查在 Chrome 里验证过），只有已有叶相对次序变化才会搬。所以拆分与关闭之后 DOM 序仍等于树序，只有换位置之后才不等。
- **`nextFocusStop`** 是 Tab 与 F6 共用的纯函数，输入是树序列表、当前项、方向、各项是否有可聚焦元素，跳过没有的；走完返回 null。

外壳的 `shellNodeRects` 与它算同一件事，这一片不合并（预备区仍用未取整的矩形，差不到一个设备像素），t07 换树时一起去掉。

### `packages/nb-layout/src/vue/SashHandle.vue`、`useSashSnap.ts`（新，私有）

从 `Splitter.vue` 抽出分隔线元素，`Splitter` 和新的 `NestedGrid` 共用，只有定位不同：

| 现有的 | 去向 |
|---|---|
| `role="separator"`、aria、`data-sash*`、两层装饰、向 scope 登记（含重挂保护） | 搬，不变 |
| 占用为 0：`--seam`、`aria-disabled`、`data-disabled`、`tabindex="-1"`、不渲染装饰 | 搬，不变 |
| `panelBounds`、`ariaMax` | 搬到 `grid-splitter.ts`；`ariaMax` 的上限由调用方给（`Splitter` 量自己，`NestedGrid` 用分支主轴长度） |
| `aria-controls` | 指向前一个叶的外框；前面是分支时指向分支里最后一个叶 |
| `data-state`、`.nb-grid-panel` | 仓库里没有读者，grid 里不再有 |
| `collapseMotion`、`[data-animating]` | `Splitter` 留着；grid 由下面的过渡接住（分隔线上的 Enter 现在也是瞬时的：`keydown` 时手势已激活，属性写不上，这一点不变） |
| `snapLines` 与窗口的 `resize`、捕获 `scroll` 监听 | `useSashSnap` 合并到父组件一份，一帧算一遍所有分隔线。否则监听数从分支数变成分隔线数，页面每次滚动都要读 6 次布局 |

`snapLines` 读 `getBoundingClientRect`，过渡刚开始读到的是旧位置，所以 `NestedGrid` 在过渡结束时再排一次。

### `packages/nb-layout/src/vue/Splitter.vue`

第 3 片拿掉 `branchId`、`sashLineEnds`、`inject` 上层 scope 这条分支，只剩独立使用。令牌名 `--nb-splitter-seam*`、`--sash-line-*` 不变。`gridBranchSizesPx` 没人用了，删掉。

公开面的变化（包还没发布，只有仓库内的使用方，写进 `NestedGrid.md`）：`grid-splitter` 少一个导出；`data-splitter`、`data-panel-id` 在 grid 里没有了；`data-leaf` 在外框上，过渡中会动。

### `packages/nb-layout/src/vue/NestedGrid.vue`（改内部，接口不变）

`node`、`layout`、`disabled`、`contextKey`、`revision`、`onGestureCommit`、事件和插槽都不变，名字也不变（SDK 导出它）。手势部分（`createGridGestureSession`、预览、提交）一行不动。删除 `GridBranchRenderer.vue`。

```text
.nb-nested-grid（relative，overflow: clip，data-grid-scope，不一致时 aria-owns）
├─ .nb-grid-frame[data-leaf="<id>"]（absolute，transform + 宽高，overflow: clip，过渡时 data-moving）× stableOrder
│   └─ .nb-grid-leaf[data-leaf-content="<id>"]（最终尺寸；<slot name="leaf">）
└─ SashHandle × order，key 是“前节点|后节点”，data-sash 仍是“分支:序号”
```

- `overflow: clip` 不用 `hidden`：`scrollIntoView` 滚不动 `clip`，否则内容里的滚动会把外框挪走。
- `stableOrder` 在 `computed` 里同步算：外壳在下一个 tick 找 Teleport 目标，只有这一次机会，新叶的外框必须在同一轮渲染里出来。
- 叶与分隔线的 DOM id 用 `useId` 加序号的不透明串：节点 id 可以含空格，`aria-owns` 按空白切分。
- `dpr` 是一个 `ref`，`resize` 与 `matchMedia("(resolution: …dppx)")` 的 `change` 更新。

**过渡**（按结果判定，不只看来源）：

1. 新矩形与正在显示的相同：什么都不做。
2. 手势进行中、刚落账（`watch(props.layout)` 里预览还被保持着）、根的尺寸变了（按 `layout.sizes[root.id]` 比，不靠 `ResizeObserver` 的回调，它晚一帧）、第一次布局：不过渡。外壳落账后还有第二次发布，矩形差不到 1px 时不过渡。
3. 其余给外框与分隔线写 `data-moving`，“最后一次开启后 `--motion-layout` 毫秒”撤掉，每次开启都重置。令牌为 0 时不写。
4. 手势开始、根尺寸变化、卸载时无条件撤掉：进行中的外框跳到终点，拖动没有拖尾。
5. 标记写在外框上，不写在根上：t08 拖动中要一部分动、一部分跟手。

**新叶与离开的叶**：新叶从挨着兄弟的那条边长出来（第一帧主轴宽度为 0，下一帧写终点，否则浏览器合并成一次样式更新，过渡不启动）。离开的叶立即消失，邻居滑过去填，不做延迟卸载。

**内容尺寸**：内容容器的宽高直接写目标矩形，外框才过渡。内层 grid 的 `extent` 只变一次，判为“根的尺寸变了”，不过渡。

**停放**：只看已发布的布局（`props.layout`），不看预览。否则拖过阈值又拖回来，内容会闪，焦点在拖动中途丢掉（外壳的“往零拖时等落账再停放”）。只有“曾经有过非零尺寸、现在为零”才停放：第一帧没有尺寸时不加 `inert`，否则 `onMounted` 里的 `focus()` 会静默失败。内容用最后的非零尺寸，`visibility: hidden` 加 `inert`。关闭叶时清掉记录。

### `packages/nb-layout/src/vue/useGridFocusOrder.ts`（新，私有）

只在 DOM 序与树序不一致时挂 `keydown` 与 `aria-owns`，平时全是浏览器原生行为。这一片里只有外壳改面板位置才会不一致。

- **Tab**：`defaultPrevented`、带修饰键、`isComposing` 或 `keyCode === 229`（输入法组字时 Tab 用来翻候选）时不管。`tabbable` 列表里不是头尾时不管；焦点元素不在列表里（`tabindex="-1"` 的容器）时用 `compareDocumentPosition` 判断在哪。到头尾了用 `nextFocusStop` 找下一项并聚焦。
- **走出最后一项**：焦点放到根里首尾的哨兵上（`tabindex="-1"`，`aria-hidden`），由浏览器移到 grid 外。外层 grid 同时也不一致这种双重情况不处理：这一片内层的 DOM 序总等于树序。
- `tabbable` 的 `displayCheck` 依赖真实布局，所以 Tab 只在 e2e 里测，`nextFocusStop` 用单元测试。

**明确不做**：从 grid 外面 Tab 进来、点击空白处后按 Tab，浏览器按 DOM 序走，根上的 `keydown` 管不到（审查在 Chrome 里复现）。这一片不一致只出现在外壳改面板位置之后，影响小。t07 之后不一致会很常见，要用 `focusin` 处理，已记到 t07 的记录里。

### `moveGridFocus` 与命令

`nb-layout/vue` 导出 `moveGridFocus(from: Element | null, direction: "next" | "previous"): boolean`：从 `from` 找最近的 grid（`closest("[data-grid-scope]")`，走树序不走 DOM 序），走到头就交给外层，最外层绕回。回到这块上次的焦点（grid 用 `focusin` 记，叶关闭时清），没有就是第一个可聚焦的元素。

工作台登记两条命令 `nbook.view.focus-next-pane`（F6）、`nbook.view.focus-previous-pane`（Shift+F6），键位走命令系统，有冲突检测，也进命令面板。走法要用 nb-layout 的 Vue 层，插件入口的类型检查不带 DOM，所以外壳挂上时把实现交给命令（`attachPaneFocus`）。F6 在浏览器里是聚焦地址栏，提案定了要用，取舍写进 Spec。

### `packages/nb-ui/src/tokens.css`

加 `--motion-layout: 470ms`、`--ease-layout: cubic-bezier(.23, 1, .32, 1)`，减少动态效果时归零。`docs/specs/theme/system.md` 没有列 motion 令牌，不用改。

### 宿主

- `WorkbenchShellLayout.vue`：Teleport 的目标从 `[data-leaf]` 改成 `[data-leaf-content]`（值是部件 id），紧凑呈现的那几个 div 也加上。`revealZoneRects` 的原点从 `[data-splitter=root]` 改成 grid 根。
- `WorkbenchShell.vue` 的放下收尾：`SETTLE_TRACK_FRAMES = 20` 改成按时间，上限是 `--motion-layout` 加一点余量。现在按帧数算，144Hz 下 140ms 就停，外框还在滑，覆盖层会淡出在半路。“连续两帧不变”的判据不变，它本来就能认出过渡结束。
- `EditorArea.vue`、`WorkbenchViewContainerHost.vue`：不用改。
- 拖动判定读 DOM 矩形（`drop-dom.ts`、`tab-drag.ts`）：过渡中拖动时量到的是中间矩形，每帧重判，只持续 470ms，接受。

### 要守住的

- 手势的预览、提交与 scope 仲裁（`useSashGesture`）不动。分隔线元素还在，`collectSashHits` 照常量它们。
- 十字交汇、拖动收起与展开、悬停线两端相连的行为不变。测这些的**行为**断言不改；测 `Splitter` 的 props、内联样式的改成读 DOM。
- 叶换位置不重建：这是这一片的目的，要有用例。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/nested-grid.md` | 新增的输出与验收 8、9（已写）；实现合同里“每个分支一个 Splitter”随实现改 |
| `docs/specs/workbench/commands.md` | 两条焦点命令 |
| `docs/testing/README.md` | e2e 默认减少动态效果，测动画的用例开回来 |
| `packages/nb-layout/src/grid.md`、`src/vue/NestedGrid.md` | 渲染一节、公开面的变化 |
| `packages/nb-layout/AGENTS.md`、`docs/modules/monorepo-boundaries.md` | 依赖加 `tabbable` |
| `.agents/works/w00026-layout-package/tasks/t07-single-tree/README.md` | 记：Tab 进入 grid 与点击空白后按 Tab 要在 t07 处理 |

## 切片

开发者 2026-11-05 准许工作量大的部分按难度派 Haiku 或 Sonnet。子代理的 diff 我审，验证我自己跑。审查后这一片没有适合 Haiku 的：测试迁移要判断每条断言是行为还是实现，不是规则替换。

| 片 | 内容 | 谁写 | 验证 |
|---|---|---|---|
| 1 | `grid-rects.ts` 与测试 | 主会话 | `bun test` |
| 2 | 抽 `SashHandle.vue`、`useSashSnap`，`Splitter` 内部改用它们，对外行为一字不变；grid 模式这一片不动 | Sonnet | `splitter.dom.test.ts`、`NestedGrid.dom.test.ts` 不改 |
| 3 | `NestedGrid` 扁平化，删 `GridBranchRenderer` 与 `Splitter` 的 grid 模式，外壳接线；三份测试（`NestedGrid.dom.test.ts`、`useGridLayout.dom.test.ts`、`lab-nested-grid.e2e.ts`）随之改 | 主会话 | 这三份、`workbench-shell.e2e.ts` |
| 4 | 过渡、停放、令牌、收尾；`playwright.config.ts` 默认 `reducedMotion: "reduce"`，测动画的用例开回来 | 主会话 | 新 e2e、全部外壳 e2e |
| 5 | Tab、`aria-owns`、`moveGridFocus` 与命令 | 主会话 | 新 e2e |
| 6 | 文档，实现审查（`reviewer` + Sonnet），可维护性与 API 形状审查（多个 Sonnet 按角度，t03 记录里排在 t06 之后） | 主会话 | `docs:check` |

## 验收映射

| 编号 | 覆盖 |
|---|---|
| 摆放、取整（缝 1、4、7px × dpr 1、1.25、1.5 枚举）、交叉轴、清洗、`stableOrder`、`nextFocusStop` | `grid-rects.test.ts` |
| 过渡（开启、不过渡的几种、连续两次、中途拖动、新叶长出）、停放（预览不停放、第一帧不停放） | `lab-nested-grid.e2e.ts` 新增，显式开动画 |
| Tab、读屏顺序 | `lab-nested-grid.e2e.ts` 新增，读屏用 CDP `Accessibility.getFullAXTree`（`ariaSnapshot()` 不反映 `aria-owns`，审查实测） |
| F6 | `workbench-shell.e2e.ts` 新增，经真实命令 |
| 验收 8 | 验收场景加“换树”按钮，拆分与换位后核对实例编号、输入、滚动、焦点；`editor-area.e2e.ts` 加：向左拆分后左边的组不重建 |
| 验收 9 | 单元枚举加一条 `deviceScaleFactor: 1.25` 的真实量缝宽；过渡中读内容尺寸与 `ResizeObserver` 次数 |
| 放下收尾 | `workbench-dnd.e2e.ts` 的收尾用例开动画跑 |
| 现有的十字交汇、拖动收起、悬停线、外壳几何、卡片外观 | 现有 e2e，行为断言不改 |

## 验证

- 回归基线：w00032 已修好外壳 e2e（`ae4433132`）。开工时先在最新 master 上跑一遍。新写的外壳用例如果用 `test.sample-views`，`NBOOK_EXCLUDE_PLUGINS` 要带上 `nbook.agent`。
- 真实浏览器走一遍：开关侧栏与面板、拆编辑组、拖分隔线。
- **量一次重内容**：100k 字章节开着时开关侧栏，记单帧耗时，进 `evidences/`。提案要求量，但无头软件渲染的帧率不可靠（t02 的结论），所以只作记录，不设门槛。
- 开发者用真实窗口确认手感，这是 t07 之前的确认点。

未验证的边界：Tab 与读屏顺序只测 Chromium；没有真实读屏软件，只看无障碍树；输入法组字时的 Tab 没有真实输入法，只测 `isComposing` 的分支。

## 不做与风险

**不做：**

- **卡片外观按邻接算**：`cards.ts` 还按固定拓扑算，t07 换。
- **去掉外壳的 Teleport 与停放区**：t07 换成一棵树以后才去得掉。`teleport-memory.ts` 这一片仍然需要。
- **视图内容、编辑器每标签一实例**：t07。
- **实时布局**：t08。这一片只有程序触发的外框过渡。
- **`NestedGrid` 改名**：SDK 导出它，不值得这时动。t07 定树的模型时再看。
- **主题切换不过渡**：换主题 `cardGap` 变，矩形差几个像素，会滑一下，不特判。

**风险：**

- **`transform` 是 `position: fixed` 的包含块**：查过，产品里视图内容的 `fixed` 都 Teleport 到 `body` 了（拖影、对话框、菜单），Monaco 没开 `fixedOverflowWidgets`。第三方插件的视图里如果直接写 `fixed`，会相对外框定位，Spec 边界一节写明了。
- **程序触发的布局变化多了 470ms 过渡**：这是用户看得到的变化。开发者觉得长了改令牌就行。
- **叶不再重建**：拆编辑组时原来的组以前会重挂，现在不会。如果某处靠重挂刷新状态（例如 `onMounted` 里读尺寸），会暴露出来，由 `editor-area.e2e.ts` 兜底。
- **e2e 默认减少动态效果**：可能有用例依赖默认的动画（例如资源树的展开动画），第 4 片逐个看。
