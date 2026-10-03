import {describe, test, expect} from "vitest";
import {SimpleCalendar, normalizeSimpleCalendarConfig} from "nbook/server/world-engine/calendars/simple";

describe("SimpleCalendar", () => {
    test("基础配置归一化", () => {
        const config = normalizeSimpleCalendarConfig({
            type: "simple",
            eraBefore: "蒙昧纪元",
            eraAfter: "新生纪元",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
        });

        expect(config.type).toBe("simple");
        expect(config.eraBefore).toBe("蒙昧纪元");
        expect(config.eraAfter).toBe("新生纪元");
        expect(config.units.length).toBe(5);
    });

    test("format: instant=0 应输出 1年1月1日", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "蒙昧纪元",
            eraAfter: "新生纪元",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
        });

        const result = calendar.format(BigInt(0));
        expect(result).toBe("新生纪元1年1月1日 00:00:00");
    });

    test("format: instant < 0 应输出 eraBefore", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "公元前",
            eraAfter: "公元",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{eraName}{year}年{month}月{day}日",
        });

        const result = calendar.format(BigInt(-1));
        expect(result).toContain("公元前");
    });

    test("cycleNames 长度必须等于 ratio", () => {
        expect(() =>
            normalizeSimpleCalendarConfig({
                type: "simple",
                eraBefore: "前",
                eraAfter: "后",
                baseUnit: "second",
                units: [
                    {name: "minute", parent: "second", ratio: 60},
                    {
                        name: "week",
                        parent: "minute",
                        ratio: 7,
                        cycleNames: ["周一", "周二"], // 长度不匹配
                    },
                ],
                format: "{year}",
            }),
        ).toThrow(/cycleNames 长度/);
    });

    test("units 不能为空", () => {
        expect(() =>
            normalizeSimpleCalendarConfig({
                type: "simple",
                eraBefore: "前",
                eraAfter: "后",
                baseUnit: "second",
                units: [],
                format: "{year}",
            }),
        ).toThrow(/units 不能为空/);
    });

    test("ratio 必须是正整数", () => {
        expect(() =>
            normalizeSimpleCalendarConfig({
                type: "simple",
                eraBefore: "前",
                eraAfter: "后",
                baseUnit: "second",
                units: [{name: "minute", parent: "second", ratio: 0}],
                format: "{year}",
            }),
        ).toThrow(/ratio 必须是正整数/);
    });

    test("week token: {week} / {weekName} / {weekOfDay} / {weekOfMonth}", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "前",
            eraAfter: "后",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {
                    name: "week",
                    parent: "day",
                    ratio: 7,
                    cycleNames: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
                    startOffset: 0,
                },
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{year}年{month}月{day}日 {week} 第{weekOfMonth}周 第{weekOfDay}天",
        });

        const result = calendar.format(BigInt(0));
        expect(result).toContain("周一"); // instant=0, totalDays=0, (0+0)%7+1=1 → 周一
        expect(result).toContain("第1周"); // dayOfMonth=1, floor((1-1)/7)+1=1
        expect(result).toContain("第1天"); // weekOfDay=1
    });

    test("parse: 基础往返转换", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "公元前",
            eraAfter: "公元",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
        });

        const instant = calendar.parse("公元1年1月1日 00:00:00");
        expect(instant).toBe(BigInt(0));

        const formatted = calendar.format(instant);
        expect(formatted).toBe("公元1年1月1日 00:00:00");
    });

    test("parse: 非零时间往返", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "前",
            eraAfter: "后",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
        });

        const input = "后2年5月15日 14:30:45";
        const instant = calendar.parse(input);
        const formatted = calendar.format(instant);
        expect(formatted).toBe(input);
    });

    test("parse: 超出范围应报错", () => {
        const calendar = new SimpleCalendar({
            type: "simple",
            eraBefore: "前",
            eraAfter: "后",
            baseUnit: "second",
            units: [
                {name: "minute", parent: "second", ratio: 60},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "day", parent: "hour", ratio: 24},
                {name: "month", parent: "day", ratio: 30},
                {name: "year", parent: "month", ratio: 12},
            ],
            format: "{year}年{month}月{day}日",
        });

        expect(() => calendar.parse("1年13月1日")).toThrow(/month 超出范围/);
        expect(() => calendar.parse("1年1月32日")).toThrow(/day 超出范围/);
    });

    test("buildUnitChain: 拓扑排序", () => {
        const config = normalizeSimpleCalendarConfig({
            type: "simple",
            eraBefore: "前",
            eraAfter: "后",
            baseUnit: "second",
            units: [
                {name: "year", parent: "month", ratio: 12},
                {name: "month", parent: "day", ratio: 30},
                {name: "day", parent: "hour", ratio: 24},
                {name: "hour", parent: "minute", ratio: 60},
                {name: "minute", parent: "second", ratio: 60},
            ],
            format: "{year}",
        });

        const calendar = new SimpleCalendar(config);
        const formatted = calendar.format(BigInt(0));
        expect(formatted).toBe("1");
    });

    test("buildUnitChain: 孤立节点应报错", () => {
        expect(() => {
            new SimpleCalendar({
                type: "simple",
                eraBefore: "前",
                eraAfter: "后",
                baseUnit: "second",
                units: [
                    {name: "minute", parent: "second", ratio: 60},
                    {name: "hour", parent: "nonexistent", ratio: 60}, // 孤立节点
                ],
                format: "{year}",
            });
        }).toThrow(/孤立节点或环/);
    });
});
