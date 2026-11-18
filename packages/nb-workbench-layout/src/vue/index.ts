/**
 * Vue 层入口：工作台的标签条与它的几何。依赖 nb-ui（下拉菜单、标签自适应、roving 焦点）与 nb-layout 的落点几何。
 */
export {default as TabStrip} from "./TabStrip.vue";
export type {TabStripItem, TabStripPartition} from "./TabStrip.vue";
export {measureTabStrip, resolveTabStripInsertion, tabStripInsertionIn, tabStripStops, translateTabStrip} from "./tab-strip-geometry";
export type {TabStripHeld, TabStripInsertion, TabStripSnapshot} from "./tab-strip-geometry";
