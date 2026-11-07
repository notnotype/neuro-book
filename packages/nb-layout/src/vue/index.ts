/**
 * Vue 层入口：分隔条、布局树的渲染器、拖放反馈，以及它们的组合式函数。依赖 nb-ui（主题、层级、翻译端口）。
 */
export {default as Splitter} from "./Splitter.vue";
export type {SplitterPanelConfig} from "./grid-splitter";
export {default as NestedGrid} from "./NestedGrid.vue";
export {default as DropFeedbackOverlay} from "./DropFeedbackOverlay.vue";
export {default as DropSectorsOverlay} from "./DropSectorsOverlay.vue";
export type {DropFeedbackPreview} from "./DropFeedbackOverlay.vue";
export {default as DropIndicatorLabel} from "./DropIndicatorLabel.vue";
export {default as TabStrip} from "./TabStrip.vue";
export type {TabStripItem, TabStripPartition} from "./TabStrip.vue";
export {measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStops} from "./tab-strip-geometry";
export type {TabStripInsertion, TabStripSnapshot} from "./tab-strip-geometry";
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
