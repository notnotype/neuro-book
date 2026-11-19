/**
 * Vue 层入口：分隔条、布局树的渲染器、拖放反馈，以及它们的组合式函数。只依赖 `vue` 与 `tabbable`：主题经本包命名空间下的
 * CSS 变量取（名字与回退的清单在 `../theme-vars.ts`），文字经 `./text` 的注入点取。
 *
 * 入口是显式清单，一行一个名字，规则同核心入口（`../index.ts`）。
 */
import "./global.css";

/* 组件 */
export {default as NestedGrid} from "./NestedGrid.vue";
export {default as Splitter} from "./Splitter.vue";
export {default as SortableList} from "./SortableList.vue";
export {default as DropFeedbackOverlay} from "./DropFeedbackOverlay.vue";
export {default as DropSectorsOverlay} from "./DropSectorsOverlay.vue";
export {default as DropIndicatorLabel} from "./DropIndicatorLabel.vue";
export {default as FloatWindowHandles} from "./FloatWindowHandles.vue";

/* 组件的类型 */
export type {
    DropFeedbackPreview,
} from "./DropFeedbackOverlay.vue";
export type {
    SplitterPanelConfig,
} from "./grid-splitter";

/* 宿主接 `NestedGrid`：量容器、算布局、接纳手势的提交 */
export {
    useGridLayout,
} from "./useGridLayout";
export type {
    GridLayoutHost,
} from "./useGridLayout";
export {
    useLayoutExtent,
} from "./useLayoutExtent";

/* 焦点在叶之间移动 */
export {
    moveGridFocus,
} from "./grid-focus";

/* 布局过渡的时长 */
export {
    layoutMotionMs,
} from "./layout-motion";

/* 可排序列表的组合式函数 */
export {
    useSortable,
} from "./useSortable";
export type {
    SortableHandle,
    SortableMove,
    UseSortableOptions,
} from "./useSortable";

/* 拖动会话与落点登记（Spec `ui/layout-drag`） */
export {
    createDragSession,
} from "./drag-session";
export type {
    DragKeyboardOptions,
    DragQuery,
    DragSession,
    DragSessionOptions,
} from "./drag-session";
export {
    dropTargetAt,
    registerDropTarget,
    useDropTarget,
} from "./drop-targets";

/* 核心入口里的类型，Vue 层的签名里用到 */
export type {
    DragState,
} from "../drag-gesture";
export type {
    GridLayoutCommitResult,
} from "../grid-types";
