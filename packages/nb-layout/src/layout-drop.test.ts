import {describe, expect, it} from "bun:test";

import {docOf, H, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {applyLayoutDrop, enumerateDropCandidates, layoutDropPanelAt, layoutDropSectors, previewEdgeDrop, previewRevealRects, resolveLayoutDrop} from "./layout-drop";
import type {LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSectorId} from "./layout-drop";
import {edgeTargetOf} from "./layout-doc";
import type {LayoutDoc, LayoutPolicy, LayoutSource} from "./layout-doc";
import type {LayoutProjectionOptions} from "./layout-project";
import type {GridDropRect} from "./grid-drop";

/** 落点规则（docs/specs/ui/workbench-layout.md 输出 25 到 29）。 */

const rect = (left: number, top: number, right: number, bottom: number): GridDropRect => ({left, top, right, bottom});

/** 三块并排，每块上面 30px 是标签条。 */
const GEOMETRY: ReadonlyArray<LayoutDropPanelGeometry> = [
    {id: "a", strip: rect(0, 0, 300, 30), body: rect(0, 30, 300, 600), insertionAt: () => 1},
    {id: "b", strip: rect(301, 0, 600, 30), body: rect(301, 30, 600, 600), insertionAt: () => 0},
    {id: "ec", strip: rect(601, 0, 900, 30), body: rect(601, 30, 900, 600), insertionAt: () => 0},
];

function drop(doc: LayoutDoc, source: LayoutSource, x: number, y: number, overrides: Partial<LayoutDropInput> = {}) {
    return resolveLayoutDrop({doc, source, point: {x, y}, panels: GEOMETRY, policy: testPolicy(), ...overrides});
}

const THREE = () => docOf(H(["a", "b", "ec"], "root"), {a: {tabs: [view("a"), view("x")], active: "view:a"}});
const VIEW: LayoutSource = {kind: "tab", tab: "view:x"};
const EDITOR_TAB: LayoutSource = {kind: "tab", tab: "tab:ec"};
const EDITOR_FROM_ELSEWHERE: LayoutSource = {kind: "tab", tab: "tab:e9"};

describe("有序规则", () => {
    it("标签条是插入位，由标签条自己量", () => {
        expect(drop(THREE(), VIEW, 400, 10)).toEqual({kind: "strip", panel: "b", index: 0});
    });

    it("正文中央添加为标签", () => {
        expect(drop(THREE(), VIEW, 450, 300)).toEqual({kind: "center", panel: "b"});
    });

    it("外缘窄带：对面有兄弟时是放到两块之间，这条边、缝、对面那块的边是同一个落点", () => {
        const fromLeftPanel = drop(THREE(), VIEW, 590, 300);
        expect(fromLeftPanel).toEqual({kind: "edge", target: {kind: "between", branch: "root", before: "b", after: "ec"}});
        expect(drop(THREE(), VIEW, 600.5, 300)).toEqual(fromLeftPanel);
        expect(drop(THREE(), VIEW, 610, 300)).toEqual(fromLeftPanel);
    });

    it("外缘窄带：对面没有兄弟时拆这一块", () => {
        expect(drop(THREE(), VIEW, 450, 40)).toEqual({kind: "edge", target: {kind: "split", panel: "b", edge: "top"}});
    });

    it("工作台外、离得远：没有落点", () => {
        expect(drop(THREE(), VIEW, 2000, 300)).toBeNull();
    });

    it("条与标题栏不是落点，紧贴面板也不算", () => {
        expect(drop(THREE(), VIEW, 899, 300, {excluded: [rect(899, 0, 950, 600)]})).toBeNull();
        expect(drop(THREE(), VIEW, 903, 300)).toMatchObject({kind: "edge"});
        expect(drop(THREE(), VIEW, 906, 300)).toBeNull();
    });

    it("标签条与正文交界那一行算正文；指针在缝上离标签条更近才算标签条", () => {
        expect(drop(THREE(), VIEW, 450, 30)).toMatchObject({kind: "edge"});
        expect(drop(THREE(), VIEW, 600.5, 10)).toEqual({kind: "strip", panel: "b", index: 0});
    });

    it("空面板整块都是中央", () => {
        const doc = docOf(H(["a", "b", "ec"]), {b: {tabs: [], active: null}, a: {tabs: [view("a"), view("x")], active: "view:a"}});
        expect(drop(doc, VIEW, 305, 40)).toEqual({kind: "center", panel: "b"});
    });

    it("进不了空面板的：中央没有落点，外缘照常（工具视图拖到空编辑组）", () => {
        const doc = docOf(H(["a", "b", "ec"]), {a: {tabs: [view("a"), view("x")], active: "view:a"}, ec: {tabs: [], active: null}});
        const body = GEOMETRY.find((geometry) => geometry.id === "ec")?.body;
        if (body === undefined) throw new Error("夹具没有编辑组");
        expect(drop(doc, VIEW, (body.left + body.right) / 2, (body.top + body.bottom) / 2)).toBeNull();
        expect(drop(doc, VIEW, body.right - 5, (body.top + body.bottom) / 2)).toMatchObject({kind: "edge"});
    });

    it("来源标签已经不在了：没有落点", () => {
        expect(drop(THREE(), {kind: "tab", tab: "view:gone"}, 450, 300)).toBeNull();
    });
});

describe("接受矩阵（输出 26）", () => {
    it("工具视图进不了编辑组的标签条与中央，能拆到外缘", () => {
        expect(drop(THREE(), VIEW, 700, 10)).toBeNull();
        expect(drop(THREE(), VIEW, 750, 300)).toBeNull();
        expect(drop(THREE(), VIEW, 890, 300)).toMatchObject({kind: "edge"});
    });

    it("编辑器标签进不了工具面板的标签条与中央，能拆到外缘", () => {
        expect(drop(THREE(), EDITOR_TAB, 400, 10)).toBeNull();
        expect(drop(THREE(), EDITOR_TAB, 450, 300)).toBeNull();
        expect(drop(THREE(), EDITOR_TAB, 310, 300)).toMatchObject({kind: "edge"});
    });

    it("整个面板同它的标签", () => {
        expect(drop(THREE(), {kind: "panel", panel: "a"}, 750, 300)).toBeNull();
        expect(drop(THREE(), {kind: "panel", panel: "a"}, 450, 300)).toEqual({kind: "center", panel: "b"});
    });
});

describe("预备区（输出 29）", () => {
    const doc = () => docOf(H(["a", "b", "ec", "auxiliarybar"]), {a: {tabs: [view("a"), view("x")], active: "view:a"}, auxiliarybar: {tabs: [], active: null, hidden: true}});
    const zones = [{panel: "auxiliarybar", rect: rect(800, 0, 1200, 600)}];

    it("真实落点优先；只在预备区上时算预备区；放下一次写入显示并接收", () => {
        expect(drop(doc(), EDITOR_TAB, 850, 300, {zones})).toMatchObject({kind: "edge"});
        const action = drop(doc(), VIEW, 1000, 300, {zones});
        expect(action).toEqual({kind: "reveal", panel: "auxiliarybar"});
        if (action === null) throw new Error("没有落点");
        const result = applyLayoutDrop(doc(), VIEW, action, testPolicy());
        if (!result.ok) throw new Error(result.detail);
        expect(result.doc.panels.auxiliarybar?.hidden).toBeUndefined();
        expect(result.doc.panels.auxiliarybar?.tabs).toEqual([view("x")]);
    });

    it("接受矩阵拒绝时不算", () => {
        expect(drop(doc(), EDITOR_TAB, 1000, 300, {zones})).toBeNull();
    });

    it("有真实落点就是它，预备区盖着也一样；这块接收不了时才算预备区", () => {
        const wide = [{panel: "auxiliarybar", rect: rect(0, 0, 1200, 600)}];
        const strict = testPolicy({accepts: (tabs, target) => tabs.every((candidate) => (candidate.kind === "view" ? target.role === "tool" : target.role === "editor"))});
        expect(drop(doc(), VIEW, 450, 300, {zones: wide, policy: strict})).toEqual({kind: "center", panel: "b"});
        expect(drop(doc(), VIEW, 750, 300, {zones: wide, policy: strict})).toEqual({kind: "reveal", panel: "auxiliarybar"});
    });

    it("几块一起显示后算矩形：彼此不重叠，面板只占中间（三块都隐藏时）", () => {
        const hidden = {tabs: [], active: null, hidden: true};
        const all = docOf(H(["sidebar", V(["ea", "panel"]), "auxiliarybar"]), {sidebar: hidden, panel: hidden, auxiliarybar: hidden});
        const projection: LayoutProjectionOptions = {
            constraints: () => ({minimumSize: {width: 10, height: 10}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
            barThickness: () => 0,
            headHeight: 32,
            collapseThreshold: 24,
            sashSize: 1,
        };
        const rects = previewRevealRects(all, ["sidebar", "panel", "auxiliarybar"], projection, {width: 1000, height: 600}, 1);
        const {sidebar, panel, auxiliarybar} = rects;
        if (sidebar === undefined || panel === undefined || auxiliarybar === undefined) throw new Error("少了预备区");
        expect(sidebar.right).toBeLessThanOrEqual(panel.left);
        expect(panel.right).toBeLessThanOrEqual(auxiliarybar.left);
        expect(panel.top).toBeGreaterThan(0);
    });
});

describe("策略按边回答（edgeTarget）", () => {
    /** 工具面板只能上下拆。 */
    const vertical: Pick<LayoutPolicy, "edgeTarget"> = {edgeTarget: (doc, _tabs, panel, edge) => (edge === "left" || edge === "right" ? null : edgeTargetOf(doc, panel, edge))};

    it("策略不给的边没有窄带，指针在那里算中央；给的边照常是外缘", () => {
        const policy = testPolicy(vertical);
        expect(drop(THREE(), VIEW, 310, 300, {policy})).toEqual({kind: "center", panel: "b"});
        expect(drop(THREE(), VIEW, 450, 40, {policy})).toMatchObject({kind: "edge", target: {kind: "split", panel: "b", edge: "top"}});
    });

    it("四角归最近的边；最近的边不给时看另一条", () => {
        // b 的正文 (301,30)-(600,600)，左上角附近：离上边比离左边近。
        expect(drop(THREE(), VIEW, 340, 35)).toMatchObject({kind: "edge", target: {kind: "split", panel: "b", edge: "top"}});
        expect(drop(THREE(), VIEW, 305, 100)).toMatchObject({kind: "edge", target: {kind: "between", after: "b"}});
        expect(drop(THREE(), VIEW, 305, 40, {policy: testPolicy(vertical)})).toMatchObject({kind: "edge", target: {kind: "split", panel: "b", edge: "top"}});
    });

    it("键盘的落点同样只列策略给的边", () => {
        const doc = THREE();
        const candidates = enumerateDropCandidates({doc, source: VIEW, policy: testPolicy(vertical), stripIndexes: () => [0]});
        const edges = candidates.flatMap((candidate) => (candidate.action.kind === "edge" && candidate.action.target.kind === "split" ? [candidate.action.target.edge] : []));
        expect(edges.length).toBeGreaterThan(0);
        expect(edges.every((edge) => edge === "top" || edge === "bottom")).toBe(true);
        expect(candidates.some((candidate) => candidate.action.kind === "edge" && candidate.action.target.kind === "between")).toBe(false);
    });

    it("缝归最近的能接收的那块：接收不了的那块不抢", () => {
        const strict = testPolicy({accepts: (tabs, target) => tabs.every((candidate) => (candidate.kind === "view" ? target.role === "tool" : target.role === "editor"))});
        // 缝在 600 到 601 之间，离 ec 更近的点上，工具视图归 b。
        expect(drop(THREE(), VIEW, 600.9, 300, {policy: strict})).toMatchObject({kind: "edge"});
        expect(drop(THREE(), EDITOR_TAB, 600.1, 300, {policy: strict})).toMatchObject({kind: "edge"});
    });
});

describe("提交", () => {
    it("放回原处返回原文档：中央落在自己所在的面板、整块面板落在自己的外缘", () => {
        const doc = THREE();
        const center = applyLayoutDrop(doc, VIEW, {kind: "center", panel: "a"}, testPolicy());
        expect(center.ok && center.doc).toBe(doc);
        const own = applyLayoutDrop(doc, {kind: "panel", panel: "b"}, {kind: "edge", target: {kind: "split", panel: "b", edge: "top"}}, testPolicy());
        expect(own.ok && own.doc).toBe(doc);
    });
});

describe("预览画真实结果", () => {
    const PROJECTION: LayoutProjectionOptions = {
        constraints: () => ({minimumSize: {width: 10, height: 10}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
        barThickness: () => 0,
        headHeight: 32,
        collapseThreshold: 24,
        sashSize: 1,
    };

    it("拆一块：新块取一半，矩形和提交后一样", () => {
        const doc = docOf(H(["a", "ec"]));
        const preview = previewEdgeDrop(doc, {kind: "panel", panel: "a"}, {kind: "edge", target: {kind: "split", panel: "ec", edge: "bottom"}}, testPolicy(), PROJECTION, {width: 1000, height: 600}, 1);
        // 被拖的工具面板保留 300 的像素，编辑组吸收余量和缝。
        expect(preview).toEqual(rect(0, 300, 1000, 600));
    });

    it("放回原处没有预览", () => {
        const doc = docOf(H(["a", "ec"]));
        expect(previewEdgeDrop(doc, {kind: "panel", panel: "a"}, {kind: "edge", target: {kind: "split", panel: "a", edge: "top"}}, testPolicy(), PROJECTION, {width: 1000, height: 600}, 1)).toBeNull();
    });
});

describe("键盘的落点（输出 31）", () => {
    it("和指针同一套规则：拒绝的、放回原处的不列；按树序", () => {
        const doc = docOf(H(["a", V(["b", "ec"])]));
        const candidates = enumerateDropCandidates({doc, source: {kind: "panel", panel: "a"}, policy: testPolicy(), stripIndexes: (panel) => (doc.panels[panel]?.tabs ?? []).map((_tab, index) => index).concat(doc.panels[panel]?.tabs.length ?? 0)});
        expect(candidates.every((candidate) => candidate.region === "b" || candidate.region === "ec")).toBe(true);
        expect(candidates.some((candidate) => candidate.action.kind === "strip" && candidate.action.panel === "ec")).toBe(false);
        expect(candidates.some((candidate) => candidate.action.kind === "edge" && candidate.region === "ec")).toBe(true);
        const keys = candidates.map((candidate) => JSON.stringify(candidate.action));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("预备区排在可见落点之后", () => {
        const doc = docOf(H(["a", "ec", "auxiliarybar"]), {a: {tabs: [view("a"), view("x")], active: "view:a"}, auxiliarybar: {tabs: [], active: null, hidden: true}});
        const candidates = enumerateDropCandidates({doc, source: VIEW, policy: testPolicy(), stripIndexes: () => [0], reveal: ["auxiliarybar"]});
        expect(candidates.at(-1)).toEqual({region: "reveal:auxiliarybar", action: {kind: "reveal", panel: "auxiliarybar"}});
    });

    it("编辑器标签没有工具面板的插入位", () => {
        const doc = docOf(H(["a", "ec"]), {ec: {tabs: [tab("p"), tab("q")], active: "tab:p"}});
        const candidates = enumerateDropCandidates({doc, source: {kind: "tab", tab: "tab:q"}, policy: testPolicy(), stripIndexes: () => [0, 1]});
        expect(candidates.some((candidate) => candidate.action.kind === "strip" && candidate.action.panel === "a")).toBe(false);
        expect(candidates.some((candidate) => candidate.action.kind === "edge")).toBe(true);
    });
});

describe("落点分区：形状与判定一致（输出“落点分区”）", () => {
    const inPolygon = (points: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean => {
        let inside = false;
        for (let at = 0, previous = points.length - 1; at < points.length; previous = at, at += 1) {
            const [xi, yi] = points[at] as readonly [number, number];
            const [xj, yj] = points[previous] as readonly [number, number];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    };
    /** 固定种子的随机数：失败时能重现。 */
    const seeded = (seed: number): (() => number) => {
        let state = seed;
        return () => {
            state = (state * 1664525 + 1013904223) % 4294967296;
            return state / 4294967296;
        };
    };
    const onlyEdges = (allowed: ReadonlyArray<string>): Pick<LayoutPolicy, "edgeTarget"> => ({edgeTarget: (doc, _tabs, panel, edge) => (allowed.includes(edge) ? edgeTargetOf(doc, panel, edge) : null)});
    const noCenter: Pick<LayoutPolicy, "accepts"> = {accepts: (_tabs, _target, region) => region === "edge"};

    const CASES: ReadonlyArray<{readonly name: string; readonly policy: LayoutPolicy; readonly ids: ReadonlyArray<LayoutDropSectorId>}> = [
        {name: "五块", policy: testPolicy(), ids: ["left", "right", "top", "bottom", "center"]},
        {name: "只有上下", policy: testPolicy(onlyEdges(["top", "bottom"])), ids: ["top", "bottom", "center"]},
        {name: "只有左右", policy: testPolicy(onlyEdges(["left", "right"])), ids: ["left", "right", "center"]},
        {name: "相邻两条边", policy: testPolicy(onlyEdges(["left", "top"])), ids: ["left", "top", "center"]},
        {name: "不接受中央", policy: testPolicy(noCenter), ids: ["left", "right", "top", "bottom"]},
    ];

    for (const {name, policy, ids} of CASES) {
        it(`${name}：随机点上，判定给的动作就是点所在那一块的动作`, () => {
            const doc = THREE();
            const panel = GEOMETRY[1] as LayoutDropPanelGeometry;
            const input = {doc, source: VIEW, point: {x: 0, y: 0}, panels: GEOMETRY, policy};
            const sectors = layoutDropSectors(input, panel);
            expect(sectors?.map((sector) => sector.id).sort()).toEqual([...ids].sort());
            const random = seeded(17);
            const {left, top, right, bottom} = panel.body;
            for (let round = 0; round < 2000; round += 1) {
                const [rx, ry] = [random(), random()];
                // 对角线上两块都对，算哪块由排序定：避开。
                if (Math.abs(rx - ry) < 1e-3 || Math.abs(rx + ry - 1) < 1e-3) continue;
                const point = {x: left + rx * (right - left), y: top + ry * (bottom - top)};
                const owners = (sectors ?? []).filter((sector) => inPolygon(sector.points, rx, ry));
                expect(owners.length).toBeLessThanOrEqual(1);
                expect(resolveLayoutDrop({...input, point})).toEqual(owners[0]?.action ?? null);
            }
        });
    }

    it("空面板整块是中央；进不了中央的按外缘", () => {
        const doc = docOf(H(["a", "e1"], "root"), {e1: {tabs: []}});
        const empty: LayoutDropPanelGeometry = {id: "e1", strip: null, body: rect(0, 0, 100, 100)};
        const base = {doc, point: {x: 0, y: 0}, panels: [empty], policy: testPolicy()};
        expect(layoutDropSectors({...base, source: EDITOR_FROM_ELSEWHERE}, empty)?.map((sector) => sector.id)).toEqual(["center"]);
        expect(layoutDropSectors({...base, source: {kind: "tab", tab: "view:a"}}, empty)?.map((sector) => sector.id).sort()).toEqual(["bottom", "left", "right", "top"]);
    });

    it("正文零面积（收成标题行）：没有分区，指针也不算到外缘", () => {
        const collapsed: LayoutDropPanelGeometry = {id: "b", strip: rect(301, 0, 600, 30), body: rect(301, 30, 600, 30)};
        const input = {doc: THREE(), source: VIEW, point: {x: 450, y: 31}, panels: [collapsed], policy: testPolicy()};
        expect(layoutDropSectors(input, collapsed)).toBeNull();
        expect(resolveLayoutDrop(input)).toEqual({kind: "center", panel: "b"});
    });

    it("什么都放不进去：没有分区", () => {
        const none = testPolicy({accepts: () => false});
        const input = {doc: THREE(), source: VIEW, point: {x: 0, y: 0}, panels: GEOMETRY, policy: none};
        expect(layoutDropSectors(input, GEOMETRY[1] as LayoutDropPanelGeometry)).toBeNull();
    });

    it("指针算哪块面板：缝归最近能接收的，标题栏与面板外没有", () => {
        const input = {doc: THREE(), source: VIEW, panels: GEOMETRY, policy: testPolicy()};
        expect(layoutDropPanelAt({...input, point: {x: 450, y: 300}})?.id).toBe("b");
        expect(layoutDropPanelAt({...input, point: {x: 450, y: 10}})?.id).toBe("b");
        expect(layoutDropPanelAt({...input, point: {x: 2000, y: 300}})).toBeNull();
        expect(layoutDropPanelAt({...input, point: {x: 450, y: 300}, excluded: [rect(400, 200, 500, 400)]})).toBeNull();
    });

    it("键盘：接受中央的空面板只有中央一个停靠点", () => {
        const doc = docOf(H(["a", "e1", "e2"], "root"), {e1: {tabs: []}});
        const candidates = enumerateDropCandidates({doc, source: {kind: "tab", tab: "tab:e2"}, policy: testPolicy(), stripIndexes: () => []});
        expect(candidates.filter((candidate) => candidate.region === "e1").map((candidate) => candidate.action.kind)).toEqual(["center"]);
    });
});
