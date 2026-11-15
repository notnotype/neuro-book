---
标签: [state:local, state:inject, env:global]
---

# NestedGrid

`NestedGrid` 把 `createGrid` 一类领域无关的树与其同源布局结果呈现出来：叶与分隔线是同一父元素的子元素，按矩形摆放，叶的内容交给宿主插槽。树的结构变了只换矩形，不搬、不重建还在的叶。它同时把一次指针或键盘手势的预览投影到所有叶，并将最终提交交回宿主；树、布局意图和任何持久化都不由渲染器拥有。

## 布局

根节点填满父级可用盒。每个叶是一个外框（`data-leaf`，`left`/`top` 加宽高）加一个内容容器（`data-leaf-content`，插槽在这里）；外框裁切内容。过渡时前后都有尺寸的叶，内容容器跟着外框逐帧变化；新叶与从零出来的叶已经是最终尺寸，外框长出来时露出它。边按设备像素取整，缝宽也取整，同一占用的缝宽度相同。交叉轴拉满父分支，主轴放不满时留空。

叶的矩形在已发布的布局里为零时内容停放：保持最后一个非零尺寸，`visibility: hidden` 加 `inert`。手势预览不会把内容停放，从零往外拉时内容在拖动中就解除停放。

外框、内容与浮动窗手柄带 `contain: layout`：是里面 `position: fixed` 的包含块，也自成层叠上下文，要盖住整个窗口的东西 Teleport 到 `body`。位置不用 `transform`：过渡时它在合成线程上走、宽高在主线程上走，主线程一忙，不动的那条边会跳；只有拿起的内容跟手时用 `transform`。

内容可以放进内容层（`contents` 与 `content` 插槽）：每项和叶外框是同一父元素的子元素，矩形是叶减去 `insetTop`，从建到销毁不换父元素，所以换叶不重建，还能从旧矩形滑到新矩形。此时 `leaf` 插槽只放面板头。叠放固定三层：外框、内容、分隔线；正飞过别的面板的外框与内容带 `data-flying`，压在上面，飞的内容在飞的外框上面。不活动的、叶为零的、叶暂时找不到的内容项停放，不卸载；要被停放而焦点在里面时发 `content-parked`，宿主决定焦点去哪。

不是手势、也不是容器尺寸变化引起的布局变化时，外框与分隔线带 `data-moving`，用 `--motion-layout`、`--ease-layout` 过渡。前后都有尺寸的叶，内容逐帧跟外框，叶里的 `ResizeObserver` 每帧都会收到尺寸，不要把过渡中的尺寸当事实记下来；叶里嵌的 grid 按容器尺寸变化处理，进行中的手势会被取消。新叶与从零出来的叶内容一开始就是最终尺寸，这期间又有变化也不跟外框；外框只有右边在动时（从左边长出来），面板头与内容贴着右边整块平移进来，外框与内容外层带 `data-anchor-right`，过渡结束就摘掉；左边在动时（从右边长出来）贴左边本来就跟着它走。纵向不贴：从上边长出来时照旧从上往下露出来（贴下边要让面板头那一条里也画内容，那一条现在被裁掉，见下）。这些叶的内容外层在过渡中按叶的矩形摆、带 `data-by-leaf`：内容体往下挪一个面板头，面板头那一条用 `clip-path` 裁掉（不挡面板头的指针），外层的上边就是外框的上边，叶从零长出来、缩到零时内容一直紧贴面板头下面；过渡结束换回内容自己的矩形，位置相同、不跳。宿主在过渡中量内容外层，量到的是叶的矩形，要量内容的位置量内容体。宿主给了 `leafShape`（叶在外框里画成的卡片：四边的内缩与四个角的圆角）时，这些叶的外框按它裁，内容外层裁掉面板头那一条、另外三边也按它裁（只圆下面两个角），露出来的一截始终是一张完整的卡片，不动的那边留着缝、角是圆的；不给时按外框的矩形裁，卡片在不动的那边被直着切掉。卡片的投影在裁切外面，过渡中没有。浮动窗不按它裁（窗的投影画在外框自身）。一整棵子树新开出来时（区域展开时的整列；顶替同一位置上别的节点的不算）作为一块，沿它在父分支里的主轴从上一帧两个兄弟之间的缝长出来（没有缝时从不动的那条边），里面的叶、分隔线与内容不各自长。离开的叶立即消失，只有一种例外：一整棵子树离开、它前后的兄弟这一帧合拢（或它在一头、挨着的兄弟这一帧伸到了它原来的那一头，所在的分支被摊平也算）、它下面还有挂着的内容、又不在拖动中（没有拿起的内容，宿主的 `dragging` 也不为真）时（例如宿主把整列移走），它留在过渡里作为一块缩回那道缝，带 `data-leaving`、`inert`、不接指针，内容停放（焦点照常交出去）但过渡结束前还画着，同样贴着在动的那条边整块平移出去，结束才摘掉。还在树里、这一轮降到零的叶（宿主收起它，例如把隐藏的区域按拖到零画）一样：停放、`inert`，过渡结束前面板头与内容还画着，贴着在动的那条边缩回去，不带 `data-leaving`。

## 交互

指针在分隔线命中带内按下会开始一次会话；细指针命中边距为 5px，触摸粗指针为 15px。交叉处最多同时调整一条宽度轴和一条高度轴，两条线一起亮，交汇的一端连着（悬停线两端挨着哪条外层分隔线由 `placeGrid` 按树结构算）。拖动期间只从按下时冻结的树、布局、容器尺寸、contextKey 与 revision 求解预览，所有受影响的子树尺寸实时跟随；松手仅提交一次。没有有效变化不会提交。提交的 `changes` 每项对应一个分支，给出该分支全部直接子节点沿主轴的 px（`baseline` 为按下时的值，`target` 为结果）、`active`、`compensated` 与有变化的 `collapsed`；宿主用 `grid.resizeBranches(changes)` 一次原子落账。提交由 `onGestureCommit` 同步接纳；拒绝会回滚预览并报告诊断。接纳后宿主应发布与提交匹配的新 `layout`，否则下一 tick 回到已发布布局并报告问题。

分隔线可聚焦。与主轴同向的方向键每次调整 10px，Shift 调整 1px；Home / End 跳到可行范围端点，Enter 切换相邻可收起面板。键盘按键抬起时结束该手势。Escape、pointercancel、窗口失焦、上下文变化和卸载会取消，不结算旧基线；分隔线失去焦点时结束键盘会话。禁用时不启动手势。沿自己长度方向为零的分隔线（收起为零的分支里，叶之间的那些）按不可交互处理：不可聚焦、不进指针命中、键盘不调整，分支展开后恢复。数据、约束、上下文或 revision 变化会使现有手势失效。点击非分隔区域不由渲染器处理；焦点不被组件搬移。

`dragging` 为真时宿主的拖动在进行（不论内容拿没拿起），离开的叶不留着缩回去。`lifted`（`{key}`）拿起一个内容项（实时布局）：不按叶摆放，不接指针，外层是一列（`lifted-head` 加内层），内层占满头下面的部分，外层尺寸一变就跟着重排；变成 null 时飞回它的叶；落进已有的叶时，那块叶上一帧显示着的内容留在卡片下面（`inert`、不接指针），过渡结束才停放，卡片长的一路叶不空；落进的是这次才出现的叶（拖出来的浮动窗）时，叶的外框和窗的手柄也从卡片的矩形一起长到终点。矩形（相对网格根）由 expose 的 `placeLifted(rect)` 直接写在元素上，不走属性：跟手的东西每帧都变，走属性的话这个组件和每块叶的插槽都要跟着重跑。整窗拖动同样：expose 的 `placeFloat(id, offset)` 把窗的外框、内容、手柄一起挪（写 `translate`），`null` 回到原处，`floats` 属性整场不变。插槽 `lifted-head` 是它上面那一条头，`overlay` 是盖在分隔线之上、拿起的内容之下的一层（不接指针）。暴露 `settleMotion()`：进行中的过渡直接到终点，宿主马上要量矩形时用。卡片的圆角与投影走 `--layout-card-radius`、`--layout-card-shadow`。

`floats`（`{id, rect, moving?}`）是浮动窗（[Spec](../../../../docs/specs/ui/nested-grid.md)“浮动窗”）：不在树里的叶，排在树后面，后面的压在前面的上面。内容项照常归属它。只有矩形变了不过渡。新开的窗（不在拖动中，它的活动内容上一帧在另一块叶里、有尺寸）从那块叶上一帧的矩形出发：外框、手柄、内容一起飞到窗的位置，面板头随外框重排。窗回到树里时叶的 id 不变，外框就从窗的位置过渡回去，压在别的面板上面；摘掉 `data-float` 的那一刻外框还带着 `data-moving`，窗的投影、底色与圆角跟着用加速的曲线过渡掉，到快落地才没。插槽 `float-chrome` 放手柄（[`FloatWindowHandles`](FloatWindowHandles.md)）：网格根的直接子元素，叠在窗的内容上面，外层不接指针。

DOM 序与树序不一致（叶换了位置）时，根上有 `aria-owns`（列出叶、分隔线与没停放的内容项），Tab 走出一块时由组件按树序接管；一致时都是浏览器的原生行为。`moveGridFocus(from, direction)` 按树序在叶之间移动焦点，嵌套时内层走到头交给外层，工作台把它接成 F6 的命令。

## 接入

宿主要做五件事：建树（`createGrid`，**`sashSize` 要传**：缺省是 0，分隔线没有宽度、不可交互，也没有任何诊断）、量容器、算布局、接纳手势提交、结构变了通知。最小的宿主：

```vue
<script setup lang="ts">
import {ref, useTemplateRef} from "vue";
import {createGrid} from "@notnotype/nb-layout";
import {NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";

const grid = ref(createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
    {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}},
    {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}},
]}, {sashSize: 4}));
// 量的是 NestedGrid 的父元素：无 padding、border，里面只有这个 grid。
const container = useTemplateRef<HTMLElement>("container");
const extent = useLayoutExtent(container);
const host = useGridLayout({grid, extent, contextKey: () => "demo"});
// 树被原地改了（拆分、关闭、换位）之后调一次，宿主才看得到新结构：`grid.value.splitLeaf(...); host.invalidate();`
</script>

<template>
    <div ref="container" style="height: 100%">
        <NestedGrid :node="host.node.value" :layout="host.layout.value" context-key="demo" :revision="host.revision.value" :on-gesture-commit="host.onGestureCommit">
            <template #leaf="{node}">{{ node.id }}</template>
        </NestedGrid>
    </div>
</template>
```

`contextKey` 在 `useGridLayout` 与 `NestedGrid` 里要写成同一个值，`revision` 要从 `host` 转给组件：对不上时提交被拒绝，界面表现为拖不动，只有接了 `@issues` 才看得到原因。

## 公开的标记与变量

宿主与测试可以依赖下面这些，改名要同步它们：

| 名字 | 在哪 | 含义 |
|---|---|---|
| `data-grid-scope` | grid 根 | 值是实例 id；`moveGridFocus` 靠它找 grid，宿主取根用它 |
| `data-leaf` | 叶外框 | 值是节点 id；外框按 `left`/`top` 加宽高摆放，过渡中会动 |
| `data-content`、`data-content-leaf` | 内容项的外层 | 值是它的 key、所属叶 id；过渡中会动，飞行中带 `data-flying` |
| `data-sash-kind` | 分隔线 | 值是宿主 `sashKind` 给的种类，没给时没有这个属性；宿主据此设 `--nb-splitter-seam` |
| `data-leaf-content` | 叶的内容容器 | 值是节点 id；宿主 Teleport 内容用它。过渡中的尺寸见上；要最终尺寸读宿主自己的布局结果。`node` 变化后的同一次渲染里新叶的它已经存在 |
| `data-moving` | 外框与分隔线 | 过渡进行中 |
| `data-anchor-right` | 外框与内容外层 | 过渡中里面那层（`data-leaf-content` 与内容体）贴右边；没有时贴左上 |
| `data-by-leaf` | 内容外层 | 过渡中按叶的矩形摆（含面板头那一条，裁掉）；有它时外层的矩形不是内容的位置 |
| `data-sash` | 分隔线 | 值是 `分支 id:序号`；`data-sash-hover`、`-active`、`-revealed`、`-cross` 是它的状态 |
| `--motion-layout`、`--ease-layout` | 继承来的 CSS 变量 | 过渡的时长与曲线，由 nb-ui 的 `tokens.css` 提供，减少动态效果时为 0；宿主没给就没有过渡 |
| `--nb-splitter-seam`、`--nb-splitter-seam-inset` | 继承来的 CSS 变量 | 分隔线静止接缝的颜色与两端缩进 |
| `--sash-line-*` | 继承来的 CSS 变量 | 悬停线的颜色、粗细、圆角、发光与缩进，见 [Splitter](Splitter.md) |

## 数据

```ts
import type {GridGestureCommit, GridGesturePreview, GridLayoutResult, GridLeaf, GridNode, GridSashRef, SplitterGestureCancelReason, SplitterGestureSource} from "@notnotype/nb-layout";

type NestedGridProps = {
    /** 当前树；null 时呈现 empty 插槽。必填。 */
    node: GridNode<unknown> | null;
    /** 与 node 同源的已计算呈现几何；必填。 */
    layout: GridLayoutResult;
    /** 禁止所有分隔线手势；默认 false。 */
    disabled?: boolean;
    /** 手势所属工作面/布局键；默认空字符串。变化会取消活动手势。 */
    contextKey?: string;
    /** 树、约束或容器尺寸变化时由宿主递增的版本；默认 0。 */
    revision?: number;
    /** 同步接纳一次完整提交；未提供或返回失败都会回滚预览。 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
    /** 内容层：和叶外框同一父元素的内容，换叶不重建；默认无，内容放在 leaf 插槽里。 */
    contents?: ReadonlyArray<GridContentInput>;
    /** 这块叶盖住除 exclude 以外的全部区域，别的叶不动；默认 null。只在内存，宿主决定。 */
    maximized?: {leaf: string; exclude: ReadonlyArray<string>} | null;
    /** 分隔线的种类，写到 data-sash-kind，宿主据此给不同的线不同的颜色；默认不写。 */
    sashKind?: (sash: {branch: string; before: string; after: string}) => string | undefined;
    /** 叶在外框里画成的卡片：inset 是相对外框上右下左的内缩，radius 是左上、右上、右下、左下的圆角，都是 CSS 长度。过渡中外框露出、盖住保持尺寸的内层时按它裁；默认按外框的矩形裁。 */
    leafShape?: (leaf: string) => {inset: [string, string, string, string]; radius: [string, string, string, string]} | undefined;
};

type NestedGridEmits = {
    /** 手势建立并冻结上下文时发出。 */
    (event: "gesture-start", info: {sessionId: string; contextKey: string; source: SplitterGestureSource; revision: number; sashes: readonly GridSashRef[]}): void;
    /** 每次产生新几何预览时发出；预览撤回、画面回到已发布的布局时（拖回基线、无变化松手、取消、提交被拒）也发一次，`changes` 为空、`layout` 是已发布的布局。 */
    (event: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 手势正常结束时发出最终提交；无变化时没有提交。 */
    (event: "gesture-end", commit: GridGestureCommit): void;
    /** 手势被取消时发出原因和参与分隔线。 */
    (event: "gesture-cancel", info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
    /** 会话诊断，包括容量不足、提交拒绝或宿主发布不匹配。 */
    (event: "issues", issues: readonly string[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：焦点去哪由宿主定。 */
    (event: "content-parked", key: string): void;
};

type NestedGridSlots = {
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    /** 内容层的一项；leaf 是它此刻所属的叶。 */
    content(props: {contentKey: string; leaf: string; active: boolean}): unknown;
    empty(): unknown;
};
```

Grid 根/叶结构的公开类型是 `GridNode<T> = GridLeaf<T> | GridBranch<T>`；分支包含 `children`，叶以 `kind: "leaf"` 区分。`leaf` 插槽仅收到叶节点，不提供额外作用域；空树与 null 根由 `empty` 插槽呈现。expose 三个方法：`settleMotion()` 把进行中的过渡直接送到终点，`placeLifted(rect)` 写拿起元素的矩形，`placeFloat(id, offset)` 写拖动中的窗挪了多少；另有 `outgoingLeaves`：过渡里缩回去、还画着的叶（节点 id 集合），留着缩回去的离开的叶（已经不在 `node` 里）与这一轮降到零的叶（还在，尺寸已经是零）；宿主按它们缩回去之前的样子画挨着的东西（例如相连的卡片），不按这一刻的布局，过渡结束就空了。插槽渲染时读到的就是这一轮的。未声明 attrs 按 Vue 单根行为落到外层承载 div，不透传到递归 Splitter 或叶容器。

## 状态与边界

- 默认允许分隔线交互；受控事实始终来自 `node` 与 `layout`，拖动中的临时预览才由组件持有。
- 宿主应在树、约束或承载盒尺寸变化时递增 `revision`；`node`、`contextKey`、`revision` 或 `disabled` 改变会取消活动手势。新 `layout` 发布会释放预览，宿主须保持它与树及容器尺寸同源。
- 容量不足、被宿主拒绝、宿主未发布匹配几何等问题通过 `issues` 事件报告。
- 空树由 `empty` 插槽处理；组件不为叶内容定义加载、错误或空数据视觉。
- 回滚只恢复到宿主最近发布的树与 layout；本组件不会自行修改树或写入快照。

## 隐藏通道理由

- `state:local`：保存拖动预览、布局盒测量和手势 scope 生命周期状态，仅在本实例的交互期间存在。
- `state:inject`：向后代的分隔线（`SashHandle`）提供共享 sash gesture scope，使整个 Grid 共用一次会话；这让交叉处的两根轴能一起预览和一次提交，避免每个分支各自提交半场手势。叶槽里再嵌一个公开 `NestedGrid` 或独立 `Splitter` 会得到自己的 scope。
- `env:global`：`useSashGesture` 在手势根、`window` 和 `document` 上监听指针捕获/释放、窗口失焦与 Escape，并按 viewport pointer 坐标命中分隔线；组件卸载或会话结束时移除监听。该通道为手势生命周期服务，不是常驻快捷键。分隔线的设备像素对齐（`useSashSnap`）在 `window` 上常驻 `resize` 与捕获阶段 `scroll` 监听，页面上任何滚动（包括叶里编辑器的）都排一帧、读一遍所有分隔线的位置；`useDevicePixelRatio` 监听 `resize` 与 `matchMedia`。模块级的焦点注册表（`grid-focus.ts` 的两个 `WeakMap`）是同一页面上所有 grid 共享的：同一页面只能有一份 nb-layout。

## 上游边界

`SashHandle` 负责分隔线元素，`useSashGesture` 负责命中、指针/键盘生命周期、取消和手势仲裁；布局计算与手势求解由 grid 几何模块及 Grid session 提供，矩形由 `placeGrid` 给。`NestedGrid` 承诺摆放、预览呈现、事件和同步提交：宿主拒绝提交时回滚预览并给出诊断。

公开面相对递归版的变化：grid 里不再有 `data-splitter`、`data-panel-id`；`data-leaf` 在外框上，过渡中会动。
