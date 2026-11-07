import {describe, expect, it} from "bun:test";

import {docOf, H, tab, testPolicy, V, view} from "./layout-doc-fixtures";
import {applyLayoutDrop, enumerateDropCandidates, layoutDropKey, layoutDropOverPanel, layoutDropPanelAt, layoutDropSectors, layoutSeamsOf, previewEdgeDrop, resolveLayoutDrop} from "./layout-drop";
import type {LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSectorId, LayoutDropSource} from "./layout-drop";
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

function drop(doc: LayoutDoc, source: LayoutDropSource, x: number, y: number, overrides: Partial<LayoutDropInput> = {}) {
    return resolveLayoutDrop({doc, source, point: {x, y}, panels: GEOMETRY, policy: testPolicy(), ...overrides});
}

const THREE = () => docOf(H(["a", "b", "ec"], "root"), {a: {tabs: [view("a"), view("x")], active: "view:a"}});
const VIEW: LayoutSource = {kind: "tab", tab: "view:x"};
const EDITOR_TAB: LayoutSource = {kind: "tab", tab: "tab:ec"};
const EDITOR_FROM_ELSEWHERE: LayoutSource = {kind: "tab", tab: "tab:e9"};

describe("缝（输出 25）", () => {
    /** 只分本窗口、缝都接受：和工作台的默认一样，外缘是 `split`，缝才是 `between`。 */
    const seamPolicy = (overrides: Partial<LayoutPolicy> = {}): LayoutPolicy => testPolicy({edgeTarget: (_doc, _tabs, panel, edge) => ({kind: "split", panel, edge}), seamAccepts: () => true, ...overrides});
    const atSeam = (x: number, y: number, overrides: Partial<LayoutPolicy> = {}) => drop(THREE(), VIEW, x, y, {policy: seamPolicy(overrides)});
    const between = {kind: "edge", target: {kind: "between", branch: "root", before: "b", after: "ec"}} as const;

    it("相邻的两块之间是一条缝，跨整个分支", () => {
        expect(layoutSeamsOf(THREE(), GEOMETRY)).toEqual([
            {branch: "root", orientation: "horizontal", before: "a", after: "b", at: 300.5, from: 0, to: 600},
            {branch: "root", orientation: "horizontal", before: "b", after: "ec", at: 600.5, from: 0, to: 600},
        ]);
    });

    it("子节点是分支时矩形是后代的并集：竖缝整高，里面的横缝只有分支那么宽", () => {
        const doc = docOf(H([V(["a", "b"], "column"), "ec"], "root"));
        const panels: ReadonlyArray<LayoutDropPanelGeometry> = [
            {id: "a", strip: null, body: rect(0, 0, 300, 300)},
            {id: "b", strip: null, body: rect(0, 301, 300, 600)},
            {id: "ec", strip: null, body: rect(301, 0, 900, 600)},
        ];
        expect(layoutSeamsOf(doc, panels)).toEqual([
            {branch: "column", orientation: "vertical", before: "a", after: "b", at: 300.5, from: 0, to: 300},
            {branch: "root", orientation: "horizontal", before: "column", after: "ec", at: 300.5, from: 0, to: 600},
        ]);
    });

    it("没有几何的叶（隐藏、拖到零）不算：看得见的两块之间才有缝", () => {
        const panels = GEOMETRY.filter((geometry) => geometry.id !== "b");
        expect(layoutSeamsOf(THREE(), panels).map(({before, after}) => [before, after])).toEqual([["a", "ec"]]);
    });

    it("收成标题行的面板按标签条算，头里还有别的东西时用 `frame`", () => {
        const doc = docOf(V(["a", "b"], "root"));
        const collapsed: LayoutDropPanelGeometry = {id: "a", strip: rect(0, 0, 300, 32), body: rect(0, 32, 300, 32)};
        const hinted: LayoutDropPanelGeometry = {id: "b", frame: rect(0, 33, 300, 600), strip: rect(0, 60, 300, 90), body: rect(0, 90, 300, 600)};
        expect(layoutSeamsOf(doc, [collapsed, hinted])[0]?.at).toBe(32.5);
    });

    it("缝先于外缘和标签条；带子外面才按面板判", () => {
        expect(atSeam(600.5, 300)).toEqual(between);
        expect(atSeam(595, 300)).toEqual(between);
        expect(atSeam(606, 300)).toEqual(between);
        expect(atSeam(600.5, 10)).toEqual(between);
        expect(atSeam(590, 300)).toEqual({kind: "edge", target: {kind: "split", panel: "b", edge: "right"}});
        expect(atSeam(590, 10)).toEqual({kind: "strip", panel: "b", index: 0});
    });

    it("最近的缝胜出", () => {
        const doc = docOf(H([V(["a", "b"], "column"), "ec"], "root"), {a: {tabs: [view("a"), view("x")], active: "view:a"}});
        const panels: ReadonlyArray<LayoutDropPanelGeometry> = [
            {id: "a", strip: null, body: rect(0, 0, 300, 300)},
            {id: "b", strip: null, body: rect(0, 301, 300, 600)},
            {id: "ec", strip: null, body: rect(301, 0, 900, 600)},
        ];
        const at = (x: number, y: number) => resolveLayoutDrop({doc, source: VIEW, point: {x, y}, panels, policy: seamPolicy()});
        expect(at(296, 299)).toEqual({kind: "edge", target: {kind: "between", branch: "column", before: "a", after: "b"}});
        expect(at(299, 296)).toEqual({kind: "edge", target: {kind: "between", branch: "root", before: "column", after: "ec"}});
    });

    it("不接受的缝不是落点，按面板继续判；不给 `seamAccepts` 就没有缝落点", () => {
        expect(atSeam(590, 300, {seamAccepts: () => false})).toEqual({kind: "edge", target: {kind: "split", panel: "b", edge: "right"}});
        expect(drop(THREE(), VIEW, 600.5, 300, {policy: testPolicy({edgeTarget: (_doc, _tabs, panel, edge) => ({kind: "split", panel, edge})})})).toEqual({kind: "edge", target: {kind: "split", panel: "b", edge: "right"}});
    });

    it("接受矩阵拒绝的来源也进不了缝", () => {
        const refuses = seamPolicy({accepts: () => false});
        expect(drop(THREE(), VIEW, 600.5, 300, {policy: refuses})).toBeNull();
    });

    it("键盘的候选里有缝，归树序靠前的那块；放回原处的不列", () => {
        const doc = docOf(H(["a", "src", "b"], "root"));
        const panels: ReadonlyArray<LayoutDropPanelGeometry> = [
            {id: "a", strip: null, body: rect(0, 0, 300, 600)},
            {id: "src", strip: null, body: rect(301, 0, 600, 600)},
            {id: "b", strip: null, body: rect(601, 0, 900, 600)},
        ];
        const candidates = enumerateDropCandidates({doc, source: {kind: "tab", tab: "view:src"}, policy: seamPolicy(), stripIndexes: () => [], seams: layoutSeamsOf(doc, panels)});
        expect(candidates.filter((candidate) => candidate.action.kind === "edge" && candidate.action.target.kind === "between")).toEqual([]);

        const other = docOf(H(["a", "b", "c"], "root"), {a: {tabs: [view("a"), view("x")], active: "view:a"}});
        const listed = enumerateDropCandidates({doc: other, source: VIEW, policy: seamPolicy(), stripIndexes: () => [], seams: layoutSeamsOf(other, [
            {id: "a", strip: null, body: rect(0, 0, 300, 600)},
            {id: "b", strip: null, body: rect(301, 0, 600, 600)},
            {id: "c", strip: null, body: rect(601, 0, 900, 600)},
        ])});
        expect(listed.filter((candidate) => candidate.action.kind === "edge" && candidate.action.target.kind === "between").map((candidate) => candidate.region)).toEqual(["a", "b"]);
    });
});

describe("被拒绝（输出 39）", () => {
    const over = (x: number, y: number, overrides: Partial<LayoutDropInput> = {}) => layoutDropOverPanel({doc: THREE(), source: EDITOR_TAB, point: {x, y}, panels: GEOMETRY, policy: testPolicy(), ...overrides});

    it("面板上、两块都不接收的缝里都算在面板上，不管接不接收", () => {
        expect(over(150, 300)).toBe(true);
        expect(over(150, 10)).toBe(true);
        const refuses = testPolicy({accepts: () => false});
        expect(drop(THREE(), EDITOR_TAB, 300.5, 300, {policy: refuses})).toBeNull();
        expect(over(300.5, 300, {policy: refuses})).toBe(true);
    });

    it("头里的提示条也算在面板上：它不在正文、标签条里", () => {
        const panels: ReadonlyArray<LayoutDropPanelGeometry> = [{id: "ec", frame: rect(0, 0, 300, 600), strip: rect(0, 60, 300, 90), body: rect(0, 90, 300, 600)}];
        expect(over(150, 30, {panels})).toBe(true);
    });

    it("工作台外、挡住的区域不算", () => {
        expect(over(2000, 300)).toBe(false);
        expect(over(899, 300, {excluded: [rect(899, 0, 950, 600)]})).toBe(false);
    });

    it("浮动窗上算，挡住的区域也挡不住它", () => {
        const float: LayoutDropPanelGeometry = {id: "w", strip: null, body: rect(1000, 0, 1200, 200)};
        expect(over(1100, 100, {floats: [float]})).toBe(true);
    });
});

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

describe("浮动窗的落点", () => {
    const POINT_IN_FLOAT = {x: 500, y: 300};
    const FLOAT_GEOMETRY: LayoutDropPanelGeometry = {id: "f", strip: rect(400, 200, 700, 230), body: rect(400, 230, 700, 500), insertionAt: () => 1};
    const withFloat = () => {
        const doc = THREE();
        return {...doc, panels: {...doc.panels, f: {role: "tool" as const, tabs: [view("w")], active: "view:w"}}, floats: [{panel: "f", rect: {x: 400, y: 200, width: 300, height: 300}}]};
    };
    const floatInput = {floats: [FLOAT_GEOMETRY]};

    it("比面板、条都先判：标签条插入，正文添加为标签", () => {
        expect(drop(withFloat(), VIEW, 500, 210, floatInput)).toEqual({kind: "strip", panel: "f", index: 1});
        expect(drop(withFloat(), VIEW, POINT_IN_FLOAT.x, POINT_IN_FLOAT.y, floatInput)).toEqual({kind: "center", panel: "f"});
        expect(drop(withFloat(), VIEW, POINT_IN_FLOAT.x, POINT_IN_FLOAT.y, {...floatInput, excluded: [rect(0, 0, 900, 600)]})).toEqual({kind: "center", panel: "f"});
    });

    it("不接收时没有落点，不穿透到底下的面板", () => {
        const source = EDITOR_TAB;
        // 底下是 b 的外缘窄带：没有浮动窗时是落点。
        expect(drop(withFloat(), source, 590, 300)).not.toBeNull();
        expect(drop(withFloat(), source, 590, 300, floatInput)).toBeNull();
    });

    it("浮动窗没有外缘，外沿也不是缝：差 1px 就算底下的面板", () => {
        expect(drop(withFloat(), VIEW, 401, 490, floatInput)).toEqual({kind: "center", panel: "f"});
        expect(layoutDropPanelAt({doc: withFloat(), source: VIEW, point: {x: 399, y: 300}, panels: GEOMETRY, policy: testPolicy(), ...floatInput})?.id).toBe("b");
    });

    it("上面的窗先判", () => {
        const over: LayoutDropPanelGeometry = {id: "a", strip: null, body: rect(450, 250, 600, 400)};
        expect(drop(withFloat(), VIEW, 500, 300, {floats: [over, FLOAT_GEOMETRY]})).toEqual({kind: "center", panel: "a"});
    });

    it("整窗拖动：经过中央没有落点，标签条与窄带才停靠；空面板也不算整块中央", () => {
        const whole: LayoutSource = {kind: "panel", panel: "f"};
        const options = {noCenter: true, edgeRatio: 0.14};
        expect(drop(withFloat(), whole, 450, 300, options)).toBeNull();
        expect(drop(withFloat(), whole, 400, 10, options)).toEqual({kind: "strip", panel: "b", index: 0});
        expect(drop(withFloat(), whole, 590, 300, options)).toEqual({kind: "edge", target: {kind: "between", branch: "root", before: "b", after: "ec"}});
        expect(drop(withFloat(), whole, 520, 300, options)).toBeNull();
        const empty = docOf(H(["a", "b"], "root"), {a: {tabs: [view("a")], active: "view:a"}, b: {tabs: [], active: null}});
        expect(drop({...empty, panels: {...empty.panels, f: {role: "tool", tabs: [view("w")], active: "view:w"}}, floats: [{panel: "f", rect: {x: 0, y: 0, width: 10, height: 10}}]}, whole, 450, 300, options)).toBeNull();
    });

    it("分区：整窗拖动不画中央", () => {
        const input: LayoutDropInput = {doc: withFloat(), source: {kind: "panel", panel: "f"}, point: {x: 590, y: 300}, panels: GEOMETRY, policy: testPolicy(), noCenter: true, edgeRatio: 0.14};
        const sectors = layoutDropSectors(input, GEOMETRY[1] as LayoutDropPanelGeometry);
        expect(sectors?.some((sector) => sector.id === "center")).toBe(false);
        expect(sectors?.length).toBeGreaterThan(0);
    });

    it("提交：标签浮出来，整窗是移动；比较键只看种类", () => {
        const rectA = {x: 1, y: 2, width: 300, height: 200};
        const tear = applyLayoutDrop(THREE(), VIEW, {kind: "float", rect: rectA}, testPolicy());
        expect(tear.ok && tear.doc.floats.at(0)?.rect).toEqual(rectA);
        const moved = applyLayoutDrop(withFloat(), {kind: "panel", panel: "f"}, {kind: "float", rect: rectA}, testPolicy());
        expect(moved.ok && moved.doc.floats).toEqual([{panel: "f", rect: rectA}]);
        expect(layoutDropKey({kind: "float", rect: rectA})).toBe(layoutDropKey({kind: "float", rect: {...rectA, x: 9}}));
        expect(layoutDropKey({kind: "center", panel: "a"})).not.toBe(layoutDropKey({kind: "center", panel: "b"}));
    });

    it("键盘的落点：浮动窗排在树后面，只有标签条和中央", () => {
        const candidates = enumerateDropCandidates({doc: withFloat(), source: VIEW, policy: testPolicy(), stripIndexes: () => [0]});
        const onFloat = candidates.filter((candidate) => candidate.region === "f");
        expect(onFloat.map((candidate) => candidate.action.kind)).toEqual(["strip", "center"]);
        expect(candidates.at(-1)?.region).toBe("f");
    });
});

describe("文档里还没有的标签（资源树拖来的文件）", () => {
    const FILE: LayoutDropSource = {kind: "new", tab: tab("file")};
    const PROJECTION_FOR_FILE: LayoutProjectionOptions = {
        constraints: () => ({minimumSize: {width: 10, height: 10}, maximumSize: {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY}}),
        barThickness: () => 0,
        headHeight: 32,
        collapseThreshold: 24,
        sashSize: 1,
    };

    it("接受矩阵照问：编辑组接收，工具面板不接收；空来源的提前返回不拦它", () => {
        expect(drop(THREE(), FILE, 750, 300)).toEqual({kind: "center", panel: "ec"});
        expect(drop(THREE(), FILE, 450, 300)).toBeNull();
    });

    it("预览：放回原处恒为假，外缘的矩形是真实结果，提交不走这里", () => {
        const doc = THREE();
        const center = applyLayoutDrop(doc, FILE, {kind: "center", panel: "ec"}, testPolicy());
        expect(center.ok && center.doc !== doc).toBe(true);
        const strip = applyLayoutDrop(doc, FILE, {kind: "strip", panel: "ec", index: 0}, testPolicy());
        expect(strip.ok && strip.doc.panels.ec?.tabs[0]).toEqual(tab("file"));
        const action = {kind: "edge", target: {kind: "split", panel: "ec", edge: "right"}} as const;
        const edge = applyLayoutDrop(doc, FILE, action, testPolicy());
        expect(edge.ok && Object.keys(edge.doc.panels).length).toBe(Object.keys(doc.panels).length + 1);
        expect(previewEdgeDrop(doc, FILE, action, testPolicy(), PROJECTION_FOR_FILE, {width: 900, height: 600}, 1)).not.toBeNull();
        const floated = applyLayoutDrop(doc, FILE, {kind: "float", rect: {x: 0, y: 0, width: 300, height: 200}}, testPolicy());
        expect(floated.ok && floated.doc.floats).toHaveLength(1);
        expect(applyLayoutDrop(doc, FILE, {kind: "reveal", panel: "a"}, testPolicy()).ok).toBe(false);
    });
});
