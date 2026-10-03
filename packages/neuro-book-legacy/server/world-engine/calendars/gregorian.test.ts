import {describe, test, expect} from "vitest";
import {GregorianCalendar, normalizeGregorianCalendarConfig} from "nbook/server/world-engine/calendars/gregorian";

describe("GregorianCalendar", () => {
    test("基础配置归一化", () => {
        const config = normalizeGregorianCalendarConfig({
            type: "gregorian",
            eraBefore: "公元前",
            eraAfter: "公元",
            format: "{eraName}{year}年{month}月{day}日",
        });

        expect(config.type).toBe("gregorian");
        expect(config.eraBefore).toBe("公元前");
        expect(config.eraAfter).toBe("公元");
    });

    test("format: instant=0 应输出公元1年1月1日", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "公元前",
            eraAfter: "公元",
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}",
        });

        const result = calendar.format(BigInt(0));
        expect(result).toBe("公元1年1月1日 00:00:00");
    });

    test("闰年判断：2000年是闰年", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "BC",
            eraAfter: "AD",
            format: "{eraName}{year}-{month:02}-{day:02}",
        });

        // 2000年是闰年，2月有29天
        // 2000年1月1日 = (2000-1) 年的秒数
        const secondsIn1999Years = BigInt(1999) * BigInt(31536000) + BigInt(Math.floor(1999 / 4) - Math.floor(1999 / 100) + Math.floor(1999 / 400)) * BigInt(86400);
        const feb29_2000 = secondsIn1999Years + BigInt(31 + 28) * BigInt(86400); // 1月31天 + 2月28天 + 1天 = 2月29日

        const result = calendar.format(feb29_2000);
        expect(result).toContain("2000");
        expect(result).toContain("02"); // 2月
        expect(result).toContain("29"); // 29日
    });

    test("parse: 往返转换", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "BC",
            eraAfter: "AD",
            format: "{eraName}{year}年{month}月{day}日",
        });

        const input = "AD2024年6月23日";
        const instant = calendar.parse(input);
        const formatted = calendar.format(instant);
        expect(formatted).toBe(input);
    });

    test("parse: 默认现实日历格式到分钟且不带秒", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "公元前",
            eraAfter: "公元",
            format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}",
        });

        const input = "公元2020年4月12日 18:00";
        const instant = calendar.parse(input);
        const formatted = calendar.format(instant);

        expect(formatted).toBe(input);
    });

    test("parse: 2月29日应校验闰年", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "BC",
            eraAfter: "AD",
            format: "{eraName}{year}年{month}月{day}日",
        });

        // 2000年是闰年，2月29日合法
        expect(() => calendar.parse("AD2000年2月29日")).not.toThrow();

        // 2001年不是闰年，2月29日非法
        expect(() => calendar.parse("AD2001年2月29日")).toThrow(/日期超出范围/);
    });

    test("parse: 公元前应转换为负年份", () => {
        const calendar = new GregorianCalendar({
            type: "gregorian",
            eraBefore: "公元前",
            eraAfter: "公元",
            format: "{eraName}{year}年{month}月{day}日",
        });

        const instant = calendar.parse("公元前1年1月1日");
        expect(instant).toBeLessThan(BigInt(0));

        const formatted = calendar.format(instant);
        expect(formatted).toBe("公元前1年1月1日");
    });
});
