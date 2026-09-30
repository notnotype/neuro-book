---
标签: [state:local, state:inject, env:global]
---

# GridRenderer

`GridRenderer` 把 `createGrid` 一类领域无关的树与其同源布局结果递归呈现为嵌套分隔面板：分支成为 `Splitter`，叶交给宿主插槽。它同时把一次指针或键盘手势的预览投影到整棵子树，并将最终提交交回宿主；树、布局意图和任何持久化都不由渲染器拥有。

## 布局

根节点填满父级可用盒。每个 branch 按其 `orientation` 生成一个 `Splitter`，直接 children 按传入 layout 的 px 尺寸排列；嵌套 branch 递归生成 splitter，leaf 在裁切容器中交给 `leaf` 插槽。横向分支沿宽度排列，纵向分支沿高度排列。没有分支时不会创建 splitter；null 根走 `empty` 插槽。承载盒应由宿主提供可测量的内容尺寸，且不能把 padding/border 混入 Grid 分配空间。小视口仍按树结构排列，具体面板溢出与最小尺寸由宿主布局和 `layout` 约束决定。

## 交互

指针在分隔线命中带内按下会开始一次会话；细指针命中边距为 5px，触摸粗指针为 15px。交叉处最多同时调整一条宽度轴和一条高度轴。拖动期间只从按下时冻结的树、布局、容器尺寸、contextKey 与 revision 求解预览，所有受影响的子树尺寸实时跟随；松手仅提交一次。没有有效变化不会提交。提交由 `onGestureCommit` 同步接纳；拒绝会回滚预览并报告诊断。接纳后宿主应发布与提交匹配的新 `layout`，否则下一 tick 回到已发布布局并报告问题。

分隔线可聚焦。与主轴同向的方向键每次调整 10px，Shift 调整 1px；Home / End 跳到可行范围端点，Enter 切换相邻可收起面板。键盘按键抬起时结束该手势。Escape、pointercancel、窗口失焦、上下文变化和卸载会取消，不结算旧基线；分隔线失去焦点时结束键盘会话。禁用时不启动手势。数据、约束、上下文或 revision 变化会使现有手势失效。点击非分隔区域不由渲染器处理；焦点不被组件搬移。

## 数据

```ts
import type {GridLeaf, GridNode, GridLayoutResult} from "./grid-types";
import type {GridGestureCommit, GridGesturePreview} from "./grid-gesture";
import type {GridSashRef} from "./sash-gesture";
import type {SplitterGestureCancelReason, SplitterGestureSource} from "./splitter-gesture";

type GridRendererProps = {
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

type GridRendererEmits = {
    /** 手势建立并冻结上下文时发出。 */
    (event: "gesture-start", info: {sessionId: string; contextKey: string; source: SplitterGestureSource; revision: number; sashes: readonly GridSashRef[]}): void;
    /** 每次产生新几何预览时发出。 */
    (event: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 手势正常结束时发出最终提交；无变化时没有提交。 */
    (event: "gesture-end", commit: GridGestureCommit): void;
    /** 手势被取消时发出原因和参与分隔线。 */
    (event: "gesture-cancel", info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
    /** 会话诊断，包括容量不足、提交拒绝或宿主发布不匹配。 */
    (event: "issues", issues: readonly string[]): void;
};

type GridRendererSlots = {
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
- `state:inject`：向递归的 `Splitter` 提供共享 sash gesture scope，使整棵嵌套 Grid 共用一次会话；这让交叉处的两根轴能一起预览和一次提交，避免每个分支各自提交半场手势。没有这个父级时独立 `Splitter` 会自行建立 scope。
- `env:global`：`useSashGesture` 在手势根、`window` 和 `document` 上监听指针捕获/释放、窗口失焦与 Escape，并按 viewport pointer 坐标命中分隔线；组件卸载或会话结束时移除监听。该通道为手势生命周期服务，不是常驻快捷键。

## 上游边界

`Splitter` 负责面板渲染与 sash 输入绑定，`useSashGesture` 负责命中、指针/键盘生命周期、取消和手势仲裁；布局计算与手势求解由 grid 几何模块及 Grid session 提供。`GridRenderer` 承诺递归映射、预览呈现、事件和同步提交回调语义，不承诺这些局部模块未声明的实现细节。
