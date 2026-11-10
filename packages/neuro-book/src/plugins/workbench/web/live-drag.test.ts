/** 实时布局的状态机（docs/specs/ui/workbench-layout.md“实时布局”）：什么时候换预览、什么时候要卡片。帧由测试推进。 */

import {describe, expect, it} from "bun:test";

import type {GridDropRect, GridRect, LayoutDoc, LayoutDropAction} from "@notnotype/nb-layout";

import type {LayoutDragDrop, LayoutTabSource} from "./layout-drag";
import {createLiveDrag} from "./live-drag";
import type {LiveDragHost} from "./live-drag";

const SOURCE: LayoutTabSource = {kind: "tab", tab: "view:a"};
const DOC = {} as LayoutDoc;
const REMOVED = {} as LayoutDoc;
const preview = {areaRect: null, indicator: null, orientation: "horizontal" as const};
const dropOf = (action: LayoutDropAction, inPlace = false): LayoutDragDrop => ({action, inPlace, preview});
const strip = (panel: string, index = 0): LayoutDragDrop => dropOf({kind: "strip", panel, index});
const CENTER = dropOf({kind: "center", panel: "other"});
const RECTS: Readonly<Record<string, GridDropRect>> = {home: {left: 0, top: 0, right: 600, bottom: 800}, other: {left: 600, top: 0, right: 1400, bottom: 800}};

function setup(over: Partial<LiveDragHost> = {}) {
    let scheduled: ((now: number) => void) | null = null;
    let now = 1000;
    const shown: Array<LayoutDoc | null> = [];
    const placed: GridRect[] = [];
    const collapses: string[] = [];
    const sorted: Array<string | null> = [];
    const live = createLiveDrag({
        requestFrame: (run) => {
            scheduled = run;
            return 1;
        },
        cancelFrame: () => {
            scheduled = null;
        },
        panelRect: (panel) => RECTS[panel] ?? null,
        gridOrigin: () => ({x: 0, y: 0}),
        settleDrop: () => undefined,
        pointer: () => null,
        placeCard: (rect) => placed.push(rect),
        placeSorted: (at) => () => sorted.push(at === null ? null : at.panel),
        placeSortedAfterRender: () => undefined,
        cardShrink: () => "strip",
        candidateDoc: () => DOC,
        sourceRemovedDoc: () => REMOVED,
        collapseSource: (from) => collapses.push(from.tab),
        homeOf: () => "home",
        show: (doc) => shown.push(doc),
        ...over,
    });
    const frame = (advance = 16): void => {
        now += advance;
        const run = scheduled;
        scheduled = null;
        run?.(now);
    };
    return {live, frame, shown, placed, collapses, sorted};
}

describe("createLiveDrag", () => {
    it("来源只在第一次落到别处时收起一次：自己的标签条、放回原处不收；离开再回来也不再展开", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        t.live.offer(dropOf({kind: "center", panel: "home"}, true));
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([]);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.live.offer(null);
        t.frame();
        t.frame(200);
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.live.end();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab, SOURCE.tab]);
    });

    it("自己的标签条马上换预览，不要卡片", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        expect(t.shown).toEqual([DOC]);
        expect(t.live.card.value).toBeNull();
    });

    it("来源收起之后，摆不出来的候选（原位、编辑器会合并）仍是来源收起的样子，不把来源又摆回去；自己标签条里的排序是已提交的样子", () => {
        const t = setup({candidateDoc: (_from, drop) => (drop.inPlace ? null : DOC)});
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.live.offer(dropOf({kind: "edge", target: {kind: "split", panel: "other", edge: "left"}}, true));
        t.frame();
        t.frame(200);
        expect(t.shown.at(-1)).toBe(REMOVED);
        t.live.offer(dropOf({kind: "strip", panel: "home", index: 0}, true));
        t.frame();
        expect(t.shown.at(-1)).toBeNull();
    });

    it("卡片收回、指针在标签条上时，被拖的标签在吸收它的那条里排序；离开要卡片时放回", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(strip("home", 1));
        t.frame();
        t.frame();
        expect(t.sorted.at(-1)).toBe("home");
        t.live.offer(CENTER);
        t.frame();
        t.frame();
        expect(t.sorted.at(-1)).toBeNull();
        t.live.end();
        expect(t.sorted.at(-1)).toBeNull();
    });

    it("放回自己标签条的原位：没有预览，也不要卡片", () => {
        const t = setup({candidateDoc: () => null});
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(dropOf({kind: "strip", panel: "home", index: 0}, true));
        t.frame();
        expect(t.live.card.value).toBeNull();
    });

    it("正文里放回原处要卡片：只有标签条才不要", () => {
        const t = setup({candidateDoc: () => null});
        t.live.begin(SOURCE, {x: 100, y: 400});
        t.live.offer(dropOf({kind: "center", panel: "home"}, true));
        t.frame();
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
    });

    it("第一次进别的标签条等够稳定才吸收：这之前卡片留着，路过不换预览", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.shown).toEqual([DOC]);
        t.live.offer(strip("other"));
        t.frame();
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        expect(t.shown.length).toBe(1);
        t.frame(200);
        expect(t.shown.length).toBe(2);
        expect(t.live.card.value).toBeNull();
    });

    it("吸收之后在这条标签条里换位不等；离开就要卡片，不等预览换", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 700, y: 10});
        t.live.offer(strip("other", 0));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toBeNull();
        const shownBefore = t.shown.length;
        t.live.offer(strip("other", 1));
        t.frame();
        expect(t.shown.length).toBe(shownBefore + 1);
        t.live.offer(CENTER);
        t.frame();
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        expect(t.shown.length).toBe(shownBefore + 1);
    });

    it("编辑器摆不出来（预览是 null）时不算吸收：卡片留着", () => {
        const t = setup({candidateDoc: () => null});
        t.live.begin(SOURCE, {x: 700, y: 10});
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
    });

    it("卡片缩小的时机：缺省离开标签条就缩到紧凑，从面板的大小开始", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(dropOf({kind: "center", panel: "home"}, true));
        t.frame();
        expect(t.placed[0]?.width).toBe(600);
        for (let index = 0; index < 60; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(380);
        expect(t.placed.at(-1)?.height).toBe(260);
    });

    it("设置离开面板才缩：来源面板里是原大小，离开才缩；吸收之后“来源面板”不变", () => {
        let pointer = {x: 300, y: 400};
        const t = setup({cardShrink: () => "panel", pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(dropOf({kind: "center", panel: "home"}, true));
        t.frame();
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(600);
        pointer = {x: 900, y: 400};
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toBeNull();
        // 从吸收它的那块面板拿起（800 宽），指针不在来源面板里：缩。
        t.live.offer(CENTER);
        t.frame();
        expect(t.placed.at(-1)?.width).toBeGreaterThan(700);
        for (let index = 0; index < 60; index += 1) t.frame();
        expect(t.placed.at(-1)?.width).toBe(380);
    });

    it("指针不动、缩放结束之后不再写", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(dropOf({kind: "center", panel: "home"}, true));
        for (let index = 0; index < 120; index += 1) t.frame();
        const writes = t.placed.length;
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.placed.length).toBe(writes);
    });

    it("判定时结构变了结束这一场：这一帧不再往下做", () => {
        const holder: {end?: () => void} = {};
        const t = setup({settleDrop: () => holder.end?.()});
        holder.end = () => t.live.end();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(strip("home"));
        t.frame();
        expect(t.live.active.value).toBe(false);
        expect(t.shown).toEqual([null]);
    });
});
