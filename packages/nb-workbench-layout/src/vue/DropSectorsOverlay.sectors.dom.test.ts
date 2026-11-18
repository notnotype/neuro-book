import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {DropSectorsOverlay} from "@notnotype/nb-layout/vue";
import {docOf, H, testPolicy, V} from "../layout-doc-fixtures";
import {layoutDropSectors} from "../layout-drop";
import type {LayoutDoc} from "../layout-doc";
import type {LayoutDropInput, LayoutDropPanelGeometry, LayoutDropSector} from "../layout-drop";

/** 工作台的落点判定算出来的分区，落点分区组件照样画得出来：组件的形状契约（id 加多边形）和判定的输出对得上，当前块与文字按判定给的 id 落到对应的块上。 */

const wrappers: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

const rect = (left: number, top: number, right: number, bottom: number) => ({left, top, right, bottom});

function draw(sectors: ReadonlyArray<LayoutDropSector>, active: string | null): void {
    const labels = Object.fromEntries(sectors.map((sector) => [sector.id, `放到 ${sector.id}`]));
    wrappers.push(mount(DropSectorsOverlay, {attachTo: document.body, props: {rect: {left: 10, top: 20, right: 610, bottom: 420}, sectors, active, labels}}));
}

function drawnIds(): string[] {
    return [...document.body.querySelectorAll("[data-drop-sector]")].map((element) => element.getAttribute("data-drop-sector") ?? "").sort();
}

function expectActiveAndLabels(sectors: ReadonlyArray<LayoutDropSector>, active: string): void {
    expect([...document.body.querySelectorAll("[data-drop-sector-active]")].map((element) => element.getAttribute("data-drop-sector"))).toEqual([active]);
    // 当前块不写字（`DropFeedbackOverlay` 的提示在说它），其余块各写自己的字。
    for (const sector of sectors) {
        const label = document.body.querySelector(`[data-drop-sector-label="${sector.id}"]`);
        if (sector.id === active) expect(label).toBeNull();
        else expect(label?.textContent).toBe(`放到 ${sector.id}`);
    }
}

describe("工作台的分区交给 DropSectorsOverlay", () => {
    it("编辑组的五块：每块一个多边形，id 与判定给的一致；当前块与文字落在判定给的 id 上", () => {
        const geometry = {id: "a", strip: null, body: rect(0, 0, 100, 100)};
        const sectors = layoutDropSectors({doc: docOf(H(["a", "b"], "root")), source: {kind: "tab", tab: "view:b"}, point: {x: 0, y: 0}, panels: [geometry], policy: testPolicy()}, geometry);
        if (sectors === null) throw new Error("没有分区");
        expect(sectors.map((sector) => sector.id)).toContain("center");
        draw(sectors, "center");
        expect(drawnIds()).toEqual(sectors.map((sector) => sector.id).sort());
        expectActiveAndLabels(sectors, "center");
    });

    it("空区域是一整块（whole）", () => {
        const doc: LayoutDoc = docOf(H([V(["sidebar", "s1"], "side"), "ea", "auxiliarybar"], "root"), {
            sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
            s1: {container: "A"},
            auxiliarybar: {tabs: [], active: null, entries: [], activeContainer: null},
        });
        const panels: LayoutDropPanelGeometry[] = [
            {id: "s1", strip: rect(0, 0, 300, 30), body: rect(0, 30, 300, 600), insertionAt: () => 0},
            {id: "ea", strip: rect(301, 0, 1000, 30), body: rect(301, 30, 1000, 600), insertionAt: () => 0},
            {id: "auxiliarybar", strip: null, body: rect(1001, 0, 1300, 600)},
        ];
        const input: LayoutDropInput = {doc, source: {kind: "tab", tab: "view:s1"}, point: {x: 1150, y: 300}, panels, policy: testPolicy(), newContainer: "custom:n"};
        const sectors = layoutDropSectors(input, panels[2]!);
        if (sectors === null) throw new Error("没有分区");
        draw(sectors, "whole");
        expect(drawnIds()).toEqual(["whole"]);
        expectActiveAndLabels(sectors, "whole");
    });

    it("侧栏一列的分节按前后两块（top、bottom）", () => {
        const doc: LayoutDoc = docOf(V([H([V(["sidebar", "s1", "s2"], "side"), "ea"], "top"), H(["panel", "p1"], "row")], "root"), {
            sidebar: {tabs: [], active: null, entries: ["A"], activeContainer: "A"},
            s1: {container: "A"},
            s2: {container: "A"},
            panel: {tabs: [], active: null, entries: ["P"], activeContainer: "P"},
            p1: {container: "P"},
        });
        const s1: LayoutDropPanelGeometry = {id: "s1", strip: rect(0, 0, 300, 30), body: rect(0, 30, 300, 300), insertionAt: () => 0};
        const panels: LayoutDropPanelGeometry[] = [
            s1,
            {id: "s2", strip: rect(0, 301, 300, 331), body: rect(0, 331, 300, 600), insertionAt: () => 0},
            {id: "ea", strip: rect(301, 0, 1000, 30), body: rect(301, 30, 1000, 600), insertionAt: () => 0},
            {id: "p1", strip: rect(0, 601, 1000, 631), body: rect(0, 631, 1000, 900), insertionAt: () => 0},
        ];
        const policy = testPolicy({edgeTarget: (_doc, _tabs, panel, edge) => ({kind: "split", panel, edge})});
        const sectors = layoutDropSectors({doc, source: {kind: "tab", tab: "view:p1"}, point: {x: 150, y: 100}, panels, policy}, s1);
        if (sectors === null) throw new Error("没有分区");
        expect(sectors.map((sector) => sector.id)).toEqual(["top", "bottom"]);
        draw(sectors, "bottom");
        expect(drawnIds()).toEqual(["bottom", "top"]);
        expectActiveAndLabels(sectors, "bottom");
    });
});
