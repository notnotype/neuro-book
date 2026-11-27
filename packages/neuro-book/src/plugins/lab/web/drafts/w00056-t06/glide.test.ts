import {describe, expect, test} from "bun:test";

import type {Point} from "./desk";
import {glidePath, glideTime} from "./glide";

const samplesOf = (path: ReturnType<typeof glidePath>, count = 200): Point[] => Array.from({length: count + 1}, (_, index) => path.at(index / count));

/** 点到线段的距离。 */
function toSegment(point: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

describe("演示指针走的路", () => {
    test("从起点出发、到终点停下", () => {
        const path = glidePath({x: 100, y: 300}, {x: 700, y: 260}, [{x: 400, y: 120}]);
        expect(path.at(0)).toEqual({x: 100, y: 300});
        const end = path.at(1);
        expect(end.x).toBeCloseTo(700, 6);
        expect(end.y).toBeCloseTo(260, 6);
    });

    test("没有路点时是一道往上拱的弧，弦高约一成", () => {
        const from = {x: 100, y: 400};
        const to = {x: 700, y: 400};
        const highest = Math.min(...samplesOf(glidePath(from, to)).map((point) => point.y));
        const sagitta = from.y - highest;
        expect(sagitta).toBeGreaterThan(600 * 0.08);
        expect(sagitta).toBeLessThan(600 * 0.14);
    });

    test("有路点时拐角是圆弧，整条路不出走廊：先沿标签条往右，再往下落进右缘", () => {
        // 第一幕“两章并排”那一拖：标签在条里，落点在正文右缘的正下方。
        const tab = {x: 600, y: 58};
        const corner = {x: 950, y: 58};
        const drop = {x: 950, y: 400};
        const points = samplesOf(glidePath(tab, drop, [corner]));
        for (const point of points) {
            expect(point.y).toBeGreaterThanOrEqual(58 - 1e-6);
            expect(point.x).toBeLessThanOrEqual(950 + 1e-6);
            expect(Math.min(toSegment(point, tab, corner), toSegment(point, corner, drop))).toBeLessThan(45);
        }
        // 拐角处不是直角：路离拐角那一点最近也有一段距离。
        const nearest = Math.min(...points.map((point) => Math.hypot(point.x - corner.x, point.y - corner.y)));
        expect(nearest).toBeGreaterThan(30);
    });

    test("按弧长取点：进度均匀时走得均匀，路点处不停", () => {
        const path = glidePath({x: 600, y: 58}, {x: 950, y: 400}, [{x: 950, y: 58}]);
        const stride = (fraction: number): number => {
            const a = path.at(fraction);
            const b = path.at(fraction + 0.02);
            return Math.hypot(b.x - a.x, b.y - a.y);
        };
        const expected = path.length * 0.02;
        for (const fraction of [0.05, 0.3, 0.48, 0.5, 0.52, 0.7, 0.95]) expect(Math.abs(stride(fraction) - expected) / expected).toBeLessThan(0.05);
    });

    test("时长随路长，短路不一闪而过、长路封顶", () => {
        expect(glideTime(40, "drag")).toBe(520);
        expect(glideTime(500, "drag")).toBe(750);
        expect(glideTime(1600, "drag")).toBe(950);
        expect(glideTime(20, "reach")).toBe(280);
        expect(glideTime(2000, "reach")).toBe(620);
    });
});
