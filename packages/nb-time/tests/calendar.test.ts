import {describe, expect, test} from "bun:test";

import {compileCalendar, dateRange, GREGORIAN, timeParts, validateCalendar, type Calendar} from "../src/index";

/** 验收 1 的王历：一天 48 小时、12 个月各有名字、每 3 年第 12 月多 1 天；纪“王历”元年是绝对年份 1；“清晨”是 4 到 10 时。 */
const ROYAL: Calendar = {
    version: 1,
    unit: "minute",
    hoursPerDay: 48,
    minutesPerHour: 60,
    months: ["初月", "冰月", "雪月", "风月", "花月", "雨月", "夏月", "火月", "谷月", "叶月", "雾月", "霜月"].map((name, index) => ({id: `r${String(index + 1)}`, name, days: 30})),
    leap: [{every: 3, months: {r12: 31}}],
    eras: [{id: "royal", name: "王历", start: 1}],
    periods: [{id: "dawn", name: "清晨", from: 4, to: 10}, {id: "night", name: "深夜", from: 44, to: 4}],
};

const problemsOf = (raw: unknown) => {
    const result = validateCalendar(raw);
    return result.ok ? [] : result.problems.map((problem) => problem.path);
};

describe("canon.time 输出 13：历法的校验", () => {
    test("合法的历法通过；内置公历也合法", () => {
        expect(validateCalendar(ROYAL).ok).toBe(true);
        expect(validateCalendar(GREGORIAN).ok).toBe(true);
    });

    test("每一项不合规则都指出位置", () => {
        expect(problemsOf({...ROYAL, version: 0})).toEqual(["/version"]);
        expect(problemsOf({...ROYAL, unit: "second"})).toEqual(["/unit"]);
        expect(problemsOf({...ROYAL, months: [], leap: []})).toEqual(["/months"]);
        expect(problemsOf({...ROYAL, hoursPerDay: 1.5})).toEqual(["/hoursPerDay"]);
        expect(problemsOf({...ROYAL, months: [...ROYAL.months, {id: "r1", name: "重了", days: 30}]})).toEqual(["/months/12/id"]);
        expect(problemsOf({...ROYAL, months: [{id: "a", name: "甲", days: 0}], leap: []})).toEqual(["/months/0/days"]);
        expect(problemsOf({...ROYAL, leap: [{every: 0, months: {}}]})).toEqual(["/leap/0/every"]);
        expect(problemsOf({...ROYAL, leap: [{every: 3, offset: 3, months: {r12: 31}}]})).toEqual(["/leap/0/offset"]);
        expect(problemsOf({...ROYAL, leap: [{every: 3, months: {nope: 31}}]})).toEqual(["/leap/0/months/nope"]);
        expect(problemsOf({...ROYAL, leap: [{every: 3, months: {r12: -1}}]})).toEqual(["/leap/0/months/r12"]);
        expect(problemsOf({...ROYAL, eras: [{id: "a", name: "甲", start: 5}, {id: "b", name: "乙", start: 5}]})).toEqual(["/eras/1/start"]);
        expect(problemsOf({...ROYAL, eras: [{id: "a", name: "甲", start: 1}, {id: "a", name: "乙", start: 9}]})).toEqual(["/eras/1/id"]);
        expect(problemsOf({...ROYAL, periods: [{id: "p", name: "时", from: 0, to: 48}]})).toEqual(["/periods/0/to"]);
        expect(problemsOf({...ROYAL, periods: [{id: "p", name: "时", from: 0, to: 1}, {id: "p", name: "又", from: 1, to: 2}]})).toEqual(["/periods/1/id"]);
    });

    test("周期上百万年的合法历法照样校验通过（不撑爆调用栈）；月很多的历法里，日期的开头照样按前缀和算对", () => {
        expect(validateCalendar({version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: [{id: "m", name: "月", days: 30}], leap: [{every: 1_000_000, months: {m: 31}}]}).ok).toBe(true);
        const many: Calendar = {version: 1, unit: "day", hoursPerDay: 24, minutesPerHour: 60, months: Array.from({length: 100_000}, (_, i) => ({id: `m${String(i)}`, name: `${String(i)}`, days: 1 + (i % 3)}))};
        const compiled = compileCalendar(many);
        expect(compiled.monthStart(0, 99_999)).toBe(Array.from({length: 99_999}, (_, i) => 1 + (i % 3)).reduce((sum, value) => sum + value, 0));
        expect(dateRange(compiled, {year: 3, month: "m5", day: 1})).toMatchObject({lo: compiled.daysBefore(3) + compiled.monthStart(0, 5)});
    });

    test("“约”放得极大、超出时间的范围：不成立（out-of-range），不让不精确的数进网络", () => {
        const compiled = compileCalendar(GREGORIAN);
        expect(dateRange(compiled, {year: 0}, {year: Number.MAX_SAFE_INTEGER, month: 0, day: 0, hour: 0})).toEqual({invalid: "out-of-range"});
    });

    test("两条上限：闰年周期乘月数不超过两百万；一年的最小单位数乘一千万零一要小于 2^53；纪的 start 在正负一千万以内", () => {
        expect(problemsOf({...ROYAL, leap: [{every: 99991, months: {r12: 31}}, {every: 99989, months: {r12: 30}}]})).toEqual(["/leap"]);
        expect(problemsOf({...ROYAL, hoursPerDay: 10_000, minutesPerHour: 10_000})).toEqual([""]);
        expect(validateCalendar({...ROYAL, hoursPerDay: 10_000, minutesPerHour: 10_000, unit: "day"}).ok).toBe(true);
        expect(problemsOf({...ROYAL, eras: [{id: "far", name: "远", start: 10_000_001}]})).toEqual(["/eras/0/start"]);
    });
});

describe("内置公历：日序号与 JS Date 对拍", () => {
    const compiled = compileCalendar(GREGORIAN);
    // 绝对年份 0 的 1 月 1 日（天文纪年）。`Date.UTC` 把 0 到 99 年当成 1900 年起，用 setUTCFullYear 绕开。
    const utcDay = (year: number, month: number, day: number) => {
        const date = new Date(0);
        date.setUTCFullYear(year, month, day);
        date.setUTCHours(0, 0, 0, 0);
        return date.getTime() / 86_400_000;
    };
    const zero = utcDay(0, 0, 1);

    test("-4000 到 4000 年里随机两千个日期：日序号相同，拆回来也相同", () => {
        let seed = 7;
        const next = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        for (let index = 0; index < 2000; index += 1) {
            const year = Math.floor(next() * 8001) - 4000;
            const month = Math.floor(next() * 12);
            const day = 1 + Math.floor(next() * compiled.monthDays(year)[month]!);
            const ours = compiled.monthStart(year, month) + day - 1;
            expect(ours).toBe(utcDay(year, month, day) - zero);
            expect(compiled.dayParts(ours)).toEqual({year, month, day});
        }
    });

    test("闰年：2000、2024、0 年二月 29 天，1900、2100 年 28 天", () => {
        for (const year of [2000, 2024, 0]) expect(compiled.monthDays(year)[1]).toBe(29);
        for (const year of [1900, 2100, -1]) expect(compiled.monthDays(year)[1]).toBe(28);
    });
});

describe("连续 n 年（月）最短与最长（L_min、L_max）", () => {
    const brute = (calendar: Calendar, unit: "year" | "month", n: number) => {
        const compiled = compileCalendar(calendar);
        const months = calendar.months.length;
        const starts = compiled.cycle * (unit === "year" ? 1 : months);
        const lengths = Array.from({length: starts}, (_, start) => {
            if (unit === "year") return compiled.daysBefore(start + n) - compiled.daysBefore(start);
            const at = (index: number) => compiled.monthStart(Math.floor(index / months), index % months);
            return at(start + n) - at(start);
        });
        return {min: Math.min(...lengths), max: Math.max(...lengths)};
    };

    test.each([["公历", GREGORIAN], ["王历", ROYAL]] as const)("%s：0 到 30 年、0 到 40 个月，与逐个起点暴力枚举相同", (_, calendar) => {
        const compiled = compileCalendar(calendar);
        for (let n = 0; n <= 30; n += 1) expect([compiled.spanDays("year", n, "min"), compiled.spanDays("year", n, "max")]).toEqual(Object.values(brute(calendar, "year", n)));
        for (let n = 0; n <= 40; n += 1) expect([compiled.spanDays("month", n, "min"), compiled.spanDays("month", n, "max")]).toEqual(Object.values(brute(calendar, "month", n)));
    });

    test("公历：15 年最短 5477 天（跨过不闰的世纪年时只有 2 个闰年），16 年最长 5844 天（验收 2 的口径）", () => {
        const compiled = compileCalendar(GREGORIAN);
        expect([compiled.spanDays("year", 15, "min"), compiled.spanDays("year", 16, "max")]).toEqual([5477, 5844]);
    });
});

describe("canon.time 验收 1：自定义历法里的日期", () => {
    const compiled = compileCalendar(ROYAL);
    const minutes = (day: number, hour: number, minute = 0) => (day * 48 + hour) * 60 + minute;

    test("“王历 612 年霜月 5 日清晨”是那一天 4 时到 10 时之前；612 年是 3 的倍数，霜月有 31 天", () => {
        const day = compiled.monthStart(612, 11) + 4;
        expect(dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 5, period: "dawn"})).toEqual({lo: minutes(day, 4), hi: minutes(day, 10) - 1, precision: "period"});
        expect([compiled.monthDays(612)[11], compiled.monthDays(613)[11]]).toEqual([31, 30]);
        expect(dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 31})).toMatchObject({precision: "day"});
        expect(dateRange(compiled, {era: "royal", year: 613, month: "r12", day: 31})).toEqual({invalid: "day-out-of-range"});
    });

    test("跨夜的时段、给到年与月、约", () => {
        const day = compiled.monthStart(613, 0);
        expect(dateRange(compiled, {era: "royal", year: 613, month: "r1", day: 1, period: "night"})).toEqual({lo: minutes(day, 44), hi: minutes(day + 1, 4) - 1, precision: "period"});
        expect(dateRange(compiled, {year: 611})).toEqual({lo: compiled.daysBefore(611) * 48 * 60, hi: compiled.daysBefore(612) * 48 * 60 - 1, precision: "year"});
        const approx = {year: 1, month: 1, day: 2, hour: 1};
        const exact = dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 5}) as {lo: number; hi: number};
        expect(dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 5}, approx)).toEqual({lo: exact.lo - 2 * 48 * 60, hi: exact.hi + 2 * 48 * 60, precision: "day"});
    });

    test("霜月改名照常；删掉霜月不成立；纪不在、日子超出、不连续、比最小单位细都给原因", () => {
        const renamed = compileCalendar({...ROYAL, months: ROYAL.months.map((month) => (month.id === "r12" ? {...month, name: "白霜月"} : month))});
        expect(dateRange(renamed, {era: "royal", year: 612, month: "r12", day: 5})).toEqual(dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 5}));
        const removed = compileCalendar({...ROYAL, months: ROYAL.months.filter((month) => month.id !== "r12"), leap: []});
        expect(dateRange(removed, {era: "royal", year: 612, month: "r12", day: 5})).toEqual({invalid: "month-missing"});
        expect(dateRange(compiled, {era: "old", year: 1})).toEqual({invalid: "era-missing"});
        expect(dateRange(compiled, {year: 1, day: 3})).toEqual({invalid: "not-contiguous"});
        expect(dateRange(compiled, {year: 1, month: "r1", day: 1, hour: 48})).toEqual({invalid: "hour-out-of-range"});
        expect(dateRange(compileCalendar({...ROYAL, unit: "day"}), {year: 1, month: "r1", day: 1, hour: 3})).toEqual({invalid: "unit-too-fine"});
    });

    test("绝对时间拆回各级：纪与纪内年份、月、日、时、分", () => {
        const range = dateRange(compiled, {era: "royal", year: 612, month: "r12", day: 5, hour: 30, minute: 15}) as {lo: number};
        expect(timeParts(compiled, range.lo)).toMatchObject({year: 612, eraYear: 612, month: {id: "r12"}, day: 5, hour: 30, minute: 15});
        expect(timeParts(compiled, 0)).toMatchObject({year: 0, month: {id: "r1"}, day: 1});
        expect(timeParts(compiled, 0).era).toBeUndefined();
    });
});
