/**
 * 判定几何的纯计算（docs/specs/ui/workbench-layout.md 输出 38）：来源收起后每块面板挪到哪、入口条怎么补位，标签条里排序写多少位移，整窗夹在哪。
 *
 * 拿起时的几何按真实 DOM 的几层盒子造：卡片比叶缩 4px，头在卡片顶上 28px 高，标签条比头左右各缩 12px，三者不重合。
 * 期望值是按 1440×900 的默认布局收起前后的矩形手算的常数，不调投影求期望，测试和实现才不是同一个式子。
 */

import {describe, expect, it} from "bun:test";

import {previewPanelRects, removeTab, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridDropRect, GridExtent} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutDropPanelGeometry, LayoutResult} from "@notnotype/nb-workbench-layout";

import {collapsedGeometry, heldTabIn, sortedOffset, stripIndex, windowRect} from "./drag-geometry";
import type {EntryBand, FrozenGeometry} from "./drag-geometry";
import type {ContainerCatalog} from "./state/containers";
import {defaultLayoutDoc} from "./state/default-tree";
import {FLOAT_KEEP_WIDTH, keepVisible, layoutProjectionOptions, PANEL_HEAD_HEIGHT, wholeInTree} from "./state/layout-constraints";
import type {ViewCatalog} from "./views/registry";

const VIEW = (location: "sidebar" | "auxiliarybar" | "panel", over: {readonly container?: string; readonly order?: number} = {}) => ({title: {"zh-CN": location, "en-US": location}, icon: "i", location, layout: "scroll" as const, ...over});
const PROJECT = "acme.project";
const AUX = "acme.aux";
const CONTAINERS: ContainerCatalog = new Map([
    [PROJECT, {title: {"zh-CN": "项目", "en-US": "Project"}, icon: "i", location: "sidebar", order: 0}],
    [AUX, {title: {"zh-CN": "辅助", "en-US": "Aux"}, icon: "i", location: "auxiliarybar", order: 0}],
]);
/** 侧栏：“项目”（文件、大纲两节，当前容器）、“搜索”、“书签”各一个入口；右栏一个容器两节（对话、笔记）；底部面板一节（终端）。 */
const CATALOG: ViewCatalog = new Map([
    ["files", VIEW("sidebar", {container: PROJECT, order: 0})],
    ["outline", VIEW("sidebar", {container: PROJECT, order: 1})],
    ["search", VIEW("sidebar", {order: 1})],
    ["marks", VIEW("sidebar", {order: 2})],
    ["chat", VIEW("auxiliarybar", {container: AUX, order: 0})],
    ["notes", VIEW("auxiliarybar", {container: AUX, order: 1})],
    ["terminal", VIEW("panel")],
]);
const EXTENT: GridExtent = {width: 1440, height: 900};
const DOC = defaultLayoutDoc(CATALOG, CONTAINERS);
const LAYOUT = {extent: EXTENT, projection: layoutProjectionOptions({doc: DOC, catalog: CATALOG, viewportWidth: EXTENT.width}), dpr: 1};

/**
 * 默认布局里每块叶的矩形（1440×900）：活动栏 48、侧栏 340、右栏 400、右轨 48（输出 50），三条缝各 1，编辑区 602；状态栏 22，下面 878 高。
 * 右栏顶上没有入口条（入口在右轨上），两节各占一半。
 */
const LEAVES: Readonly<Record<string, GridDropRect>> = {
    "section:files": {left: 48, top: 0, right: 388, bottom: 439},
    "section:outline": {left: 48, top: 440, right: 388, bottom: 878},
    g0: {left: 389, top: 0, right: 991, bottom: 677},
    "section:terminal": {left: 389, top: 710, right: 991, bottom: 878},
    "section:chat": {left: 992, top: 0, right: 1392, bottom: 439},
    "section:notes": {left: 992, top: 440, right: 1392, bottom: 878},
};

function measured(id: string): LayoutDropPanelGeometry {
    const leaf = LEAVES[id] as GridDropRect;
    const frame = {left: leaf.left + 4, top: leaf.top + 4, right: leaf.right - 4, bottom: leaf.bottom - 4};
    return {id, frame, strip: {left: frame.left + 12, top: frame.top, right: frame.right - 12, bottom: frame.top + 28}, body: {...frame, top: frame.top + 28}};
}

const SIDEBAR_BAND: EntryBand = {
    region: "sidebar",
    axis: "y",
    row: {left: 0, top: 0, right: 48, bottom: 878},
    groupEnd: 878,
    merged: null,
    rect: {left: 0, top: 0, right: 48, bottom: 878},
    entries: [{container: PROJECT, start: 8, end: 40}, {container: "view:search", start: 48, end: 80}, {container: "view:marks", start: 88, end: 120}],
};
/** 右轨的入口带（输出 50）：同活动栏竖着排，在右栏外侧。 */
const AUX_BAND: EntryBand = {region: "auxiliarybar", axis: "y", row: {left: 1392, top: 0, right: 1440, bottom: 878}, groupEnd: 878, merged: null, rect: {left: 1392, top: 0, right: 1440, bottom: 878}, entries: [{container: AUX, start: 8, end: 40}]};
const PANEL_BAND: EntryBand = {region: "panel", axis: "x", row: {left: 389, top: 678, right: 991, bottom: 710}, groupEnd: 450, merged: "section:terminal", rect: {left: 389, top: 678, right: 450, bottom: 710}, entries: [{container: "view:terminal", start: 393, end: 425}]};

const KEPT: FrozenGeometry = {
    geometry: {panels: Object.keys(LEAVES).map(measured), floats: [], excluded: [], bands: [SIDEBAR_BAND, AUX_BAND, PANEL_BAND], origin: {x: 0, y: 0}},
    strips: new Map(),
    heldTab: {width: 90, grab: 0.25},
};

function must(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.doc;
}
const collapse = (tab: string): FrozenGeometry => collapsedGeometry(KEPT, DOC, must(removeTab(DOC, tab)), LAYOUT);
const panelOf = (geometry: FrozenGeometry, id: string): LayoutDropPanelGeometry | undefined => geometry.geometry.panels.find((item) => item.id === id);

describe("来源收起后的判定几何", () => {
    it("测试用的叶矩形就是这份布局投影出来的：常数过时了在这里先红", () => {
        const ids = treeLeaves(DOC.tree.root).map((leaf) => leaf.id).filter((id) => id in LEAVES);
        expect(ids.toSorted()).toEqual(Object.keys(LEAVES).toSorted());
        expect(previewPanelRects(DOC, ids, LAYOUT.projection, EXTENT, 1)).toEqual(LEAVES);
    });

    it("侧栏一个容器两节，摘掉上面那节：下面那节上移 440，头高不变、正文长满；摘掉的那节不再是落点", () => {
        const after = collapse("view:files");
        expect(panelOf(after, "section:files")).toBeUndefined();
        expect(panelOf(after, "section:outline")).toEqual({
            id: "section:outline",
            frame: {left: 52, top: 4, right: 384, bottom: 874},
            strip: {left: 64, top: 4, right: 372, bottom: 32},
            body: {left: 52, top: 32, right: 384, bottom: 874},
        });
        // 别的面板没挪。
        expect(panelOf(after, "g0")).toEqual(measured("g0"));
        expect(after.heldTab).toEqual(KEPT.heldTab);
    });

    it("底部面板唯一一节：编辑组往下长 200，头不动；底部面板与它的入口条不再是落点", () => {
        const after = collapse("view:terminal");
        expect(panelOf(after, "g0")).toEqual({
            id: "g0",
            frame: {left: 393, top: 4, right: 987, bottom: 873},
            strip: {left: 405, top: 4, right: 975, bottom: 32},
            body: {left: 393, top: 32, right: 987, bottom: 873},
        });
        expect(panelOf(after, "section:terminal")).toBeUndefined();
        expect(after.geometry.bands.map((band) => band.region)).toEqual(["sidebar", "auxiliarybar"]);
    });

    it("右栏的容器剩一节：剩下那节长满、头跟着上沿走；右轨还在，整条是落点，入口不动（输出 50，没有并进来的头）", () => {
        const after = collapse("view:notes");
        expect(panelOf(after, "section:notes")).toBeUndefined();
        expect(panelOf(after, "section:chat")).toEqual({
            id: "section:chat",
            frame: {left: 996, top: 4, right: 1388, bottom: 874},
            strip: {left: 1008, top: 4, right: 1376, bottom: 32},
            body: {left: 996, top: 32, right: 1388, bottom: 874},
        });
        expect(after.geometry.bands.find((item) => item.region === "auxiliarybar")).toEqual(AUX_BAND);
    });

    it("右栏唯一的容器只剩来源：摘掉后右栏空了，右轨不在，不再是落点", () => {
        const withoutNotes = must(removeTab(DOC, "view:notes"));
        const after = collapsedGeometry(KEPT, withoutNotes, must(removeTab(withoutNotes, "view:chat")), LAYOUT);
        expect(after.geometry.bands.map((band) => band.region)).toEqual(["sidebar", "panel"]);
    });

    it("来源是它容器唯一的视图：活动栏上它的入口没了，后面的往前补一格（到下一个入口的距离）", () => {
        const after = collapse("view:search");
        expect(after.geometry.bands.find((band) => band.region === "sidebar")?.entries).toEqual([{container: PROJECT, start: 8, end: 40}, {container: "view:marks", start: 48, end: 80}]);
    });

    describe("横向的入口条（底部面板）", () => {
        /** 侧栏一节（文件）；底部面板两个各只有一个视图的容器：终端（当前，并进入口条）、输出。 */
        const catalog: ViewCatalog = new Map([["files", VIEW("sidebar")], ["chat", VIEW("auxiliarybar")], ["terminal", VIEW("panel", {order: 0})], ["output", VIEW("panel", {order: 1})]]);
        const doc = defaultLayoutDoc(catalog);
        const layout = {extent: EXTENT, projection: layoutProjectionOptions({doc, catalog, viewportWidth: EXTENT.width}), dpr: 1};
        const band: EntryBand = {
            region: "panel",
            axis: "x",
            row: {left: 389, top: 678, right: 1039, bottom: 710},
            groupEnd: 470,
            merged: "section:terminal",
            rect: {left: 389, top: 678, right: 470, bottom: 710},
            entries: [{container: "view:terminal", start: 393, end: 425}, {container: "view:output", start: 433, end: 465}],
        };
        const kept: FrozenGeometry = {geometry: {panels: [], floats: [], excluded: [], bands: [band], origin: {x: 0, y: 0}}, strips: new Map(), heldTab: null};
        const bandAfter = (tab: string): EntryBand | undefined => collapsedGeometry(kept, doc, must(removeTab(doc, tab)), layout).geometry.bands[0];

        it("侧栏收走了：入口条整条跟着它的叶左移 340，入口与组末端一起移，落点那一段只到入口这一组", () => {
            expect(bandAfter("view:files")).toEqual({
                ...band,
                row: {left: 49, top: 678, right: 1039, bottom: 710},
                groupEnd: 130,
                rect: {left: 49, top: 678, right: 130, bottom: 710},
                entries: [{container: "view:terminal", start: 53, end: 85}, {container: "view:output", start: 93, end: 125}],
            });
        });

        it("最后一个入口的容器只有来源：入口没了，组末端往回补它自己的长度，入口条不动", () => {
            expect(bandAfter("view:output")).toEqual({...band, groupEnd: 438, rect: {left: 389, top: 678, right: 438, bottom: 710}, entries: [{container: "view:terminal", start: 393, end: 425}]});
        });
    });

    it("容器还没量到：照旧用拿起时的", () => {
        expect(collapsedGeometry(KEPT, DOC, must(removeTab(DOC, "view:files")), {...LAYOUT, extent: null})).toBe(KEPT);
    });
});

describe("标签条里跟手的标签", () => {
    it("拿起时的宽度与按下的点在它上面的比例；按下的点不在它上面、量不到时按指针判", () => {
        const rect = {left: 100, top: 0, right: 180, bottom: 30};
        expect(heldTabIn(rect, {x: 120, y: 10})).toEqual({width: 80, grab: 0.25});
        expect(heldTabIn(rect, {x: 90, y: 10})).toBeNull();
        expect(heldTabIn({left: 100, top: 0, right: 100, bottom: 30}, {x: 100, y: 10})).toBeNull();
        expect(heldTabIn(null, {x: 120, y: 10})).toBeNull();
    });

    it("位移：抓点第一次定下，之后沿条跟着指针，夹在条的两端之间", () => {
        const base = {rect: {left: 100, top: 0, width: 80, height: 30}, translate: "", bounds: {left: 50, top: 0, right: 400, bottom: 30}, vertical: false};
        const first = sortedOffset({...base, point: {x: 130, y: 10}, grab: null});
        expect(first).toEqual({grab: 0.375, translate: "0px"});
        expect(sortedOffset({...base, point: {x: 200, y: 10}, grab: first.grab}).translate).toBe("70px");
        expect(sortedOffset({...base, point: {x: 10, y: 10}, grab: first.grab}).translate).toBe("-50px");
        expect(sortedOffset({...base, point: {x: 1000, y: 10}, grab: first.grab}).translate).toBe("220px");
    });

    it("位移：元素上已经写着位移时按它算静止的位置，写出来的和元素上的一样就不用重写", () => {
        const shifted = {rect: {left: 170, top: 0, width: 80, height: 30}, translate: "70px", bounds: {left: 50, top: 0, right: 400, bottom: 30}, vertical: false};
        expect(sortedOffset({...shifted, point: {x: 200, y: 10}, grab: 0.375})).toEqual({grab: 0.375, translate: "70px"});
    });

    it("位移：条比标签还短时贴着条的起点；抓点夹在 0 到 1 之间，标签没有宽度时抓在正中", () => {
        const bounds = {left: 50, top: 0, right: 100, bottom: 30};
        expect(sortedOffset({rect: {left: 100, top: 0, width: 80, height: 30}, translate: "", bounds, vertical: false, point: {x: 300, y: 10}, grab: 0.5}).translate).toBe("-50px");
        const wide = {left: 0, top: 0, right: 1000, bottom: 30};
        expect(sortedOffset({rect: {left: 100, top: 0, width: 80, height: 30}, translate: "", bounds: wide, vertical: false, point: {x: 40, y: 10}, grab: null}).grab).toBe(0);
        expect(sortedOffset({rect: {left: 100, top: 0, width: 80, height: 30}, translate: "", bounds: wide, vertical: false, point: {x: 400, y: 10}, grab: null}).grab).toBe(1);
        expect(sortedOffset({rect: {left: 100, top: 0, width: 0, height: 30}, translate: "", bounds: wide, vertical: false, point: {x: 100, y: 10}, grab: null}).grab).toBe(0.5);
    });

    it("位移：活动栏是竖着的，写成浏览器读回来的 `0px Npx`", () => {
        const placed = sortedOffset({rect: {left: 0, top: 100, width: 48, height: 32}, translate: "0px 10px", bounds: {left: 0, top: 0, right: 48, bottom: 878}, vertical: true, point: {x: 24, y: 120}, grab: null});
        expect(placed).toEqual({grab: 0.9375, translate: "0px 0px"});
    });
});

describe("标签在文档里的下标", () => {
    const doc: LayoutDoc = {...DOC, panels: {...DOC.panels, g0: {...(DOC.panels.g0 as LayoutDoc["panels"][string]), tabs: ["a", "b", "c", "d"].map((viewId) => ({kind: "view" as const, viewId}))}}};

    it("按量到的邻居在文档里找：插在后邻居之前、前邻居之后，都没有是末尾", () => {
        expect(stripIndex(doc, "g0", {before: "view:b", after: "view:a"})).toBe(1);
        expect(stripIndex(doc, "g0", {before: null, after: "view:b"})).toBe(2);
        expect(stripIndex(doc, "g0", {before: null, after: null})).toBe(4);
    });

    it("收进“更多”的标签不在 DOM 里：量到的邻居在文档里不相邻，下标仍按文档", () => {
        // 看得见的只有 a 和 d：插在 d 前面，文档里是第 3 个。
        expect(stripIndex(doc, "g0", {before: "view:d", after: "view:a"})).toBe(3);
    });
});

describe("整窗此刻的矩形", () => {
    const drag = {panel: "f", grab: {x: 10, y: 5}, origin: {x: 100, y: 50}, from: {x: 0, y: 0}, shown: {width: 300, height: 200}, size: {width: 320, height: 240}};

    it("抓住的点在指针下，大小还是记录里的", () => {
        expect(windowRect(drag, {x: 150, y: 60}, {width: 1000, height: 800})).toEqual({x: 40, y: 5, width: 320, height: 240});
    });

    it("拖到树区域外：按呈现的大小夹，留一段头抓得到；往下拖出去时头留在里面", () => {
        expect(windowRect(drag, {x: 2000, y: 60}, {width: 1000, height: 800})).toEqual({x: 1000 - FLOAT_KEEP_WIDTH, y: 5, width: 320, height: 240});
        expect(windowRect(drag, {x: 150, y: 5000}, {width: 1000, height: 800})).toEqual({x: 40, y: 800 - PANEL_HEAD_HEIGHT, width: 320, height: 240});
    });

    it("容器还没量到：不夹", () => {
        expect(windowRect(drag, {x: 2000, y: 5000}, null)).toEqual({x: 1890, y: 4945, width: 320, height: 240});
    });

    it("新开的窗整个夹回树区域，拖窗只保证留一段头", () => {
        const rect = {x: 900, y: 700, width: 300, height: 200};
        expect(wholeInTree(rect, {width: 1000, height: 800})).toEqual({x: 700, y: 600, width: 300, height: 200});
        expect(keepVisible(rect, {width: 1000, height: 800})).toEqual({x: 900, y: 700, width: 300, height: 200});
        expect(wholeInTree(rect, null)).toBe(rect);
    });
});
