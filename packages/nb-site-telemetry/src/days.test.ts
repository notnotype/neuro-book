import {describe, expect, it} from "bun:test";

import {formatIsoWeek, formatServerDay, heartbeatSegmentAt, isoWeekMonday, isoWeekOf, serverDayAt} from "./days";

const at = (iso: string): number => Date.parse(iso);

describe("服务端日与心跳段（site.telemetry-ingest 输出 2）", () => {
    it("服务端日按 UTC 切，一天的最后一毫秒仍是这一天", () => {
        expect(formatServerDay(serverDayAt(at("2026-11-24T00:00:00.000Z")))).toBe("2026-11-24");
        expect(formatServerDay(serverDayAt(at("2026-11-24T23:59:59.999Z")))).toBe("2026-11-24");
        expect(formatServerDay(serverDayAt(at("2026-11-25T00:00:00.000Z")))).toBe("2026-11-25");
        expect(serverDayAt(at("2026-11-25T00:00:00.000Z")) - serverDayAt(at("2026-11-24T23:59:59.999Z"))).toBe(1);
    });

    it("心跳段每 15 分钟一段，段的边界按 UTC 对齐", () => {
        const start = heartbeatSegmentAt(at("2026-11-24T10:00:00.000Z"));
        expect(heartbeatSegmentAt(at("2026-11-24T10:14:59.999Z"))).toBe(start);
        expect(heartbeatSegmentAt(at("2026-11-24T10:15:00.000Z"))).toBe(start + 1);
        expect(heartbeatSegmentAt(at("2026-11-25T10:00:00.000Z")) - start).toBe(96);
    });
});

describe("ISO 周", () => {
    const day = (iso: string): number => serverDayAt(at(`${iso}T12:00:00Z`));

    it("年底与年初的几天按周四所在的年份归周", () => {
        // 2024-12-30 是周一，那一周的周四在 2025 年：属于 2025-W01。
        expect(formatIsoWeek(day("2024-12-30"))).toBe("2025-W01");
        // 2027-01-01 是周五，那一周的周四在 2026 年；2026 年有 53 周。
        expect(formatIsoWeek(day("2027-01-01"))).toBe("2026-W53");
        expect(formatIsoWeek(day("2027-01-04"))).toBe("2027-W01");
        expect(formatIsoWeek(day("2026-01-01"))).toBe("2026-W01");
        expect(formatIsoWeek(day("2025-12-28"))).toBe("2025-W52");
        expect(isoWeekOf(day("2020-12-31"))).toEqual({year: 2020, week: 53});
    });

    it("一周的周一与写法互相对得上，没有第 53 周的年份写 W53 时为 null", () => {
        expect(isoWeekMonday(2025, 1)).toBe(day("2024-12-30"));
        expect(isoWeekMonday(2026, 53)).toBe(day("2026-12-28"));
        expect(isoWeekMonday(2025, 53)).toBeNull();
        expect(isoWeekMonday(2027, 53)).toBeNull();
        for (let offset = 0; offset < 800; offset += 1) {
            const d = day("2024-01-01") + offset;
            const {year, week} = isoWeekOf(d);
            const monday = isoWeekMonday(year, week);
            expect(monday !== null && d - monday >= 0 && d - monday < 7).toBe(true);
        }
    });

    it("百年以内的年份照常算，不被当成 1900 年代", () => {
        expect(isoWeekMonday(50, 1)).not.toBe(isoWeekMonday(1950, 1));
        expect(isoWeekOf(isoWeekMonday(50, 10)!)).toEqual({year: 50, week: 10});
    });
});
