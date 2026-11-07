import {describe, expect, it} from "bun:test";

import type {GridDropPoint, GridDropRect, LayoutDoc, LayoutDropAction} from "@notnotype/nb-layout";

import {createLiveDrag} from "./live-drag";
import type {LayoutDragDrop, LayoutTabSource} from "./layout-drag";

/**
 * 实时布局的帧循环（docs/specs/ui/workbench-layout.md“实时布局”）。判定与 DOM 由宿主给，这里推进帧、移动指针，看预览、卡片与空位。真实浏览器里的邻居让位在 e2e/workbench-live-drag.e2e.ts。
 */

const SOURCE: LayoutTabSource = {kind: "tab", tab: "view:v"};
const rect = (left: number, top: number, right: number, bottom: number): GridDropRect => ({left, top, right, bottom});

/** 文档在这里只是令牌：实时布局不看内容，只转交。 */
const token = (name: string): LayoutDoc => ({name}) as unknown as LayoutDoc;
const REMOVED = token("removed");
const CANDIDATE = token("candidate");

const drop = (action: LayoutDropAction, over: Partial<LayoutDragDrop> = {}): LayoutDragDrop => ({action, inPlace: false, preview: {areaRect: null, indicator: null, orientation: "horizontal"}, ...over});

function harness(options: {readonly candidate?: LayoutDoc | null; readonly homeOf?: (shown: LayoutDoc | null) => string | null; readonly panels?: Readonly<Record<string, GridDropRect>>} = {}) {
    const frames = new Map<number, (now: number) => void>();
    let nextFrame = 1;
    let listener: ((point: GridDropPoint) => void) | null = null;
    const shown: Array<LayoutDoc | null> = [];
    const panels = options.panels ?? {a: rect(100, 100, 900, 700)};
    const live = createLiveDrag({
        requestFrame: (run) => {
            frames.set(nextFrame, run);
            return nextFrame++;
        },
        cancelFrame: (frame) => frames.delete(frame),
        panelRect: (panel) => panels[panel] ?? null,
        gridOrigin: () => ({x: 10, y: 20}),
        trackPointer: (next) => {
            listener = next;
            return () => {
                listener = null;
            };
        },
        candidateDoc: () => (options.candidate === undefined ? CANDIDATE : options.candidate),
        sourceRemovedDoc: () => REMOVED,
        homeOf: (_source, doc) => options.homeOf?.(doc) ?? "a",
        show: (doc) => shown.push(doc),
    });
    let now = 1000;
    const advance = (ms: number): void => {
        now += ms;
        const pending = [...frames.values()];
        frames.clear();
        for (const run of pending) run(now);
    };
    return {live, shown, advance, frameCount: () => frames.size, tracking: () => listener !== null, point: (x: number, y: number) => listener?.({x, y})};
}

describe("实时布局的帧循环", () => {
    it("来源自己那条标签条里：不拿起卡片，预览马上换，不等稳定", () => {
        const {live, shown, advance} = harness();
        live.begin(SOURCE, {x: 200, y: 110});
        live.offer(drop({kind: "strip", panel: "a", index: 2}));
        advance(16);
        expect(live.card.value).toBeNull();
        expect(shown).toEqual([CANDIDATE]);
        expect(live.previewKey.value).toContain("strip");
    });

    it("离开标签条：内容抬成卡片，抓住的点在指针下；离开来源面板后缩到小卡，抓住的点还在指针下", () => {
        const {live, advance, point} = harness();
        live.begin(SOURCE, {x: 500, y: 400});
        live.offer(null);
        advance(16);
        const lifted = live.card.value;
        expect(lifted?.key).toBe(SOURCE.tab);
        // 抓住的点是面板中央，矩形相对网格根（10、20）：
        expect(lifted?.rect.x).toBeCloseTo(500 - 10 - 400, 0);
        expect(lifted?.rect.width).toBeGreaterThan(780);

        point(1500, 900);
        for (let index = 0; index < 60; index += 1) advance(16);
        const card = live.card.value;
        expect(card?.rect.width).toBeCloseTo(380, 0);
        expect(card?.rect.height).toBeCloseTo(260, 0);
        const grabX = (500 - 100) / 800;
        expect((card?.rect.x ?? 0) + grabX * (card?.rect.width ?? 0)).toBeCloseTo(1500 - 10, 0);
    });

    it("指针不动、缩放收敛之后不换卡片对象：渲染链不跟着每帧重跑", () => {
        const {live, advance, point} = harness();
        live.begin(SOURCE, {x: 500, y: 400});
        live.offer(null);
        advance(16);
        point(1500, 900);
        for (let index = 0; index < 200; index += 1) advance(16);
        const settled = live.card.value;
        advance(16);
        advance(16);
        expect(live.card.value).toBe(settled);
    });

    it("标签先预览到别的面板再撕下：卡片从那块面板开始缩，不是已提交的来源", () => {
        const panels = {a: rect(0, 0, 100, 100), b: rect(1000, 0, 2000, 800)};
        const {live, advance} = harness({panels, homeOf: (doc) => (doc === CANDIDATE ? "b" : "a")});
        live.begin(SOURCE, {x: 1500, y: 20});
        live.offer(drop({kind: "strip", panel: "b", index: 0}));
        advance(16);
        advance(200);
        expect(live.previewKey.value).toContain("\"b\"");
        live.offer(drop({kind: "center", panel: "b"}));
        advance(16);
        expect(live.card.value?.rect.width).toBeGreaterThan(900);
    });

    it("候选要稳定：一直换就不摆，留在来源收起；稳定之后才摆", () => {
        const {live, shown, advance} = harness();
        live.begin(SOURCE, {x: 500, y: 400});
        live.offer(null);
        advance(16);
        advance(16);
        for (const panel of ["b", "c", "d", "e"]) {
            live.offer(drop({kind: "center", panel}));
            advance(60);
        }
        expect(shown).not.toContain(CANDIDATE);
        advance(200);
        expect(shown.at(-1)).toBe(CANDIDATE);
        expect(live.shownAction.value).toEqual({kind: "center", panel: "e"});
    });

    it("摆不出提交后的样子（编辑器拒绝）：回到已提交的布局", () => {
        const {live, shown, advance} = harness({candidate: null});
        live.begin(SOURCE, {x: 500, y: 400});
        live.offer(drop({kind: "center", panel: "b"}));
        advance(16);
        advance(200);
        expect(shown.at(-1)).toBeNull();
    });

    it("长出新面板的落点有空位；指针还在空位里时算这个落点（粘滞），出了空位不算", () => {
        const {live, advance} = harness();
        const edge = drop({kind: "edge", target: {kind: "split", panel: "b", edge: "right"}}, {preview: {areaRect: rect(300, 300, 500, 500), indicator: null, orientation: "horizontal"}});
        live.begin(SOURCE, {x: 400, y: 400});
        live.offer(edge);
        advance(16);
        advance(200);
        expect(live.slot.value).toEqual({x: 290, y: 280, width: 200, height: 200});
        expect(live.stickyDrop({x: 400, y: 400})).toBe(edge);
        expect(live.stickyDrop({x: 700, y: 400})).toBeNull();
    });

    it("活动栏的落点不改卡片的状态：已经拿起的继续跟手，没拿起的不拿起", () => {
        const bar = drop({kind: "strip", panel: "sidebar", index: 0}, {noPreview: true});
        const lifted = harness();
        lifted.live.begin(SOURCE, {x: 500, y: 400});
        lifted.live.offer(null);
        lifted.advance(16);
        lifted.live.offer(bar);
        lifted.advance(16);
        expect(lifted.live.card.value).not.toBeNull();

        const inStrip = harness();
        inStrip.live.begin(SOURCE, {x: 500, y: 110});
        inStrip.live.offer(bar);
        inStrip.advance(16);
        expect(inStrip.live.card.value).toBeNull();
    });

    it("收场：撤预览、停帧循环、停跟踪指针，什么都不留", () => {
        const {live, shown, advance, frameCount, tracking} = harness();
        live.begin(SOURCE, {x: 500, y: 400});
        live.offer(drop({kind: "center", panel: "b"}));
        advance(16);
        advance(200);
        live.end();
        expect(shown.at(-1)).toBeNull();
        expect(frameCount()).toBe(0);
        expect(tracking()).toBe(false);
        expect(live.active.value).toBe(false);
        expect(live.card.value).toBeNull();
        expect(live.slot.value).toBeNull();
        expect(live.previewKey.value).toBe("none");
        expect(live.stickyDrop({x: 400, y: 400})).toBeNull();
    });
});
