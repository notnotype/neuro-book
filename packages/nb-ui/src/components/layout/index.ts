/**
 * 布局原语入口：只含 grid、Splitter、递归渲染器与投影。
 *
 * 给不渲染组件树、只做几何与结构的消费者（会话、存储宿主、编辑组工具）用——
 * 它们不该为了一个 `createGrid` 把整个组件桶（几十个控件与表单组件）拉进模块图。
 * 组件消费者继续走 `@notnotype/nb-ui/components`。
 */
export * from "./grid";
export * from "./grid-splitter";
export * from "./sash-drag";
export {
    GRID_DROP_INDICATOR_PX,
    GRID_EDGE_RATIO_DEFAULT,
    isGridDropRect,
    resolveGridEdgeDrop,
    resolveGridInsertion,
    resolveListInsertion,
    type GridDropMember,
    type GridDropPoint,
    type GridDropRect,
    type GridEdgeDrop,
    type GridInsertion,
    type GridListInsertion,
} from "./grid-drop";
export {
    SASH_HOVER_DELAY_MS,
    acquireSashCursor,
    sashCursorFor,
    sashHitKey,
    type SashCursor,
    type SashCursorOwner,
} from "./sash-feedback";
export {
    SASH_HIT_MARGIN,
    collectSashHits,
    hitTestSashBand,
    sashDistance,
    sashHitMargin,
    type SashHitTarget,
    type SashPoint,
    type SashPointerKind,
    type SashRect,
} from "./sash-hit-area";
export {
    EPSILON,
    GRID_UNBOUNDED,
    UNBOUNDED_EXTENT,
    ZERO_EXTENT,
    allocateAxis,
    allocateSashPanels,
    clampAxis,
    collapsePolicyProblem,
    constraintsOf,
    crossAxisOf,
    extentOf,
    finite,
    layoutOf,
    normCollapse,
    normConstraint,
    normExtent,
    readExtent,
    round,
    sashPanelBounds,
    shareAxis,
    type GridSashResolver,
    type SashPanel,
} from "./grid-geometry";
export {default as Splitter} from "./Splitter.vue";
export {default as GridRenderer} from "./GridRenderer.vue";
export type {SplitterPanelConfig} from "./Splitter.vue";
export {SASH_GESTURE_SCOPE_KEY, useSashScope} from "./sash-scope";
export {createSplitterSession, type SplitterGestureChange, type SplitterGestureSession} from "./splitter-session";
export type {GridSashRef, SashGestureBinding, SashGestureCommit, SashGestureHost, SashGestureSessionCore} from "./sash-gesture";
export {
    createGridGestureSession,
    projectGridGesture,
    type GridBranchChange,
    type GridGestureBaseline,
    type GridGestureCommit,
    type GridGesturePreview,
    type GridGestureSession,
    type GridGestureSessionInput,
} from "./grid-gesture";
export {
    SASH_COLLAPSE_THRESHOLD,
    sashEdgeDelta,
    solveSashCollapse,
    solveSashDrag,
    type SashDragInput,
    type SashDragResult,
    type SashDragSnapState,
} from "./sash-drag";
export {
    type SplitterGestureCancellation,
    type SplitterGestureCancelReason,
    type SplitterGestureSource,
    type SplitterGestureState,
} from "./splitter-gesture";
