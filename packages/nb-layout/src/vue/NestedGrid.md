---
标签: [state:local, state:inject, env:global]
---

# NestedGrid

`NestedGrid` 把 `createGrid` 一类领域无关的树与其同源布局结果呈现出来：叶与分隔线是同一父元素的子元素，按矩形摆放，叶的内容交给宿主插槽。树的结构变了只换矩形，不搬、不重建还在的叶。它同时把一次指针或键盘手势的预览投影到所有叶，并将最终提交交回宿主；树、布局意图和任何持久化都不由渲染器拥有。

## 布局

根节点填满父级可用盒。每个叶是一个外框（`data-leaf`，`transform` 加宽高）加一个内容容器（`data-leaf-content`，插槽在这里）；外框裁切内容。过渡时前后都有尺寸的叶，内容容器跟着外框逐帧变化；新叶与从零出来的叶已经是最终尺寸，外框长出来时露出它。边按设备像素取整，缝宽也取整，同一占用的缝宽度相同。交叉轴拉满父分支，主轴放不满时留空。

叶的矩形在已发布的布局里为零时内容停放：保持最后一个非零尺寸，`visibility: hidden` 加 `inert`。手势预览不会把内容停放，从零往外拉时内容在拖动中就解除停放。

外框用了 `transform`，是内容里 `position: fixed` 的包含块：要盖住整个窗口的东西 Teleport 到 `body`。

内容可以放进内容层（`contents` 与 `content` 插槽）：每项和叶外框是同一父元素的子元素，矩形是叶减去 `insetTop`，从建到销毁不换父元素，所以换叶不重建，还能从旧矩形滑到新矩形。此时 `leaf` 插槽只放面板头。叠放固定三层：外框、内容、分隔线；正飞过别的面板的外框与内容带 `data-flying`，压在上面。不活动的、叶为零的、叶暂时找不到的内容项停放，不卸载；要被停放而焦点在里面时发 `content-parked`，宿主决定焦点去哪。

不是手势、也不是容器尺寸变化引起的布局变化时，外框与分隔线带 `data-moving`，用 `--motion-layout`、`--ease-layout` 过渡。前后都有尺寸的叶，内容逐帧跟外框，叶里的 `ResizeObserver` 每帧都会收到尺寸，不要把过渡中的尺寸当事实记下来；叶里嵌的 grid 按容器尺寸变化处理，进行中的手势会被取消。新叶与从零出来的叶内容一开始就是最终尺寸，从挨着兄弟的边长出来时露出它，这期间又有变化也不跟外框。离开的叶立即消失。

## 交互

指针在分隔线命中带内按下会开始一次会话；细指针命中边距为 5px，触摸粗指针为 15px。交叉处最多同时调整一条宽度轴和一条高度轴，两条线一起亮，交汇的一端连着（悬停线两端挨着哪条外层分隔线由 `placeGrid` 按树结构算）。拖动期间只从按下时冻结的树、布局、容器尺寸、contextKey 与 revision 求解预览，所有受影响的子树尺寸实时跟随；松手仅提交一次。没有有效变化不会提交。提交的 `changes` 每项对应一个分支，给出该分支全部直接子节点沿主轴的 px（`baseline` 为按下时的值，`target` 为结果）、`active`、`compensated` 与有变化的 `collapsed`；宿主用 `grid.resizeBranches(changes)` 一次原子落账。提交由 `onGestureCommit` 同步接纳；拒绝会回滚预览并报告诊断。接纳后宿主应发布与提交匹配的新 `layout`，否则下一 tick 回到已发布布局并报告问题。

分隔线可聚焦。与主轴同向的方向键每次调整 10px，Shift 调整 1px；Home / End 跳到可行范围端点，Enter 切换相邻可收起面板。键盘按键抬起时结束该手势。Escape、pointercancel、窗口失焦、上下文变化和卸载会取消，不结算旧基线；分隔线失去焦点时结束键盘会话。禁用时不启动手势。数据、约束、上下文或 revision 变化会使现有手势失效。点击非分隔区域不由渲染器处理；焦点不被组件搬移。

DOM 序与树序不一致（叶换了位置）时，根上有 `aria-owns`，Tab 走出一块时由组件按树序接管；一致时都是浏览器的原生行为。`moveGridFocus(from, direction)` 按树序在叶之间移动焦点，嵌套时内层走到头交给外层，工作台把它接成 F6 的命令。

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
| `data-leaf` | 叶外框 | 值是节点 id；外框带 `transform`，过渡中会动 |
| `data-content`、`data-content-leaf` | 内容项的外层 | 值是它的 key、所属叶 id；过渡中会动，飞行中带 `data-flying` |
| `data-leaf-content` | 叶的内容容器 | 值是节点 id；宿主 Teleport 内容用它。过渡中的尺寸见上；要最终尺寸读宿主自己的布局结果。`node` 变化后的同一次渲染里新叶的它已经存在 |
| `data-moving` | 外框与分隔线 | 过渡进行中 |
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
    /** 会话诊断出口；默认未提供。 */
    onIssues?: (issues: readonly string[]) => void;
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
};

type NestedGridSlots = {
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    empty(): unknown;
};
```

Grid 根/叶结构的公开类型是 `GridNode<T> = GridLeaf<T> | GridBranch<T>`；分支包含 `children`，叶以 `kind: "leaf"` 区分。`leaf` 插槽仅收到叶节点，不提供额外作用域；空树与 null 根由 `empty` 插槽呈现。组件不 expose API。未声明 attrs 按 Vue 单根行为落到外层承载 div，不透传到递归 Splitter 或叶容器。

## 状态与边界

- 默认允许分隔线交互；受控事实始终来自 `node` 与 `layout`，拖动中的临时预览才由组件持有。
- 宿主应在树、约束或承载盒尺寸变化时递增 `revision`；`node`、`contextKey`、`revision` 或 `disabled` 改变会取消活动手势。新 `layout` 发布会释放预览，宿主须保持它与树及容器尺寸同源。
- 容量不足、被宿主拒绝、宿主未发布匹配几何等问题通过 `issues` 事件和可选 `onIssues` 回调报告。
- 空树由 `empty` 插槽处理；组件不为叶内容定义加载、错误或空数据视觉。
- 回滚只恢复到宿主最近发布的树与 layout；本组件不会自行修改树或写入快照。

## 隐藏通道理由

- `state:local`：保存拖动预览、布局盒测量和手势 scope 生命周期状态，仅在本实例的交互期间存在。
- `state:inject`：向后代的分隔线（`SashHandle`）提供共享 sash gesture scope，使整个 Grid 共用一次会话；这让交叉处的两根轴能一起预览和一次提交，避免每个分支各自提交半场手势。叶槽里再嵌一个公开 `NestedGrid` 或独立 `Splitter` 会得到自己的 scope。
- `env:global`：`useSashGesture` 在手势根、`window` 和 `document` 上监听指针捕获/释放、窗口失焦与 Escape，并按 viewport pointer 坐标命中分隔线；组件卸载或会话结束时移除监听。该通道为手势生命周期服务，不是常驻快捷键。分隔线的设备像素对齐（`useSashSnap`）在 `window` 上常驻 `resize` 与捕获阶段 `scroll` 监听，页面上任何滚动（包括叶里编辑器的）都排一帧、读一遍所有分隔线的位置；`useDevicePixelRatio` 监听 `resize` 与 `matchMedia`。模块级的焦点注册表（`grid-focus.ts` 的两个 `WeakMap`）是同一页面上所有 grid 共享的：同一页面只能有一份 nb-layout。

## 上游边界

`SashHandle` 负责分隔线元素，`useSashGesture` 负责命中、指针/键盘生命周期、取消和手势仲裁；布局计算与手势求解由 grid 几何模块及 Grid session 提供，矩形由 `placeGrid` 给。`NestedGrid` 承诺摆放、预览呈现、事件和同步提交：宿主拒绝提交时回滚预览并给出诊断。

公开面相对递归版的变化：grid 里不再有 `data-splitter`、`data-panel-id`；`data-leaf` 在外框上，过渡中会动。
