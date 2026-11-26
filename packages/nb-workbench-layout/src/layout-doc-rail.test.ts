import {describe, expect, it} from "bun:test";

import {docOf, H, tab, testPolicy, V} from "./layout-doc-fixtures";
import {carryDynamicTabs, edgeTargetOf, floatTab, insertTab, movePanelToEdge, sameLayoutShape, setContainerEntries, setContainerRail, stripDynamicTabs} from "./layout-doc";
import {validateLayoutDoc} from "./layout-doc-validate";
import type {LayoutDoc, LayoutEdge, LayoutResult, PanelRecord} from "./layout-doc";

/** 侧轨意图在布局文档里（docs/specs/ui/workbench-layout.md 输出 50 的“展开”、输出 51 的“矩形”）。 */

function okDoc(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`操作失败：${result.code} ${result.message}`);
    return result.doc;
}

const edge = (doc: LayoutDoc, panel: string, side: LayoutEdge) => {
    const target = edgeTargetOf(doc, panel, side);
    if (target === null) throw new Error(`没有 ${panel} 的 ${side}`);
    return target;
};

const RECT = {x: 10, y: 10, width: 300, height: 200};

/** 侧栏的容器 A（当前）有 s1、s2，容器 B 有 s3；底部面板的容器 P 有 p1；右栏容器 M 只有 m1。M 的侧轨展开着、宽 300。 */
const railed = (): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1", "s2", "s3"], "side"), V(["ea", H(["panel", "p1"], "row")], "center"), V(["auxiliarybar", "m1"], "aux")], "body"), "statusbar"], "root"), {
    sidebar: {tabs: [], active: null, entries: ["A", "B"], activeContainer: "A"},
    s1: {container: "A"},
    s2: {container: "A"},
    s3: {container: "B"},
    panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
    p1: {container: "P"},
    auxiliarybar: {tabs: [], active: null, entries: ["M"], activeContainer: "M", rail: {M: {expanded: true, width: 300}}},
    m1: {container: "M"},
});

const railOf = (doc: LayoutDoc, anchor: string): PanelRecord["rail"] => doc.panels[anchor]?.rail;
/** 把文档当记录读回来：JSON 往返后再过校验，和 store 读记录走的是同一条路。 */
const reread = (doc: LayoutDoc) => validateLayoutDoc(JSON.parse(JSON.stringify(doc)));

describe("读入", () => {
    it("合法的侧轨意图原样读进来，不修、不复制", () => {
        const doc = okDoc({ok: true, doc: railed()});
        const checked = validateLayoutDoc(doc);
        expect(checked.ok && checked.repairs).toEqual([]);
        expect(checked.ok && checked.doc).toBe(doc);
    });

    it("坏值只在那一项上当缺省，并写一条修掉的说明；其余布局与别的项照用", () => {
        const doc = railed();
        const stored = {
            ...doc,
            panels: {
                ...doc.panels,
                sidebar: {...doc.panels.sidebar, rail: {A: {expanded: "yes", width: 280}, B: {expanded: true, width: -5}, gone: {expanded: true}}},
                auxiliarybar: {...doc.panels.auxiliarybar, rail: {M: {expanded: false, width: "wide", extra: 1}}},
                s1: {...doc.panels.s1, rail: {A: {expanded: true}}},
            },
        };
        const checked = validateLayoutDoc(stored);
        if (!checked.ok) throw new Error(checked.message);
        expect(railOf(checked.doc, "sidebar")).toEqual({A: {width: 280}, B: {expanded: true}});
        // M 的三个值都不认：整项去掉，锚上没有项了就整个字段不写。
        expect(checked.doc.panels.auxiliarybar).not.toHaveProperty("rail");
        // 分节不是锚，不该有这个字段。
        expect(checked.doc.panels.s1).not.toHaveProperty("rail");
        expect(checked.repairs).toHaveLength(7);
        expect(sameLayoutShape(checked.doc, {...doc, panels: {...doc.panels, sidebar: {...doc.panels.sidebar, rail: {A: {width: 280}, B: {expanded: true}}}, auxiliarybar: {...doc.panels.auxiliarybar, rail: undefined} as PanelRecord}})).toBe(true);
    });

    it("坏值是带自有 toString 键的对象（JSON 里写得出来）：照样局部修掉、写说明，不抛", () => {
        const doc = railed();
        const stored = JSON.parse(JSON.stringify({...doc, panels: {...doc.panels, auxiliarybar: {...doc.panels.auxiliarybar, rail: {M: {expanded: {toString: 0}, width: 310}}}, sidebar: {...doc.panels.sidebar, rail: {A: {width: {toString: 0, valueOf: 0}}}}}})) as unknown;
        const checked = validateLayoutDoc(stored);
        if (!checked.ok) throw new Error(checked.message);
        expect(railOf(checked.doc, "auxiliarybar")).toEqual({M: {width: 310}});
        expect(checked.repairs).toEqual(["panels.sidebar.rail.A.width: an object", "panels.auxiliarybar.rail.M.expanded: an object"]);
        const badName = JSON.parse(JSON.stringify({...doc, panels: {...doc.panels, auxiliarybar: {...doc.panels.auxiliarybar, name: {toString: 0}}}})) as unknown;
        expect(validateLayoutDoc(badName)).toMatchObject({ok: false, code: "invalid"});
    });

    it("浮动窗上的坏值同样局部修掉", () => {
        const floated = okDoc(floatTab(railed(), {tab: "view:m1", rect: RECT}, testPolicy()));
        const panel = floated.floats[0]?.panel as string;
        const checked = validateLayoutDoc({...floated, floats: [{panel, rect: RECT, rail: {expanded: 1, width: 360}}]});
        if (!checked.ok) throw new Error(checked.message);
        expect(checked.doc.floats).toEqual([{panel, rect: RECT, rail: {width: 360}}]);
        expect(checked.repairs).toHaveLength(1);
    });

    it("节点 id 或面板的键以 `rail:` 开头时按不合法拒收：呈现里的侧轨叶用这个 id", () => {
        // 只改叶的 id、ref 与面板的键，标签与归属不动：改别的会让文档因为别的原因不合法，这条就空过了。
        const renamed = JSON.parse(JSON.stringify(railed()).replaceAll('"id":"m1"', '"id":"rail:auxiliarybar"').replaceAll('"ref":"panel:m1"', '"ref":"panel:rail:auxiliarybar"').replaceAll('"m1":{', '"rail:auxiliarybar":{'));
        expect(validateLayoutDoc(renamed)).toMatchObject({ok: false, code: "invalid"});
        // 对照：同样改成一个普通的名字是合法的。
        const plain = JSON.parse(JSON.stringify(railed()).replaceAll('"id":"m1"', '"id":"m2"').replaceAll('"ref":"panel:m1"', '"ref":"panel:m2"').replaceAll('"m1":{', '"m2":{'));
        expect(validateLayoutDoc(plain)).toMatchObject({ok: true});
    });
});

describe("形状比较与写入", () => {
    it("侧轨意图算进形状；键序与没写的字段不算", () => {
        const doc = railed();
        const anchor = doc.panels.auxiliarybar as PanelRecord;
        const reordered = {...doc, panels: {...doc.panels, auxiliarybar: {...anchor, rail: {M: {width: 300, expanded: true as const}}}}};
        expect(sameLayoutShape(doc, reordered)).toBe(true);
        const narrower = {...doc, panels: {...doc.panels, auxiliarybar: {...anchor, rail: {M: {expanded: true as const, width: 260}}}}};
        expect(sameLayoutShape(doc, narrower)).toBe(false);
    });

    it("写一个容器的意图：再写同一个值、或写回原状，返回原对象（零写入）；宽度不是有限正数时拒绝（和读入同一条）", () => {
        const doc = railed();
        expect(okDoc(setContainerRail(doc, {anchor: "auxiliarybar", container: "M", intent: {width: 300, expanded: true}}))).toBe(doc);
        for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(setContainerRail(doc, {anchor: "auxiliarybar", container: "M", intent: {width}})).toMatchObject({ok: false, code: "rejected"});
        }
        const collapsed = okDoc(setContainerRail(doc, {anchor: "auxiliarybar", container: "M", intent: {width: 300}}));
        expect(railOf(collapsed, "auxiliarybar")).toEqual({M: {width: 300}});
        const cleared = okDoc(setContainerRail(collapsed, {anchor: "auxiliarybar", container: "M", intent: null}));
        expect(cleared.panels.auxiliarybar).not.toHaveProperty("rail");
        expect(okDoc(setContainerRail(cleared, {anchor: "auxiliarybar", container: "M", intent: {}}))).toBe(cleared);
    });

    it("不在入口顺序里的容器、不是锚的面板不能写", () => {
        const doc = railed();
        expect(setContainerRail(doc, {anchor: "auxiliarybar", container: "A", intent: {expanded: true}})).toMatchObject({ok: false, code: "rejected"});
        expect(setContainerRail(doc, {anchor: "m1", container: "M", intent: {expanded: true}})).toMatchObject({ok: false, code: "rejected"});
        expect(setContainerRail(doc, {anchor: "nope", container: "M", intent: {expanded: true}})).toMatchObject({ok: false, code: "not-found"});
    });
});

describe("跟着容器与视图走", () => {
    it("浮出：容器唯一的视图浮成窗，意图从锚上搬到窗上；拖回那个容器，意图回到锚上", () => {
        const floated = okDoc(floatTab(railed(), {tab: "view:m1", rect: RECT}, testPolicy()));
        const panel = floated.floats[0]?.panel as string;
        expect(floated.floats).toEqual([{panel, rect: RECT, rail: {expanded: true, width: 300}}]);
        expect(floated.panels.auxiliarybar).not.toHaveProperty("rail");
        // 记录读回来还在（字段跟着 JSON 往返）。
        expect(reread(floated)).toMatchObject({ok: true, repairs: []});

        const docked = okDoc(movePanelToEdge(floated, {panel, target: edge(floated, "auxiliarybar", "bottom"), container: "M"}, testPolicy()));
        expect(docked.floats).toEqual([]);
        expect(railOf(docked, "auxiliarybar")).toEqual({M: {expanded: true, width: 300}});
    });

    it("容器里还有别的分节时浮出一个视图，意图留在锚上", () => {
        const doc = okDoc(setContainerRail(railed(), {anchor: "sidebar", container: "A", intent: {expanded: true}}));
        const floated = okDoc(floatTab(doc, {tab: "view:s1", rect: RECT}, testPolicy()));
        expect(railOf(floated, "sidebar")).toEqual({A: {expanded: true}});
        expect(floated.floats[0]).not.toHaveProperty("rail");
    });

    it("整个容器搬到别的区域：最后一个分节过去时意图跟到那边的锚上，之前留在原处", () => {
        const doc = okDoc(setContainerRail(railed(), {anchor: "sidebar", container: "A", intent: {width: 240}}));
        const first = okDoc(movePanelToEdge(doc, {panel: "s1", target: edge(doc, "p1", "right"), container: "A"}, testPolicy()));
        expect(railOf(first, "sidebar")).toEqual({A: {width: 240}});
        const second = okDoc(movePanelToEdge(first, {panel: "s2", target: edge(first, "s1", "right"), container: "A"}, testPolicy()));
        expect(railOf(second, "sidebar")).toBeUndefined();
        expect(railOf(second, "panel")).toEqual({A: {width: 240}});
    });

    it("容器暂时没有成员（视图移进别的容器）时意图留着；容器从入口顺序里删掉时一起去掉", () => {
        const doc = okDoc(setContainerRail(railed(), {anchor: "sidebar", container: "B", intent: {expanded: true}}));
        const emptied = okDoc(movePanelToEdge(doc, {panel: "s3", target: edge(doc, "s2", "bottom"), container: "A"}, testPolicy()));
        expect(railOf(emptied, "sidebar")).toEqual({B: {expanded: true}});
        const dropped = okDoc(setContainerEntries(emptied, "sidebar", ["A"]));
        expect(dropped.panels.sidebar).not.toHaveProperty("rail");
    });

    it("模板与放弃恢复：去掉动态标签、按另一份带回动态标签，侧轨意图都以结构那一份为准", () => {
        const doc = okDoc(insertTab(railed(), {panel: "ea", tab: tab("t1")}));
        const template = stripDynamicTabs(doc);
        expect(railOf(template, "auxiliarybar")).toEqual({M: {expanded: true, width: 300}});
        const changed = okDoc(setContainerRail(doc, {anchor: "auxiliarybar", container: "M", intent: null}));
        const restored = carryDynamicTabs(template, changed);
        expect(railOf(restored, "auxiliarybar")).toEqual({M: {expanded: true, width: 300}});
        expect(restored.panels.ea?.tabs).toEqual([tab("ea"), tab("t1")]);
    });
});
