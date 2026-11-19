/** 拖动卡片（Spec `ui/layout-drag` 的“拖动卡片”）：拿起、逐帧缩放与追赶、写的频率。时间由测试给。 */

import {describe, expect, it} from "bun:test";

import {createDragCard} from "./drag-card";
import type {DragCard, DragCardFrame} from "./drag-card";
import type {GridRect} from "./grid-rects";

const ORIGIN = {x: 40, y: 30};
const COMPACT = {width: 380, height: 260};
/** 内容此刻在这块矩形上（600×400）；按下在上沿往下 20、正中。 */
const FROM = {left: 100, top: 100, right: 700, bottom: 500};
const PRESS = {x: 400, y: 120};

/** 跑若干帧，每帧 `dt` 毫秒，指针由 `pointerAt` 给；交回每一帧的结果。 */
function run(card: DragCard, count: number, over: Partial<DragCardFrame> & {readonly dt?: number; readonly start?: number; readonly pointerAt?: (index: number) => {x: number; y: number}} = {}) {
    const dt = over.dt ?? 1000 / 60;
    const results: Array<{readonly rect: GridRect | null; readonly settling: boolean}> = [];
    for (let index = 0; index < count; index++) {
        const now = (over.start ?? 0) + index * dt;
        results.push(card.step({now, elapsed: dt, pointer: over.pointerAt?.(index) ?? PRESS, origin: ORIGIN, target: over.target ?? COMPACT, ...(over.refreshMs === undefined ? {} : {refreshMs: over.refreshMs})}));
    }
    return results;
}

/** 抓住的点（占卡片的比例）在指针下：位置按画出来的尺寸算。 */
const grabbedAt = (rect: GridRect, grab: {x: number; y: number}) => ({x: rect.x + ORIGIN.x + grab.x * rect.width, y: rect.y + ORIGIN.y + grab.y * rect.height});

describe("createDragCard", () => {
    it("拿起：第一帧不按时间缩，就在内容所在的矩形上（相对网格根）", () => {
        const [first] = run(createDragCard(FROM, PRESS, COMPACT), 1);
        expect(first).toEqual({rect: {x: 60, y: 70, width: 600, height: 400}, settling: true});
    });

    it("之后逐帧缩向目标，缩放中抓住的点一直在指针下；到了终点不再要帧，指针不动就不用写", () => {
        const results = run(createDragCard(FROM, PRESS, COMPACT), 120);
        const widths = results.flatMap((result) => (result.rect === null ? [] : [result.rect.width]));
        // 每帧走 1 − e^(−16.67/90) ≈ 0.169：600 → 562.8 → 531.9 → 506.2（手算）。
        expect(widths.slice(0, 4)).toEqual([600, 563, 532, 506]);
        for (const result of results) {
            if (result.rect === null) continue;
            const grabbed = grabbedAt(result.rect, {x: 0.5, y: 0.05});
            expect(grabbed.x).toBeCloseTo(PRESS.x, 9);
            expect(grabbed.y).toBeCloseTo(PRESS.y, 9);
        }
        const last = results.findLast((result) => result.rect !== null);
        expect(last?.rect).toMatchObject({width: 380, height: 260});
        expect(results.at(-1)).toEqual({rect: null, settling: false});
    });

    it("离终点不到 `stillPx` 就是终点：拿起时就差一点的，第一帧就到", () => {
        const [first] = run(createDragCard({left: 0, top: 0, right: 380.05, bottom: 260}, {x: 0, y: 0}, COMPACT), 1, {pointerAt: () => ({x: 0, y: 0})});
        expect(first).toEqual({rect: {x: -40, y: -30, width: 380, height: 260}, settling: false});
    });

    it("尺寸按 `refreshMs` 隔着写，位置每帧跟手", () => {
        const results = run(createDragCard(FROM, PRESS, COMPACT), 8, {refreshMs: 1000 / 30, pointerAt: (index) => ({x: PRESS.x + index, y: PRESS.y})});
        expect(results.every((result) => result.rect !== null)).toBe(true);
        // 60Hz 的帧、每秒 30 次：尺寸在偶数帧写，写的是那一帧逼近到的值（600、531.9、484.9、452.4，手算）；奇数帧还是上一次的。
        expect(results.map((result) => result.rect?.width)).toEqual([600, 600, 532, 532, 485, 485, 452, 452]);
        // 抓住的点（正中）每帧都跟着指针。
        expect(results.map((result) => (result.rect === null ? null : result.rect.x + ORIGIN.x + 0.5 * result.rect.width))).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((index) => PRESS.x + index));
    });

    it("帧的时间戳有抖动：离该写尺寸的时刻差 `refreshSlackMs` 以内也写；设成 0 就等到时刻", () => {
        const steps = (slack?: number) => {
            const card = createDragCard(FROM, PRESS, COMPACT, slack === undefined ? {} : {refreshSlackMs: slack});
            // 每秒 30 次：拿起之后下一次该写在 33.3ms；帧落在 16ms、31.5ms（间隔 16、15.5）。
            return [[0, 16], [16, 16], [31.5, 15.5]].map(([now, elapsed]) => card.step({now: now as number, elapsed: elapsed as number, pointer: PRESS, origin: ORIGIN, target: COMPACT, refreshMs: 1000 / 30}));
        };
        // 缺省差 2ms 以内算到了：31.5 离 33.3 差 1.8，写；尺寸是两帧逼近到的 535.0（手算）。
        expect(steps().map((result) => result.rect?.width ?? null)).toEqual([600, null, 535]);
        expect(steps(0).map((result) => result.rect?.width ?? null)).toEqual([600, null, null]);
    });

    it("尺寸已经是目标、只剩追赶：还要帧，追完才停", () => {
        const results = run(createDragCard({left: 100, top: 100, right: 480, bottom: 360}, {x: 600, y: 120}, COMPACT), 200, {pointerAt: () => ({x: 600, y: 120})});
        expect(results[0]).toMatchObject({rect: {width: 380, height: 260}, settling: true});
        expect(results.every((result) => result.rect === null || result.rect.width === 380)).toBe(true);
        expect(results.at(-1)).toEqual({rect: null, settling: false});
    });

    it("尺寸到了终点那一帧马上写，不等间隔", () => {
        const dt = 1000 / 60;
        const results = run(createDragCard(FROM, PRESS, COMPACT), 120, {refreshMs: 1000, dt});
        const written = results.flatMap((result, index) => (result.rect === null ? [] : [{index, width: result.rect.width}]));
        // 间隔一秒：拿起那一次之后，下一次写尺寸是到终点那一帧（离目标不到 0.1，约 0.7 秒），不等到一秒。
        expect(written.map((item) => item.width)).toEqual([600, 380]);
        expect((written[1]?.index ?? Infinity) * dt).toBeLessThan(1000);
        expect(results.at(-1)).toEqual({rect: null, settling: false});
    });

    it("拿起时指针在矩形外：抓住的点夹在卡片边上，卡片从矩形的位置追到指针下", () => {
        const pointer = {x: 800, y: 120};
        const results = run(createDragCard(FROM, pointer, COMPACT), 200, {pointerAt: () => pointer});
        // 抓点夹在右边：拿起那一帧卡片还在矩形上。
        expect(results[0]?.rect).toMatchObject({x: FROM.left - ORIGIN.x, y: FROM.top - ORIGIN.y});
        // 追赶和尺寸一起逼近：第一帧追赶量 −100 走到 −100×0.831 ≈ −83.1，宽 562.8 画成 563，x = 800 − 40 − 563 − 83.1 ≈ 113.9（手算）。
        expect(results[1]?.rect?.width).toBe(563);
        expect(results[1]?.rect?.x).toBeCloseTo(113.9, 1);
        const last = results.findLast((result) => result.rect !== null)?.rect;
        if (last === undefined || last === null) throw new Error("应当写过矩形");
        // 追完了：卡片的右沿在指针下。
        expect(last.x + ORIGIN.x + last.width).toBe(pointer.x);
        expect(results.at(-1)).toEqual({rect: null, settling: false});
    });

    it("量不到的矩形（宽为 0、null）：按 `fallback` 拿起，抓在上沿中点，不追赶", () => {
        for (const from of [{left: 100, top: 100, right: 100, bottom: 500}, {left: 100, top: 100, right: 700, bottom: 100}, {left: 100, top: 100, right: 700, bottom: Number.POSITIVE_INFINITY}, {left: 700, top: 100, right: 100, bottom: 500}, null]) {
            const [first] = run(createDragCard(from, PRESS, COMPACT), 1);
            expect(first).toEqual({rect: {x: PRESS.x - ORIGIN.x - 190, y: PRESS.y - ORIGIN.y, width: 380, height: 260}, settling: false});
        }
    });

    it("缩放中目标变了（指针回到来源面板里）：从此刻的尺寸转向新目标", () => {
        const card = createDragCard(FROM, PRESS, COMPACT);
        run(card, 4);
        // 三帧之后是 506.2×340.3（手算）；再一帧按 600×400 走：506.2 + 93.8×0.169 ≈ 522.1，340.3 + 59.7×0.169 ≈ 350.4。
        const [next] = run(card, 1, {start: 4 * (1000 / 60), target: {width: 600, height: 400}});
        expect(next?.rect).toMatchObject({width: 522, height: 350});
        expect(next?.settling).toBe(true);
    });

    it("宽不是有限数的矩形也当量不到", () => {
        const [first] = run(createDragCard({left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: 500}, PRESS, COMPACT), 1);
        expect(first).toEqual({rect: {x: PRESS.x - ORIGIN.x - 190, y: PRESS.y - ORIGIN.y, width: 380, height: 260}, settling: false});
    });

    it("`tauMs`：时间常数越小缩得越快", () => {
        const fast = createDragCard(FROM, PRESS, COMPACT, {tauMs: 1});
        // 一帧 16.7ms 是 16.7 个时间常数：第一帧之后离目标只剩 220·e^(−16.7)，画出来已经是 380；`stillPx` 按逼近之前的值判，下一帧取终点、不再要帧。
        const [, first, second] = run(fast, 3);
        expect(first).toMatchObject({rect: {width: 380, height: 260}, settling: true});
        expect(second).toEqual({rect: null, settling: false});
    });

    it("`elapsed` 为负或不是有限数：这一帧不逼近", () => {
        const card = createDragCard(FROM, PRESS, COMPACT);
        run(card, 1);
        for (const elapsed of [-16, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(card.step({now: 16, elapsed, pointer: PRESS, origin: ORIGIN, target: COMPACT})).toEqual({rect: null, settling: true});
        }
    });
});
