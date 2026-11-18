/** 实时布局的状态机（docs/specs/ui/workbench-layout.md“实时布局”）：什么时候换预览、什么时候要卡片。帧由测试推进。 */

import {describe, expect, it} from "bun:test";

import type {GridDropRect, GridRect, LayoutDoc} from "@notnotype/nb-layout";

import {BAR_STRIP, entryStripOf} from "./entry-drop";
import type {WorkbenchDropAction} from "./entry-drop";
import type {LayoutDragDrop, LayoutTabSource} from "./layout-drag";
import {createLiveDrag} from "./live-drag";
import type {LiveDragHost} from "./live-drag";

const SOURCE: LayoutTabSource = {kind: "tab", tab: "view:a"};
const DOC = {} as LayoutDoc;
const REMOVED = {} as LayoutDoc;
const preview = {areaRect: null, indicator: null, orientation: "horizontal" as const};
const dropOf = (action: WorkbenchDropAction, inPlace = false): LayoutDragDrop => ({action, inPlace, preview});
const strip = (panel: string, index = 0): LayoutDragDrop => dropOf({kind: "strip", panel, index});
const CENTER = dropOf({kind: "center", panel: "other"});
/** 来源面板里不是原位的落点：拆开它自己那块。 */
const HOME_SPLIT = dropOf({kind: "edge", target: {kind: "split", panel: "home", edge: "left"}});
const RECTS: Readonly<Record<string, GridDropRect>> = {home: {left: 0, top: 0, right: 600, bottom: 800}, other: {left: 600, top: 0, right: 1400, bottom: 800}};

function setup(over: Partial<LiveDragHost> = {}) {
    let scheduled: ((now: number) => void) | null = null;
    let now = 1000;
    const shown: Array<LayoutDoc | null> = [];
    const placed: GridRect[] = [];
    const collapses: string[] = [];
    const expansions: string[] = [];
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
        cardRefresh: () => "display",
        candidateDoc: () => DOC,
        sourceRemovedDoc: () => REMOVED,
        collapseSource: (from) => collapses.push(from.tab),
        expandSource: (from) => expansions.push(from.tab),
        homeOf: () => "home",
        homeStays: () => false,
        isHomeStrip: (_from, strip) => strip === "home",
        show: (doc) => shown.push(doc),
        ...over,
    });
    const frame = (advance = 16): void => {
        now += advance;
        const run = scheduled;
        scheduled = null;
        run?.(now);
    };
    return {live, frame, shown, placed, collapses, expansions, sorted};
}

describe("createLiveDrag", () => {
    it("来源落到别处时收起：自己的标签条、放回原处不收；收起着时没有落点再回来，不重复收起", () => {
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

    it("来源收起之后回到原处（原位）：展开回原位，预览是已提交的样子；再落到别处又收起（输出 38）", () => {
        const t = setup({candidateDoc: (_from, drop) => (drop.inPlace ? null : DOC)});
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.live.offer(dropOf({kind: "edge", target: {kind: "split", panel: "home", edge: "top"}}, true));
        t.frame();
        t.frame(200);
        expect(t.expansions).toEqual([SOURCE.tab]);
        expect(t.shown.at(-1)).toBeNull();
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab, SOURCE.tab]);
        // 自己标签条里的原位同样是展开。
        t.live.offer(dropOf({kind: "strip", panel: "home", index: 0}, true));
        t.frame();
        expect(t.expansions).toEqual([SOURCE.tab, SOURCE.tab]);
        expect(t.shown.at(-1)).toBeNull();
    });

    it("来源收起之后，摆不出来的别处（编辑器会合并或拒绝）仍是来源收起的样子，不展开", () => {
        const t = setup({candidateDoc: (_from, drop) => (drop.action.kind === "center" ? DOC : null)});
        t.live.begin(SOURCE, {x: 700, y: 400});
        t.live.offer(CENTER);
        t.frame();
        t.frame(200);
        t.live.offer(dropOf({kind: "edge", target: {kind: "split", panel: "other", edge: "left"}}));
        t.frame();
        t.frame(200);
        expect(t.expansions).toEqual([]);
        expect(t.shown.at(-1)).toBe(REMOVED);
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

    it("放回原处（不在自己的标签条里）照样拿着卡片：来源展开回原位，卡片不收回（输出 38）", () => {
        const t = setup({candidateDoc: (_from, drop) => (drop.inPlace ? null : DOC)});
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        t.frame();
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        t.live.offer(dropOf({kind: "edge", target: {kind: "split", panel: "home", edge: "top"}}, true));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        expect(t.shown.at(-1)).toBeNull();
    });

    it("撕下标签：来源那块面板摘掉它还在时，拿起卡片的那一帧就收起来源，预览是来源收起的样子；回到自己标签条里的原位展开、收回卡片（输出 38）", () => {
        const t = setup({homeStays: () => true, candidateDoc: (_from, drop) => (drop.inPlace ? null : DOC)});
        t.live.begin(SOURCE, {x: 100, y: 10});
        t.live.offer(dropOf({kind: "strip", panel: "home", index: 0}, true));
        t.frame();
        expect(t.collapses).toEqual([]);
        expect(t.live.card.value).toBeNull();
        // 拖出标签条到自己的正文：不等落点稳定。
        t.live.offer(dropOf({kind: "center", panel: "home"}));
        t.frame();
        expect(t.collapses).toEqual([SOURCE.tab]);
        expect(t.shown.at(-1)).toBe(REMOVED);
        expect(t.live.previewKey.value).toBe("source-removed");
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        // 稳定之后是并入自己那块：预览照旧是摘掉它的样子，盖层看 `shownAction`。
        t.frame(200);
        expect(t.live.shownAction.value).toEqual({kind: "center", panel: "home"});
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.live.offer(dropOf({kind: "strip", panel: "home", index: 0}, true));
        t.frame();
        expect(t.expansions).toEqual([SOURCE.tab]);
        expect(t.shown.at(-1)).toBeNull();
        expect(t.live.card.value).toBeNull();
        // 再拖出去又撕下来。
        t.live.offer(dropOf({kind: "center", panel: "home"}));
        t.frame();
        expect(t.collapses).toEqual([SOURCE.tab, SOURCE.tab]);
    });

    it("摘掉它面板就没了（单个标签的面板）：拿起卡片不收起来源，等第一个落点稳定", () => {
        const t = setup({homeStays: () => false});
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        t.frame();
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        expect(t.collapses).toEqual([]);
        t.frame(200);
        expect(t.collapses).toEqual([SOURCE.tab]);
    });

    it("离开吸收它的标签条时指针已在那块面板外面：卡片从面板的位置追到指针下，不跳", () => {
        let pointer = {x: 900, y: 10};
        const t = setup({pointer: () => pointer});
        t.live.begin(SOURCE, pointer);
        t.live.offer(strip("other"));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toBeNull();
        // 从标签条往上拖出了网格：那块面板（other，从 y=0 起）在指针下面 40px。
        pointer = {x: 900, y: -40};
        t.live.offer(null);
        t.frame();
        expect(t.placed.at(-1)?.y).toBe(0);
        t.frame();
        expect(t.placed.at(-1)?.y).toBeLessThan(0);
        // 抓住的点夹在卡片上边：追完之后卡片的上边在指针下。
        for (let index = 0; index < 120; index += 1) t.frame();
        expect(t.placed.at(-1)?.y).toBeCloseTo(-40, 5);
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
        t.live.offer(HOME_SPLIT);
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
        t.live.offer(HOME_SPLIT);
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

    it("刷新率 30：尺寸每秒至多约 30 次、按整像素写，位置每帧都跟手，抓住的点按画出来的大小算；跟随屏幕时取整后变了就写", () => {
        const run = (refresh: "display" | "30") => {
            let pointer = {x: 300, y: 400};
            const t = setup({cardRefresh: () => refresh, pointer: () => pointer});
            t.live.begin(SOURCE, pointer);
            t.live.offer(HOME_SPLIT);
            t.frame();
            // 16ms 一帧，约半秒：缩放还没到终点。
            for (let index = 0; index < 30; index += 1) {
                pointer = {x: pointer.x + 1, y: 400};
                t.frame();
            }
            const sizes = t.placed.filter((rect, index, all) => index === 0 || rect.width !== all[index - 1]?.width).length;
            return {t, sizes};
        };
        const limited = run("30");
        expect(limited.t.placed.length).toBe(31);
        // 31 帧共 480ms：按 33ms 一次至多 16 次。
        expect(limited.sizes).toBeLessThanOrEqual(16);
        expect(limited.sizes).toBeGreaterThan(8);
        expect(limited.t.placed.every((rect) => Number.isInteger(rect.width) && Number.isInteger(rect.height))).toBe(true);
        // 抓住的点按画出来的大小算：尺寸没写的帧，卡片右边照样和指针保持拿起时的比例。
        limited.t.placed.forEach((rect, index) => expect((300 + index - rect.x) / rect.width).toBeCloseTo(0.5, 5));
        // 跟随屏幕：取整后变了就写，缩放的尾巴里一帧不到一像素的才不写。
        expect(run("display").sizes).toBeGreaterThan(limited.sizes + 8);
        for (let index = 0; index < 60; index += 1) limited.t.frame();
        expect(limited.t.placed.at(-1)?.width).toBe(380);
    });

    it("指针不动、缩放结束之后不再写", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 300, y: 400});
        t.live.offer(HOME_SPLIT);
        for (let index = 0; index < 120; index += 1) t.frame();
        const writes = t.placed.length;
        for (let index = 0; index < 30; index += 1) t.frame();
        expect(t.placed.length).toBe(writes);
    });

    it("活动栏的入口之间是一条标签条：第一次进去等稳定，吸收之后卡片收回、拖的视图在活动栏里排序；入口上是并入，卡片留着", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 20, y: 100});
        t.live.offer(dropOf({kind: "new-container", region: "sidebar", container: "custom:a", before: null}));
        t.frame();
        expect(t.shown.length).toBe(0);
        t.frame(200);
        expect(t.shown).toEqual([DOC]);
        expect(t.live.card.value).toBeNull();
        expect(t.collapses).toEqual([SOURCE.tab]);
        t.frame();
        expect(t.sorted.at(-1)).toBe(BAR_STRIP);
        t.live.offer(dropOf({kind: "join-container", region: "sidebar", container: "view:b"}));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toEqual({key: SOURCE.tab});
        expect(t.live.shownAction.value).toEqual({kind: "join-container", region: "sidebar", container: "view:b"});
    });

    it("右栏、底部面板的入口条同活动栏：入口之间是这一条入口条，吸收之后拖的视图在它里面排序；整个容器搬过来也是", () => {
        const t = setup();
        t.live.begin(SOURCE, {x: 900, y: 40});
        t.live.offer(dropOf({kind: "move-container", region: "auxiliarybar", container: "view:a", before: null}));
        t.frame();
        t.frame(200);
        expect(t.live.card.value).toBeNull();
        t.frame();
        expect(t.sorted.at(-1)).toBe(entryStripOf("auxiliarybar"));
    });

    it("来源是侧栏里一个容器唯一的视图时活动栏是它自己的标签条：入口之间马上跟手，不收起来源", () => {
        const t = setup({isHomeStrip: (_from, strip) => strip === "home" || strip === BAR_STRIP});
        t.live.begin(SOURCE, {x: 20, y: 100});
        t.live.offer(dropOf({kind: "move-entry", region: "sidebar", container: "view:a", before: "view:b"}));
        t.frame();
        expect(t.shown).toEqual([DOC]);
        expect(t.live.card.value).toBeNull();
        expect(t.collapses).toEqual([]);
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
