import {describe, test, expect} from "vitest";
import {CustomCalendar, normalizeCustomCalendarConfig} from "nbook/server/world-engine/calendars/custom";

describe("CustomCalendar", () => {
    test("基础配置归一化", () => {
        const config = normalizeCustomCalendarConfig({
            type: "custom",
            format: (instant: bigint) => `时刻${instant}`,
            parse: (input: string) => BigInt(input.replace("时刻", "")),
        });

        expect(config.type).toBe("custom");
        expect(typeof config.format).toBe("function");
        expect(typeof config.parse).toBe("function");
    });

    test("format: 调用用户函数", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => `自定义历${Number(instant) + 1}年`,
            parse: (input: string) => BigInt(Number(input.replace(/\D/g, "")) - 1),
        });

        const result = calendar.format(BigInt(0));
        expect(result).toBe("自定义历1年");

        const result2 = calendar.format(BigInt(99));
        expect(result2).toBe("自定义历100年");
    });

    test("parse: 调用用户函数", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => `时刻${instant}`,
            parse: (input: string) => BigInt(input.replace("时刻", "")),
        });

        const instant = calendar.parse("时刻12345");
        expect(instant).toBe(BigInt(12345));
    });

    test("parse: 往返转换", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => `T:${instant}`,
            parse: (input: string) => BigInt(input.replace("T:", "")),
        });

        const instant = BigInt(9876543210);
        const formatted = calendar.format(instant);
        const parsed = calendar.parse(formatted);
        expect(parsed).toBe(instant);
    });

    test("projection: 使用用户提供的 projection", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => `时刻${instant}`,
            parse: (input: string) => BigInt(0),
            projection: () => ({
                format: "时刻{instant}",
                examples: ["时刻0", "时刻1000"],
            }),
        });

        const proj = calendar.projection();
        expect(proj.format).toBe("时刻{instant}");
        expect(proj.examples).toEqual(["时刻0", "时刻1000"]);
    });

    test("projection: 默认 projection（无用户提供）", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => `时刻${instant}`,
            parse: (input: string) => BigInt(0),
        });

        const proj = calendar.projection();
        expect(proj.format).toBe("自定义格式");
        expect(proj.examples.length).toBe(2);
    });

    test("format 必须返回字符串", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => 123 as any, // 返回数字而不是字符串
            parse: (input: string) => BigInt(0),
        });

        expect(() => calendar.format(BigInt(0))).toThrow(/必须返回字符串/);
    });

    test("parse 必须返回 bigint", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => "x",
            parse: (input: string) => 123 as any, // 返回数字而不是 bigint
        });

        expect(() => calendar.parse("x")).toThrow(/必须返回 bigint/);
    });

    test("format 抛错时应包装", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => {
                throw new Error("用户错误");
            },
            parse: (input: string) => BigInt(0),
        });

        expect(() => calendar.format(BigInt(0))).toThrow(/用户错误/);
    });

    test("parse 抛错时应包装", () => {
        const calendar = new CustomCalendar({
            type: "custom",
            format: (instant: bigint) => "x",
            parse: (input: string) => {
                throw new Error("解析失败");
            },
        });

        expect(() => calendar.parse("x")).toThrow(/解析失败/);
    });
});
