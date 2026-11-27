import {describe, expect, it} from "bun:test";

import {createGrid} from "@notnotype/nb-layout";
import {docOf, H, shapeOf, sizeOf, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {
    activateTab,
    carryDynamicTabs,
    countsInShare,
    edgeTargetOf,
    edgeTargetTouches,
    findTreeNode,
    floatTab,
    insertTab,
    isPanelShown,
    isSectionCollapsed,
    LAYOUT_MAX_FLOATS,
    movePanelToEdge,
    movePanelToStrip,
    moveTabToEdge,
    moveTabToStrip,
    normalizeTree,
    openFloatPanel,
    openPanelAtEdge,
    raiseFloat,
    regionOf,
    removeTab,
    replaceTab,
    sameLayoutShape,
    sectionCollapseBlock,
    setActiveContainer,
    setBarHidden,
    setContainerEntries,
    setCurrentEditor,
    setFloatRect,
    setPanelCollapsed,
    setPanelHidden,
    setSiblingShares,
    stripDynamicTabs,
    tabKey,
    treeLeaves,
} from "./layout-doc";
import {validateLayoutDoc} from "./layout-doc-validate";
import type {LayoutDoc, LayoutEdge, LayoutEdgeTarget, LayoutResult} from "./layout-doc";
import type {GridSnapshotBranch, GridSnapshotNode} from "@notnotype/nb-layout";
import {enumerateDropCandidates} from "./layout-drop";
import {projectLayoutDoc} from "./layout-project";
import {rebaseIntents} from "./intent-writeback";
import type {LayoutProjectionOptions} from "./layout-project";

/** 布局文档（docs/specs/ui/workbench-layout.md 输出 1 到 4、8、25 到 28）。 */

function okDoc(result: LayoutResult): LayoutDoc {
    if (!result.ok) throw new Error(`操作失败：${result.code} ${result.message}`);
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

    describe("按比例重分一组兄弟（setSiblingShares）", () => {
        const heights = (doc: LayoutDoc, ids: ReadonlyArray<string>): number[] => ids.map((id) => sizeOf(doc.tree.root, id).height);

        it("这几块合占的主轴意图不变，彼此之比换成给定的；别的兄弟、交叉轴、文档的其余部分不动", () => {
            // 四块各 150 高、500 宽：只重分 b、c、d 合占的 450。
            const doc = docOf(H([V(["a", "b", "c", "d"], "col"), "e"]));
            const next = okDoc(setSiblingShares(doc, [{node: "b", share: 1}, {node: "c", share: 3}, {node: "d", share: 5}]));
            expect(heights(next, ["a", "b", "c", "d"])).toEqual([150, 50, 150, 250]);
            expect(["a", "b", "c", "d", "e"].map((id) => sizeOf(next.tree.root, id).width)).toEqual([500, 500, 500, 500, 500]);
            expect(shape(next)).toBe(shape(doc));
            expect(next.panels).toEqual(doc.panels);
        });

        it("用在外缘放置之后：连放两块得到的一半、四分之一，按搬之前的比例重分回来", () => {
            const doc = docOf(H([V(["a", "b"], "col"), V(["x", "y", "z"], "from"), "e"]));
            const first = okDoc(movePanelToEdge(doc, {panel: "x", target: edge(doc, "b", "bottom")}, testPolicy()));
            const second = okDoc(movePanelToEdge(first, {panel: "y", target: edge(first, "x", "bottom")}, testPolicy()));
            const total = heights(second, ["x", "y"]).reduce((sum, value) => sum + value, 0);
            const next = okDoc(setSiblingShares(second, [{node: "x", share: 3}, {node: "y", share: 1}]));
            expect(heights(next, ["x", "y"])).toEqual([total * 3 / 4, total / 4]);
            expect(heights(next, ["a", "b"])).toEqual(heights(second, ["a", "b"]));
        });

        it("分支也能当其中一块：它的主轴意图按比例写，里面的子节点不动", () => {
            const doc = docOf(V(["a", H(["b", "c"], "row"), "e"]));
            const next = okDoc(setSiblingShares(doc, [{node: "a", share: 1}, {node: "row", share: 3}]));
            expect(heights(next, ["a", "row"])).toEqual([100, 300]);
            expect(sizeOf(next.tree.root, "b")).toEqual(sizeOf(doc.tree.root, "b"));
        });

        it("不是同一个分支的子节点、节点不在树里、比例不是正的有限数、同一个节点给两次：拒绝，文档不变", () => {
            const doc = docOf(H([V(["a", "b"], "col"), "e"]));
            const rejected = (shares: ReadonlyArray<{node: string; share: number}>) => {
                const result = setSiblingShares(doc, shares);
                return result.ok ? "ok" : result.code;
            };
            expect(rejected([{node: "a", share: 1}, {node: "e", share: 1}])).toBe("rejected");
            expect(rejected([{node: "a", share: 1}, {node: "nope", share: 1}])).toBe("rejected");
            expect(rejected([{node: "a", share: 0}, {node: "b", share: 1}])).toBe("rejected");
            expect(rejected([{node: "a", share: Number.NaN}, {node: "b", share: 1}])).toBe("rejected");
            expect(rejected([{node: "a", share: 1}, {node: "a", share: 1}])).toBe("rejected");
            // 根没有父分支，没有“兄弟”可言。
            expect(rejected([{node: doc.tree.root.id, share: 1}])).toBe("rejected");
        });

        it("一项都不给：原样返回", () => {
            const doc = docOf(H(["a", "e"]));
            expect(okDoc(setSiblingShares(doc, []))).toBe(doc);
        });
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

    it("宿主给的新 id 已被占用时拒绝、文档不变：面板 id 撞已有面板、分支 id 撞树上的节点或浮动窗，都不覆盖别的面板", () => {
        const doc = docOf(H(["ea", "b"]), {ea: {tabs: [tab("x"), tab("y")], active: "tab:y"}});
        // 计数器式的 newId 在重新载入文档后从头数：第一次就给出已有的面板 id。
        const panelTaken = moveTabToEdge(doc, {tab: "tab:y", target: edge(doc, "b", "right")}, testPolicy({newId: () => "b"}));
        expect(panelTaken).toMatchObject({ok: false, code: "rejected"});
        expect(doc.panels.b?.tabs).toEqual([view("b")]);
        // 往不同方向分要新建分支：ea 只剩一个标签，整块挪过去，要的是分支的 id，它撞上已有的面板（这里是一块浮动窗）。
        const floating = okDoc(floatTab(doc, {tab: "tab:x", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy({newId: () => "w"})));
        const branchTaken = moveTabToEdge(floating, {tab: "tab:y", target: edge(floating, "b", "bottom")}, testPolicy({newId: () => "w"}));
        expect(branchTaken).toMatchObject({ok: false, code: "rejected"});
        expect(shape(floating)).toBe("H[ea,b]");
    });

    it("输入是响应式代理（深层的 Proxy，同 Vue 的 reactive）时结构操作照常：不抛，输入不变，结果和传原对象时一样", () => {
        const plain = docOf(H(["ea", "b"]), {ea: {tabs: [tab("x"), tab("y")], active: "tab:y"}});
        const before = JSON.stringify(plain);
        const proxied = <T extends object>(value: T): T => new Proxy(value, {get: (target, key, receiver) => {
            const found = Reflect.get(target, key, receiver) as unknown;
            return found !== null && typeof found === "object" ? proxied(found) : found;
        }});
        const result = okDoc(moveTabToEdge(proxied(plain), {tab: "tab:y", target: edge(plain, "b", "right")}, testPolicy()));
        expect(JSON.stringify(result)).toBe(JSON.stringify(okDoc(moveTabToEdge(plain, {tab: "tab:y", target: edge(plain, "b", "right")}, testPolicy()))));
        expect(JSON.stringify(plain)).toBe(before);
    });

    it("规模：2000 个标签的文档，一次结构操作的拷贝不慢（量数写进 layout-doc.ts 的注释，不设断言）", () => {
        const tabs = Array.from({length: 2000}, (_, index) => tab(`t${String(index)}`));
        const doc = docOf(H(["ea", "b"]), {ea: {tabs, active: "tab:t0"}});
        const started = performance.now();
        for (let round = 0; round < 20; round += 1) okDoc(moveTabToEdge(doc, {tab: "tab:t1", target: edge(doc, "b", "right")}, testPolicy()));
        const perRound = (performance.now() - started) / 20;
        console.info(`2000 个标签：一次外缘移动 ${perRound.toFixed(2)}ms`);
        expect(perRound).toBeGreaterThan(0);
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

describe("往一个方向分（输出 27）", () => {
    const moved = (doc: LayoutDoc, key: string, target: LayoutEdgeTarget): LayoutDoc => okDoc(moveTabToEdge(doc, {tab: key, target}, testPolicy()));
    const along = (doc: LayoutDoc, axis: "width" | "height", ...ids: string[]) => ids.map((id) => Math.round(sizeOf(doc.tree.root, id)[axis]));
    /** 三个编辑组并排，`ea` 里多一个要拖走的标签。 */
    const threeEditors = (): LayoutDoc => docOf(H(["ea", "eb", "ec"]), {ea: {tabs: [tab("ea"), tab("ex")], active: "tab:ea"}});
    const placedIn = (doc: LayoutDoc): string => treeLeaves(doc.tree.root).find((leaf) => leaf.id.startsWith("n"))?.id as string;

    it("split：只分这一块，别的块不动", () => {
        const next = moved(threeEditors(), "tab:ex", {kind: "split", panel: "eb", edge: "right"});
        expect(shape(next)).toBe("H[ea,eb,n1,ec]");
        expect(along(next, "width", "ea", "eb", "n1", "ec")).toEqual([333, 167, 167, 333]);
    });

    it("spread：新块占 1/(n+1)，其余按原比例缩，不是拉平", () => {
        const doc = threeEditors();
        const widths: Readonly<Record<string, number>> = {ea: 600, eb: 300, ec: 100};
        const root = doc.tree.root as GridSnapshotBranch;
        const sized: LayoutDoc = {...doc, tree: {...doc.tree, root: {...root, children: root.children.map((child) => ({...child, size: {...child.size, width: widths[child.id] as number}}))}}};
        const next = moved(sized, "tab:ex", {kind: "spread", panel: "eb", edge: "right"});
        expect(shape(next)).toBe("H[ea,eb,n1,ec]");
        expect(along(next, "width", "ea", "eb", "n1", "ec")).toEqual([450, 225, 250, 75]);
    });

    it("spread：编辑组上下两端都只在编辑组里分，新块插在面板之前，固定的面板和侧栏不动", () => {
        const cases = [["e1", "top", "V[n1,e1,e2,panel]"], ["e2", "bottom", "V[e1,e2,n1,panel]"]] as const;
        for (const [panel, side, expected] of cases) {
            const doc = docOf(H(["sidebar", V(["e1", "e2", "panel"], "center")]), {e1: {tabs: [tab("e1"), tab("ex")], active: "tab:e1"}});
            const next = moved(doc, "tab:ex", {kind: "spread", panel, edge: side});
            expect(shapeOf(findTreeNode(next.tree.root, "center")?.node as GridSnapshotNode)).toBe(expected);
            expect(along(next, "height", "panel")).toEqual(along(doc, "height", "panel"));
            expect(along(next, "height", "e1", "e2", placedIn(next))).toEqual([133, 133, 133]);
            expect(along(next, "width", "sidebar")).toEqual(along(doc, "width", "sidebar"));
        }
    });

    it("spread：摘掉来源后分支塌陷时按 split，来源放到剩下那块的另一边", () => {
        const doc = docOf(V([H(["b", "src"], "pair"), "panel"]));
        const next = moved(doc, "view:src", {kind: "spread", panel: "b", edge: "left"});
        expect(shape(next)).toBe("V[H[src,b],panel]");
    });

    it("spread：来源在同一分支时先摘掉再算，n 不含来源", () => {
        const doc = docOf(V(["e1", "e2", "es"]));
        const next = moved(doc, "tab:es", {kind: "spread", panel: "e1", edge: "top"});
        expect(shape(next)).toBe("V[es,e1,e2]");
        const [placed, first, second] = along(next, "height", "es", "e1", "e2") as [number, number, number];
        expect(placed / (placed + first + second)).toBeCloseTo(1 / 3, 1);
    });

    it("spread：隐藏的、收起的不占份额，也不缩", () => {
        const doc = docOf(V(["sidebar", "shut", "a", "b"]), {
            sidebar: {hidden: true},
            shut: {collapsed: true},
            b: {tabs: [view("b"), view("x")], active: "view:b"},
        });
        const next = moved(doc, "view:x", {kind: "spread", panel: "a", edge: "bottom"});
        expect(along(next, "height", "sidebar", "shut")).toEqual(along(doc, "height", "sidebar", "shut"));
        expect(along(next, "height", "a", "b", "n1")).toEqual([100, 100, 100]);
    });

    it("spread：具名来源拖空就不占份额，新块按看得见的块数分", () => {
        const doc = docOf(V(["sidebar", "a", "b"], "column"));
        const root = doc.tree.root as GridSnapshotBranch;
        const heights: Readonly<Record<string, number>> = {sidebar: 400, a: 100, b: 100};
        const sized: LayoutDoc = {...doc, tree: {...doc.tree, root: {...root, children: root.children.map((child) => ({...child, size: {...child.size, height: heights[child.id] as number}}))}}};
        const next = moved(sized, "view:sidebar", {kind: "spread", panel: "b", edge: "bottom"});
        expect(next.panels.sidebar?.hidden).toBe(true);
        expect(along(next, "height", "a", "b", "n1")).toEqual([67, 67, 67]);
        expect(along(next, "height", "sidebar")).toEqual([400]);
    });

    it("两种分法放回紧挨着来源的那条边都是原处：什么都不变", () => {
        for (const kind of ["split", "spread"] as const) {
            const doc = docOf(H(["a", "src", "b"]));
            expect(okDoc(moveTabToEdge(doc, {tab: "view:src", target: {kind, panel: "a", edge: "right"}}, testPolicy()))).toBe(doc);
            expect(edgeTargetTouches(doc, {kind, panel: "a", edge: "right"}, "src")).toBe(true);
            expect(edgeTargetTouches(doc, {kind, panel: "a", edge: "left"}, "src")).toBe(false);
        }
    });

    it("具名面板只有一个标签：放到紧挨着它的那条边也是原处，不隐藏", () => {
        const doc = docOf(V(["sidebar", "a"]));
        expect(okDoc(moveTabToEdge(doc, {tab: "view:sidebar", target: {kind: "split", panel: "a", edge: "top"}}, testPolicy()))).toBe(doc);
    });
});

describe("标签", () => {
    it("插入、激活：编辑组的激活改活动编辑组", () => {
        const doc = docOf(H(["ea", "eb"]));
        const inserted = okDoc(insertTab(doc, {panel: "eb", tab: tab("z")}));
        expect(inserted.panels.eb?.active).toBe("tab:z");
        expect(inserted.currentEditor).toBe("eb");
        expect(okDoc(activateTab(inserted, "tab:ea")).currentEditor).toBe("ea");
        // 失败与 nb-layout 同形（Spec ui/workbench-layout 失败与恢复）：`message` 是英文，只给日志看。
        const ascii = expect.stringMatching(/^[\x20-\x7e]+$/u);
        expect(insertTab(doc, {panel: "eb", tab: tab("ea")})).toEqual({ok: false, code: "rejected", message: ascii});
        expect(insertTab(doc, {panel: "nope", tab: tab("z")})).toEqual({ok: false, code: "not-found", message: ascii});
        expect(validateLayoutDoc({version: 99})).toEqual({ok: false, code: "unsupported-version", message: ascii});
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
});

describe("校验", () => {
    const valid = (): LayoutDoc => docOf(V([H(["activitybar", "sidebar", "ea"]), "statusbar"]));

    it("合法文档通过", () => {
        expect(validateLayoutDoc(valid())).toEqual({ok: true, doc: valid(), repairs: []});
    });

    it("条的叶 id 要等于条名；别的节点、面板与浮动窗的 id 不能是条名，也不能撞上呈现里生成的 id（入口条叶、区域的内层分支）", () => {
        const doc = valid();
        const rename = (from: string, to: string): LayoutDoc => JSON.parse(JSON.stringify(doc).replaceAll(`"${from}"`, `"${to}"`)) as LayoutDoc;
        // 活动栏叶的 id 写错了：宿主按叶 id 认条，画不出活动栏。
        const bar = JSON.parse(JSON.stringify(doc)) as LayoutDoc;
        const barLeaf = treeLeaves(bar.tree.root).find((leaf) => leaf.id === "activitybar") as {id: string};
        barLeaf.id = "bar-a";
        expect(validateLayoutDoc(bar)).toMatchObject({ok: false, code: "invalid"});
        // 面板 id（连同它的叶与 ref）是条名、入口条叶的写法、内层分支的写法。
        for (const id of ["statusbar", "strip:sidebar", "strip:whatever", "sidebar:sections"]) {
            expect(validateLayoutDoc(rename("sidebar", id)), id).toMatchObject({ok: false, code: "invalid"});
        }
        // 分支的 id 撞上同样的写法。
        const branch = JSON.parse(JSON.stringify(doc)) as LayoutDoc;
        (branch.tree.root as {id: string}).id = "strip:panel";
        expect(validateLayoutDoc(branch)).toMatchObject({ok: false, code: "invalid"});
        // 浮动窗的面板 id 同样。
        const floating = okDoc(floatTab(doc, {tab: "view:sidebar", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy({newId: () => "strip:x"})));
        expect(validateLayoutDoc(floating)).toMatchObject({ok: false, code: "invalid"});
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

    it("开一个空窗：到上限失败；id 已有（面板或树里的分支）失败；`activate: false` 不改活动编辑组", () => {
        const panel = {role: "editor", tabs: [], active: null} as const;
        const opened = okDoc(openFloatPanel(base(), {id: "w", panel, rect: RECT, activate: false}));
        expect(opened.floats).toEqual([{panel: "w", rect: RECT}]);
        expect(opened.currentEditor).toBe(base().currentEditor);
        expect(openFloatPanel(opened, {id: "w", panel, rect: RECT})).toMatchObject({ok: false, code: "rejected"});
        const branch = opened.tree.root;
        expect(branch.kind).toBe("branch");
        expect(openFloatPanel(opened, {id: branch.id, panel, rect: RECT})).toMatchObject({ok: false, code: "rejected"});
        let full = opened;
        for (let index = 1; index < LAYOUT_MAX_FLOATS; index += 1) full = okDoc(openFloatPanel(full, {id: `w${String(index)}`, panel, rect: RECT}));
        expect(openFloatPanel(full, {id: "more", panel, rect: RECT})).toMatchObject({ok: false, code: "limit-exceeded"});
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
        // 和分支 id 撞：按 id 摘节点会把整棵分支摘掉。
        expect(validateLayoutDoc({...doc, floats: [{panel: "body", rect: RECT}], panels: {...doc.panels, body: doc.panels[panel]}}).ok).toBe(false);
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
});

/** 区域与容器（docs/specs/ui/workbench-layout.md 输出 28、40 到 43；ADR 0046）。 */
describe("区域与容器", () => {
    /** 侧栏的容器 A（当前）有 s1、s2，容器 B 有 s3；底部面板的容器 P 有 p1；右栏没有容器，隐藏着，区域只剩锚。 */
    const containers = (): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1", "s2", "s3"], "side"), V(["ea", H(["panel", "p1"], "row")], "center"), "auxiliarybar"], "body"), "statusbar"], "root"), {
        sidebar: {tabs: [], active: null, entries: ["A", "B"], activeContainer: "A"},
        s1: {container: "A"},
        s2: {container: "A"},
        s3: {container: "B"},
        panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
        p1: {container: "P"},
        auxiliarybar: {tabs: [], active: null, hidden: true, entries: [], activeContainer: null},
    });
    /** 侧栏用容器（s1 属于当前的 A，s2 属于 B）；右栏没有新字段，还是原来的具名面板，下面分出一块两个标签的 x。 */
    const mixed = (): LayoutDoc => docOf(V([H(["activitybar", V(["sidebar", "s1", "s2"], "side"), "ea", V(["auxiliarybar", "x"], "aux")], "body"), "statusbar"], "root"), {
        sidebar: {tabs: [], active: null, entries: ["A", "B"], activeContainer: "A"},
        s1: {container: "A"},
        s2: {container: "B"},
        x: {tabs: [view("x"), view("y")], active: "view:x"},
    });
    const shownOf = (doc: LayoutDoc, ids: ReadonlyArray<string>): boolean[] => ids.map((id) => isPanelShown(doc, id));

    describe("区域", () => {
        it("分节属于和它同一列（底部面板是同一排）的那片锚；锚是自己的区域；编辑组、浮动窗不属于任何区域", () => {
            const doc = okDoc(floatTab(containers(), {tab: "view:s2", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy()));
            expect(["s1", "s3", "p1", "sidebar", "auxiliarybar", "panel"].map((id) => regionOf(doc, id))).toEqual(["sidebar", "sidebar", "panel", "sidebar", "auxiliarybar", "panel"]);
            expect(regionOf(doc, "ea")).toBeNull();
            expect(doc.floats.map((float) => regionOf(doc, float.panel))).toEqual([null]);
            expect(regionOf(doc, "nope")).toBeNull();
        });

        it("区域只剩锚时，锚直接在骨架的分支里：它旁边的工具面板与编辑组不算这个区域的", () => {
            const doc = docOf(V([H(["activitybar", "sidebar", "t", V(["ea", "panel", "u"])]), "statusbar"]));
            expect(["sidebar", "panel"].map((id) => regionOf(doc, id))).toEqual(["sidebar", "panel"]);
            expect(["t", "u", "ea"].map((id) => regionOf(doc, id))).toEqual([null, null, null]);
        });
    });

    describe("可见", () => {
        it("只显示区域当前容器的分节；锚自己不显示；区域隐藏时它的分节都不显示，别的区域不受影响", () => {
            const doc = containers();
            expect(shownOf(doc, ["s1", "s2", "s3", "p1", "sidebar", "panel"])).toEqual([true, true, false, true, false, false]);
            const hidden = okDoc(setPanelHidden(doc, "sidebar", true));
            expect(shownOf(hidden, ["s1", "s2", "s3", "p1"])).toEqual([false, false, false, true]);
        });

        it("没有新字段的文档照旧：空的具名面板能显示，具名面板隐藏不带走同一列的工具面板", () => {
            const empty = docOf(H(["sidebar", "ea"]), {sidebar: {tabs: [], active: null}});
            expect(isPanelShown(empty, "sidebar")).toBe(true);
            const column = docOf(H([V(["sidebar", "tool"]), "ea"]), {sidebar: {hidden: true}});
            expect(shownOf(column, ["sidebar", "tool"])).toEqual([false, true]);
        });

        it("归属只在区域里起作用：带着归属的浮动窗照常显示", () => {
            const floated = okDoc(floatTab(containers(), {tab: "view:s3", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy()));
            const id = floated.floats[0]?.panel as string;
            const stale = {...floated, panels: {...floated.panels, [id]: {...(floated.panels[id] as LayoutDoc["panels"][string]), container: "B"}}};
            expect(isPanelShown(stale, id)).toBe(true);
        });

        it("归属只在带容器的区域里起作用：区域的具名面板不是锚时，同一列里带着归属的面板照常显示，具名面板隐藏也不带走它", () => {
            const doc = mixed();
            const stale: LayoutDoc = {...doc, panels: {...doc.panels, x: {...(doc.panels.x as LayoutDoc["panels"][string]), container: "gone"}}};
            expect(regionOf(stale, "x")).toBe("auxiliarybar");
            expect(isPanelShown(stale, "x")).toBe(true);
            expect(isPanelShown(okDoc(setPanelHidden(stale, "auxiliarybar", true)), "x")).toBe(true);
            // 写入路径问的是同一件事：挨着它开的新面板不带归属。
            const opened = okDoc(openPanelAtEdge(stale, {id: "v", panel: {role: "tool", tabs: [view("v")], active: "view:v"}, target: edge(stale, "x", "bottom")}, testPolicy()));
            expect(opened.panels.v?.container).toBeUndefined();
        });

        it("不在当前容器里的分节与锚不是键盘拖动的落点，也不被别的落点当成相邻的兄弟", () => {
            const candidates = enumerateDropCandidates({doc: containers(), source: {kind: "tab", tab: "view:p1"}, policy: testPolicy(), stripIndexes: () => [0]});
            expect([...new Set(candidates.map((candidate) => candidate.region))].sort()).toEqual(["ea", "s1", "s2"]);
            // 动作里的面板 id 都是值（`"panel":"s1"`、`"before":"s1"`），所以按“冒号后面的值”找，不和 `panel` 这个键混在一起。
            const mentioned = JSON.stringify(candidates.map((candidate) => candidate.action));
            for (const absent of ["s3", "sidebar", "auxiliarybar", "panel"]) expect(mentioned).not.toContain(`:"${absent}"`);
        });
    });

    describe("空区域（ADR 0050）", () => {
        it("锚只在区域显示着、一个分节都没有时显示，那时它就是这块区域；有分节或隐藏着时不显示", () => {
            const doc = containers();
            expect(shownOf(doc, ["auxiliarybar", "sidebar", "panel"])).toEqual([false, false, false]);
            const opened = okDoc(setPanelHidden(doc, "auxiliarybar", false));
            expect(opened).not.toBe(doc);
            expect(shownOf(opened, ["auxiliarybar", "sidebar", "panel"])).toEqual([true, false, false]);
        });

        it("拖走区域最后一节，区域随之隐藏（摘掉、移到别处都一样）；打开着的空区域，别的操作不把它藏起来", () => {
            expect(okDoc(removeTab(containers(), "view:p1")).panels.panel?.hidden).toBe(true);
            const moved = okDoc(moveTabToEdge(containers(), {tab: "view:p1", target: {kind: "split", panel: "s1", edge: "bottom"}}, testPolicy()));
            expect(moved.panels.panel?.hidden).toBe(true);
            expect(regionOf(moved, "p1")).toBe("sidebar");
            const opened = okDoc(setPanelHidden(containers(), "auxiliarybar", false));
            const other = okDoc(removeTab(opened, "view:s3"));
            expect(other.panels.auxiliarybar?.hidden).toBeUndefined();
            expect(isPanelShown(other, "auxiliarybar")).toBe(true);
        });

        it("放进空区域：区域没有当前容器时，落进来的容器就是当前容器、排进入口顺序；新分节显示、锚不再显示，不用宿主的归整", () => {
            const opened = okDoc(setPanelHidden(containers(), "auxiliarybar", false));
            const landed = okDoc(moveTabToEdge(opened, {tab: "view:s3", target: {kind: "split", panel: "auxiliarybar", edge: "bottom"}, container: "C"}, testPolicy()));
            expect(regionOf(landed, "s3")).toBe("auxiliarybar");
            expect(landed.panels.auxiliarybar).toMatchObject({entries: ["C"], activeContainer: "C"});
            expect(shownOf(landed, ["s3", "auxiliarybar"])).toEqual([true, false]);
            // 区域已经有当前容器时不换：放进不是当前容器的那个，照旧看不见，切换由宿主做（ADR 0046 决策 5）。
            const other = okDoc(moveTabToEdge(containers(), {tab: "view:s3", target: {kind: "split", panel: "p1", edge: "right"}, container: "Q"}, testPolicy()));
            expect(other.panels.panel).toMatchObject({activeContainer: "P"});
            expect(isPanelShown(other, "s3")).toBe(false);
        });
    });

    describe("切换容器（输出 42）", () => {
        it("换掉当前容器：树与尺寸意图一点不动，切回来各分节的显隐、收成标题行原样；只切换也算有变化", () => {
            const doc = okDoc(setPanelCollapsed(containers(), "s1", true));
            const switched = okDoc(setActiveContainer(doc, "sidebar", "B"));
            expect(switched).not.toBe(doc);
            expect(sameLayoutShape(doc, switched)).toBe(false);
            expect(switched.tree).toEqual(doc.tree);
            expect(shownOf(switched, ["s1", "s2", "s3"])).toEqual([false, false, true]);
            const back = okDoc(setActiveContainer(switched, "sidebar", "A"));
            expect(back.tree).toEqual(doc.tree);
            expect(back.panels).toEqual(doc.panels);
            expect(sameLayoutShape(doc, back)).toBe(true);
        });

        it("同一次写入清掉区域的拖到零，不改区域的隐藏；已经是当前容器、也没拖到零时返回原对象", () => {
            const doc = containers();
            expect(okDoc(setActiveContainer(doc, "sidebar", "A"))).toBe(doc);
            const zero = okDoc(setPanelHidden(okDoc(setPanelCollapsed(doc, "sidebar", true)), "sidebar", true));
            const switched = okDoc(setActiveContainer(zero, "sidebar", "B"));
            expect(switched.panels.sidebar).toMatchObject({activeContainer: "B", hidden: true});
            expect(switched.panels.sidebar?.collapsed).toBeUndefined();
            const same = okDoc(setActiveContainer(zero, "sidebar", "A"));
            expect(same.panels.sidebar?.collapsed).toBeUndefined();
            expect(same.panels.sidebar?.hidden).toBe(true);
        });

        it("不在入口顺序里的容器、不是锚的面板（无名的、不用容器的具名面板）都拒绝；null 是区域里没有容器", () => {
            const doc = containers();
            expect(setActiveContainer(doc, "sidebar", "nope")).toMatchObject({ok: false, code: "rejected"});
            expect(setActiveContainer(doc, "s1", "A")).toMatchObject({ok: false, code: "rejected"});
            expect(setActiveContainer(doc, "ghost", "A")).toMatchObject({ok: false, code: "not-found"});
            expect(setActiveContainer(mixed(), "auxiliarybar", null)).toMatchObject({ok: false, code: "rejected"});
            expect(shownOf(okDoc(setActiveContainer(doc, "sidebar", null)), ["s1", "s2", "s3"])).toEqual([false, false, false]);
        });
    });

    describe("收成标题行（输出 11、20）", () => {
        it("区域此刻只显示这一个分节时它不算收起，记录留着；又显示两个分节时重新起作用", () => {
            const doc = okDoc(setPanelCollapsed(containers(), "s1", true));
            expect(isSectionCollapsed(doc, "s1")).toBe(true);
            expect(sectionCollapseBlock(doc, "s1")).toBeNull();

            // s2 换到容器 B：位置是原处，只换归属。当前容器 A 里只剩 s1。
            const alone = okDoc(movePanelToEdge(doc, {panel: "s2", target: edge(doc, "s1", "bottom"), container: "B"}, testPolicy()));
            expect(alone.tree).toEqual(doc.tree);
            expect(shownOf(alone, ["s1", "s2"])).toEqual([true, false]);
            expect(alone.panels.s1?.collapsed).toBe(true);
            expect(isSectionCollapsed(alone, "s1")).toBe(false);
            expect(sectionCollapseBlock(alone, "s1")).toBe("lone-section");

            const back = okDoc(movePanelToEdge(alone, {panel: "s2", target: edge(alone, "s1", "bottom"), container: "A"}, testPolicy()));
            expect(isSectionCollapsed(back, "s1")).toBe(true);
            expect(back.panels).toEqual(doc.panels);
        });

        it("另一个分节是关掉的、区域切到只有一个分节的容器，也一样", () => {
            const closed = okDoc(removeTab(okDoc(setPanelCollapsed(containers(), "s1", true)), "view:s2"));
            expect(closed.panels.s1?.collapsed).toBe(true);
            expect(isSectionCollapsed(closed, "s1")).toBe(false);

            // 不在当前容器里的分节按“区域此刻显示的”判：s3 现在不显示，收起只是记下；切过去它是唯一的一节，不算收起。
            const hiddenOne = okDoc(setPanelCollapsed(containers(), "s3", true));
            expect(isSectionCollapsed(hiddenOne, "s3")).toBe(true);
            const switched = okDoc(setActiveContainer(hiddenOne, "sidebar", "B"));
            expect(switched.panels.s3?.collapsed).toBe(true);
            expect(isSectionCollapsed(switched, "s3")).toBe(false);
        });

        it("收起：区域唯一显示的分节、底部面板的分节都拒绝，文档不变；展开总是允许，清掉留着的记录", () => {
            const doc = containers();
            const single = okDoc(setActiveContainer(doc, "sidebar", "B"));
            expect(setPanelCollapsed(single, "s3", true)).toMatchObject({ok: false, code: "rejected"});
            // 区域隐藏着也按显示时算：隐藏那一刻滑出去的面板头不多出收起按钮。两节的照旧各自能收。
            const hiddenSingle = okDoc(setPanelHidden(single, "sidebar", true));
            expect(sectionCollapseBlock(hiddenSingle, "s3")).toBe("lone-section");
            expect(setPanelCollapsed(hiddenSingle, "s3", true)).toMatchObject({ok: false, code: "rejected"});
            expect(sectionCollapseBlock(okDoc(setPanelHidden(doc, "sidebar", true)), "s1")).toBeNull();
            expect(setPanelCollapsed(doc, "p1", true)).toMatchObject({ok: false, code: "rejected"});
            expect(sectionCollapseBlock(doc, "p1")).toBe("row-region");
            // 拒绝的是分节，不是区域：底部面板的锚照常收起（整个区域拖到零）。
            expect(sectionCollapseBlock(doc, "panel")).toBeNull();
            expect(okDoc(setPanelCollapsed(doc, "panel", true)).panels.panel?.collapsed).toBe(true);
            // 两节都显示时各自能收，两节一起收成标题行也行。
            const both = okDoc(setPanelCollapsed(okDoc(setPanelCollapsed(doc, "s1", true)), "s2", true));
            expect([isSectionCollapsed(both, "s1"), isSectionCollapsed(both, "s2")]).toEqual([true, true]);

            const alone = okDoc(removeTab(okDoc(setPanelCollapsed(doc, "s1", true)), "view:s2"));
            const expanded = okDoc(setPanelCollapsed(alone, "s1", false));
            expect(expanded.panels.s1?.collapsed).toBeUndefined();
            expect(okDoc(setPanelCollapsed(expanded, "s1", false))).toBe(expanded);
        });

        it("底部面板的分节记录里留着 `collapsed` 也不算收起", () => {
            const doc = containers();
            const stale: LayoutDoc = {...doc, panels: {...doc.panels, p1: {...(doc.panels.p1 as LayoutDoc["panels"][string]), collapsed: true}}};
            expect(isSectionCollapsed(stale, "p1")).toBe(false);
            expect(okDoc(setPanelCollapsed(stale, "p1", false)).panels.p1?.collapsed).toBeUndefined();
        });

        it("不在带容器的区域里的面板只看记录：没有容器的那一列里唯一的工具面板照常收起；锚的 `collapsed` 是区域拖到零，不是收成标题行", () => {
            const plain = okDoc(setPanelCollapsed(mixed(), "x", true));
            expect(isSectionCollapsed(plain, "x")).toBe(true);
            expect(sectionCollapseBlock(plain, "x")).toBeNull();
            const zero = okDoc(setPanelCollapsed(mixed(), "sidebar", true));
            expect(zero.panels.sidebar?.collapsed).toBe(true);
            expect(isSectionCollapsed(zero, "sidebar")).toBe(false);
            expect(isSectionCollapsed(zero, "ghost")).toBe(false);
        });

        it("不算收起的分节照常占份额、照常收手势写回的尺寸：唯一显示的分节带着 `collapsed` 时，把区域拖宽不丢", () => {
            const doc = okDoc(removeTab(okDoc(setPanelCollapsed(containers(), "s1", true)), "view:s2"));
            const side = findTreeNode(doc.tree.root, "side")?.node as GridSnapshotNode;
            expect(countsInShare(doc, side)).toBe(true);

            const {input, sashSize, collapsedTo} = projectLayoutDoc(doc, PROJECTION);
            const sizes = createGrid<string>(input, {sashSize}).layout({width: 1000, height: 600}).sizes;
            const presented = sizes.s1 as {width: number; height: number};
            const rebased = rebaseIntents(doc, {...sizes, s1: {...presented, width: presented.width + 60}}, collapsedTo);
            expect(sizeOf(rebased.tree.root, "s1").width).toBe(presented.width + 60);
            expect(presentedSizes(rebased).s1?.width).toBe(presented.width + 60);
        });

        it("底部面板的分节带着 `collapsed` 时，分节之间拖出来的宽度照常写回", () => {
            const base = docOf(V([H(["activitybar", V(["ea", H(["panel", "p1", "p2"], "row")], "center")], "body"), "statusbar"], "root"), {
                panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
                p1: {container: "P", collapsed: true},
                p2: {container: "P"},
            });
            const {input, sashSize, collapsedTo} = projectLayoutDoc(base, PROJECTION);
            const sizes = createGrid<string>(input, {sashSize}).layout({width: 1000, height: 600}).sizes;
            const [p1, p2] = [sizes.p1, sizes.p2] as [{width: number; height: number}, {width: number; height: number}];
            expect(p1.width).toBeCloseTo(p2.width);
            const dragged = {...sizes, p1: {...p1, width: p1.width - 120}, p2: {...p2, width: p2.width + 120}};
            const again = presentedSizes(rebaseIntents(base, dragged, collapsedTo));
            expect(again.p1?.width).toBeCloseTo(p1.width - 120);
            expect(again.p2?.width).toBeCloseTo(p2.width + 120);
        });
    });

    describe("入口顺序（输出 41）", () => {
        it("整份替换；和现在一样时返回原对象", () => {
            const doc = containers();
            const reordered = okDoc(setContainerEntries(doc, "sidebar", ["B", "A", "C"]));
            expect(reordered.panels.sidebar).toMatchObject({entries: ["B", "A", "C"], activeContainer: "A"});
            expect(sameLayoutShape(doc, reordered)).toBe(false);
            expect(okDoc(setContainerEntries(doc, "sidebar", ["A", "B"]))).toBe(doc);
        });

        it("拿掉当前容器、重复、空串、无名面板、还有标签的具名面板都拒绝；先换走当前容器就能拿掉", () => {
            const doc = containers();
            expect(setContainerEntries(doc, "sidebar", ["B"])).toMatchObject({ok: false, code: "rejected"});
            expect(setContainerEntries(doc, "sidebar", ["A", "A"])).toMatchObject({ok: false, code: "rejected"});
            expect(setContainerEntries(doc, "sidebar", ["A", ""])).toMatchObject({ok: false, code: "rejected"});
            expect(setContainerEntries(doc, "s1", ["A"])).toMatchObject({ok: false, code: "rejected"});
            expect(setContainerEntries(doc, "ghost", ["A"])).toMatchObject({ok: false, code: "not-found"});
            expect(setContainerEntries(mixed(), "auxiliarybar", ["A"])).toMatchObject({ok: false, code: "rejected"});
            const moved = okDoc(setContainerEntries(okDoc(setActiveContainer(doc, "sidebar", "B")), "sidebar", ["B"]));
            expect(moved.panels.sidebar).toMatchObject({entries: ["B"], activeContainer: "B"});
        });
    });

    describe("放进区域（输出 40）", () => {
        it("标签放到分节的标签条：不并进去，紧挨着它新建分节，跟它同一个容器；插入位在最前是它前面", () => {
            const after = okDoc(moveTabToStrip(mixed(), {tab: "view:y", panel: "s1", index: 1}, testPolicy()));
            expect(shape(after)).toBe("V[H[activitybar,V[sidebar,s1,n1,s2],ea,V[auxiliarybar,x]],statusbar]");
            expect(after.panels.s1?.tabs).toEqual([view("s1")]);
            expect(after.panels.n1).toEqual({role: "tool", tabs: [view("y")], active: "view:y", container: "A"});
            const before = okDoc(moveTabToStrip(mixed(), {tab: "view:y", panel: "s1", index: 0}, testPolicy()));
            expect(shape(before)).toBe("V[H[activitybar,V[sidebar,n1,s1,s2],ea,V[auxiliarybar,x]],statusbar]");
            const inactive = okDoc(moveTabToStrip(mixed(), {tab: "view:y", panel: "s2", index: 1}, testPolicy()));
            expect(inactive.panels.n1?.container).toBe("B");
            expect(isPanelShown(inactive, "n1")).toBe(false);
        });

        it("整块多标签的面板放到分节上、多标签的浮动窗停靠进区域：一个标签一节，按原顺序，同一个容器", () => {
            const merged = okDoc(movePanelToStrip(mixed(), {panel: "x", target: "s1"}, testPolicy()));
            expect(shape(merged)).toBe("V[H[activitybar,V[sidebar,s1,x,n1,s2],ea,auxiliarybar],statusbar]");
            expect(merged.panels.x).toEqual({role: "tool", tabs: [view("x")], active: "view:x", container: "A"});
            expect(merged.panels.n1).toEqual({role: "tool", tabs: [view("y")], active: "view:y", container: "A"});

            const floating: LayoutDoc = {...mixed(), panels: {...mixed().panels, f: {role: "tool", tabs: [view("f1"), view("f2")], active: "view:f2"}}, floats: [{panel: "f", rect: {x: 10, y: 10, width: 300, height: 200}}]};
            const docked = okDoc(movePanelToEdge(floating, {panel: "f", target: {kind: "split", panel: "s1", edge: "top"}}, testPolicy()));
            expect(shape(docked)).toBe("V[H[activitybar,V[sidebar,f,n1,s1,s2],ea,V[auxiliarybar,x]],statusbar]");
            expect(docked.floats).toEqual([]);
            expect([docked.panels.f, docked.panels.n1].map((panel) => [panel?.tabs, panel?.container])).toEqual([[[view("f1")], "A"], [[view("f2")], "A"]]);
            // 一块拆成几节时平分它占的份额。
            const heights = ["f", "n1"].map((id) => sizeOf(docked.tree.root, id).height);
            expect(heights[0]).toBeGreaterThan(0);
            expect(heights[0]).toBeCloseTo(heights[1] as number);
        });

        it("放到分节的外缘：归属是区域的当前容器，指定了就是指定的那个", () => {
            const current = okDoc(moveTabToEdge(mixed(), {tab: "view:y", target: edge(mixed(), "s1", "top")}, testPolicy()));
            expect(shape(current)).toBe("V[H[activitybar,V[sidebar,n1,s1,s2],ea,V[auxiliarybar,x]],statusbar]");
            expect(current.panels.n1?.container).toBe("A");
            const named = okDoc(moveTabToEdge(mixed(), {tab: "view:y", target: edge(mixed(), "s1", "top"), container: "B"}, testPolicy()));
            expect(named.panels.n1?.container).toBe("B");
            const opened = okDoc(openPanelAtEdge(mixed(), {id: "v", panel: {role: "tool", tabs: [view("v")], active: "view:v"}, target: edge(mixed(), "s1", "bottom")}, testPolicy()));
            expect(opened.panels.v?.container).toBe("A");
        });

        it("空的区域没有当前容器：不指定归属不放，文档不变；指定了就成为这个区域的分节，切过去、显示出来才看得见", () => {
            const doc = docOf(V([H(["activitybar", "sidebar", "ea", "x"], "body"), "statusbar"], "root"), {
                sidebar: {tabs: [], active: null, hidden: true, entries: [], activeContainer: null},
                x: {tabs: [view("x"), view("y")], active: "view:x"},
            });
            const target: LayoutEdgeTarget = {kind: "split", panel: "sidebar", edge: "bottom"};
            expect(moveTabToEdge(doc, {tab: "view:y", target}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            const placed = okDoc(moveTabToEdge(doc, {tab: "view:y", target, container: "custom:1"}, testPolicy()));
            expect(shape(placed)).toBe("V[H[activitybar,V[sidebar,n1],ea,x],statusbar]");
            expect(placed.panels.n1?.container).toBe("custom:1");
            expect(regionOf(placed, "n1")).toBe("sidebar");
            expect(isPanelShown(placed, "n1")).toBe(false);
            const entered = okDoc(setActiveContainer(okDoc(setContainerEntries(placed, "sidebar", ["custom:1"])), "sidebar", "custom:1"));
            expect(isPanelShown(okDoc(setPanelHidden(entered, "sidebar", false)), "n1")).toBe(true);
        });

        it("位置是原处、指定了另一个容器：只换归属；没指定时什么都不变", () => {
            const doc = mixed();
            const target: LayoutEdgeTarget = {kind: "split", panel: "s2", edge: "top"};
            expect(okDoc(movePanelToEdge(doc, {panel: "s1", target}, testPolicy()))).toBe(doc);
            const moved = okDoc(movePanelToEdge(doc, {panel: "s1", target, container: "B"}, testPolicy()));
            expect(moved.tree).toEqual(doc.tree);
            expect(moved.panels.s1?.container).toBe("B");
        });

        it("分节与锚不收第二个标签：直接插入、放进锚的标签条都拒绝，文档不变", () => {
            const doc = mixed();
            expect(insertTab(doc, {panel: "s1", tab: view("new")})).toMatchObject({ok: false, code: "rejected"});
            expect(insertTab(doc, {panel: "sidebar", tab: view("new")})).toMatchObject({ok: false, code: "rejected"});
            expect(moveTabToStrip(doc, {tab: "view:y", panel: "sidebar", index: 0}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(movePanelToStrip(doc, {panel: "x", target: "sidebar"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
        });

        it("锚的交叉方向外缘不是落点（侧栏、右栏的锚的左右，底部面板的锚的上下）：开新面板、移面板、移标签都拒绝，文档不变；沿区域方向的外缘照常", () => {
            const doc = containers();
            const record = {role: "tool" as const, tabs: [view("v")], active: "view:v"};
            for (const side of ["left", "right"] as const) {
                for (const kind of ["split", "spread"] as const) {
                    const target: LayoutEdgeTarget = {kind, panel: "sidebar", edge: side};
                    expect(openPanelAtEdge(doc, {id: "v", panel: record, target}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
                    expect(movePanelToEdge(doc, {panel: "p1", target}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
                    expect(moveTabToEdge(doc, {tab: "view:s2", target}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
                }
            }
            for (const side of ["top", "bottom"] as const) {
                expect(openPanelAtEdge(doc, {id: "v", panel: record, target: {kind: "split", panel: "panel", edge: side}}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            }
            // 只剩锚的区域也一样：右栏的锚直接在横向的骨架分支里，往它左右放仍然拒绝。
            expect(openPanelAtEdge(doc, {id: "v", panel: {...record, container: "R"}, target: {kind: "split", panel: "auxiliarybar", edge: "left"}}, testPolicy())).toMatchObject({ok: false, code: "rejected"});

            const below = okDoc(openPanelAtEdge(doc, {id: "v", panel: record, target: {kind: "split", panel: "sidebar", edge: "bottom"}}, testPolicy()));
            expect(regionOf(below, "v")).toBe("sidebar");
            expect(shownOf(below, ["s1", "s2", "s3", "v"])).toEqual([true, true, false, true]);
            const beside = okDoc(openPanelAtEdge(doc, {id: "v", panel: record, target: {kind: "split", panel: "panel", edge: "right"}}, testPolicy()));
            expect(regionOf(beside, "v")).toBe("panel");
            expect(beside.panels.v?.container).toBe("P");
        });

        it("区域的锚不移动：移到外缘、并进别的面板都拒绝，区域不会因此隐藏", () => {
            const doc = mixed();
            expect(movePanelToEdge(doc, {panel: "sidebar", target: edge(doc, "x", "bottom")}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(movePanelToEdge(doc, {panel: "sidebar", target: edge(doc, "ea", "right")}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(movePanelToStrip(doc, {panel: "sidebar", target: "x"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(movePanelToStrip(doc, {panel: "sidebar", target: "s1"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            // 不用容器的空具名面板并进别处照旧：没有东西可并，它隐藏。
            const empty: LayoutDoc = {...doc, panels: {...doc.panels, auxiliarybar: {...(doc.panels.auxiliarybar as LayoutDoc["panels"][string]), tabs: [], active: null}}};
            expect(okDoc(movePanelToStrip(empty, {panel: "auxiliarybar", target: "x"}, testPolicy())).panels.auxiliarybar?.hidden).toBe(true);
        });

        it("点名了容器、落点却不在带容器的区域里：拒绝，文档不变；没点名的照旧清掉归属", () => {
            const doc = mixed();
            const toPlain = edge(doc, "x", "bottom");
            expect(movePanelToEdge(doc, {panel: "s1", target: toPlain, container: "A"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(moveTabToEdge(doc, {tab: "view:s1", target: edge(doc, "ea", "right"), container: "A"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(openPanelAtEdge(doc, {id: "v", panel: {role: "tool", tabs: [view("v")], active: "view:v", container: "A"}, target: toPlain}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            // 位置是原处时也一样：x 不在带容器的区域里，换不了归属。
            expect(movePanelToEdge(doc, {panel: "x", target: {kind: "split", panel: "auxiliarybar", edge: "bottom"}, container: "A"}, testPolicy())).toMatchObject({ok: false, code: "rejected"});
            expect(okDoc(movePanelToEdge(doc, {panel: "s1", target: toPlain}, testPolicy())).panels.s1?.container).toBeUndefined();
        });
    });

    describe("搬出区域（输出 40）", () => {
        it("分节浮出来、移到没有容器的区域、移到编辑区旁边：归属清掉", () => {
            const floated = okDoc(floatTab(mixed(), {tab: "view:s1", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy()));
            expect(floated.panels.n1).toEqual({role: "tool", tabs: [view("s1")], active: "view:s1"});
            expect(floated.panels.s1).toBeUndefined();

            const toPlain = okDoc(movePanelToEdge(mixed(), {panel: "s1", target: edge(mixed(), "x", "bottom")}, testPolicy()));
            expect(shape(toPlain)).toBe("V[H[activitybar,V[sidebar,s2],ea,V[auxiliarybar,x,s1]],statusbar]");
            expect(toPlain.panels.s1).toEqual({role: "tool", tabs: [view("s1")], active: "view:s1"});

            const toEditor = okDoc(moveTabToEdge(mixed(), {tab: "view:s1", target: edge(mixed(), "ea", "right")}, testPolicy()));
            expect(regionOf(toEditor, "s1")).toBeNull();
            expect(toEditor.panels.s1?.container).toBeUndefined();
        });
    });

    describe("规范形不碰身份", () => {
        it("同轴嵌套展平、单子分支塌陷之后，分节的归属、所在区域与显隐都不变", () => {
            const doc = docOf(V([H(["activitybar", V([V(["sidebar", "s1", "s2"], "inner")], "outer"), "ea"]), "statusbar"]), {
                sidebar: {tabs: [], active: null, entries: ["A", "B"], activeContainer: "A"},
                s1: {container: "A"},
                s2: {container: "B"},
            });
            const flat: LayoutDoc = {...doc, tree: {...doc.tree, root: normalizeTree(doc.tree.root)}};
            expect(shape(flat)).toBe("V[H[activitybar,V[sidebar,s1,s2],ea],statusbar]");
            for (const id of ["s1", "s2", "sidebar"]) {
                expect(regionOf(flat, id)).toBe(regionOf(doc, id));
                expect(isPanelShown(flat, id)).toBe(isPanelShown(doc, id));
            }
            expect(flat.panels).toEqual(doc.panels);
        });

        it("区域的分节走到只剩锚、那一列塌掉，再有分节进来：入口顺序与当前容器还在锚上，归属跟着分节的记录", () => {
            const one = okDoc(removeTab(mixed(), "view:s2"));
            expect(shape(one)).toBe("V[H[activitybar,V[sidebar,s1],ea,V[auxiliarybar,x]],statusbar]");
            expect(one.panels.s1?.container).toBe("A");
            expect(isPanelShown(one, "s1")).toBe(true);

            const none = okDoc(removeTab(one, "view:s1"));
            expect(shape(none)).toBe("V[H[activitybar,sidebar,ea,V[auxiliarybar,x]],statusbar]");
            // 拖走区域最后一节，区域随之隐藏（ADR 0050 决策 3）；入口顺序与当前容器由宿主归整，库不动。
            expect(none.panels.sidebar).toMatchObject({entries: ["A", "B"], activeContainer: "A", hidden: true});
            expect(sizeOf(none.tree.root, "sidebar").width).toBe(sizeOf(mixed().tree.root, "side").width);

            const again = okDoc(openPanelAtEdge(none, {id: "s9", panel: {role: "tool", tabs: [view("v")], active: "view:v", container: "B"}, target: {kind: "split", panel: "sidebar", edge: "bottom"}}, testPolicy()));
            expect(shape(again)).toBe("V[H[activitybar,V[sidebar,s9],ea,V[auxiliarybar,x]],statusbar]");
            expect(again.panels.s9?.container).toBe("B");
            expect(regionOf(again, "s9")).toBe("sidebar");
            expect(isPanelShown(okDoc(setActiveContainer(okDoc(setPanelHidden(again, "sidebar", false)), "sidebar", "B")), "s9")).toBe(true);
        });

        it("区域拖到零记在锚上：分节走光、再进来，零宽都还在（锚的父分支换了方向也不展开）", () => {
            const zero = okDoc(setPanelCollapsed(mixed(), "sidebar", true));
            const none = okDoc(removeTab(okDoc(removeTab(zero, "view:s2")), "view:s1"));
            expect(none.panels.sidebar?.collapsed).toBe(true);
            const again = okDoc(openPanelAtEdge(none, {id: "s9", panel: {role: "tool", tabs: [view("v")], active: "view:v"}, target: {kind: "split", panel: "sidebar", edge: "bottom"}}, testPolicy()));
            expect(again.panels.sidebar?.collapsed).toBe(true);
        });
    });

    describe("比较（输出 28）", () => {
        it("只差归属、入口顺序或当前容器的两份文档不一样；没写当前容器和 null 一样", () => {
            const doc = containers();
            const withPanel = (id: string, patch: Partial<LayoutDoc["panels"][string]>): LayoutDoc => ({...doc, panels: {...doc.panels, [id]: {...(doc.panels[id] as LayoutDoc["panels"][string]), ...patch}}});
            expect(sameLayoutShape(doc, withPanel("s2", {container: "B"}))).toBe(false);
            expect(sameLayoutShape(doc, withPanel("sidebar", {entries: ["B", "A"]}))).toBe(false);
            expect(sameLayoutShape(doc, withPanel("sidebar", {activeContainer: "B"}))).toBe(false);
            const {activeContainer: _activeContainer, ...unset} = doc.panels.auxiliarybar as LayoutDoc["panels"][string];
            expect(sameLayoutShape(doc, {...doc, panels: {...doc.panels, auxiliarybar: unset}})).toBe(true);
        });
    });

    describe("校验", () => {
        it("带容器的文档通过", () => {
            expect(validateLayoutDoc(containers())).toEqual({ok: true, doc: containers(), repairs: []});
        });

        it("浮动窗不属于容器：带着归属的浮动窗记录拒绝；开浮动窗时不把归属写进去", () => {
            const floated = okDoc(floatTab(containers(), {tab: "view:s3", rect: {x: 10, y: 10, width: 300, height: 200}}, testPolicy()));
            const id = floated.floats[0]?.panel as string;
            expect(validateLayoutDoc(floated)).toMatchObject({ok: true});
            expect(validateLayoutDoc({...floated, panels: {...floated.panels, [id]: {...floated.panels[id], container: "B"}}})).toMatchObject({ok: false, code: "invalid"});

            const opened = okDoc(openFloatPanel(containers(), {id: "f", panel: {role: "tool", tabs: [view("f")], active: "view:f", container: "A"}, rect: {x: 10, y: 10, width: 300, height: 200}}));
            expect(opened.panels.f).toEqual({role: "tool", tabs: [view("f")], active: "view:f"});
            expect(validateLayoutDoc(opened)).toMatchObject({ok: true});
        });

        it.each<[string, string, Record<string, unknown>]>([
            ["编辑组带归属", "ea", {container: "A"}],
            ["归属是空串", "s1", {container: ""}],
            ["归属不是字符串", "s1", {container: 1}],
            ["无名面板带入口顺序", "s1", {entries: []}],
            ["入口顺序不是数组", "sidebar", {entries: "A", activeContainer: null}],
            ["入口顺序里有重复", "sidebar", {entries: ["A", "A"]}],
            ["入口顺序里有空串", "sidebar", {entries: ["A", ""]}],
            ["还有标签的具名面板带入口顺序", "sidebar", {tabs: [view("sidebar")], active: "view:sidebar"}],
            ["无名面板带当前容器", "s1", {activeContainer: null}],
            ["当前容器不在入口顺序里", "sidebar", {entries: ["B"], activeContainer: "A"}],
            ["有当前容器却没有入口顺序", "sidebar", {entries: undefined, activeContainer: "A"}],
        ])("%s：拒绝", (_name, id, patch) => {
            const doc = containers();
            expect(validateLayoutDoc({...doc, panels: {...doc.panels, [id]: {...doc.panels[id], ...patch}}})).toMatchObject({ok: false, code: "invalid"});
        });
    });
});
