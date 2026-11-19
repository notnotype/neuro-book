---
标签: [state:local, state:inject, env:global]
---

# NestedGrid

`NestedGrid` 把 `createGrid` 一类领域无关的树与其同源布局结果呈现出来：叶与分隔线是同一父元素的子元素，按矩形摆放，叶的内容交给宿主插槽。树的结构变了只换矩形，不搬、不重建还在的叶。它同时把一次指针或键盘手势的预览投影到所有叶，并将最终提交交回宿主；树、布局意图和任何持久化都不由渲染器拥有。

行为合同在 [Spec](../../../../docs/specs/ui/nested-grid.md)（下面写“输出 N”的都指它的输出编号）；本文只写 Spec 没有的：接口、用法、使用提醒和标记。

## 布局

根节点填满父级可用盒。每个叶是一个外框（`data-leaf`，`left`/`top` 加宽高）加一个内容容器（`data-leaf-content`，插槽在这里）；外框裁切内容。摆放、取整与交叉轴见输出 27 到 34。

叶的矩形在已发布的布局里为零时内容停放：`visibility: hidden` 加 `inert`（输出 116 到 119）。

外框、内容与浮动窗手柄带 `contain: layout`：是里面 `position: fixed` 的包含块（输出 28），也自成层叠上下文，要盖住整个窗口的东西 Teleport 到 `body`。位置不用 `transform`：过渡时它在合成线程上走、宽高在主线程上走，主线程一忙，不动的那条边会跳；只有拿起的内容跟手时用 `transform`。

内容可以放进内容层（`contents` 与 `content` 插槽，输出 80 到 96）。此时 `leaf` 插槽只放面板头。内容项要被停放而焦点在里面时发 `content-parked`，宿主决定焦点去哪（“时序与寿命”）。正飞过别的面板的外框与内容带 `data-flying`。

## 过渡

规则见输出 35 到 60。下面是 Spec 没有的用法与提醒：

- 过渡中外框与分隔线带 `data-moving`。前后都有尺寸的叶，内容逐帧跟外框，叶里的 `ResizeObserver` 每帧都会收到尺寸：不要把过渡中的尺寸当事实记下来；要最终尺寸读宿主自己的布局结果。
- 外框只有右边在动时，外框与内容外层带 `data-anchor-right`，过渡结束就摘掉（输出 39）。纵向不贴：贴下边要让面板头那一条里也画内容，那一条现在被裁掉。
- 这些叶的内容外层在过渡中按叶的矩形摆、带 `data-by-leaf`：内容体往下挪一个面板头，面板头那一条用 `clip-path` 裁掉（不挡面板头的指针），外层的上边就是外框的上边（输出 86）；过渡结束换回内容自己的矩形，位置相同、不跳。宿主在过渡中量内容外层，量到的是叶的矩形，要量内容的位置量内容体。
- 不给 `leafShape` 时，这些叶按外框的矩形裁，卡片在不动的那边被直着切掉；给了形状时见输出 51 到 55。形状可以伸出外框时，`fill` 画伸出去的部分。
- 离开的叶留着缩回去（输出 44 到 48）时带 `data-leaving`、`inert`、不接指针；宿主用 `dragging` 属性告诉网格拖动在进行（不论内容拿没拿起），这时离开的叶不留着。还在树里、这一轮降到零的叶（输出 49）不带 `data-leaving`。

## 交换

规则见输出 61 到 77，`swap` 的字段见“数据”。下面是 Spec 没有的用法与提醒：

- 裁切窗可以按 `window.inset` 内缩、按 `window.radius` 圆角：带上的外框、内容外层与分隔线各自的 `clip-path` 是窗在它坐标里的位置，起点那一帧就写上，和 `left`/`top` 同一段过渡。
- 带上的项带 `data-swap`（输出 75）；离开的一组带 `data-leaving`、`inert`；组里的分隔线两侧尺寸冻结在离开前。
- 布局是异步算出来的宿主，在拿到新布局、写进属性的同一个同步段里给 `swap`。
- 裁切窗应当等于两组静止时的外观：过渡结束那一帧摘掉裁切，窗比静止时小的部分会一下子露出来。
- 滑出去的分隔线不再问宿主的 `sashKind`、`sashStyle`（两侧已经不在宿主的布局里），沿用它离开前最后一次的结果。
- 宿主按文档列的叶对不上呈现时（被收走、没呈现出来），不在呈现里的忽略（输出 67）。交换开始之后才挂上来的内容项按它的叶属于哪一组裁，但从终点出现（已知限制）。
- 网格同时只有一条带（输出 73）：进行中的过渡全部送到终点的做法同 `settleMotion`，别处正在长出来、缩回去的也一起。
- 交换中来了一次不带交换的布局变化，带照旧走完，裁切窗与静止的底不跟着变（输出 74；已知限制）。
- `swap-backdrop` 插槽（输出 77）里宿主画不动的东西，外框这期间不画自己的卡片。

## 交互

指针在分隔线命中带内按下会开始一次会话；命中带的外扩距离见 [Splitter](Splitter.md)（输出 11）。交叉处最多同时调整一条宽度轴和一条高度轴，两条线一起亮，交汇的一端连着（悬停线两端挨着哪条外层分隔线由 `placeGrid` 按树结构算）。拖动期间只从按下时冻结的树、布局、容器尺寸、contextKey 与 revision 求解预览，所有受影响的子树尺寸实时跟随；松手仅提交一次。没有有效变化不会提交。提交的 `changes` 每项对应一个分支，给出该分支全部直接子节点沿主轴的 px（`baseline` 为按下时的值，`target` 为结果）、`active`、`compensated` 与有变化的 `collapsed`；宿主用 `grid.resizeBranches(changes)` 一次原子落账。提交由 `onGestureCommit` 同步接纳；拒绝会回滚预览并报告诊断。接纳后宿主应发布与提交匹配的新 `layout`，否则下一 tick 回到已发布布局并报告问题。

与主轴同向的方向键每次调整 10px，Shift 调整 1px；Home / End 跳到可行范围端点，Enter 切换相邻可收起面板。键盘按键抬起时结束该手势。取消的情形见输出 9：Escape、pointercancel、窗口失焦、上下文变化和卸载都不结算旧基线；分隔线失去焦点时结束键盘会话。禁用时不启动手势。沿自己长度方向为零的分隔线（输出 136）按不可交互处理。数据、约束、上下文或 revision 变化会使现有手势失效。点击非分隔区域不由渲染器处理；焦点不被组件搬移。

`dragging` 为真时宿主的拖动在进行（不论内容拿没拿起），离开的叶不留着缩回去。`lifted`（`{key}`）拿起一个内容项（实时布局，输出 89 到 91）：不接指针，外层是一列（`lifted-head` 加内层）。落进已有的叶时，那块叶上一帧显示着的内容留在卡片下面（`inert`、不接指针），过渡结束才停放，卡片长的一路叶不空；落进的是这次才出现的叶（拖出来的浮动窗）时，叶的外框和窗的手柄也从卡片的矩形一起长到终点。矩形（相对网格根）由 expose 的 `placeLifted(rect)` 直接写在元素上，不走属性：跟手的东西每帧都变，走属性的话这个组件和每块叶的插槽都要跟着重跑。整窗拖动同样：expose 的 `placeFloat(id, offset)` 把窗的外框、内容、手柄一起挪（写 `translate`），`null` 回到原处（输出 115），`floats` 属性整场不变。插槽 `lifted-head` 是它上面那一条头，`overlay` 是盖在分隔线之上、拿起的内容之下的一层（不接指针，输出 87）。暴露 `settleMotion()`：进行中的过渡直接到终点，宿主马上要量矩形时用。卡片的圆角与投影走 `--nb-layout-card-radius`、`--nb-layout-card-shadow`（输出 112）。

`floats`（`{id, rect, gesture?}`）是浮动窗（输出 101 到 115）。窗回到树里时叶的 id 不变，外框就从窗的位置过渡回去；摘掉 `data-float` 的那一刻外框还带着 `data-moving`，窗的投影、底色与圆角跟着过渡掉（输出 109、110）。插槽 `float-chrome` 放手柄（[`FloatWindowHandles`](FloatWindowHandles.md)，输出 113）。

焦点：DOM 序与树序不一致（叶换了位置）时，根上有 `aria-owns`，Tab 走出一块时由组件按树序接管；规则见输出 121 到 132。`moveGridFocus(from, direction)` 的规则见输出 129 到 131。

## 接入

宿主要做五件事：建树（`createGrid`，**`sashSize` 要传**：缺省是 0，分隔线没有宽度、不可交互，也没有任何诊断）、量容器、算布局、接纳手势提交、结构变了通知。后四件由 `useGridHost` 接好，整包绑到组件上（输出 144、145）：

```vue
<script setup lang="ts">
import {shallowRef} from "vue";
import {createGrid} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

const grid = shallowRef(createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
    {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}},
    {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}},
]}, {sashSize: 4}));
const host = useGridHost({grid, onIssues: (issues) => console.warn(issues)});
// 树被原地改了（拆分、关闭、换位）之后调一次，宿主才看得到新结构：`grid.value.splitLeaf(...); host.invalidate();`
</script>

<template>
    <!-- 承载盒要有确定的高度：组件的根铺满它，量到 0 高时布局为空、手势停用（叶照常挂着，只是没有尺寸）。 -->
    <div style="height: 100%">
        <NestedGrid v-bind="host.bindings.value">
            <template #leaf="{node}">{{ node.id }}</template>
        </NestedGrid>
    </div>
</template>
```

- 尺寸来自组件自己量的根盒（`extent` 事件，读 `clientWidth`、`clientHeight`，不随祖先的变换缩放），宿主不另量；没量到可用尺寸（null，或宽、高任一为 0）时布局为空、`disabled` 为真。尺寸只来自组件，不要把它挂在“有了尺寸才渲染”的条件后面，那样永远等不到尺寸。
- `disabled`、`contextKey`、提交处理只经 `useGridHost` 的选项给，模板里不要再写同名属性：`disabled`、`contextKey` 后写的会静默覆盖包里的值，提交处理会被换掉或合成数组。
- 诊断只有一个出口：选项里的 `onIssues` 收布局重算的诊断、`notify-failed`，也收组件的 `issues` 事件（包里带着接它的处理）。
- 提交：同步核对上下文、版本与尺寸，一次 `resizeBranches` 成功之后才调选项里的 `onApplied(commit, result, before)`。`before` 是提交之前发布的布局（手势开始时呈现的那份），此时 `host.layout` 已经是之后的；要比较提交前后时用它。`onApplied` 是“已经落账”的通知，不是第二道拒绝门：它抛错报成 `notify-failed`，不反悔已提交的几何；自身提交不造成预览自取消。
- 收起与展开一块有收起策略的面板（按钮、快捷键）：`host.setCollapsed(id, collapsed)`。它只翻收起标记、按分配规则重排（见 [grid API](../grid.md)），标记变了才重发布局；不触发 `onApplied`，要存盘就用它返回的 `collapse`。分隔条上的 Enter 是另一种结果（邻居让位、恢复到记下的尺寸）。
- 组件卸载前发 `extent` 为 null：组件被条件渲染摘掉时宿主的 `host.extent` 回到 null；宿主自己整个卸载时，宿主的侦听已经停了。
- 提交处理 `onGestureCommit` 是属性，要返回 `{ok: true}` 或失败对象。写成 `@gesture-commit` 时处理函数会被当作这个属性调用，返回 void 就回滚；整包绑定之后再写它，会和包里的合成数组，提交时出错。
- 开发构建里、网格挂载之前调一次根入口的 `setLayoutDevChecks(true)`：接线错了（能拖的边界全是 0 宽、没接或接错提交处理、模板里另写了 `context-key` 或 `:revision`）时控制台警告，每个网格每种一次（[Spec](../../../../docs/specs/ui/nested-grid.md) 输出 151）。库不读 `import.meta.env`，开不开由宿主决定。
- 不经 `NestedGrid` 量尺寸的地方（例如量别的盒子做别的事）用 `useLayoutExtent(ref)`：它共享 `clientWidth`、`clientHeight` 与 `ResizeObserver`，`null` 表示还没挂载，0 是真实的零。

## 公开的标记与变量

宿主与测试可以依赖下面这些，改名要同步它们：

| 名字 | 在哪 | 含义 |
|---|---|---|
| `data-grid-scope` | grid 根 | 值是实例 id；`moveGridFocus` 靠它找 grid，宿主取根用它 |
| `data-leaf` | 叶外框 | 值是节点 id；外框按 `left`/`top` 加宽高摆放，过渡中会动 |
| `data-content`、`data-content-leaf` | 内容项的外层 | 值是它的 key、所属叶 id；过渡中会动，飞行中带 `data-flying` |
| `data-flying` | 外框与内容外层 | 这次过渡里压在别的面板上面飞过去的项：换了叶的内容、整块挪到别处的面板、从浮动窗回到树里的叶；还原最大化的过渡结束之前，被还原的那块也带它 |
| `data-lifted` | 内容外层 | 这一项被拿起（`lifted`），盖在别的上面跟手 |
| `data-float` | 外框与内容外层 | 这块叶是浮动窗 |
| `data-float-gesture` | 浮动窗的外框、内容外层与手柄层 | 手势进行中，值是 `move` 或 `resize`：跟手、不过渡；`move` 时外框与内容不接指针（输出 114） |
| `data-float-chrome` | 浮动窗的手柄层（`float-chrome` 插槽的外层） | 值是浮动窗的 id |
| `data-sash-kind` | 分隔线 | 值是宿主 `sashKind` 给的种类，没给时没有这个属性；宿主据此设 `--nb-layout-splitter-seam` |
| `data-leaf-content` | 叶的内容容器 | 值是节点 id；宿主 Teleport 内容用它。过渡中的尺寸见“过渡”；要最终尺寸读宿主自己的布局结果。`node` 变化后的同一次渲染里新叶的它已经存在 |
| `data-moving` | 外框与分隔线 | 过渡进行中 |
| `data-anchor-right` | 外框与内容外层 | 过渡中里面那层（`data-leaf-content` 与内容体）贴右边；没有时贴左上（输出 39） |
| `data-by-leaf` | 内容外层 | 过渡中按叶的矩形摆（含面板头那一条，裁掉）；有它时外层的矩形不是内容的位置 |
| `data-swap` | 外框、内容外层与分隔线 | 交换进行中，值是 `in`（换上来的）或 `out`（离开的）；带它时 `clip-path` 是裁切窗，不是 `leafShape`（输出 75） |
| `data-leaving` | 外框、内容外层与分隔线 | 离开了、在过渡里留着（缩回去，或交换里滑出去），不接指针；降到零但还在树里的叶不带它 |
| `data-swap-backdrop` | 静止的底（`swap-backdrop` 插槽的外层） | 交换进行中、宿主给了这个插槽时才有 |
| `data-sash` | 分隔线 | 值是 `分支 id:序号`；`data-sash-hover`、`-active`、`-revealed`、`-cross` 是它的状态 |
| `--nb-layout-motion-layout`、`--nb-layout-ease-layout` | 继承来的 CSS 变量 | 过渡的时长与曲线：装了 nb-ui 时经它的桥接取主题的 `--motion-layout`、`--ease-layout`；减少动态效果时为 0；宿主没给时按缺省（470ms，输出 142） |
| `--nb-layout-splitter-seam`、`--nb-layout-splitter-seam-inset` | 继承来的 CSS 变量 | 宿主旋钮，主题不写：分隔线静止接缝的颜色与两端缩进，可以设在子树上 |
| `--nb-layout-sash-line-*` | 继承来的 CSS 变量 | 悬停线的颜色、粗细、圆角、发光与缩进，装了 nb-ui 时经桥接取主题的 `--sash-line-*`，见 [Splitter](Splitter.md)。全部变量与回退见包的 README |

## 数据

```ts
import type {GridFailure, GridGestureCommit, GridGesturePreview, GridIssue, GridIssueCode, GridLayoutResult, GridLeaf, GridNode, GridGestureCancellation, GridGestureStart, GridExtent} from "@notnotype/nb-layout";

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
    /** 同步接纳一次完整提交；未提供或返回失败都会回滚预览。失败是 `{ok: false, code, message, params?}`（Spec `ui/nested-grid` 失败 6）：`code` 给程序分支（宿主自己拒绝可以用自己的码），`message` 是英文、只给日志看。 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | GridFailure;
    /** 内容层：和叶外框同一父元素的内容，换叶不重建；默认无，内容放在 leaf 插槽里。 */
    contents?: ReadonlyArray<GridContentInput>;
    /** 这块叶盖住除 exclude 以外的全部区域，别的叶不动；默认 null。只在内存，宿主决定。 */
    maximized?: {leaf: string; exclude: ReadonlyArray<string>} | null;
    /** 拿起的内容项（实时布局）：盖在别的面板与分隔线上跟手，不接指针，矩形由 placeLifted 写；变成 null 时飞回它的叶。默认 null。 */
    lifted?: {key: string} | null;
    /** 宿主的拖动进行中（不论内容拿没拿起）：离开的叶立即消失，不留着缩回去。默认 false。 */
    dragging?: boolean;
    /** 浮动窗：不在树里的叶，后面的压在前面的上面；矩形相对网格根，只有矩形变了不过渡。默认没有。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /** 分隔线的种类，写到 data-sash-kind，宿主据此给不同的线不同的颜色；默认不写。 */
    sashKind?: (sash: {branch: string; before: string; after: string}) => string | undefined;
    /** 写在分隔线元素上的内联样式（多半是 CSS 变量），宿主据此在线所占的那一条里画东西；位置与尺寸由网格写，同名属性被覆盖。默认不写。 */
    sashStyle?: (sash: {branch: string; before: string; after: string}) => Record<string, string> | undefined;
    /** 宿主让这条分隔线此刻不能拖（指针、键盘都不行，线照画），例如一列分节全部收成标题行时；缺省都能拖。 */
    sashDisabled?: (sash: {branch: string; before: string; after: string}) => boolean;
    /**
     * 叶在外框里画成的卡片：inset 是相对外框上右下左的内缩，radius 是左上、右上、右下、左下的圆角，都是 CSS 长度。过渡中外框露出、盖住保持尺寸的内层时按它裁；默认按外框的矩形裁。
     * 给了 fill 时形状可以伸出外框（内缩为负）：外框里的东西照旧裁在外框里，伸出去的部分画成 fill，这块外框画在别的外框下面，伸到邻居那里的部分被邻居盖住。
     */
    leafShape?: (leaf: string) => GridLeafShape | undefined;
    /**
     * 交换：下一次布局变化里一组叶换成另一组时整块平移（输出 61 到 77）。和那次布局变化在同一个同步段里给，token 变了才算新的；默认 null。
     * window.inset 是外接矩形上右下左的内缩（px），window.radius 是四个角（CSS 长度）。
     */
    swap?: {token: number; leaving: ReadonlyArray<string>; entering: ReadonlyArray<string>; axis: "width" | "height"; direction: 1 | -1; gap: number; window?: {inset: [number, number, number, number]; radius?: [string, string, string, string]}} | null;
};

/** 内容层的一项：key 是身份（不变就不重建、不换父元素），换 leaf 是在叶之间移动；insetTop 是叶顶部留给面板头的高度；不 active 的停放、不卸载。 */
type GridContentInput = {key: string; leaf: string; insetTop: number; active: boolean};
/** 浮动窗：rect 相对网格根；gesture 是手势进行中（跟手、不过渡；move 还不接指针，判定才看得到底下）。 */
type GridFloatInput = {id: string; rect: GridRect; gesture?: "move" | "resize"};
/** 叶画成的卡片：inset 上右下左的内缩、radius 四个角（CSS 长度）；fill 是形状伸出外框（内缩为负）时伸出去那部分的颜色。 */
type GridLeafShape = {inset: [string, string, string, string]; radius: [string, string, string, string]; fill?: string};

type NestedGridEmits = {
    /** 手势建立并冻结上下文时发出。 */
    (event: "gesture-start", info: GridGestureStart): void;
    /** 每次产生新几何预览时发出；预览撤回、画面回到已发布的布局时（拖回基线、无变化松手、取消、提交被拒）也发一次，`changes` 为空、`layout` 是已发布的布局。 */
    (event: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 手势正常结束时发出最终提交；无变化时没有提交。 */
    (event: "gesture-end", commit: GridGestureCommit): void;
    /** 手势被取消时发出原因和参与分隔线。 */
    (event: "gesture-cancel", info: GridGestureCancellation): void;
    /**
     * 诊断与被拒的提交（Spec 输出 139、140）：带 `ok` 的（`"ok" in issue`）是被拒的提交，已经回滚；其余是诊断。
     * 只发新出现的：一场手势里同一个诊断只发一次；要知道现在有哪些问题，读 `layout.issues` 与 `gesture-update` 载荷的 `issues`。
     */
    (event: "issues", issues: readonly (GridIssue<GridIssueCode | "not-published"> | GridFailure)[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：焦点去哪由宿主定。 */
    (event: "content-parked", key: string): void;
    /** 量到的根盒（输出 144）：挂载后量到就同步发、两轴变了才再发；卸载前发 null。`useGridHost` 的整包里带着接它的处理。 */
    (event: "extent", extent: GridExtent | null): void;
};

type NestedGridSlots = {
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    /** 内容层的一项；leaf 是它此刻所属的叶。 */
    content(props: {contentKey: string; leaf: string; active: boolean}): unknown;
    /** 拿起的内容项的头：卡片上面那一条。 */
    "lifted-head"?(props: {contentKey: string}): unknown;
    /** 盖在分隔线之上、拿起的内容之下的一层（实时布局的分区、空位），不接指针。 */
    overlay?(): unknown;
    /** 浮动窗的手柄：网格根的直接子元素，矩形同浮动窗，叠在它的内容上面；外层不接指针，里面的控件自己开。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
    /** 交换进行中静止的底：在所有外框下面、两组外框的外接矩形上；inset、radius 是裁切窗在这一层里的四边内缩（px）与四个角。 */
    "swap-backdrop"?(props: {inset: [number, number, number, number]; radius: [string, string, string, string] | null}): unknown;
    empty(): unknown;
};
```

Grid 根/叶结构的公开类型是 `GridNode<T> = GridLeaf<T> | GridBranch<T>`；分支包含 `children`，叶以 `kind: "leaf"` 区分。`leaf` 插槽仅收到叶节点，不提供额外作用域；空树与 null 根由 `empty` 插槽呈现。expose 三个方法：`settleMotion()` 把进行中的过渡直接送到终点，`placeLifted(rect)` 写拿起元素的矩形，`placeFloat(id, offset)` 写拖动中的窗挪了多少。

expose 的读数：

- `outgoingLeaves`：过渡里离开、还画着的叶（节点 id 集合），留着缩回去或交换里滑出去的离开的叶（已经不在 `node` 里）与这一轮降到零的叶（还在，尺寸已经是零）；宿主按它们缩回去之前的样子画挨着的东西（例如相连的卡片），不按这一刻的布局，过渡结束就空了。
- `shapedLeaves`：这一刻外框按 `leafShape` 裁的叶（长出来的、缩回去的、内容不跟外框的），宿主要在这段时间换一种形状时读它（输出 56）。
- `swappingLeaves`：这一刻在交换里的叶（含滑出去的），宿主在这段时间不换别的画法时读它（输出 76）。
- `moving`：这一刻有没有布局过渡在走（整个网格的），宿主要等过渡结束再换画法时按它“为假”判；减少动态效果时一轮过渡都不开，它一直为假（输出 60）。
- `outgoingLeaves`、`shapedLeaves`、`swappingLeaves` 在插槽渲染时读到的都是这一轮的（后两者也是 Spec“时序与寿命”的合同）。

未声明 attrs 按 Vue 单根行为落到外层承载 div，不透传到递归 Splitter 或叶容器。

## 状态与边界

- 默认允许分隔线交互；受控事实始终来自 `node` 与 `layout`，拖动中的临时预览才由组件持有。
- 宿主应在树、约束或承载盒尺寸变化时递增 `revision`；`node`、`contextKey`、`revision` 或 `disabled` 改变会取消活动手势。新 `layout` 发布会释放预览，宿主须保持它与树及容器尺寸同源。
- 容量不足、被宿主拒绝、宿主未发布匹配几何等问题通过 `issues` 事件报告，元素是 `{code, message, params?}`，按 `code` 与 `params` 分支，`message` 是英文、只给日志看；只发新出现的（Spec 输出 140）。松手、取消与卸载时宿主的监听抛出，手势已经收尾；拖动途中某一帧里抛出，手势照常进行。异常都照常冒出去。
- 空树由 `empty` 插槽处理；组件不为叶内容定义加载、错误或空数据视觉。
- 回滚只恢复到宿主最近发布的树与 layout；本组件不会自行修改树或写入快照。

## 隐藏通道理由

- `state:local`：保存拖动预览、布局盒测量和手势 scope 生命周期状态，仅在本实例的交互期间存在。
- `state:inject`：分隔线的读屏名称与取值文字经 `LAYOUT_TEXT_KEY` 注入的翻译函数取，同 [Splitter](Splitter.md) 的“文字”。另向后代的分隔线（`SashHandle`）提供共享 sash gesture scope，使整个 Grid 共用一次会话；这让交叉处的两根轴能一起预览和一次提交，避免每个分支各自提交半场手势。叶槽里再嵌一个公开 `NestedGrid` 或独立 `Splitter` 会得到自己的 scope（输出 24）。
- `env:global`：`useSashGesture` 在手势根、`window` 和 `document` 上监听指针捕获/释放、窗口失焦与 Escape，并按 viewport pointer 坐标命中分隔线；组件卸载或会话结束时移除监听。该通道为手势生命周期服务，不是常驻快捷键。分隔线的设备像素对齐（`useSashSnap`）在 `window` 上常驻 `resize` 与捕获阶段 `scroll` 监听，页面上任何滚动（包括叶里编辑器的）都排一帧、读一遍所有分隔线的位置；`useDevicePixelRatio` 监听 `resize` 与 `matchMedia`。模块级的焦点注册表（`grid-focus.ts` 的两个 `WeakMap`）是同一页面上所有 grid 共享的：同一页面只能有一份 nb-layout。

## 上游边界

`SashHandle` 负责分隔线元素，`useSashGesture` 负责命中、指针/键盘生命周期、取消和手势仲裁；布局计算与手势求解由 grid 几何模块及 Grid session 提供，矩形由 `placeGrid` 给。`NestedGrid` 承诺摆放、预览呈现、事件和同步提交：宿主拒绝提交时回滚预览并给出诊断。主工作台与编辑器工作区共用这一份渲染实现。

公开面相对递归版的变化：grid 里不再有 `data-splitter`、`data-panel-id`；`data-leaf` 在外框上，过渡中会动。
