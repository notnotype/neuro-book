# t27 计划：一个容器一张卡片、切换容器滚过去、右栏与底部面板的入口条

第 2 稿（2026-11-16，按评审页第 3 版重写）。第 1 稿按“一节一张卡片、几节各自连在活动栏上”写，开发者在第 2 版上否了，作废。

## Context

开发者 2026-11-16 试用 t25 后要的：活动栏切换容器做成上下滚动；底部面板、右栏也像活动栏一样切换容器、左右滚动；侧栏和活动栏连在一起。三版评审页（[`container-switch`](artifacts/container-switch/index.html)）定下的，编号同 [README](README.md)：

1. `switch-1` 甲：切换时整个容器滚过去，470ms、布局曲线（`--motion-layout`、`--ease-layout`）；滚到一半又点，从这一刻接着滚。
2. `indicator-1`：入口的选中标记和内容同时滑过去。
3. `join-2` 否：几节各自连在活动栏上的画法不要。
4. 底部面板的一个标签（容器）下面可以有几节，左右并排（现有合同，输出 25 第 7 行）。
5. `card-3`：侧栏、底部面板、右栏一个容器一张卡片，卡片之间照旧是缝；卡片里几节之间是开放式分割线（1px，沿长轴两端各缩进 10px，不碰卡片边，旧外壳 [`ui/workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md) 输出 38 的画法）。编辑组照旧一组一张卡片。
6. `strip-3` 甲：右栏、底部面板的入口条是卡片顶上一行，切换时不动；当前容器只有一节时，那一节的标题与动作并进这一行。
7. 第 3 版“直接做”：侧栏整张卡片一直和活动栏相连，切换时整张卡片上下滚、两个容器之间隔一条缝；底部面板、右栏的卡片与顶上一行不动，里面的内容左右滚；方向跟着入口条；点当前容器的入口是隐藏区域；区域隐藏或拖到零时点别的入口按显示长出来、不滚；减少动态效果直接换；平铺主题没有缝和圆角、线照旧；隐藏显示同 t25 的丙。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、20、22、42、44 到 47；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“过渡”；[ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md)。

约束：开发者 2026-11-16 定 nb-layout 要做成可复用的通用布局工具、以后发 npm（t26）。这次往 nb-layout 里加的只有宿主驱动的“交换”过渡；区域、容器、卡片怎么拼、入口条都在工作台。

## 技术选型

无。滚动用现有的过渡机制（`useGridMotion` 的 CSS 过渡，`left`/`top` 加 `clip-path`），选中标记是一个元素的 `transform` 过渡。

## 关键设计

### 一个容器一张卡片：`web/shell/adjacency.ts`、`web/components/WorkbenchSurface.vue`

- 卡片仍按叶画（扁平渲染器一块叶一个外框），几块叶拼成一张：`CardInput` 加 `groupOf(id): string | null`，宿主给工具面板所在的区域；同组、相邻的两块叶之间的边是相连（`joined`：不留缝、两角不圆）。不同区域的工具面板挨着（底部面板与右栏）照旧是两张卡片。只有两个区域时用组区分，按几何判不出来，所以要宿主给。
- 活动栏与侧栏：侧栏整张卡片和活动栏相连，就是贴着活动栏的每一块叶都相连（整列都在同一组里，组内没有缝，不会出现第 2 版那种缝通到活动栏边上的样子）。条件从“同一个分支的兄弟”改为“左邻是活动栏、在侧栏组里、宽度大于零”。
- 圆角按角算：一个角圆当且仅当它两侧的边都不相连。`shapeOf` 与卡片样式从“左右两侧相连”改为四个角各自给（写成卡片上的四个 CSS 变量，内容外层的裁切用同一组）。
- 分割线：`sashKindOf` 只把同组两侧之间的线算作 `panes`；`panes` 取 `--shell-pane-divider`、两端缩进 `--shell-pane-divider-inset`（已有）。nbook 的 `--shell-pane-divider` 从透明改回 `var(--divider)`（t25 第 4 条改成透明，理由是一节一张卡片，现在不成立）；不同组之间的线照旧取 `--shell-seam`（卡片主题透明）。
- 投影与外框：浅色是一层淡投影，深色是一圈 1px 外框（`--shell-card-shadow` 的 `0 0 0 1px`）；几块叶拼成一张时，相连的边上不能有。改为卡片的投影由一个伪元素画，四边各自伸出去，相连的那一边不伸（伪元素的 `inset` 按边给）。活动栏和侧栏相连处现在的画法跟着统一。
- 活动栏与侧栏之间的短线（`data-shell-join-seam`）照旧画在活动栏上，一条，两端离顶底 10px。

### “角接过去”扩到整列：同上

- `capLeaf` 换成一组：这一刻按形状裁、和活动栏相连、正在缩回去或刚连上的那几块（整列）。每块都往左伸过活动栏的一个圆角加半缝、伸出去的部分是活动栏的底色（`GridLeafShape.fill`）；最上面一块的右上角、最下面一块的右下角是圆的，其余的角在组内本来就是直的。组内没有缝，伸出去的部分连成一条，和只有一节时一样，不需要第 1 稿的“压扁中间的角”。
- `freshlyJoined` 同样换成一组；切换容器（整列换成另一列）不算刚连上。

### 交换过渡：`packages/nb-layout/src/grid-motion.ts`、`vue/useGridMotion.ts`、`vue/NestedGrid.vue`

- 新属性 `swap`（宿主驱动，通用）：`{node: string; axis: "width" | "height"; direction: 1 | -1; token: number} | null`：下一次布局变化里，`node` 下面换成另一组叶，旧的沿 `axis` 往 `-direction` 滑出去，新的从 `direction` 那边滑进来，都裁在 `node` 的矩形里。`token` 变了才算一次新的交换，之后第一次布局变化消费它，没有变化就作废。
- `grid-motion.ts` 加纯函数 `swapPlacements(items, previous, swap)`：离开的叶和它们之间的分隔线留着（`leaving`），终点是原位置平移出去“节点长度加一条缝”；新叶和新分隔线的起点是终点平移进来同样的距离；都带裁切矩形（`node` 的矩形换算成各自坐标里的 `inset`）。这一轮 `enteringRects`、`leavingPlacements` 对这几块不起作用。外框写 `data-swap="in" | "out"`，宿主按它决定这段时间画不画卡片的样子。
- 外框、内容外层、分隔线都用 `left`/`top` 加 `clip-path` 的 CSS 过渡，同一个时长与曲线，都在主线程，边对得上（t25 为了两条边同步把位置从 `transform` 换成 `left`/`top`，这里沿用）。已有 `leafShape` 裁切时按两者的交算（裁到的那一边内缩取大、圆角取 0）。
- 滚到一半又换：留着的叶从这一刻的位置接着走，新的接在这一刻看得见的最外面那一块后面，不跳、不叠。减少动态效果直接换；拖动中（`holding`）不交换。

### 切换容器时发 `swap`：`web/components/WorkbenchShell.vue`、`WorkbenchSurface.vue`

- 点入口切换（输出 22、47 的点击），区域这一刻可见、没在长出来时，提交前给 `swap`：`node` 是区域在呈现树里的节点（投影已登记）；侧栏 `axis: "height"`，右栏、底部面板 `axis: "width"`；`direction` 按入口顺序，新的在后面是 1。区域隐藏或拖到零时不发，按显示长出来（已有）。拖动落进入口、“移动到”、当前容器空了这些结构变化不发，照旧。
- 侧栏：整张卡片滚（外框带着卡片的样子），两个容器之间隔一条缝；活动栏、短线不动。
- 右栏、底部面板：卡片与顶上一行不动、里面的内容滚。交换的这段时间区域的卡片由宿主画一张静止的底（区域矩形、四角与投影照卡片），写着 `data-swap` 的外框不画底、投影、圆角，只带着头与内容滑；裁切矩形是卡片里顶上一行以下。

### 入口的选中标记：`web/components/WorkbenchToolStrip.vue`、新的区域入口条

- 活动栏的按下底色从每个按钮自己的底换成一个独立的块，位置是当前入口，`transform` 过渡，只在合成层；侧栏隐藏时淡出（`aria-pressed` 的规则不变）。底部面板标题的下划线、右栏图标的按下底色同样。当前入口总在外面（输出 22），收进“更多”时不发生。

### 右栏、底部面板卡片顶上一行：`web/components/WorkbenchSurface.vue`、`WorkbenchPanelHead.vue`、`web/state/layout-present.ts`、`WorkbenchShell.vue`

- 区域里有两个以上的容器时才有这一行；只有一个容器时头和现在一样（每节一个头）。
- 几何：不进布局树。区域顶上那几块叶（底部面板几节左右并排时是全部，右栏是最上面一节）的头让出这一行：`layoutContents` 的工具面板头高度改为按叶给（`toolHeadHeight(panel)`：这一行 32 加自己的头 32；当前容器只有一节时并成一行，32）。这一行由表面画在区域矩形的顶上，跨过几块叶，在外框之上、内容之下。
- 内容：右栏是容器图标（按下底色滑动），底部面板是容器标题（下划线滑动）；当前容器只有一节时后面接那一节的标题（右栏）与动作、框架按钮（两者都有）。几节时每节照旧有自己的头。
- 交互同活动栏：点入口不是当前容器就切换（发 `swap`），是当前容器就隐藏区域；右键与菜单键开容器的菜单（输出 44）；名称与悬停文字按输出 41；放不下时排在后面的收进“更多”，当前容器的入口总在外面；方向键在入口之间走。
- `layout-present.ts` 的 `containerEntries`、`toolEntryIntent` 推广到三个区域（`regionEntries(doc, region, …)`、`regionEntryIntent`），活动栏照旧用侧栏的。

### 入口条的拖放：同上，加 `web/layout-drag.ts`、`web/live-drag.ts`

- 右栏、底部面板顶上一行的入口条和活动栏上段一样是拖动源（输出 46）与落点（输出 45）：横着排，插入线是竖线，落在入口上是并入的高亮；复用活动栏的判定（`measureTabStrip` 按方向量）。只在这一行画出来时有。

### 一叶一张卡片的假设要盘点的地方

实施第 1 片时逐个过，结果写进 Task 记录：实时布局拿起一节（拿起的卡片四角都圆、带投影，剩下的几节重新拼成一张）、收成标题行的节（标题行一样拼进卡片）、显示隐藏时露出来的形状（`leafShape`，组内的边不留缝不圆）、落点分区与盖层（画在一节上，盖层的四角按这一节在卡片里的位置）、拖到零、最大化（最大化的一节自己一张卡片）、浮动窗（自己一张卡片，回停靠后拼进去）。

## Spec 与文档改动

开发者确认计划后、各片动手前写（条目级 planned，实现后补证据）：

- `docs/specs/ui/workbench-layout.md`：输出 19（一个容器一张卡片、开放式分割线、活动栏与侧栏整张相连、“角接过去”按整列、投影与外框在相连的边上没有）；输出 20（右栏、底部面板有两个以上容器时卡片顶上一行，只有一节时并成一行）；输出 22（选中标记滑动）；输出 42（切换动画：侧栏整张卡片滚，右栏、底部面板卡片不动、内容滚；接着滚、隐藏时不滚、减少动效）；输出 47（入口条的几何与交互）；验收场景补拼成一张卡片、滚动切换、右栏与底部面板切换。
- `docs/specs/ui/nested-grid.md`：“过渡”加交换。
- 组件说明：`WorkbenchSurface.md`、`WorkbenchToolStrip.md`、`WorkbenchPanelHead.md`、`NestedGrid.md`；主题变量说明（`--shell-pane-divider` 在 nbook 里重新画）。

## 切片

1. **一个容器一张卡片**：分组相连、四角、分割线、投影与外框、“角接过去”扩到整列，盘点一叶一张卡片的假设。验证：`adjacency.test.ts`、类型检查、e2e `workbench-containers`（t25 的逐帧像素用例扩到两节的侧栏）、`workbench-views`、`lab-workbench-surface`、`workbench-live-drag`；浅色与深色各截图看接缝。
2. **交换过渡、侧栏滚动切换、活动栏选中标记滑动**。验证：`grid-motion.test.ts`、`useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`、e2e `workbench-containers`（逐帧：两组都在区域里、区域外没有像素、接着滚、减少动效直接换）、`lab-nested-grid`。
3. **右栏、底部面板顶上一行与切换**：入口条、并成一行、点击与菜单、左右滚动（静止的底）、下划线与按下底色滑动。验证：`layout-present.test.ts`、`WorkbenchPanelHead` 的组件测试与 Lab 场景、e2e `workbench-containers`、`workbench-views`、`workbench-shell`。
4. **顶上一行的拖放**。验证：e2e `workbench-live-drag`、`workbench-dnd`。

每片单独提交、跑上面的验证；第 1 片之后、第 2 片之后在开发服务上给开发者看。

## 验收映射

- 输出 19（拼成一张卡片、分割线、相连、角接过去）→ `adjacency.test.ts`、e2e `workbench-containers` 逐帧像素、`lab-workbench-surface` 的分隔线种类用例。
- 输出 20（顶上一行）→ `WorkbenchPanelHead` 组件测试、e2e `workbench-views`。
- 输出 22（选中标记）→ e2e `workbench-containers` 逐帧读按下块的位置。
- 输出 42（滚动切换）→ `grid-motion.test.ts`、e2e `workbench-containers`。
- 输出 44 到 47（右栏、底部面板的入口条）→ `layout-present.test.ts`、e2e `workbench-containers`、`workbench-live-drag`。
- `ui/nested-grid` 的“过渡”（交换）→ `grid-motion.test.ts`、`useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；量动画时 `emulateMedia({reducedMotion: "no-preference"})`，放慢 `--motion-layout` 后停在几个时刻读像素（t25 的做法）。
- 开发服务上逐帧看三个区域的切换、侧栏几节的隐藏显示，浅色截图给开发者，深色自己看接缝。
- 未验证的边界：无头浏览器固定 60Hz。

## 不做与风险

- 不做：标签切换的动画（开发者没提）；拖动落进入口、“移动到”、当前容器空了引起的换容器不滚；编辑组的卡片画法。
- 风险：顶上一行不进布局树、靠给区域顶上的叶多让一行头来摆，几节左右并排时这一行跨过几块叶；分节被拖走、区域里只剩一个容器时这一行要同一次提交消失、头高跟着变，按“内容立刻让开、不过渡”（输出 21 的做法）处理。拖到这一行上的落点要和每节自己的头区分开（这一行是入口条，节的头是标题行）。
- 风险：交换时右栏、底部面板的“静止的底”是宿主另画的一张，换回外框自己画的那一帧要对得上（同一套四角与投影变量），第 3 片逐帧看。
- 风险：裁切用 `clip-path` 过渡，每帧重绘滑动的那几块；先在开发服务上量帧时间，超了再考虑合成层的做法。
- 风险：投影改由伪元素画，影响所有卡片（编辑组、浮动窗）；第 1 片对照改前改后的截图。
