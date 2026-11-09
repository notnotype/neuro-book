/** 拖动中画什么（docs/specs/ui/workbench-layout.md 输出 30、38）。 */

import {describe, expect, it} from "bun:test";

import type {LayoutDoc, LayoutDropAction} from "@notnotype/nb-layout";

import {presentDrag} from "./drag-presentation";
import type {DragPresentationInput} from "./drag-presentation";
import type {LayoutDragDrop} from "./layout-drag";
import {defaultLayoutDoc} from "./state/default-tree";

const TAB = "view:nbook.explorer";
const base = defaultLayoutDoc(new Map());
/** 来源在侧栏。 */
const doc: LayoutDoc = {...base, panels: {...base.panels, sidebar: {role: "tool", name: "sidebar", tabs: [{kind: "view", viewId: "nbook.explorer"}], active: TAB}}};
const preview = {areaRect: null, indicator: null, orientation: "horizontal" as const};
const dropOf = (action: LayoutDropAction, inPlace = false): LayoutDragDrop => ({action, inPlace, preview});
const input = (over: Partial<DragPresentationInput> = {}): DragPresentationInput => ({live: true, source: {kind: "tab", tab: TAB}, drop: null, lifted: false, shownAction: null, rendered: doc, rejected: false, ...over});

describe("presentDrag", () => {
    it("实时布局下来源一直是占位；落点指示不留占位", () => {
        expect(presentDrag(input()).placeholder).toBe(TAB);
        expect(presentDrag(input({live: false})).placeholder).toBeNull();
    });

    it("拿着卡片时不要拖影，没拿着要", () => {
        expect(presentDrag(input({lifted: true})).ghost).toBe(false);
        expect(presentDrag(input()).ghost).toBe(true);
        expect(presentDrag(input({source: null})).ghost).toBe(false);
    });

    it("实时布局里卡片收回、指针在标签条上：标签自己在条里跟手，不要拖影；落点指示照样要拖影", () => {
        const onStrip = dropOf({kind: "strip", panel: "sidebar", index: 1});
        expect(presentDrag(input({drop: onStrip})).ghost).toBe(false);
        expect(presentDrag(input({drop: dropOf({kind: "reveal", panel: "sidebar"})})).ghost).toBe(false);
        expect(presentDrag(input({drop: onStrip, lifted: true})).ghost).toBe(false);
        expect(presentDrag(input({drop: onStrip, live: false})).ghost).toBe(true);
        expect(presentDrag(input({drop: dropOf({kind: "center", panel: "auxiliarybar"})})).ghost).toBe(true);
    });

    it("长出新块时，来源落进去的那块是空位", () => {
        const action: LayoutDropAction = {kind: "edge", target: {kind: "split", panel: "panel", edge: "right"}};
        expect(presentDrag(input({shownAction: action})).slotPanel).toBe("sidebar");
    });

    it("中央并入：目标盖一层；放回来源自己那块不算并入", () => {
        const other: LayoutDropAction = {kind: "center", panel: "auxiliarybar"};
        expect(presentDrag(input({shownAction: other})).mergeTarget).toBe("auxiliarybar");
        const own: LayoutDropAction = {kind: "center", panel: "sidebar"};
        expect(presentDrag(input({shownAction: own})).mergeTarget).toBeNull();
    });

    it("标签条上没有盖层：被吸收的标签就是反馈", () => {
        const view = presentDrag(input({shownAction: {kind: "strip", panel: "auxiliarybar", index: 0}}));
        expect(view.mergeTarget).toBeNull();
        expect(view.slotPanel).toBeNull();
    });

    it("反馈：实时布局只报读屏文字；落点指示画预览写文字；整窗移动什么都不画；被拒绝报拒绝", () => {
        const drop = dropOf({kind: "center", panel: "auxiliarybar"});
        expect(presentDrag(input({drop})).feedback).toEqual({preview: null, label: null, announce: drop, kind: "center"});
        expect(presentDrag(input({live: false, drop})).feedback).toEqual({preview, label: drop, announce: null, kind: "center"});
        const moved = dropOf({kind: "float", rect: {x: 0, y: 0, width: 10, height: 10}});
        expect(presentDrag(input({live: false, source: {kind: "panel", panel: "f"}, drop: moved})).feedback).toEqual({preview: null, label: null, announce: null, kind: "float"});
        expect(presentDrag(input({rejected: true})).feedback.announce).toBe("rejected");
    });

    it("放回原处的种类是 noop", () => {
        expect(presentDrag(input({drop: dropOf({kind: "center", panel: "sidebar"}, true)})).feedback.kind).toBe("noop");
    });

    it("分区：实时布局画在卡片后面，落点指示画在反馈层", () => {
        const sectors = {rect: {left: 0, top: 0, right: 1, bottom: 1}, items: [], active: null};
        const drop = {...dropOf({kind: "center", panel: "auxiliarybar"}), sectors};
        expect(presentDrag(input({drop})).liveSectors).toBe(sectors);
        expect(presentDrag(input({drop})).feedbackSectors).toBeNull();
        expect(presentDrag(input({live: false, drop})).feedbackSectors).toBe(sectors);
    });
});
