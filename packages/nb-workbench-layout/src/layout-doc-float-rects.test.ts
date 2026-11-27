import {describe, expect, it} from "bun:test";

import {docOf, H, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {edgeTargetOf, floatTab, insertTab, movePanelToEdge, moveTabToEdge, removeTab, sameLayoutShape} from "./layout-doc";
import {validateLayoutDoc} from "./layout-doc-validate";
import {applyLayoutDrop} from "./layout-drop";
import type {LayoutDoc, LayoutEdge, LayoutResult} from "./layout-doc";

/** 浮动窗记住的矩形（docs/specs/ui/workbench-layout.md 输出 39 的“记住矩形”）。 */

function okDoc(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`操作失败：${result.code} ${result.message}`);
    return result.doc;
}

const edge = (doc: LayoutDoc, panel: string, side: LayoutEdge) => {
    const target = edgeTargetOf(doc, panel, side);
    if (target === null) throw new Error(`没有 ${panel} 的 ${side}`);
    return target;
};

/** 整个文件一份：每次新建的话计数从头来，第二次浮出撞上第一次的 id。 */
const policy = testPolicy();

const RECT = {x: 40, y: 30, width: 610, height: 420};
const OTHER = {x: 300, y: 200, width: 460, height: 340};

/** 编辑组 ea、eb，右栏容器 M 有 m1，侧栏容器 A 有 s1。 */
const base = (): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1"], "side"), H(["ea", "eb"], "center"), V(["auxiliarybar", "m1"], "aux")], "body"), "statusbar"], "root"), {
    sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
    s1: {container: "A"},
    auxiliarybar: {tabs: [], active: null, entries: ["M"], activeContainer: "M"},
    m1: {container: "M"},
});

const floated = (doc: LayoutDoc, key: string, rect = RECT) => {
    const next = okDoc(floatTab(doc, {tab: key, rect}, policy));
    return {doc: next, panel: next.floats.at(-1)?.panel as string};
};
const dockBack = (doc: LayoutDoc, panel: string) => okDoc(movePanelToEdge(doc, {panel, target: edge(doc, "auxiliarybar", "bottom"), container: "M"}, policy));
const reread = (doc: LayoutDoc) => validateLayoutDoc(JSON.parse(JSON.stringify(doc)));

describe("记下与清掉", () => {
    it("工具视图的窗回到树里：按视图记下窗的记录矩形；记录读回来还在", () => {
        const {doc, panel} = floated(base(), "view:m1");
        expect(doc.floatRects).toBeUndefined();
        const docked = dockBack(doc, panel);
        expect(docked.floats).toEqual([]);
        expect(docked.floatRects).toEqual({"view:m1": RECT});
        expect(reread(docked)).toMatchObject({ok: true, repairs: [], doc: {floatRects: {"view:m1": RECT}}});
    });

    it("窗里有几个工具视图：回到树里时每个都记同一个矩形", () => {
        const first = floated(base(), "view:m1");
        const two = okDoc(insertTab(first.doc, {panel: first.panel, tab: view("x1")}));
        const docked = dockBack(two, first.panel);
        expect(docked.floatRects).toEqual({"view:m1": RECT, "view:x1": RECT});
    });

    it("从多标签窗单独拖一个回树里：这一个记下，窗还浮着、别的标签不记", () => {
        const first = floated(base(), "view:m1");
        const two = okDoc(insertTab(first.doc, {panel: first.panel, tab: view("x1")}));
        const out = okDoc(moveTabToEdge(two, {tab: "view:x1", target: edge(two, "auxiliarybar", "bottom"), container: "M"}, policy));
        expect(out.floats.map((float) => float.panel)).toEqual([first.panel]);
        expect(out.floatRects).toEqual({"view:x1": RECT});
        // 再把剩下的一个也拖回去（一个标签一次，同“回到停靠”）：两个都记着。
        expect(okDoc(moveTabToEdge(out, {tab: "view:m1", target: edge(out, "auxiliarybar", "bottom"), container: "M"}, policy)).floatRects).toEqual({"view:x1": RECT, "view:m1": RECT});
    });

    it("再浮出、再回来：记的是最近那扇窗的矩形", () => {
        const once = floated(base(), "view:m1");
        const docked = dockBack(once.doc, once.panel);
        const again = floated(docked, "view:m1", OTHER);
        // 浮着的时候记录不动：还是上一次的。
        expect(again.doc.floatRects).toEqual({"view:m1": RECT});
        expect(dockBack(again.doc, again.panel).floatRects).toEqual({"view:m1": OTHER});
    });

    it("并进别的浮动窗不记：视图还浮着", () => {
        const one = floated(base(), "view:m1");
        const two = floated(one.doc, "view:s1", OTHER);
        const merged = okDoc(applyLayoutDrop(two.doc, {kind: "panel", panel: one.panel}, {kind: "center", panel: two.panel}, policy));
        expect(merged.floats.map((float) => float.panel)).toEqual([two.panel]);
        expect(merged.panels[two.panel]?.tabs.map((item) => item.kind === "view" && item.viewId)).toContain("m1");
        expect(merged).not.toHaveProperty("floatRects");
    });

    it("窗被关掉（标签没了）不记，而且这个视图原来记着的一起清掉", () => {
        const once = floated(base(), "view:m1");
        const again = floated(dockBack(once.doc, once.panel), "view:m1", OTHER);
        const closed = okDoc(removeTab(again.doc, "view:m1"));
        expect(closed.floats).toEqual([]);
        expect(closed).not.toHaveProperty("floatRects");
    });

    it("视图从树里没了（插件停用）：它的项在同一次提交里清掉，别的视图的照留", () => {
        const one = floated(base(), "view:m1");
        const two = floated(dockBack(one.doc, one.panel), "view:s1", OTHER);
        const both = okDoc(movePanelToEdge(two.doc, {panel: two.panel, target: edge(two.doc, "sidebar", "bottom"), container: "A"}, policy));
        expect(both.floatRects).toEqual({"view:m1": RECT, "view:s1": OTHER});
        expect(okDoc(removeTab(both, "view:m1")).floatRects).toEqual({"view:s1": OTHER});
    });

    it("编辑器标签的窗回到树里不记", () => {
        const doc = okDoc(insertTab(base(), {panel: "ea", tab: tab("t1")}));
        const {doc: floating, panel} = floated(doc, "tab:t1");
        const docked = okDoc(movePanelToEdge(floating, {panel, target: edge(floating, "eb", "right")}, policy));
        expect(docked.floats).toEqual([]);
        expect(docked).not.toHaveProperty("floatRects");
    });
});

describe("读入与形状", () => {
    it("合法的原样读进来，不修、不复制", () => {
        const doc = {...base(), floatRects: {"view:m1": RECT}};
        const checked = validateLayoutDoc(doc);
        expect(checked.ok && checked.repairs).toEqual([]);
        expect(checked.ok && checked.doc).toBe(doc);
    });

    it("坏项与文档里没有这个标签的项丢掉并各写一条说明，其余照用；全丢光了整个字段不写；不是对象整个丢", () => {
        const stored = JSON.parse(JSON.stringify({...base(), floatRects: {"view:m1": RECT, "tab:t1": RECT, "view:s1": {...RECT, width: 0.4, height: 0.4}, "view:__proto__": RECT, "view:x": "wide", "view:gone": RECT}})) as unknown;
        const checked = validateLayoutDoc(stored);
        if (!checked.ok) throw new Error(checked.message);
        expect(checked.doc.floatRects).toEqual({"view:m1": RECT});
        // 坏矩形（含取整后会成 0 的亚像素宽高）、不是工具视图的键、文档里没有这个标签的键（与提交出口清的同一判据）各一条。
        expect(checked.repairs).toHaveLength(5);
        const none = validateLayoutDoc({...base(), floatRects: {"tab:t1": RECT}});
        expect(none.ok && none.doc).not.toHaveProperty("floatRects");
        const empty = validateLayoutDoc({...base(), floatRects: {}});
        expect(empty).toMatchObject({ok: true, repairs: ["floatRects: empty"]});
        expect(empty.ok && empty.doc).not.toHaveProperty("floatRects");
        const notObject = validateLayoutDoc({...base(), floatRects: [RECT]});
        expect(notObject).toMatchObject({ok: true, repairs: ["floatRects: not an object"]});
        expect(notObject.ok && notObject.doc).not.toHaveProperty("floatRects");
    });

    it("形状比较看记住的矩形：值不同就不同，键序与没写字段不影响", () => {
        const doc = base();
        expect(sameLayoutShape(doc, {...doc, floatRects: {"view:m1": RECT}})).toBe(false);
        expect(sameLayoutShape({...doc, floatRects: {"view:m1": RECT}}, {...doc, floatRects: {"view:m1": OTHER}})).toBe(false);
        expect(sameLayoutShape({...doc, floatRects: {"view:m1": RECT, "view:s1": OTHER}}, {...doc, floatRects: {"view:s1": {...OTHER}, "view:m1": {...RECT}}})).toBe(true);
    });
});
