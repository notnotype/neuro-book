/**
 * 核心入口：工作台的布局文档、它到 nb-layout 布局树的投影、落点规则。纯 TS，不依赖 Vue 与 DOM：服务端经应用的
 * `workbench/shared/` 也导入这里。标签条在 `@notnotype/nb-workbench-layout/vue`。
 *
 * 入口是显式清单，一行一个名字，不用 `export *`：只列包外用到的名字，包内文件之间的零件（`holdsEditor`、`normalizeTree`、`isFixedChild` 一类）不导出。
 * 加或去一个名字就是改这份清单，`entry.test.ts` 对着它断言；宿主新用到一个名字时，在这里加一行。
 */
export {
    LAYOUT_DOC_VERSION,
    LAYOUT_MAX_FLOATS,
    REGION_ORIENTATION,
    activateTab,
    barOfRef,
    barRef,
    carryDynamicTabs,
    edgeTargetOf,
    findTab,
    findTreeNode,
    floatTab,
    hiddenRegionsAtZero,
    insertTab,
    isContainerAnchor,
    isFloating,
    isPanelShown,
    isSectionCollapsed,
    moveTabToEdge,
    moveTabToStrip,
    movePanelToEdge,
    openFloatPanel,
    openPanelAtEdge,
    panelRef,
    raiseFloat,
    regionNodeOf,
    regionOf,
    removeTab,
    replaceTab,
    roundFloatRect,
    sameLayoutShape,
    sameTreeShape,
    sectionCollapseBlock,
    setActiveContainer,
    setBarHidden,
    setContainerEntries,
    setContainerRail,
    setCurrentEditor,
    setFloatRail,
    setFloatRect,
    setPanelCollapsed,
    setPanelHidden,
    setSiblingShares,
    stripDynamicTabs,
    tabKey,
    treeEditorAnchor,
    treeLeaves,
} from "./layout-doc";
export type {
    LayoutBar,
    LayoutDoc,
    LayoutEdge,
    LayoutEdgeTarget,
    LayoutFloatRect,
    LayoutPolicy,
    LayoutResult,
    LayoutSource,
    PanelName,
    PanelRecord,
    RailIntent,
    TabRef,
} from "./layout-doc";
export {
    presentationCollapse,
    projectLayoutDoc,
    railLeafId,
    regionOfRailLeaf,
    regionOfStripLeaf,
    regionStripLeafId,
} from "./layout-project";
export type {
    LayoutProjection,
    LayoutProjectionOptions,
} from "./layout-project";
export {
    LAYOUT_FLOAT_EDGE_RATIO,
    applyLayoutDrop,
    enumerateDropCandidates,
    layoutDropKey,
    layoutDropOverPanel,
    layoutDropPanelAt,
    layoutDropSectors,
    layoutSeamsOf,
    previewEdgeDrop,
    previewPanelRects,
    rectContains,
    resolveLayoutDrop,
} from "./layout-drop";
export type {
    LayoutDropAction,
    LayoutDropCandidate,
    LayoutDropInput,
    LayoutDropPanelGeometry,
    LayoutDropSector,
    LayoutDropSectorId,
    LayoutDropSource,
} from "./layout-drop";
export {validateLayoutDoc} from "./layout-doc-validate";
// 意图回写只导出两个说清时机的入口，底下的 `rebaseIntents`、`fixedNodesOf` 不导出（模块头注释）。
export {applyGestureCommit, rebaseForOperation} from "./intent-writeback";
export type {IntentWritebackRejection} from "./intent-writeback";
