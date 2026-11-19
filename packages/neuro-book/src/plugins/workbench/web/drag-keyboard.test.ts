/**
 * 键盘拖动的停靠点（docs/specs/ui/workbench-layout.md 输出 31）：每个落点放回判定能算出它的那个点。
 */

import {describe, expect, it} from "bun:test";

import {layoutSeamsOf} from "@notnotype/nb-workbench-layout";
import type {GridDropPoint} from "@notnotype/nb-layout";
import type {LayoutDropAction, LayoutDropCandidate, LayoutDropPanelGeometry} from "@notnotype/nb-workbench-layout";

import {barStops, pointOfCandidate} from "./drag-keyboard";
import type {StripStops} from "./drag-keyboard";
import type {EntryBand} from "./drag-geometry";
import {defaultLayoutDoc} from "./state/default-tree";
import type {ViewCatalog} from "./views/registry";

const VIEW = (location: "sidebar" | "auxiliarybar" | "panel") => ({title: {"zh-CN": location, "en-US": location}, icon: "i", location, layout: "scroll" as const});
const CATALOG: ViewCatalog = new Map([["files", VIEW("sidebar")], ["terminal", VIEW("panel")]]);
const DOC = defaultLayoutDoc(CATALOG);

/** 编辑组：头在上面 28px 高，正文在下面；侧栏的那一节同样。 */
const G0: LayoutDropPanelGeometry = {id: "g0", frame: {left: 393, top: 4, right: 1035, bottom: 673}, strip: {left: 405, top: 4, right: 1023, bottom: 32}, body: {left: 393, top: 32, right: 1035, bottom: 673}};
const FILES: LayoutDropPanelGeometry = {id: "section:files", frame: {left: 52, top: 4, right: 384, bottom: 874}, strip: {left: 64, top: 4, right: 372, bottom: 32}, body: {left: 52, top: 32, right: 384, bottom: 874}};
/** 收成标题行的一节：正文零高。 */
const FOLDED: LayoutDropPanelGeometry = {id: "section:terminal", strip: {left: 405, top: 680, right: 1023, bottom: 708}, body: {left: 393, top: 708, right: 1035, bottom: 708}};
const PANELS = [FILES, G0, FOLDED];

const NO_STOPS: StripStops = () => [];
const at = (action: LayoutDropAction, stops: StripStops = NO_STOPS): GridDropPoint | null => pointOfCandidate({region: "g0", action} satisfies LayoutDropCandidate, DOC, PANELS, stops);

describe("键盘的停靠点", () => {
    it("中央是正文的中心；四条边各往正文里 2px，落在那条边的中点", () => {
        expect(at({kind: "center", panel: "g0"})).toEqual({x: 714, y: 352.5});
        expect(at({kind: "edge", target: {kind: "split", panel: "g0", edge: "left"}})).toEqual({x: 395, y: 352.5});
        expect(at({kind: "edge", target: {kind: "split", panel: "g0", edge: "right"}})).toEqual({x: 1033, y: 352.5});
        expect(at({kind: "edge", target: {kind: "split", panel: "g0", edge: "top"}})).toEqual({x: 714, y: 34});
        expect(at({kind: "edge", target: {kind: "split", panel: "g0", edge: "bottom"}})).toEqual({x: 714, y: 671});
    });

    it("收成标题行的分节：上边停在标题行中心（正文零高，往里 2px 已经落到下一节）", () => {
        expect(at({kind: "edge", target: {kind: "split", panel: "section:terminal", edge: "top"}})).toEqual({x: 714, y: 694});
    });

    it("标签条：同一个下标有两个位置时取后一个（放下去是普通标签），没有这个下标是 null", () => {
        const stops: StripStops = (panel) => (panel === "g0" ? [{point: {x: 500, y: 18}, index: 1}, {point: {x: 600, y: 18}, index: 1}, {point: {x: 700, y: 18}, index: 2}] : []);
        expect(at({kind: "strip", panel: "g0", index: 1}, stops)).toEqual({x: 600, y: 18});
        expect(at({kind: "strip", panel: "g0", index: 5}, stops)).toBeNull();
    });

    it("两块面板之间的缝：停在缝上、两块之间", () => {
        const seam = layoutSeamsOf(DOC, PANELS).find((item) => item.orientation === "horizontal" && item.at > FILES.body.right && item.at < G0.body.left);
        if (seam === undefined) throw new Error("侧栏与编辑组之间应当有一条缝");
        const point = at({kind: "edge", target: {kind: "between", branch: seam.branch, before: seam.before, after: seam.after}});
        expect(point?.x).toBeGreaterThan(FILES.body.right);
        expect(point?.x).toBeLessThan(G0.body.left);
        expect(point?.y).toBeGreaterThanOrEqual(0);
        expect(point?.y).toBeLessThanOrEqual(878);
    });

    it("算不出的是 null：浮动、不存在的缝、量不到的面板", () => {
        expect(at({kind: "float", rect: {x: 0, y: 0, width: 300, height: 200}})).toBeNull();
        expect(at({kind: "edge", target: {kind: "between", branch: "nope", before: "nope", after: "g0"}})).toBeNull();
        expect(at({kind: "center", panel: "hidden"})).toBeNull();
    });
});

describe("入口条上的停靠点", () => {
    const entries = [{container: "a", start: 8, end: 40}, {container: "b", start: 48, end: 80}];

    it("活动栏竖着：点在入口条竖直的中线上", () => {
        const band: EntryBand = {region: "sidebar", axis: "y", row: {left: 0, top: 0, right: 48, bottom: 878}, groupEnd: 878, merged: null, rect: {left: 0, top: 0, right: 48, bottom: 878}, entries};
        const points = barStops(band, true);
        expect(points.length).toBeGreaterThan(0);
        expect(points.every((point) => point.x === 24)).toBe(true);
    });

    it("右栏、底部面板的入口条横着：点在水平的中线上", () => {
        const band: EntryBand = {region: "panel", axis: "x", row: {left: 389, top: 678, right: 1039, bottom: 710}, groupEnd: 480, merged: null, rect: {left: 389, top: 678, right: 1039, bottom: 710}, entries: entries.map((entry) => ({...entry, start: entry.start + 389, end: entry.end + 389}))};
        const points = barStops(band, false);
        expect(points.length).toBeGreaterThan(0);
        expect(points.every((point) => point.y === 694)).toBe(true);
    });
});
