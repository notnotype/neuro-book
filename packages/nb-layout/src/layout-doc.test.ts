import {describe, expect, it} from "bun:test";

import {createGrid} from "./grid";
import {docOf, H, shapeOf, sizeOf, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {
    activateTab,
    carryDynamicTabs,
    clampFloatRect,
    countsInShare,
    edgeTargetOf,
    floatTab,
    insertTab,
    LAYOUT_MAX_FLOATS,
    movePanelToEdge,
    movePanelToStrip,
    moveTabToEdge,
    moveTabToStrip,
    normalizeTree,
    openPanelAtEdge,
    raiseFloat,
    rebaseIntents,
    removeTab,
    replaceTab,
    resizeFloatRect,
    setBarHidden,
    setCurrentEditor,
    setFloatRect,
    setPanelCollapsed,
    setPanelHidden,
    showPanelAndInsert,
    stripDynamicTabs,
    tabKey,
    validateLayoutDoc,
} from "./layout-doc";
import type {LayoutDoc, LayoutEdge, LayoutResult} from "./layout-doc";
import {projectLayoutDoc} from "./layout-project";
import type {LayoutProjectionOptions} from "./layout-project";

/** 布局文档（docs/specs/ui/workbench-layout.md 输出 1 到 4、8、25 到 28）。 */

function okDoc(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`操作失败：${result.code} ${result.detail}`);
    return result.doc;
}

const edge = (doc: LayoutDoc, panel: string, side: LayoutEdge) => {
    const target = edgeTargetOf(doc, panel, side);
    if (target === null) throw new Error(`没有 ${panel} 的 ${side}`);
    return target;
};

const shape = (doc: LayoutDoc): string => shapeOf(doc.tree.root);

const PROJECTION: LayoutProjectionOptions = {
    constraints: () => ({minimumSize: {width: 10, height: 10}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
    barThickness: (bar) => (bar === "activitybar" ? 48 : 22),
    headHeight: 32,
    collapseThreshold: 24,
    sashSize: 1,
};

/** 全部节点的呈现尺寸（`rebaseIntents` 要分支的也写回）。 */
function presentedSizes(doc: LayoutDoc, extent = {width: 1000, height: 600}): Record<string, {width: number; height: number}> {
    const {input, sashSize} = projectLayoutDoc(doc, PROJECTION);
    return createGrid<string>(input, {sashSize}).layout(extent).sizes;
}
const solveSizes = (doc: LayoutDoc) => presentedSizes(doc);

describe("规范形", () => {
    it("同轴嵌套展平，单子分支塌陷：`(A | B) | C` 只会存成 `H[A, B, C]`", () => {
        const doc = docOf(H([H(["a", "b"]), "c"]));
        expect(shapeOf(normalizeTree(doc.tree.root))).toBe("H[a,b,c]");
        expect(shapeOf(normalizeTree(docOf(V([H([V(["a", "b"])]), "c"])).tree.root))).toBe("V[a,b,c]");
    });

    it("不同方向的嵌套保留", () => {
        expect(shapeOf(normalizeTree(docOf(H([V(["a", "b"]), "c"])).tree.root))).toBe("H[V[a,b],c]");
    });

    it("展平前后主轴总量守恒，比例不变；交叉轴取分支的", () => {
        const doc = docOf(H([H(["a", "b"]), "c"]));
        const root = normalizeTree(doc.tree.root);
        expect(sizeOf(root, "a")).toEqual({width: 250, height: 600});
        expect(sizeOf(root, "b").width).toBeCloseTo(250);
        expect(sizeOf(root, "c").width).toBeCloseTo(500);
    });

    it("隐藏的兄弟不算进总量：可见的固定面板展平后不变", () => {
        const doc = docOf(V(["ea", H([H(["a", "panel"], "inner"), "c"], "row")]), {panel: {hidden: true}});
        const presented = solveSizes(doc);
        const rebased = rebaseIntents(doc, presented, projectLayoutDoc(doc, PROJECTION).collapsedTo);
        const normal: LayoutDoc = {...rebased, tree: {...rebased.tree, root: normalizeTree(rebased.tree.root, (node) => countsInShare(rebased, node))}};
        expect(Math.abs((solveSizes(normal).a?.width ?? 0) - (presented.a?.width ?? 0))).toBeLessThanOrEqual(1);
    });

    it.each([
        ["全按比例", H([H(["ea", "eb"]), "ec"])],
        ["全固定", H([H(["a", "b"]), "c", "ee"])],
        ["混合", H(["sidebar", H(["a", "ee"]), "auxiliarybar"])],
    ])("展平前后每个叶的呈现尺寸不变（差不到 1px）：%s", (_name, tree) => {
        const raw = docOf(tree);
        const presented = presentedSizes(raw);
        const rebased = rebaseIntents(raw, presented);
        const normal: LayoutDoc = {...rebased, tree: {...rebased.tree, root: normalizeTree(rebased.tree.root)}};
        const after = presentedSizes(normal);
        for (const id of Object.keys(raw.panels)) expect(Math.abs((after[id]?.width ?? 0) - (presented[id]?.width ?? 0))).toBeLessThanOrEqual(1);
    });
});

describe("意图", () => {
    it("呈现尺寸写回意图；呈现为零的轴保留原意图，那就是展开时的尺寸", () => {
        const doc = docOf(H(["a", "b"]));
        const rebased = rebaseIntents(doc, {a: {width: 0, height: 100}, b: {width: 321, height: 100}});
        expect(sizeOf(rebased.tree.root, "a")).toEqual({width: 500, height: 100});
        expect(sizeOf(rebased.tree.root, "b")).toEqual({width: 321, height: 100});
    });
});

describe("外缘（规则 4、5）", () => {
    it("`H[A, B, C]`：B 的右缘与 C 的左缘是同一个落点，新块只从 B、C 取，A 不动", () => {
        const doc = docOf(H(["a", "b", "c", "d"]));
        const fromB = edge(doc, "b", "right");
        expect(fromB).toEqual(edge(doc, "c", "left"));
        const result = okDoc(movePanelToEdge(doc, {panel: "d", target: fromB}, testPolicy()));
        expect(shape(result)).toBe("H[a,b,d,c]");
        const a = sizeOf(result.tree.root, "a").width;
        const b = sizeOf(result.tree.root, "b").width;
        const d = sizeOf(result.tree.root, "d").width;
        expect(a).toBeCloseTo(250);
        expect(b).toBeCloseTo(250 * (2 / 3));
        expect(d).toBeCloseTo(500 / 3);
    });

    it("`H[V[A, B], C]`：B 的右缘是拆 B，新块只有 B 那么高", () => {
        const doc = docOf(H([V(["a", "b"]), "c", "d"]));
        const result = okDoc(movePanelToEdge(doc, {panel: "d", target: edge(doc, "b", "right")}, testPolicy()));
        expect(shape(result)).toBe("H[V[a,H[b,d]],c]");
        expect(sizeOf(result.tree.root, "d").height).toBe(sizeOf(doc.tree.root, "b").height);
    });

    it("`H[V[A, B], C]`：C 的左缘是放到 V 与 C 之间，新块整高", () => {
        const doc = docOf(H([V(["a", "b"]), "c", "d"]));
        const result = okDoc(movePanelToEdge(doc, {panel: "d", target: edge(doc, "c", "left")}, testPolicy()));
        expect(shape(result)).toBe("H[V[a,b],d,c]");
        expect(sizeOf(result.tree.root, "d").height).toBe(600);
    });

    it("对面没有兄弟：拆这一块，新块取一半", () => {
        const doc = docOf(H(["a", "b", "c"]));
        const result = okDoc(movePanelToEdge(doc, {panel: "c", target: edge(doc, "b", "top")}, testPolicy()));
        expect(shape(result)).toBe("H[a,V[c,b]]");
        expect(sizeOf(result.tree.root, "c").height).toBe(300);
    });

    it("条不算对面的兄弟；隐藏的兄弟跳过去找下一个", () => {
        const doc = docOf(H(["activitybar", "sidebar", "a", "b"], "root"), {a: {name: "panel", hidden: true}});
        expect(edge(doc, "sidebar", "left")).toEqual({kind: "split", panel: "sidebar", edge: "left"});
        expect(edge(doc, "sidebar", "right")).toEqual({kind: "between", branch: "root", before: "sidebar", after: "b"});
    });

    it("开发者的场景：视图 A 移到右栏 C、D 之间，还是同一块面板；来源那一列只剩 B，塌陷成一块", () => {
        const doc = docOf(H([V(["a", "b"]), H(["ea", "eb"]), V(["c", "d"])]));
        const result = okDoc(movePanelToEdge(doc, {panel: "a", target: edge(doc, "c", "bottom")}, testPolicy()));
        expect(shape(result)).toBe("H[b,ea,eb,V[c,a,d]]");
        expect(result.panels.a).toEqual(doc.panels.a);
    });

    it("目标所在的分支因为摘掉来源塌陷了：按幸存者找到目标", () => {
        const doc = docOf(H([V(["a", "b"], "column"), "c"]));
        const target = edge(doc, "c", "left");
        const result = okDoc(movePanelToEdge(doc, {panel: "a", target}, testPolicy()));
        expect(shape(result)).toBe("H[b,a,c]");
    });

    it("放回原处：结构一样时返回原对象，比例是非整数也不动", () => {
        const doc = rebaseIntents(docOf(H(["a", "b", "c"])), {a: {width: 123.4567, height: 600}});
        expect(okDoc(movePanelToEdge(doc, {panel: "b", target: edge(doc, "a", "right")}, testPolicy()))).toBe(doc);
        expect(okDoc(movePanelToEdge(doc, {panel: "b", target: edge(doc, "c", "left")}, testPolicy()))).toBe(doc);
        expect(okDoc(movePanelToEdge(doc, {panel: "b", target: edge(doc, "b", "left")}, testPolicy()))).toBe(doc);
    });

    it("单标签的无名面板拖到外缘是整块移动，面板 id 跟着走", () => {
        const doc = docOf(H(["s", "ea", "b"]));
        const result = okDoc(moveTabToEdge(doc, {tab: "view:s", target: edge(doc, "b", "bottom")}, testPolicy()));
        expect(shape(result)).toBe("H[ea,V[b,s]]");
        expect(result.panels.s?.tabs).toEqual([view("s")]);
    });

    it("具名面板不移动：它的单标签拆出新面板，它拖空隐藏，留在原位", () => {
        const doc = docOf(H(["sidebar", "ea", "b"]));
        const result = okDoc(moveTabToEdge(doc, {tab: "view:sidebar", target: edge(doc, "b", "bottom")}, testPolicy()));
        expect(shape(result)).toBe("H[sidebar,ea,V[b,n1]]");
        expect(result.panels.sidebar).toMatchObject({tabs: [], active: null, hidden: true, name: "sidebar"});
        expect(result.panels.n1?.tabs).toEqual([view("sidebar")]);
    });

    it("单标签的面板放回挨着自己的边是原位，具名的也是", () => {
        const doc = docOf(V(["sidebar", "b"]));
        expect(okDoc(moveTabToEdge(doc, {tab: "view:sidebar", target: edge(doc, "sidebar", "top")}, testPolicy()))).toBe(doc);
        expect(okDoc(moveTabToEdge(doc, {tab: "view:sidebar", target: edge(doc, "sidebar", "bottom")}, testPolicy()))).toBe(doc);
        expect(okDoc(moveTabToEdge(doc, {tab: "view:b", target: edge(doc, "sidebar", "bottom")}, testPolicy()))).toBe(doc);
    });

    it("收起的面板方向变了就展开：挨着它开新面板、同一列的兄弟没了（标题行变零宽之后连头都没了）", () => {
        const row = docOf(V(["ea", "panel"]), {panel: {collapsed: true}});
        const opened = okDoc(openPanelAtEdge(row, {id: "n", panel: {role: "tool", tabs: [], active: null}, target: {kind: "split", panel: "panel", edge: "right"}}, testPolicy()));
        expect(opened.panels.panel?.collapsed).toBeUndefined();
        const column = docOf(H([V(["sidebar", "x"], "column"), "ea"]), {sidebar: {collapsed: true}});
        const removed = okDoc(removeTab(column, "view:x"));
        expect(shape(removed)).toBe("H[sidebar,ea]");
        expect(removed.panels.sidebar?.collapsed).toBeUndefined();
        // 方向没变的不动。
        const same = docOf(H([V(["sidebar", "x", "y"], "column"), "ea"]), {sidebar: {collapsed: true}});
        expect(okDoc(removeTab(same, "view:x")).panels.sidebar?.collapsed).toBe(true);
    });

    it("收成标题行的面板移到外缘时展开：换到横向分支就成了零宽", () => {
        const doc = docOf(V(["ea", H(["panel", "x"]), "c"]), {c: {collapsed: true}});
        const result = okDoc(moveTabToEdge(doc, {tab: "view:c", target: edge(doc, "x", "right")}, testPolicy()));
        expect(shape(result)).toBe("V[ea,H[panel,x,c]]");
        expect(result.panels.c?.collapsed).toBeUndefined();
    });

    it("多标签面板的一个标签拖到外缘：拆出新面板，继承角色；编辑组拆出的成为活动编辑组", () => {
        const doc = docOf(H(["ea", "b"]), {ea: {tabs: [tab("x"), tab("y")], active: "tab:y"}});
        const result = okDoc(moveTabToEdge(doc, {tab: "tab:y", target: edge(doc, "b", "right")}, testPolicy()));
        expect(shape(result)).toBe("H[ea,b,n1]");
        expect(result.panels.n1).toEqual({role: "editor", tabs: [tab("y")], active: "tab:y"});
        expect(result.panels.ea?.active).toBe("tab:x");
        expect(result.currentEditor).toBe("n1");
    });

    it("开一块新面板：编辑组成为活动编辑组；id 重复不提交", () => {
        const doc = docOf(H(["ea", "b"]));
        const panel = {role: "editor" as const, tabs: [tab("z")], active: "tab:z"};
        const result = okDoc(openPanelAtEdge(doc, {id: "ef", panel, target: edge(doc, "ea", "right")}, testPolicy()));
        expect(shape(result)).toBe("H[ea,ef,b]");
        expect(result.currentEditor).toBe("ef");
        expect(openPanelAtEdge(doc, {id: "ea", panel, target: edge(doc, "ea", "right")}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
    });

    it("接受矩阵提交时再验一次，失败文档不变", () => {
        const doc = docOf(H(["a", "b", "c"]));
        const refuse = testPolicy({accepts: () => false});
        expect(movePanelToEdge(doc, {panel: "c", target: edge(doc, "a", "top")}, refuse)).toMatchObject({ok: false, code: "rejected"});
    });

    it("超过节点上限：不提交", () => {
        const many = docOf(H(Array.from({length: 255}, (_, index) => `p${String(index)}`)));
        expect(moveTabToEdge({...many, panels: {...many.panels, p0: {role: "tool", tabs: [view("x"), view("y")], active: "view:x"}}}, {tab: "view:y", target: edge(many, "p1", "top")}, testPolicy())).toMatchObject({ok: false, code: "limit-exceeded"});
    });
});

describe("标签", () => {
    it("插入、激活：编辑组的激活改活动编辑组", () => {
        const doc = docOf(H(["ea", "eb"]));
        const inserted = okDoc(insertTab(doc, {panel: "eb", tab: tab("z")}));
        expect(inserted.panels.eb?.active).toBe("tab:z");
        expect(inserted.currentEditor).toBe("eb");
        expect(okDoc(activateTab(inserted, "tab:ea")).currentEditor).toBe("ea");
        expect(insertTab(doc, {panel: "eb", tab: tab("ea")})).toMatchObject({ok: false, code: "rejected"});
        expect(insertTab(doc, {panel: "nope", tab: tab("z")})).toMatchObject({ok: false, code: "not-found"});
    });

    it("活动编辑组：只能是编辑组；已经是它时返回原文档", () => {
        const doc = docOf(H(["sidebar", "ea", "eb"]));
        const moved = okDoc(setCurrentEditor(doc, "eb"));
        expect(moved.currentEditor).toBe("eb");
        expect(okDoc(setCurrentEditor(moved, "eb"))).toBe(moved);
        expect(setCurrentEditor(doc, "sidebar")).toMatchObject({ok: false, code: "not-found"});
    });

    it("只换位置（activate: false）：活动标签与活动编辑组都不变，被移动的就是活动标签时也一样", () => {
        const doc = {...docOf(H(["ea", "eb"]), {ea: {tabs: [tab("a"), tab("b"), tab("c")], active: "tab:a"}}), currentEditor: "ea"};
        const moved = okDoc(moveTabToStrip(doc, {tab: "tab:a", panel: "ea", index: 3, activate: false}, testPolicy()));
        expect(moved.panels.ea?.tabs.map(tabKey)).toEqual(["tab:b", "tab:c", "tab:a"]);
        expect(moved.panels.ea?.active).toBe("tab:a");
        const across = okDoc(moveTabToStrip(doc, {tab: "tab:b", panel: "eb", index: 0, activate: false}, testPolicy()));
        expect(across.panels.eb?.active).toBe("tab:eb");
        expect(across.panels.ea?.active).toBe("tab:a");
        expect(across.currentEditor).toBe("ea");
    });

    it("preview 替换：一次写完，位置与活动都接上", () => {
        const doc = docOf(H(["ea"]), {ea: {tabs: [tab("p"), tab("q")], active: "tab:p"}});
        const result = okDoc(replaceTab(doc, {tab: "tab:p", next: tab("r")}));
        expect(result.panels.ea?.tabs.map(tabKey)).toEqual(["tab:r", "tab:q"]);
        expect(result.panels.ea?.active).toBe("tab:r");
        expect(replaceTab(doc, {tab: "tab:p", next: tab("q")})).toMatchObject({ok: false, code: "rejected"});
    });

    it("活动标签被关：优先后一个，没有就前一个", () => {
        const doc = docOf(H(["ea"]), {ea: {tabs: [tab("p"), tab("q"), tab("r")], active: "tab:q"}});
        const once = okDoc(removeTab(doc, "tab:q"));
        expect(once.panels.ea?.active).toBe("tab:r");
        expect(okDoc(removeTab(once, "tab:r")).panels.ea?.active).toBe("tab:p");
    });

    it("同一面板换顺序：插入位是摘掉来源之前的；原位返回原对象", () => {
        const doc = docOf(H(["ea", "b"]), {ea: {tabs: [tab("p"), tab("q"), tab("r")], active: "tab:p"}});
        expect(okDoc(moveTabToStrip(doc, {tab: "tab:p", panel: "ea", index: 3}, testPolicy())).panels.ea?.tabs.map(tabKey)).toEqual(["tab:q", "tab:r", "tab:p"]);
        expect(okDoc(moveTabToStrip(doc, {tab: "tab:p", panel: "ea", index: 0}, testPolicy()))).toBe(doc);
        expect(okDoc(moveTabToStrip(doc, {tab: "tab:p", panel: "ea", index: 1}, testPolicy()))).toBe(doc);
    });

    it("固定分区的限制问策略：移标签和整个面板并入都问", () => {
        const doc = docOf(H(["ea", "eb"]), {ea: {tabs: [tab("p"), tab("q")], active: "tab:p"}});
        const refuse = testPolicy({canInsert: () => false});
        expect(moveTabToStrip(doc, {tab: "tab:q", panel: "ea", index: 0}, refuse)).toMatchObject({ok: false, code: "rejected"});
        expect(movePanelToStrip(doc, {panel: "eb", target: "ea"}, refuse)).toMatchObject({ok: false, code: "rejected"});
    });

    it("插入位越界时夹回来", () => {
        const doc = docOf(H(["ea", "eb"]), {ea: {tabs: [tab("p"), tab("q")], active: "tab:p"}});
        expect(okDoc(moveTabToStrip(doc, {tab: "tab:eb", panel: "ea", index: -3}, testPolicy())).panels.ea?.tabs.map(tabKey)).toEqual(["tab:eb", "tab:p", "tab:q"]);
    });

    it("并入已有面板的标签条：树不动，只改标签；收起的目标同一次展开", () => {
        const doc = docOf(H(["a", "b"]), {a: {tabs: [view("x"), view("y")], active: "view:x"}, b: {collapsed: true}});
        const result = okDoc(moveTabToStrip(doc, {tab: "view:x", panel: "b", index: 0}, testPolicy()));
        expect(shape(result)).toBe("H[a,b]");
        expect(result.panels.b?.tabs.map(tabKey)).toEqual(["view:x", "view:b"]);
        expect(result.panels.b?.active).toBe("view:x");
        expect(result.panels.b?.collapsed).toBe(false);
    });

    it("整个面板并入：全部标签保持顺序，来源拖空", () => {
        const doc = docOf(H(["a", "b", "ec"]), {a: {tabs: [view("x"), view("y")], active: "view:y"}});
        const result = okDoc(movePanelToStrip(doc, {panel: "a", target: "b"}, testPolicy()));
        expect(result.panels.b?.tabs.map(tabKey)).toEqual(["view:b", "view:x", "view:y"]);
        expect(result.panels.b?.active).toBe("view:y");
        expect(result.panels.a).toBeUndefined();
        expect(shape(result)).toBe("H[b,ec]");
    });

    it("接受矩阵：工具视图进不了编辑组的标签条，编辑器标签进不了工具面板的", () => {
        const doc = docOf(H(["a", "eb"]));
        expect(moveTabToStrip(doc, {tab: "view:a", panel: "eb", index: 0}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
        expect(moveTabToStrip(doc, {tab: "tab:eb", panel: "a", index: 0}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
    });
});

describe("不变量", () => {
    it("具名面板拖空时隐藏，留在树里；无名工具面板移除", () => {
        const doc = docOf(H(["sidebar", "a", "ec"]));
        const named = okDoc(removeTab(doc, "view:sidebar"));
        expect(named.panels.sidebar?.hidden).toBe(true);
        expect(shape(named)).toBe("H[sidebar,a,ec]");
        const unnamed = okDoc(removeTab(doc, "view:a"));
        expect(unnamed.panels.a).toBeUndefined();
        expect(shape(unnamed)).toBe("H[sidebar,ec]");
    });

    it("编辑组拖空后移除，最后一个留着；活动编辑组转到还在的组", () => {
        const doc = {...docOf(H(["ea", "eb", "c"])), currentEditor: "eb"};
        const once = okDoc(removeTab(doc, "tab:eb"));
        expect(once.panels.eb).toBeUndefined();
        expect(once.currentEditor).toBe("ea");
        const twice = okDoc(removeTab(once, "tab:ea"));
        expect(twice.panels.ea?.tabs).toEqual([]);
        expect(shape(twice)).toBe("H[ea,c]");
    });

    it("活动编辑组没了换到树序里相邻的：后面的优先，不是第一个", () => {
        const doc = {...docOf(H(["ea", "eb", "ec", "ed"])), currentEditor: "eb"};
        expect(okDoc(removeTab(doc, "tab:eb")).currentEditor).toBe("ec");
        const last = {...doc, currentEditor: "ed"};
        expect(okDoc(removeTab(last, "tab:ed")).currentEditor).toBe("ec");
        const other = {...doc, currentEditor: "ea"};
        expect(okDoc(removeTab(other, "tab:eb")).currentEditor).toBe("ea");
    });

    it("开新面板（activate: false）：只建组，活动编辑组不变", () => {
        const doc = {...docOf(H(["ea", "c"])), currentEditor: "ea"};
        const opened = okDoc(openPanelAtEdge(doc, {id: "n", panel: {role: "editor", tabs: [], active: null}, target: edge(doc, "ea", "bottom"), activate: false}, testPolicy()));
        expect(shape(opened)).toBe("H[V[ea,n],c]");
        expect(opened.currentEditor).toBe("ea");
    });

    it("最后一个编辑组里单个标签拖到工具面板外缘：整块移动，树里仍有编辑组", () => {
        const doc = docOf(H(["sidebar", "ea"]));
        const result = okDoc(moveTabToEdge(doc, {tab: "tab:ea", target: edge(doc, "sidebar", "bottom")}, testPolicy()));
        expect(shape(result)).toBe("V[sidebar,ea]");
        expect(result.panels.ea?.role).toBe("editor");
    });

    it("放弃布局的改动：结构回到旧的，动态标签以现在为准：关掉的拿掉，开着的放回原来那块，那块不在了进活动编辑组；活动标签与活动编辑组不变", () => {
        const saved = {...docOf(H(["sidebar", "ea", "eb"]), {ea: {tabs: [tab("closed"), tab("kept")], active: "tab:closed"}, eb: {tabs: [tab("other")], active: "tab:other"}}), currentEditor: "ea"};
        const moved = okDoc(openPanelAtEdge(saved, {id: "n", panel: {role: "editor", tabs: [tab("fresh")], active: "tab:fresh"}, target: edge(saved, "eb", "bottom")}, testPolicy()));
        const now = okDoc(removeTab(okDoc(insertTab(moved, {panel: "ea", tab: tab("added")})), "tab:closed"));
        const back = carryDynamicTabs(saved, now);
        expect(shape(back)).toBe("H[sidebar,ea,eb]");
        // 新开的那块（n）在旧文档里没有：它的标签进活动编辑组。
        expect(back.panels.ea?.tabs.map(tabKey)).toEqual(["tab:kept", "tab:added", "tab:fresh"]);
        expect(back.panels.ea?.active).toBe("tab:added");
        expect(back.panels.eb?.tabs.map(tabKey)).toEqual(["tab:other"]);
        expect(back.panels.sidebar?.tabs).toEqual([view("sidebar")]);
        expect(back.currentEditor).toBe("ea");
    });

    it("存盘前去掉动态标签：只留工具面板与一个空编辑组", () => {
        const doc = docOf(H(["sidebar", "ea", "eb"]), {ea: {tabs: [tab("p")], active: "tab:p"}});
        const stripped = stripDynamicTabs(doc);
        expect(Object.keys(stripped.panels).filter((id) => stripped.panels[id]?.role === "editor")).toHaveLength(1);
        expect(stripped.panels.sidebar?.tabs).toEqual([view("sidebar")]);
    });
});

describe("显隐与收起", () => {
    it("“显示”同时清掉隐藏与收起", () => {
        const doc = docOf(H(["panel", "ea"]), {panel: {hidden: true, collapsed: true}});
        const shown = okDoc(setPanelHidden(doc, "panel", false));
        expect(shown.panels.panel?.hidden).toBeUndefined();
        expect(shown.panels.panel?.collapsed).toBeUndefined();
    });

    it("只有具名面板能隐藏，编辑组不可收起，同值返回原对象", () => {
        const doc = docOf(H(["a", "ea", "sidebar"]));
        expect(setPanelHidden(doc, "a", true)).toMatchObject({ok: false, code: "rejected"});
        expect(setPanelCollapsed(doc, "ea", true)).toMatchObject({ok: false, code: "rejected"});
        expect(okDoc(setPanelHidden(doc, "sidebar", false))).toBe(doc);
        expect(okDoc(setBarHidden(doc, "statusbar", false))).toBe(doc);
        expect(okDoc(setBarHidden(doc, "statusbar", true)).hiddenBars).toEqual(["statusbar"]);
    });

    it("预备区：一次写入显示面板并接收", () => {
        const doc = docOf(H(["a", "auxiliarybar", "ec"]), {a: {tabs: [view("x"), view("y")], active: "view:x"}, auxiliarybar: {tabs: [], active: null, hidden: true}});
        const result = okDoc(showPanelAndInsert(doc, {panel: "auxiliarybar", source: {kind: "tab", tab: "view:x"}}, testPolicy()));
        expect(result.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(result.panels.auxiliarybar?.tabs).toEqual([view("x")]);
        expect(result.panels.auxiliarybar?.active).toBe("view:x");
        expect(result.panels.a?.tabs).toEqual([view("y")]);
    });

    it("预备区按位置插；标签本来就在这块面板里时只显示并激活，不重排（活动栏条目放到拖到零的侧栏）", () => {
        const doc = docOf(H(["a", "sidebar", "ec"]), {a: {tabs: [view("x"), view("y")], active: "view:x"}, sidebar: {tabs: [view("p"), view("q")], active: "view:p", collapsed: true}});
        const inserted = okDoc(showPanelAndInsert(doc, {panel: "sidebar", source: {kind: "tab", tab: "view:y"}, index: 1}, testPolicy()));
        expect(inserted.panels.sidebar?.tabs).toEqual([view("p"), view("y"), view("q")]);
        expect(inserted.panels.sidebar?.collapsed).toBeUndefined();
        const own = okDoc(showPanelAndInsert(doc, {panel: "sidebar", source: {kind: "tab", tab: "view:p"}}, testPolicy()));
        expect(own.panels.sidebar?.tabs).toEqual([view("p"), view("q")]);
        expect(own.panels.sidebar?.active).toBe("view:p");
        expect(own.panels.sidebar?.collapsed).toBeUndefined();
        const other = okDoc(showPanelAndInsert(doc, {panel: "sidebar", source: {kind: "tab", tab: "view:q"}}, testPolicy()));
        expect(other.panels.sidebar?.tabs).toEqual([view("p"), view("q")]);
        expect(other.panels.sidebar?.active).toBe("view:q");
    });
});

describe("校验", () => {
    const valid = (): LayoutDoc => docOf(V([H(["activitybar", "sidebar", "ea"]), "statusbar"]));

    it("合法文档通过", () => {
        expect(validateLayoutDoc(valid())).toEqual({ok: true, doc: valid()});
    });

    it("版本不支持与内容损坏是两种问题码", () => {
        expect(validateLayoutDoc({...valid(), version: 2})).toMatchObject({ok: false, code: "unsupported-version"});
        expect(validateLayoutDoc("坏的")).toMatchObject({ok: false, code: "invalid"});
    });

    it.each<[string, (doc: LayoutDoc) => unknown]>([
        ["面板不在树里", (doc) => ({...doc, panels: {...doc.panels, ghost: {role: "tool", tabs: [], active: null}}})],
        ["树里有未登记的面板", (doc) => {
            const {sidebar: _sidebar, ...panels} = doc.panels;
            return {...doc, panels};
        }],
        ["标签重复", (doc) => ({...doc, panels: {...doc.panels, sidebar: {...doc.panels.sidebar, tabs: [tab("ea")], active: "tab:ea"}}})],
        ["活动标签不在标签里", (doc) => ({...doc, panels: {...doc.panels, sidebar: {...doc.panels.sidebar, active: "view:nope"}}})],
        ["没有编辑组", (doc) => ({...doc, panels: {...doc.panels, ea: {...doc.panels.ea, role: "tool"}}})],
        ["具名面板重名", (doc) => ({...doc, panels: {...doc.panels, ea: {...doc.panels.ea, name: "sidebar"}}})],
        ["不认识的条", (doc) => ({...doc, tree: {...doc.tree, root: {...doc.tree.root, children: [...(doc.tree.root as {children: unknown[]}).children, {kind: "leaf", id: "x", ref: "bar:x", size: {width: 0, height: 0}}]}}})],
        ["hiddenBars 里的任意值", (doc) => ({...doc, hiddenBars: ["sidebar"]})],
        ["currentEditor 指向工具面板", (doc) => ({...doc, currentEditor: "sidebar"})],
        ["编辑组具名且隐藏", (doc) => ({...doc, panels: {...doc.panels, ea: {...doc.panels.ea, name: "panel", hidden: true}}})],
        ["无名面板隐藏", (doc) => ({...doc, panels: {...doc.panels, sidebar: {role: "tool", tabs: [], active: null, hidden: true}}})],
        ["编辑组收起", (doc) => ({...doc, panels: {...doc.panels, ea: {...doc.panels.ea, collapsed: true}}})],
        ["浮动不为空", (doc) => ({...doc, floats: [{}]})],
        ["条缺一个", (doc) => ({...doc, tree: {...doc.tree, root: {...doc.tree.root, children: [(doc.tree.root as {children: unknown[]}).children[0]]}}})],
        ["id 是原型键", (doc) => ({...doc, tree: {...doc.tree, root: {...doc.tree.root, id: "__proto__"}}})],
    ])("%s：拒绝", (_name, corrupt) => {
        expect(validateLayoutDoc(corrupt(valid()))).toMatchObject({ok: false, code: "invalid"});
    });

    it("默认树的形状校验通过，且条在最外层不随结构操作移动", () => {
        const doc = docOf(V([H(["activitybar", "sidebar", V(["ea", "panel"]), "auxiliarybar"]), "statusbar"]));
        expect(validateLayoutDoc(doc).ok).toBe(true);
        const moved = okDoc(moveTabToEdge(doc, {tab: "view:sidebar", target: edge(doc, "ea", "top")}, testPolicy()));
        expect(shape(moved)).toBe("V[H[activitybar,sidebar,V[n1,ea,panel],auxiliarybar],statusbar]");
    });
});

describe("浮动窗", () => {
    const RECT = {x: 100, y: 80, width: 460, height: 340};
    const base = () => docOf(V([H(["activitybar", "sidebar", "e0", "e1"], "body"), "statusbar"], "root"), {
        sidebar: {tabs: [view("a"), view("b")], active: "view:a"},
        e0: {tabs: [tab("t0"), tab("t1")], active: "tab:t0"},
        e1: {tabs: [tab("t2")], active: "tab:t2"},
    });
    const floated = (doc: LayoutDoc, key: string): string => {
        const panel = Object.entries(doc.panels).find(([, record]) => record.tabs.some((candidate) => tabKey(candidate) === key))?.[0];
        if (panel === undefined) throw new Error(`没有 ${key}`);
        return panel;
    };

    it("标签浮出来：新的无名面板，继承角色；来源还在；矩形写入时取整", () => {
        const doc = okDoc(floatTab(base(), {tab: "view:b", rect: {...RECT, x: 100.4, width: 459.6}}, testPolicy()));
        const panel = floated(doc, "view:b");
        expect(doc.panels[panel]).toEqual({role: "tool", tabs: [view("b")], active: "view:b"});
        expect(doc.floats).toEqual([{panel, rect: {...RECT, x: 100, width: 460}}]);
        expect(doc.panels.sidebar?.tabs).toEqual([view("a")]);
        expect(shape(doc)).toBe(shape(base()));
        expect(validateLayoutDoc(doc).ok).toBe(true);
    });

    it("编辑器标签浮出来成为活动编辑组；只有一个标签的组不留空壳；树里最后一个编辑组留一个空组", () => {
        const policy = testPolicy();
        const first = okDoc(floatTab(base(), {tab: "tab:t2", rect: RECT}, policy));
        expect(first.currentEditor).toBe(floated(first, "tab:t2"));
        expect(first.panels.e1).toBeUndefined();
        const all = okDoc(floatTab(okDoc(floatTab(first, {tab: "tab:t0", rect: RECT}, policy)), {tab: "tab:t1", rect: RECT}, policy));
        expect(all.panels.e0).toEqual({role: "editor", tabs: [], active: null});
        expect(all.floats).toHaveLength(3);
        expect(validateLayoutDoc(all).ok).toBe(true);
    });

    it("只有这一个标签的窗再浮动只改矩形：同一块面板，不换 id；矩形没变返回原对象", () => {
        const doc = okDoc(floatTab(base(), {tab: "view:b", rect: RECT}, testPolicy()));
        const panel = floated(doc, "view:b");
        const moved = okDoc(floatTab(doc, {tab: "view:b", rect: {...RECT, x: 200}}, testPolicy()));
        expect(moved.floats).toEqual([{panel, rect: {...RECT, x: 200}}]);
        expect(okDoc(setFloatRect(moved, {panel, rect: {...RECT, x: 200.2}}))).toBe(moved);
    });

    it("提到最前改次序；已在最前返回原对象；不存在的窗是 not-found", () => {
        const policy = testPolicy();
        const one = okDoc(floatTab(base(), {tab: "view:b", rect: RECT}, policy));
        const two = okDoc(floatTab(one, {tab: "tab:t1", rect: RECT}, policy));
        const [under, over] = two.floats.map((float) => float.panel) as [string, string];
        expect(okDoc(raiseFloat(two, over))).toBe(two);
        expect(okDoc(raiseFloat(two, under)).floats.map((float) => float.panel)).toEqual([over, under]);
        expect(raiseFloat(two, "e0")).toMatchObject({ok: false, code: "not-found"});
    });

    it("到上限失败，文档不变", () => {
        let doc = docOf(H(["e0"], "root"), {e0: {tabs: Array.from({length: LAYOUT_MAX_FLOATS + 2}, (_, index) => tab(`t${String(index)}`)), active: "tab:t0"}});
        const policy = testPolicy();
        for (let index = 0; index < LAYOUT_MAX_FLOATS; index += 1) doc = okDoc(floatTab(doc, {tab: `tab:t${String(index)}`, rect: RECT}, policy));
        expect(floatTab(doc, {tab: `tab:t${String(LAYOUT_MAX_FLOATS)}`, rect: RECT}, policy)).toMatchObject({ok: false, code: "limit-exceeded"});
    });

    it("窗空了移除；活动编辑组换到树序最后一个编辑组", () => {
        const doc = okDoc(floatTab(base(), {tab: "tab:t1", rect: RECT}, testPolicy()));
        const panel = floated(doc, "tab:t1");
        const closed = okDoc(removeTab(doc, "tab:t1"));
        expect(closed.panels[panel]).toBeUndefined();
        expect(closed.floats).toEqual([]);
        expect(closed.currentEditor).toBe("e1");
        expect(validateLayoutDoc(closed).ok).toBe(true);
    });

    it("回到树里：并入标签条、移到外缘；内容跟着键走，矩形从记录里消失", () => {
        const policy = testPolicy();
        const doc = okDoc(floatTab(base(), {tab: "view:b", rect: RECT}, policy));
        const panel = floated(doc, "view:b");
        const merged = okDoc(movePanelToStrip(doc, {panel, target: "sidebar"}, policy));
        expect(merged.floats).toEqual([]);
        expect(merged.panels[panel]).toBeUndefined();
        expect(merged.panels.sidebar?.tabs).toEqual([view("a"), view("b")]);
        const side = okDoc(movePanelToEdge(doc, {panel, target: edge(doc, "sidebar", "bottom")}, policy));
        expect(side.floats).toEqual([]);
        expect(side.panels[panel]?.tabs).toEqual([view("b")]);
        expect(shape(side)).toBe(shapeOf(okDoc(moveTabToEdge(base(), {tab: "view:b", target: edge(base(), "sidebar", "bottom")}, policy)).tree.root).replace(/n\d+/u, panel));
        expect(validateLayoutDoc(side).ok).toBe(true);
    });

    it("标签从多标签的窗回到树里，窗还在；最后一个标签走了窗没了", () => {
        const policy = testPolicy();
        const one = okDoc(floatTab(base(), {tab: "tab:t1", rect: RECT}, policy));
        const panel = floated(one, "tab:t1");
        const two = okDoc(moveTabToStrip(one, {tab: "tab:t0", panel, index: 1}, policy));
        expect(two.panels[panel]?.tabs).toEqual([tab("t1"), tab("t0")]);
        const back = okDoc(moveTabToStrip(two, {tab: "tab:t0", panel: "e1", index: 1}, policy));
        expect(back.floats.map((float) => float.panel)).toEqual([panel]);
        expect(okDoc(moveTabToStrip(back, {tab: "tab:t1", panel: "e1", index: 1}, policy)).floats).toEqual([]);
    });

    it("浮动窗不可收起；隐藏只有具名面板", () => {
        const doc = okDoc(floatTab(base(), {tab: "view:b", rect: RECT}, testPolicy()));
        const panel = floated(doc, "view:b");
        expect(setPanelCollapsed(doc, panel, true)).toMatchObject({ok: false, code: "rejected"});
        expect(setPanelHidden(doc, panel, true)).toMatchObject({ok: false, code: "rejected"});
    });

    it("校验：坏的 floats 拒绝", () => {
        const doc = okDoc(floatTab(base(), {tab: "view:b", rect: RECT}, testPolicy()));
        const panel = floated(doc, "view:b");
        const invalid = (floats: unknown, panels: unknown = doc.panels): boolean => validateLayoutDoc({...doc, floats, panels}).ok === false;
        expect(validateLayoutDoc(doc).ok).toBe(true);
        // 负坐标合法：窗可以拖出去一部分。
        expect(invalid([{panel, rect: {...RECT, x: -300, y: -10}}])).toBe(false);
        expect(invalid([{panel, rect: {...RECT, width: 0}}])).toBe(true);
        expect(invalid([{panel, rect: {...RECT, x: Number.NaN}}])).toBe(true);
        expect(invalid([{panel: "nobody", rect: RECT}])).toBe(true);
        expect(invalid([{panel: "e0", rect: RECT}])).toBe(true);
        expect(invalid([{panel, rect: RECT}, {panel, rect: RECT}])).toBe(true);
        expect(invalid([])).toBe(true);
        expect(invalid(doc.floats, {...doc.panels, [panel]: {...doc.panels[panel], collapsed: true}})).toBe(true);
        expect(invalid(doc.floats, {...doc.panels, [panel]: {...doc.panels[panel], name: "panel"}})).toBe(true);
        expect(invalid(Array.from({length: LAYOUT_MAX_FLOATS + 1}, () => ({panel, rect: RECT})))).toBe(true);
    });

    it("校验：编辑组全浮动不行，树里至少要有一个", () => {
        const doc = docOf(V([H(["activitybar", "sidebar", "e0"], "body"), "statusbar"], "root"), {sidebar: {tabs: [view("a")], active: "view:a"}, e0: {tabs: [], active: null}});
        expect(validateLayoutDoc(doc).ok).toBe(true);
        const floatOnly = {...doc, tree: docOf(V([H(["activitybar", "sidebar"], "body"), "statusbar"], "root")).tree, floats: [{panel: "e0", rect: RECT}]};
        expect(validateLayoutDoc(floatOnly)).toMatchObject({ok: false, code: "invalid"});
    });

    it("夹取：头留在区域里，窗比区域大时缩到区域；不改记录", () => {
        const extent = {width: 800, height: 600};
        const keep = {width: 80, height: 32};
        expect(clampFloatRect(RECT, extent, keep)).toEqual(RECT);
        expect(clampFloatRect({...RECT, x: 790, y: 590}, extent, keep)).toEqual({...RECT, x: 720, y: 568});
        expect(clampFloatRect({...RECT, x: -900, y: -40}, extent, keep)).toEqual({...RECT, x: 80 - 460, y: 0});
        expect(clampFloatRect({...RECT, width: 2000, height: 900}, extent, keep)).toEqual({...RECT, width: 800, height: 600});
    });

    it("缩放：负方向同时改位置，到了上下限对边不动", () => {
        const bounds = {min: {width: 200, height: 100}, max: {width: 600, height: 500}};
        expect(resizeFloatRect(RECT, {width: 1, height: 1}, {x: 40, y: 10}, bounds)).toEqual({...RECT, width: 500, height: 350});
        expect(resizeFloatRect(RECT, {width: -1, height: 0}, {x: -40, y: 10}, bounds)).toEqual({...RECT, x: 60, width: 500});
        expect(resizeFloatRect(RECT, {width: -1, height: -1}, {x: 1000, y: 1000}, bounds)).toEqual({x: 100 + 460 - 200, y: 80 + 340 - 100, width: 200, height: 100});
        expect(resizeFloatRect(RECT, {width: 1, height: 0}, {x: 1000, y: 0}, bounds)).toEqual({...RECT, width: 600});
    });
});
