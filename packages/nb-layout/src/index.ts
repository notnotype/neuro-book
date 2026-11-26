/**
 * 核心入口：布局树、尺寸求解器、手势状态与落点几何。不依赖 Vue 与 DOM，插件激活时就能建模型，Bun 里也能测。
 * 组件与组合式函数在 `@notnotype/nb-layout/vue`。
 *
 * 入口是显式清单，一行一个名字：这里的名字就是公开面（Spec `ui/nested-grid` 的“边界与兼容”），文件里别的导出是内部的，库内用
 * 相对路径导入。加一个导出就是改这份清单，评审时看得见；`exports.test.ts` 拦 `export *`。
 */

/* 网格：建树、结构操作、快照（`grid.md`） */
export {
    createGrid,
    restoreGrid,
} from "./grid";
export type {
    Grid,
    GridRestoredGrid,
} from "./grid";

/* 网格的数据类型、上限常数、失败与诊断（Spec `ui/nested-grid` 失败 5 到 7、输出 139） */
export {
    GRID_MAX_DEPTH,
    GRID_MAX_NODES,
    GRID_SNAPSHOT_VERSION,
} from "./grid-types";
export type {
    GridAxis,
    GridBranch,
    GridBranchesResizeResult,
    GridBranchInput,
    GridBranchResize,
    GridCollapseOptions,
    GridCollapseResult,
    GridCommitFailureCode,
    GridConstraint,
    GridDroppedRef,
    GridExtent,
    GridFailure,
    GridFailureCode,
    GridHostIssueCode,
    GridIssue,
    GridIssueCode,
    GridLayoutCommitResult,
    GridLayoutResult,
    GridLeaf,
    GridLeafInput,
    GridNode,
    GridNodeInput,
    GridOptions,
    GridOrientation,
    GridParamValue,
    GridRefEncoder,
    GridRefResolution,
    GridRefResolver,
    GridRestoreFailureCode,
    GridRestoreResult,
    GridSetSizeResult,
    GridResult,
    GridSizing,
    GridSnapshot,
    GridSnapshotBranch,
    GridSnapshotLeaf,
    GridSnapshotNode,
    GridSplitInput,
    GridSplitSide,
    SashCollapsePolicy,
    SashCollapseState,
    SplitterCollapseState,
} from "./grid-types";

/* 开发模式的配置检查（Spec `ui/nested-grid` 输出 151） */
export {
    setLayoutDevChecks,
} from "./dev-checks";

/* 尺寸求解对外的常数与类型 */
export {
    GRID_UNBOUNDED,
    UNBOUNDED_EXTENT,
} from "./grid-geometry";
export type {
    GridSashResolver,
    SashPanel,
} from "./grid-geometry";

/* 矩形：把布局摆成卡片、浮动窗的夹取与缩放 */
export {
    clampFloatRect,
    placeGrid,
    resizeFloatRect,
} from "./grid-rects";
export type {
    GridContentInput,
    GridFloatInput,
    GridLeafShape,
    GridRect,
    LayoutFloatResize,
} from "./grid-rects";

/* 分隔线手势的公共合同：`NestedGrid` 与独立 `Splitter` 共用 */
export type {
    GridSashRef,
    SashGestureCancelReason,
    SashGestureCommit,
    SashGestureSessionCore,
    SashGestureSource,
} from "./sash-gesture";

/* `NestedGrid` 的手势会话与事件载荷 */
export {
    createGridGestureSession,
} from "./grid-gesture";
export type {
    GridBranchChange,
    GridGestureBaseline,
    GridGestureCancellation,
    GridGestureCommit,
    GridGesturePreview,
    GridGestureSession,
    GridGestureSessionInput,
    GridGestureStart,
} from "./grid-gesture";

/* 独立 `Splitter` 的事件载荷 */
export type {
    SplitterGestureCancellation,
    SplitterGestureState,
} from "./splitter-gesture";

/* 落点几何 */
export {
    resolveGridEdgeDrop,
    resolveListInsertion,
} from "./grid-drop";
export type {
    GridDropMember,
    GridDropPoint,
    GridDropRect,
    GridEdgeDrop,
    GridListInsertion,
} from "./grid-drop";

/* 交换 */
export type {
    GridSwap,
    GridSwapWindow,
} from "./grid-swap";

/* 拖动手势的配置与落点种类 */
export {
    defineDropKind,
    DRAG_GESTURE_DEFAULTS,
} from "./drag-gesture";
export type {
    DragCancelReason,
    DragEnd,
    DragGestureConfig,
    DropKind,
} from "./drag-gesture";

/* 公开签名里出现的类型（拖动会话的状态与宿主回调）；产生它们的低层函数不从入口导出 */
export type {
    DragCardSize,
} from "./drag-card";
export type {
    LivePreview,
} from "./live-drop";

/* 可排序列表的几何 */
export {
    moveInSections,
    slotOfKey,
    SORTABLE_STICKY_PX,
    sortableSlotIn,
    sortableSlots,
} from "./sortable";
export type {
    SortableAxis,
    SortableLayout,
    SortableSection,
    SortableSlot,
    SortableSpan,
    SortableSwitch,
} from "./sortable";

/* Vue 层读的 CSS 变量的清单（Spec `ui/nested-grid` 输出 141） */
export {
    NB_LAYOUT_THEME_VARS,
} from "./theme-vars";
export type {
    NbLayoutThemeVar,
    NbLayoutVarName,
} from "./theme-vars";
