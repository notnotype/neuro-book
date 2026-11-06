/**
 * 核心入口：布局树、尺寸求解器、手势状态与落点几何。不依赖 Vue 与 DOM，插件激活时就能建模型，Bun 里也能测。
 * 组件与组合式函数在 `@notnotype/nb-layout/vue`。
 */
export * from "./grid";
export * from "./layout-doc";
export * from "./layout-project";
export * from "./layout-drop";
export * from "./sash-drag";
export {
    DRAG_GESTURE_DEFAULTS,
    defineDropKind,
    type DragCancelReason,
    type DragEnd,
    type DragGestureConfig,
    type DropKind,
} from "./drag-gesture";
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
    type SplitterGestureCancellation,
    type SplitterGestureCancelReason,
    type SplitterGestureSource,
    type SplitterGestureState,
} from "./splitter-gesture";
