# t27 计划：几节的容器与活动栏相连、切换容器滚过去、右栏与底部面板的入口条

## Context

开发者 2026-11-16 试用 t25 后要的三件（原话在 [README](README.md)）：活动栏切换容器做成上下滚动；底部面板、右栏也像活动栏一样切换容器，左右滚动；评审页上的附言要侧栏和活动栏连在一起。评审页 [`container-switch`](artifacts/container-switch/index.html) 两版的决定：

- `switch-1` 甲：整个容器滚过去，470ms、布局曲线（`--motion-layout`、`--ease-layout`）；滚到一半又点，从这一刻的位置接着滚。
- `indicator-1`：入口的选中标记（活动栏的按下底色、底部面板标题的下划线、右栏图标的按下底色）和内容同时滑过去。
- `strip-1` 乙：右栏、底部面板的入口条放进区域第一个分节的头里，不加新的一行、不进布局树。开发者答的是“先同意”，可以改。
- 几节的容器也和活动栏相连（会话里确认）。第 2 版 `join-2` 问的是几节相连时静止、切换、隐藏、显示的画法，**等开发者答**；只有第 1 片依赖它。
- 第 1 版页尾“直接做”的几条照做：方向跟着入口条（活动栏上下，右栏、底部面板左右；点后面的入口内容往前走）；只滚区域里的内容，入口条不动；点当前容器的入口是隐藏区域；区域隐藏或拖到零时点别的入口，按显示长出来、不滚；减少动态效果直接换；平铺主题照样滚。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、22、42、44 到 47；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“过渡”；[ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md)（右栏、底部面板的入口条“也一样”，几何当时留给第二步）。

约束：开发者 2026-11-16 定 nb-layout 要做成可复用的通用布局工具、以后发 npm（t26）。所以这次往 nb-layout 里加的只能是宿主驱动的通用件（一种“交换”过渡、形状的椭圆圆角）；区域、容器、入口条、活动栏相连都留在工作台。

## 技术选型

无。滚动、滑动都用现有的过渡机制（`useGridMotion` 的 CSS 过渡，`left`/`top` 加 `clip-path`），选中标记是一个元素的 `transform` 过渡；不引入动画库。

## 关键设计

### 几节相连：`packages/neuro-book/src/plugins/workbench/web/shell/adjacency.ts`

- 相连的条件从“和活动栏是同一个分支的兄弟”改为：叶在活动栏右边紧挨着的那个兄弟节点里（它就是和活动栏等长的那一列），左邻是活动栏，是工具面板，宽度大于零。一列里贴着活动栏的每一节都相连；同一列里并排在右边的不贴活动栏，照旧。拖到零、最大化（`maximizedCardEdges`）不变。
- 静止画法：每一节左边不留缝、左边两个角是直的；节与节之间的缝通到活动栏边上；活动栏右边不留缝、右边两个角是直的。

### 短线与“角接过去”：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchSurface.vue`

- 短线从活动栏的 `::after`（一条贯通全高的线）改为每一节自己画：相连的分节在左边画一条两端各缩 10px 的线（`--shell-join-divider`），切换时跟着节一起滚，缝里没有线。
- `capLeaf` 换成一组（`capLeaves`）：这一刻按形状裁、和活动栏相连、正在缩回去或刚连上的那几节（`freshlyJoined` 同样换成一组）。每一节都往左伸过活动栏的一个圆角加半缝、伸出去的部分是活动栏的底色（已有的 `GridLeafShape.fill`）。圆角：最上面一节的右上角、最下面一节的右下角是整圆（缩到零时成了活动栏的两个角）；节与节之间的那两个角横向半径是 `min(圆角, 50%)`（`clip-path` 圆角的百分比按外框宽算），缩到零时是直的。
- 活动栏的右边不再在开头一下子换成断开的样子：这段时间活动栏的卡片右边是目标值（隐藏是半缝、显示是 0），带同一个时长与曲线的过渡；缝里看得到的那一截因此跟着走，最多 2px。活动栏的内容框跟着卡片的右边走，图标最多挪 1px，不跳。
- 不画投影、短线淡出淡入，同 t25；`data-shell-cap` 留在活动栏上（去掉投影），短线的淡入淡出改到分节上。

### 形状的椭圆圆角：`packages/nb-layout/src/grid-rects.ts`、`vue/NestedGrid.vue`

- `GridLeafShape.radius` 的每个角可以写成 `{x, y}`（横、竖两个半径），`leafShapeClip` 拼成 `round <横> / <竖>`。通用件，宿主用它压扁中间的角。`NestedGrid.md` 与 `ui/nested-grid` 的“过渡”同步。

### 交换过渡：`packages/nb-layout/src/grid-motion.ts`、`vue/useGridMotion.ts`、`vue/NestedGrid.vue`

- 新属性 `swap`（宿主驱动，通用）：`{node: string; axis: "width" | "height"; direction: 1 | -1; token: number} | null`。意思是“下一次布局变化里，`node` 下面的叶换成另一组：旧的沿 `axis` 往 `-direction` 滑出去，新的从 `direction` 那边滑进来，都裁在 `node` 的矩形里”。`token` 变了才算一次新的交换；之后第一次布局变化消费它，没有变化就作废。
- `grid-motion.ts` 加纯函数 `swapPlacements(items, previous, swap)`：离开的叶（上一帧在 `node` 下、这一帧没有）留着（`leaving`），终点是原矩形平移出去一个“节点长度加一条缝”；新叶的起点是终点平移进来同样的距离；两组都带裁切矩形（`node` 的矩形，换算成各自外框坐标里的 `inset`）。这一轮 `enteringRects` 与 `leavingPlacements` 对这几块叶不起作用。
- 裁切与形状合起来：外框已经有 `leafShape` 的 `clip-path` 时，按两者的交算（裁到的那一边内缩取大、圆角取 0）。外框与内容外层都用 `left`/`top` 加 `clip-path` 的 CSS 过渡，同一个时长与曲线，都在主线程，边对得上（t25 为了两条边同步把位置从 `transform` 换成了 `left`/`top`，这里沿用）。
- 滚到一半又换：上一轮留着的叶从这一刻的位置接着走，新的接在这一刻看得见的最外面那一块后面（评审页的做法），不跳、不叠。
- 减少动态效果：直接换，没有留着的叶。拖动中（`holding`）不交换。

### 切换容器时发 `swap`：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue`、`state/layout-doc-store.ts`

- 区域的当前容器变了、区域这一刻可见且没在长出来：在同一次提交前给 `WorkbenchSurface` 一个 `swap`：`node` 是这个区域在呈现树里的节点（投影已登记），侧栏 `axis: "height"`，右栏、底部面板 `axis: "width"`；`direction` 按入口顺序（新的在后面是 1）。区域隐藏或拖到零时不发，按显示长出来（已有）。
- 其余换当前容器的路径（拖动落进入口、“移动到”、当前容器空了）照旧不滚：那些本来就是结构变化，Spec 输出 42 只规定点入口的切换。

### 入口的选中标记：`components/WorkbenchToolStrip.vue`、新的区域入口条

- 活动栏的按下底色从每个按钮自己的底换成一个独立的块，位置是当前入口，`transform` 过渡（`--motion-layout`、`--ease-layout`），只在合成层；侧栏隐藏时淡出（`aria-pressed` 规则不变）。当前入口收进“更多”时不会发生（输出 22：当前容器的入口总在外面）。

### 右栏、底部面板的入口条：`components/WorkbenchPanelHead.vue`、`state/layout-present.ts`、`WorkbenchShell.vue`

- `layout-present.ts` 的 `containerEntries`、`toolEntryIntent` 推广到三个区域（`regionEntries(doc, region, …)`、`regionEntryIntent`），活动栏照旧用侧栏的。
- 区域有两个以上的容器时，区域第一个分节（右栏是最上面一节，底部面板是最左边一节）的头在标题前画入口条：右栏是图标按钮（按下底色滑动），底部面板是标题（下划线滑动）；条后一条竖分隔线，再是这一节自己的标题。底部面板当前容器只有一节时不再写节的标题（入口就是标题）；右栏照写（图标没有字）。只有一个容器时不画入口条，头和现在一样。
- 点入口同活动栏（输出 22）：不是当前容器就切换（发 `swap`）；是当前容器就隐藏区域。右键与菜单键开容器的菜单（输出 44），可访问名称、悬停文字按输出 41。
- 头的宽度分配：入口条和标签带一样先让位（逐级收成只留图标、末尾“更多”），当前容器的入口总在外面；沿用 `WorkbenchPanelHead` 现有的让位规则，不另写一套。

### 入口条的拖放：同上，加 `web/layout-drag.ts`、`web/live-drag.ts`

- 右栏、底部面板的入口条和活动栏上段一样是拖动源（输出 46）与落点（输出 45）：横着排，插入线是竖线，落在入口上是并入的高亮。复用活动栏的落点判定（`measureTabStrip` 按方向量）。只在入口条画出来的时候有。

## Spec 与文档改动

开发者确认计划后、各片动手前写（条目级 planned，实现后补证据）：

- `docs/specs/ui/workbench-layout.md`：输出 19 的相连规则与“角接过去”的几节画法（等 `join-2`）；输出 22 的选中标记滑动；输出 42 的切换动画（滚动的方向、只滚区域内容、接着滚、隐藏时不滚、减少动效）；输出 47 写实入口条的几何与交互（第一个分节的头、图标与标题、只有一个容器时不画、点击与菜单、拖放）；验收场景补几节相连、滚动切换、右栏与底部面板切换。
- `docs/specs/ui/nested-grid.md`：“过渡”加交换；形状的椭圆圆角。
- 组件说明：`WorkbenchSurface.md`、`WorkbenchToolStrip.md`、`WorkbenchPanelHead.md`、`NestedGrid.md`。

## 切片

1. **几节相连**（等 `join-2`）：`adjacency.ts`、`WorkbenchSurface.vue`、nb-layout 的椭圆圆角。验证：`adjacency.test.ts`、nb-layout 单元测试与类型检查、e2e `workbench-containers`（扩写 t25 的逐帧像素用例到两节的容器）、`lab-workbench-surface`。
2. **交换过渡与侧栏滚动切换、选中标记滑动**：nb-layout 的 `swap`，工作台发 `swap`，活动栏的选中标记。验证：`grid-motion.test.ts`、`useGridMotion.dom.test.ts`、e2e `workbench-containers`（逐帧：两组节都在区域里、没有越出区域的像素、接着滚、减少动效直接换）、`lab-nested-grid`。
3. **右栏、底部面板的入口条与切换**：入口条、点击与菜单、左右滚动、标题下划线滑动。验证：`layout-present.test.ts`、`WorkbenchPanelHead` 的组件测试与 Lab 场景、e2e `workbench-containers`、`workbench-views`、`workbench-shell`。
4. **入口条的拖放**：验证：e2e `workbench-live-drag`、`workbench-dnd`。

每片单独提交、单独跑上面的验证；第 2 片之后在开发服务上给开发者看。

## 验收映射

- `ui/workbench-layout` 输出 19（几节相连、角接过去）→ `adjacency.test.ts`、e2e `workbench-containers` 逐帧像素。
- 输出 22（选中标记）→ e2e `workbench-containers` 逐帧读按下块的位置。
- 输出 42（滚动切换）→ `grid-motion.test.ts`、e2e `workbench-containers`。
- 输出 44 到 47（右栏、底部面板的入口条）→ `layout-present.test.ts`、组件测试、e2e `workbench-containers`、`workbench-live-drag`。
- `ui/nested-grid` 的“过渡”（交换、椭圆圆角）→ `grid-motion.test.ts`、`useGridMotion.dom.test.ts`、`NestedGrid.dom.test.ts`。

## 验证

- 每片按上面跑受影响的单元测试、类型检查与 e2e；e2e 量动画时 `emulateMedia({reducedMotion: "no-preference"})`，放慢 `--motion-layout` 后停在几个时刻读像素（t25 的做法）。
- 开发服务上逐帧录屏看三个区域的切换、侧栏几节的隐藏显示，浅色主题截图给开发者。
- 未验证的边界：深色主题只按变量推断；无头浏览器固定 60Hz。

## 不做与风险

- 不做：标签切换的动画（开发者没提）；拖动落进入口、“移动到”、当前容器空了引起的换容器不滚（结构变化，照旧）；平铺主题以外的主题单独调。
- 风险：`clip-path` 圆角里的 `min(圆角, 50%)` 要在 Chrome 里实测按外框宽解析；不行就由 NestedGrid 在过渡的每一帧算像素（多一份每帧写入），第 1 片先量。
- 风险：交换时外框已有的形状裁切和区域裁切取交，圆角处是近似（裁到的一边圆角取 0）；滑动的节两头被区域切掉时角是直的，和评审页一致。
- 风险：裁切用 `clip-path` 过渡，每帧重绘滑动的那几块；侧栏宽 300px 上下，先在开发服务上量帧时间，超了再考虑合成层的做法。
