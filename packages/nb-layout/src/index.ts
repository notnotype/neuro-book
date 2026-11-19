/**
 * 核心入口：布局树、尺寸求解器、手势状态与落点几何。不依赖 Vue 与 DOM，插件激活时就能建模型，Bun 里也能测。
 * 组件与组合式函数在 `@notnotype/nb-layout/vue`。
 */
export * from "./grid";
/** 插件 SDK 导出的失败与诊断类型（Spec `ui/nested-grid` 失败 5、6，输出 139）：`./grid` 里也有，`sdk.test.ts` 按入口文件里写出的名字核对 SDK 的导出面，所以在这里写出名字。 */
export type {GridCommitFailureCode, GridFailure, GridHostIssueCode, GridIssue, GridIssueCode, GridLayoutCommitResult, GridParamValue} from "./grid-types";
export * from "./live-drop";
/** Vue 层读的 CSS 变量的清单（Spec `ui/nested-grid` 输出 141）：纯数据，宿主与 nb-ui 的桥接测试从核心入口取，不必经 Vue 层。 */
export {NB_LAYOUT_THEME_VARS} from "./theme-vars";
export type {NbLayoutThemeVar, NbLayoutVarName} from "./theme-vars";
export {clampFloatRect, placeGrid, resizeFloatRect} from "./grid-rects";
export type {GridContentInput, GridFloatInput, GridLeafShape, GridRect, LayoutFloatResize} from "./grid-rects";
export type {GridSwap, GridSwapWindow} from "./grid-swap";
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
export type {GridSashRef, SashGestureBinding, SashGestureCancelReason, SashGestureCommit, SashGestureHost, SashGestureSessionCore, SashGestureSource} from "./sash-gesture";
export {
    createGridGestureSession,
    projectGridGesture,
    type GridBranchChange,
    type GridGestureBaseline,
    type GridGestureCancellation,
    type GridGestureCommit,
    type GridGesturePreview,
    type GridGestureSession,
    type GridGestureSessionInput,
    type GridGestureStart,
} from "./grid-gesture";
export {
    type SplitterGestureCancellation,
    type SplitterGestureState,
} from "./splitter-gesture";
export {moveInSections, slotOfKey, SORTABLE_STICKY_PX, sortableSlotIn, sortableSlots} from "./sortable";
export type {SortableAxis, SortableLayout, SortableSection, SortableSlot, SortableSpan, SortableSwitch} from "./sortable";
