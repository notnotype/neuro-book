import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {hasDefaultExport, hasStarExport, moduleExports} from "@notnotype/neuro-book-test-support/module-exports";

import * as entry from "./index";

/**
 * 核心入口是显式清单（`index.ts`）：只列包外用到的名字，包内文件之间的零件不导出。加或去一个名字要同时改这里的清单，评审时看得见；
 * 宿主新用到的名字在清单里加一行，不要改回 `export *`。
 */
const VALUES: ReadonlyArray<string> = [
    "LAYOUT_DOC_VERSION",
    "LAYOUT_FLOAT_EDGE_RATIO",
    "LAYOUT_MAX_FLOATS",
    "REGION_ORIENTATION",
    "activateTab",
    "applyGestureCommit",
    "applyLayoutDrop",
    "barOfRef",
    "barRef",
    "carryDynamicTabs",
    "edgeTargetOf",
    "enumerateDropCandidates",
    "findTab",
    "findTreeNode",
    "floatTab",
    "hiddenRegionsAtZero",
    "insertTab",
    "isContainerAnchor",
    "isFloating",
    "isPanelShown",
    "isSectionCollapsed",
    "layoutDropKey",
    "layoutDropOverPanel",
    "layoutDropPanelAt",
    "layoutDropSectors",
    "layoutSeamsOf",
    "movePanelToEdge",
    "moveTabToEdge",
    "moveTabToStrip",
    "openFloatPanel",
    "openPanelAtEdge",
    "panelRef",
    "presentationCollapse",
    "previewEdgeDrop",
    "previewPanelRects",
    "projectLayoutDoc",
    "railLeafId",
    "regionOfRailLeaf",
    "raiseFloat",
    "rebaseForOperation",
    "rectContains",
    "regionNodeOf",
    "regionOf",
    "regionOfStripLeaf",
    "regionStripLeafId",
    "removeTab",
    "replaceTab",
    "resolveLayoutDrop",
    "roundFloatRect",
    "sameLayoutShape",
    "sameTreeShape",
    "sectionCollapseBlock",
    "setActiveContainer",
    "setBarHidden",
    "setContainerEntries",
    "setContainerRail",
    "setCurrentEditor",
    "setFloatRail",
    "setFloatRect",
    "setPanelCollapsed",
    "setPanelHidden",
    "setSiblingShares",
    "stripDynamicTabs",
    "tabKey",
    "treeEditorAnchor",
    "treeLeaves",
    "validateLayoutDoc",
];

const TYPES: ReadonlyArray<string> = [
    "IntentWritebackRejection",
    "LayoutBar",
    "LayoutDoc",
    "LayoutDropAction",
    "LayoutDropCandidate",
    "LayoutDropInput",
    "LayoutDropPanelGeometry",
    "LayoutDropSector",
    "LayoutDropSectorId",
    "LayoutDropSource",
    "LayoutEdge",
    "LayoutEdgeTarget",
    "LayoutFloatRect",
    "LayoutPolicy",
    "LayoutProjection",
    "LayoutProjectionOptions",
    "LayoutResult",
    "LayoutSource",
    "PanelName",
    "PanelRecord",
    "RailIntent",
    "TabRef",
];

const entryText = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

describe("nb-workbench-layout 的入口", () => {
    it("入口是显式清单：不用 `export *`、不用默认导出；值与类型的名字和这里的清单一一对上", () => {
        expect(hasStarExport(entryText)).toBe(false);
        expect(hasDefaultExport(entryText)).toBe(false);
        const listed = moduleExports(entryText);
        expect(listed.filter((item) => item.kind === "value").map((item) => item.name).sort()).toEqual([...VALUES].sort());
        expect(listed.filter((item) => item.kind === "type").map((item) => item.name).sort()).toEqual([...TYPES].sort());
    });

    it("清单里的值运行时都在", () => {
        expect(Object.keys(entry).sort()).toEqual([...VALUES].sort());
    });

    /** 意图回写只有两个说清时机的函数（docs/specs/ui/workbench-layout.md 输出 49）：底下的零件漏传参数不报错，不交给宿主。 */
    it("导出 applyGestureCommit、rebaseForOperation，不导出 rebaseIntents、fixedNodesOf", () => {
        expect(typeof entry.applyGestureCommit).toBe("function");
        expect(typeof entry.rebaseForOperation).toBe("function");
        expect(Object.hasOwn(entry, "rebaseIntents")).toBe(false);
        expect(Object.hasOwn(entry, "fixedNodesOf")).toBe(false);
    });
});
