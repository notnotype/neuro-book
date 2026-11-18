# t27 计划：一个容器一张卡片、侧栏切换容器滚过去

第 4 稿（2026-11-17，按第 3 稿的第二轮设计审查改；审查与处理见 [README](README.md) 与 [`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）。第 3 稿的右栏、底部面板入口条（入口条叶、并成一行的头、左右滚动、下划线与按下底色滑动、入口条的拖放）拆到 [t28](../t28-panel-entry-strips/README.md)，第 3 稿原文在提交 `c56ab99a7` 的本文件里。第 1 稿按“一节一张卡片、几节各自连在活动栏上”写，开发者在评审页第 2 版上否了，作废。

## Context

开发者 2026-11-16 试用 t25 后要的：活动栏切换容器做成上下滚动；底部面板、右栏也像活动栏一样切换容器、左右滚动（拆到 t28）；侧栏和活动栏连在一起。三版评审页（[`container-switch`](artifacts/container-switch/index.html)）定下的，编号同 [README](README.md)：

1. `switch-1` 甲：切换时整个容器滚过去，470ms、布局曲线（`--motion-layout`、`--ease-layout`）；滚到一半又点，从这一刻接着滚。
2. `indicator-1`：入口的选中标记和内容同时滑过去。
3. `join-2` 否：几节各自连在活动栏上的画法不要。
4. 底部面板的一个标签（容器）下面可以有几节，左右并排（现有合同，输出 25 第 7 行）。
5. `card-3`：侧栏、底部面板、右栏一个容器一张卡片，卡片之间照旧是缝；卡片里几节之间是开放式分割线。编辑组照旧一组一张卡片。
6. `strip-3` 甲：右栏、底部面板的入口条是卡片顶上一行（t28）。
7. 第 3 版“直接做”：侧栏整张卡片一直和活动栏相连，切换时整张卡片上下滚；点当前容器的入口是隐藏区域；区域隐藏或拖到零时点别的入口按显示长出来、不滚；减少动态效果直接换；隐藏显示同 t25 的丙。
8. 开发者 2026-11-16 看过第 2 稿要点后同意，要求按 autonomous-delivery 推进。

滚动的样子照评审页的演示（`regionScroller`）：侧栏的裁切范围是整列（含上下的缝），一次滚“区域长度加一条缝”。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 19、22、42；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“过渡”。

约束：nb-layout 要做成可复用的通用布局工具、以后发 npm（开发者 2026-11-16，t26）。这次往 nb-layout 里加的两样都是通用的、由宿主驱动：分隔线的样式钩子（`sashStyle`，第 1 片已做）、交换过渡（`swap`）。区域怎么分组、卡片怎么拼都在工作台。

## 技术选型

无。滚动用现有的过渡机制（CSS 过渡，`left`/`top` 加 `clip-path`），选中标记是一个元素的 `transform` 过渡。

## 关键设计

### 一个容器一张卡片（第 1 片，已提交 `9bfd8b021`）

同组相邻的叶相连（`CardSide` 的 `joined` 带 `bar` 区分和活动栏相连，审查第二轮第 3 条）；整列和活动栏相连；四个角各自按两侧算；同组分隔线那 1px 由 `sashStyle` 画成卡片；“角接过去”扩到整列（`capLeaves`）。设计写在 `WorkbenchSurface.md` 与源码注释里，盘点结果在 README。

### 交换过渡：`packages/nb-layout/src/grid-motion.ts`、`vue/useGridMotion.ts`、`vue/NestedGrid.vue`

- 新属性 `swap`（宿主驱动，通用）：

  ```ts
  interface GridSwap {
      /** 变了才算一次新的交换。 */
      readonly token: number;
      /** 这次变化里离开的叶与换上来的叶（叶 id）。 */
      readonly leaving: ReadonlyArray<string>;
      readonly entering: ReadonlyArray<string>;
      readonly axis: GridAxis;
      /** 1：新的从终点那边（右、下）进来，旧的往起点那边出去。 */
      readonly direction: 1 | -1;
      /** 相邻两组之间多隔的距离（px）。 */
      readonly gap: number;
      /** 裁切窗：两组外接矩形的四边内缩（px，上右下左）与四角（CSS 长度）；不给就是外接矩形本身。 */
      readonly window?: {readonly inset: readonly [number, number, number, number]; readonly radius?: readonly [string, string, string, string]};
  }
  ```

  窗口的内缩用 px 数值：胶片的间距要在脚本里用窗口沿轴的长度（审查第二轮第 10 条）；圆角只进 `clip-path`，用 CSS 长度。
- 生效：在 `layers` 的那个 watcher 里判（不另开 watcher，免得和它谁先跑决定结果，第二轮第 5 条 C）。`token` 变了之后的第一次布局变化里：
  - `leaving` 只留上一帧在、有尺寸、这一帧不在的叶，`entering` 只留这一帧在、上一帧不在的叶，其余的 id 忽略（例如被放不下收走、没呈现出来的分节）；
  - 过滤后有一边是空的、上一轮交换之外的过渡还没完（区域在长出来、缩回去）、拖动中（`holding`）、减少动态效果，都不交换，照常过渡；前两种经 `issues` 事件交回一句原因（第二轮第 7 条）。
  - `token` 变化所在的那一轮刷新结束后（`nextTick`）不管用没用都作废，零写入的点击、被拒的提交不会把它留给后面不相干的布局变化。
- 窗口：`entering` 的终点矩形与 `leaving` 的上一帧矩形的外接矩形，按 `window` 内缩。每个参与的外框、内容外层、分隔线的 `clip-path` 是窗口在它自己坐标里的位置，和 `left`/`top` 同一个时长与曲线，所以窗口在网格里不动。
  - 起点（第二轮第 4 条）：`none` 到 `inset()` 不能过渡，开始那一帧给每个参与的元素写 `clip-path` 的起点（窗口在它起点坐标里的位置），下一帧写终点；`growing` 从“矩形”扩成“矩形加裁切”。`[data-moving]` 的 `transition` 列表加 `clip-path`。
  - 和已有裁切取交：外框的 `leafShape`、内容外层的 `byLeafClip`（`insetTop`）。每边取内缩大的，裁到的那边圆角取窗口的。
- 胶片（评审页 `regionScroller` 的模型）：参与交换的几组排成沿 `axis` 的一条带，相邻两组相距“窗口长度加 `gap`”，整条带一起平移。
  - 交换进行中又来一次（重定向）：在 `update()` 里读带上每一组此刻的位置（`getComputedStyle` 的 `left`/`top`，每次重定向读一次），作为 `decideMotion` 的输入（第二轮第 5 条 B）。只在重定向时读，平常的过渡不读。
  - 要换上的那组已经在带上（滑到一半又点回去，第二轮第 5 条 A）：沿用它此刻的位置，不重排；不在带上：接在 `direction` 那头最外面那组的后面。然后所有组平移同一个量，让要换上的那组落到终点矩形。所以只会同向一起走，不穿过彼此、不跳。
  - 摘掉：此刻和终点都在窗口外的组摘掉；此刻看得见、终点在窗外的留着滑出去，过渡结束时摘（第二轮第 13 条 B）。
  - 反向重定向时浏览器按已走的比例缩短过渡（实测 100ms 后反向约 320ms 回到原位），不改；验收按位置判，不按时长（第二轮第 13 条 A）。
- 离开的一组：提交那一刻就停放（不可交互，焦点在里面时这一刻发 `content-parked`），过渡结束前看得见。它们之间的分隔线留着、跟着滑：`GridLeavingItem` 扩到分隔线，带冻结的 `beforePx`、`afterPx`（取上一帧的，否则离开的叶不在新布局里、判成“一侧为零”把线藏掉），`disabled` 固定为真，不登记手势（第二轮第 5 条 B、第 6 条）。
- 外框、内容外层、分隔线写 `data-swap="in" | "out"`；暴露 `swappingLeaves`（这一刻在交换里的叶，含离开的）。

### 侧栏切换容器时发 `swap`：`web/components/WorkbenchShell.vue`、`WorkbenchSurface.vue`

- 点活动栏的入口切换（输出 22 的点击），侧栏这一刻显示着、宽度大于零、里面没有最大化的分节时，提交前给 `swap`：`leaving`、`entering` 是切换前后的容器在文档里显示着的分节（库按呈现过滤）；`axis: "height"`；`direction` 按入口顺序，新的在后面是 1；`gap` 是主题的缝宽（`card-gap`），不给 `window`，裁在整列（含上下的缝，评审页的 `sideClip`）。
- 不发的：侧栏隐藏或拖到零（按显示长出来，已有）；里面有最大化的分节（切换会退出最大化，上一帧的矩形是整窗，第二轮第 14 条第 1 点；照常过渡）；拖动落进入口、“移动到”、当前容器空了这些结构变化。
- 外框带着卡片的样子滚，活动栏、短线不动；`capLeaves` 不算 `swappingLeaves` 里的叶（切换容器时活动栏前后都相连，不换画法，`data-shell-cap` 始终不出现）。

### 活动栏的选中标记：`web/components/WorkbenchToolStrip.vue`

- 按下底色从每个按钮自己的底换成条里一个独立的块，位置是当前入口（渲染后量当前入口的 `offsetTop`；条的尺寸变了用 `ResizeObserver` 重量）。`transform` 过渡只在当前入口变了的那一次带（写一个标记），窗口缩放、入口收进“更多”时直接到位；拖动中入口换位（`TransitionGroup`）时块直接到终点；侧栏隐藏时淡出（`aria-pressed` 的规则不变）。当前入口总在外面（输出 22）。

## Spec 与文档改动

条目级 planned，实现后补证据：

- `docs/specs/ui/workbench-layout.md`：输出 19（第 1 片已写）；输出 22（选中标记滑动）；输出 42（侧栏切换容器整张卡片上下滚：接着滚不穿叠、隐藏时不滚、有最大化的分节时不滚、减少动效直接换、焦点在提交时交出）；验收场景补拼成一张卡片、侧栏滚动切换。第 3 片动手前写。
- `docs/specs/ui/nested-grid.md`：“过渡”加交换（生效与作废、窗口、胶片与重定向、离开的一组与分隔线、`issues`）；分隔线的宿主样式（第 1 片的 `sashStyle`）。第 2 片动手前写。
- 组件说明：`NestedGrid.md`（`swap`、`swappingLeaves`）、`WorkbenchSurface.md`、`WorkbenchToolStrip.md`。

## 切片

1. **一个容器一张卡片**：已提交 `9bfd8b021`。
2. **nb-layout 的交换过渡，先在 Lab 里证明**：`grid-motion.ts`、`useGridMotion.ts`、`NestedGrid.vue`；Lab 加一个交换场景（`fixtures/nb-layout/` 下，`s=swap`，一列里两三组叶、按钮换组、能放慢）。验证：`grid-motion.test.ts`（胶片的排法、重定向、摘掉，喂位置的算术）、`NestedGrid.dom.test.ts`（给了 `swap` 但没有布局变化、再改一次尺寸什么都不滑；过滤后为空时照常过渡并发 `issues`；离开的一组提交那一刻停放、焦点交出）、新 e2e `lab-grid-swap.e2e.ts`（放慢后停在几个时刻读位置与像素，见验收映射）、`lab-grid-structure.e2e.ts`（已有过渡不变）。提交后在后台派一次实现审查（Sonnet），不等它，接着做第 3 片。
3. **侧栏接线与活动栏选中标记**：发 `swap`、`capLeaves` 排除交换里的叶、选中标记的块。验证：e2e `workbench-containers`（逐帧：两组都在整列里、整列外没有像素、接着滚、活动栏的 `data-shell-cap` 不出现、短线始终在；有最大化的分节时不滚；选中标记的块和内容同时走）、`workbench-views`（按下底色的颜色取主题）。

每片单独提交、跑上面的验证。

## 验收映射

- 输出 19 → `adjacency.test.ts`、e2e `workbench-containers` 的逐帧像素、`lab-workbench-surface` 的分隔线种类（第 1 片已过）。
- 输出 22（选中标记）→ e2e `workbench-containers` 逐帧读块的位置。
- 输出 42（侧栏滚动切换、焦点交出）→ e2e `workbench-containers`、`NestedGrid.dom.test.ts`。
- `ui/nested-grid` 的“过渡”（交换）→ `grid-motion.test.ts`、`NestedGrid.dom.test.ts`、e2e `lab-grid-swap`：
  - 开始后第一帧窗口外没有像素（`clip-path` 有起点）；
  - 滑到一半反向：各组的区间始终不相交，最后停在原位；
  - 滑到一半点回正在滑出的那组：它从此刻的位置往回走，不跳；
  - 给了 `swap` 但零写入，接着改一次尺寸：什么都不滑；
  - 离开的叶有一节没呈现出来（窄窗口收走）：照常按剩下的交换，或过滤后为空时照常过渡；
  - 离开的一组里的分隔线跟着滑，线在。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；量动画时 `emulateMedia({reducedMotion: "no-preference"})`，放慢 `--motion-layout` 后停在几个时刻读像素（t25 的做法）。
- 开发服务上逐帧看侧栏的切换、侧栏几节的隐藏显示，浅色截图给开发者，深色自己看接缝。
- 未验证的边界：无头浏览器固定 60Hz。

## 不做与风险

- 不做：标签切换的动画（开发者没提）；拖动落进入口、“移动到”、当前容器空了引起的换容器不滚；编辑组的卡片画法；右栏、底部面板的入口条与切换（t28，交换的 `window` 与静止的底在那里用）。
- 上游候选（第二轮第 11 条，不在本 Task 采纳）：一个容器的几片叶共用一层卡片（NestedGrid 的卡片层），代替相连边裁投影、分隔线补底、交换时补静止的底。记进待确认清单，t26 拆通用层之前交开发者定。
- 风险：裁切用 `clip-path` 过渡，每帧重绘滑动的那几块；先在 Lab 场景上量帧时间，超了再考虑合成层的做法。
- 风险：胶片重定向读一次 DOM；只在交换进行中又来一次交换时读。
- 已知限制：拖动中入口换位时，选中标记直接到终点，和按钮的滑动差一段（约 200ms）。
