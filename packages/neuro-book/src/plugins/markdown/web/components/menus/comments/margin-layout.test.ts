/** 槽位的高度范围（docs/specs/workbench/markdown-editing.md 输出 33、验收 22）：纯几何，没有 DOM。 */
import {describe, expect, it} from "bun:test";

import {MIN_CAP_LINES, slotRange, SLOT_GAP} from "./margin-layout";

const METRICS = {oneLine: 36, minCap: MIN_CAP_LINES * 22 + 14};

describe("槽位的高度范围", () => {
    it("下一段有批注：最小与最大都是这一段的高度（减去槽位之间的空）", () => {
        expect(slotRange({top: 100, height: 120, nextBottom: 300, nextCommented: true}, METRICS)).toEqual({min: 120 - SLOT_GAP, max: 120 - SLOT_GAP});
    });

    it("下一段没有批注：最大放宽到两倍段高；下一段更矮时不越过它的底边", () => {
        expect(slotRange({top: 100, height: 120, nextBottom: 500, nextCommented: false}, METRICS)).toEqual({min: 116, max: 240 - SLOT_GAP});
        // 下一段只有 40 高：底边在 100 + 120 + 16 + 40 = 276，比两倍段高（340）近。
        expect(slotRange({top: 100, height: 120, nextBottom: 276, nextCommented: false}, METRICS)).toEqual({min: 116, max: 176 - SLOT_GAP});
    });

    it("没有下一段：放宽到两倍段高，不受底边限制", () => {
        expect(slotRange({top: 100, height: 120, nextBottom: null, nextCommented: false}, METRICS).max).toBe(240 - SLOT_GAP);
    });

    it("一行的短段：至少放得下一行意见，卡片比这一段高", () => {
        const range = slotRange({top: 100, height: 28, nextBottom: 200, nextCommented: true}, METRICS);
        expect(range).toEqual({min: 36, max: 36});
    });

    it("很高的段：最小高度封顶，最大仍是段高；下一段没有批注时放宽，但最小不变", () => {
        const tall = {top: 0, height: 600, nextBottom: 1400, nextCommented: true};
        expect(slotRange(tall, METRICS)).toEqual({min: METRICS.minCap, max: 600 - SLOT_GAP});
        expect(slotRange({...tall, nextCommented: false}, METRICS)).toEqual({min: METRICS.minCap, max: 1200 - SLOT_GAP});
    });

    it("最大不会小于最小", () => {
        const range = slotRange({top: 0, height: 10, nextBottom: 12, nextCommented: false}, METRICS);
        expect(range.max).toBeGreaterThanOrEqual(range.min);
    });
});
