/**
 * Vue 层入口：分隔条、布局树的渲染器、拖放反馈，以及它们的组合式函数。只依赖 `vue` 与 `tabbable`：主题经本包命名空间下的
 * CSS 变量取（名字与回退的清单在 `../theme-vars.ts`），文字经 `./text` 的注入点取。
 */
import "./global.css";

export {default as Splitter} from "./Splitter.vue";
export type {SplitterPanelConfig} from "./grid-splitter";
export {default as NestedGrid} from "./NestedGrid.vue";
export {default as DropFeedbackOverlay} from "./DropFeedbackOverlay.vue";
export {default as DropSectorsOverlay} from "./DropSectorsOverlay.vue";
export {default as FloatWindowHandles} from "./FloatWindowHandles.vue";
export type {DropFeedbackPreview} from "./DropFeedbackOverlay.vue";
export {default as DropIndicatorLabel} from "./DropIndicatorLabel.vue";
export {default as SortableList} from "./SortableList.vue";
export {useSortable} from "./useSortable";
export type {SortableHandle, SortableMove, UseSortableOptions} from "./useSortable";
export {
    SASH_HOVER_DELAY_MS,
    acquireSashCursor,
    sashCursorFor,
    sashHitKey,
    type SashCursor,
    type SashCursorOwner,
} from "./sash-feedback";
export {SASH_GESTURE_SCOPE_KEY, useSashScope} from "./sash-scope";
export type {DragState} from "../drag-gesture";
export {moveGridFocus} from "./grid-focus";
export {layoutMotionMs} from "./layout-motion";
export {createDragSession} from "./drag-session";
export type {DragKeyboardOptions, DragQuery, DragSession, DragSessionOptions} from "./drag-session";
export {dropTargetAt, registerDropTarget, useDropTarget} from "./drop-targets";
export * from "./useLayoutExtent";
export * from "./useGridLayout";
export * from "./useSashGesture";
