import {describe, expect, test} from "bun:test";

import {ageAt, assembleNetwork, browse, chapterHull, compileCalendar, dateRange, DEFAULT_FUZZY, during, formatRange, formatSpan, GREGORIAN, lowerStatement, placementMismatches, solveNetwork, timeParts, type Statement} from "../src/index";

const compiled = compileCalendar(GREGORIAN);
const author = {kind: "author"} as const;
const DAY = 1440;

/** 按安放的先后给事件与说法，组网并求解。 */
function solve(events: readonly {id: string; when: Statement[]}[], bodyOf: (id: string) => string = (id) => id) {
    const assembled = assembleNetwork({events: events.map((event) => ({id: event.id, statements: event.when.map((statement, index) => ({ref: `${event.id}#${String(index)}`, lowered: lowerStatement(statement, compiled, DEFAULT_FUZZY)}))})), exists: () => true, bodyOf});
    return {assembled, network: solveNetwork(assembled)};
}
const ymd = (tick: number) => {
    const parts = timeParts(compiled, tick);
    return [parts.year, parts.month.id, parts.day];
};

describe("canon.time 验收 2：粗略与年龄", () => {
    const events = [
        {id: "birth", when: [{kind: "birth", who: "xia", basis: author}, {kind: "date", year: 1997, month: "m3", day: 1, basis: author}] as Statement[]},
        {id: "fifteen", when: [{kind: "age", who: "xia", years: {min: 15, max: 15}, basis: author}] as Statement[]},
        {id: "june", when: [{kind: "date", year: 2012, month: "m6", basis: author}] as Statement[]},
    ];

    test("“十五岁那年”从 2012 年 2 月底起、到 2013 年 3 月初止；问年龄答 15 岁；定在 2012 年 6 月、没有年龄说法的事也答 15 岁", () => {
        const {assembled, network} = solve(events);
        const range = network.range("fifteen");
        if (range.state !== "ok") throw new Error(range.state);
        expect([ymd(range.lo), ymd(range.hi)]).toEqual([[2012, "m2", 28], [2013, "m3", 1]]);
        expect(ageAt(network, compiled, "fifteen", [{min: 15, max: 15}], assembled.births.get("xia")!)).toEqual({kind: "years", min: 15, max: 15});
        expect(ageAt(network, compiled, "june", [], assembled.births.get("xia")!)).toEqual({kind: "years", min: 15, max: 15});
        expect(ageAt(network, compiled, "june", [], [])).toEqual({kind: "unknown"});
    });
});

describe("canon.time 验收 6、输出 12：几条年龄说法", () => {
    test("15 岁与 16 岁两条：答 15 到 16 岁并提示；十五六岁与十五岁：答 15 岁；没有出生事件的人照样按说法答", () => {
        const {network} = solve([{id: "e", when: []}]);
        expect(ageAt(network, compiled, "e", [{min: 15, max: 15}, {min: 16, max: 16}], [])).toEqual({kind: "years", min: 15, max: 16, disagree: true});
        expect(ageAt(network, compiled, "e", [{min: 15, max: 16}, {min: 15, max: 15}], [])).toEqual({kind: "years", min: 15, max: 15});
    });

    test("还没出生；没有上界时至少 k 岁；几件出生事件答不知道", () => {
        const {network} = solve([
            {id: "b", when: [{kind: "date", year: 2000, month: "m1", day: 1, basis: author}]},
            {id: "before", when: [{kind: "date", year: 1990, basis: author}]},
            {id: "later", when: [{kind: "after", of: "b", gap: {min: 20, unit: "year"}, basis: author}]},
        ]);
        expect(ageAt(network, compiled, "before", [], ["b"])).toEqual({kind: "notBorn"});
        // 下界是连续 20 年的最短；连续 20 年的最长多一天，按 Spec 不看起点的上下界，19 岁也说得通。
        expect(ageAt(network, compiled, "later", [], ["b"])).toEqual({kind: "atLeast", min: 19});
        expect(ageAt(network, compiled, "later", [], ["b", "before"])).toEqual({kind: "unknown", reason: "birth-ambiguous"});
    });
});

describe("canon.time 输出 5、验收 4：安放与时间对不上", () => {
    test("第 3 章的事在第 5 章的事之后十年：第 5 章那件安放得太晚；把它挪进前史（安放到最前）以后消失", () => {
        const ch3 = {id: "ch3", when: [{kind: "after", of: "ch5", gap: {min: 10, max: 10, unit: "year"}, basis: author}] as Statement[]};
        const ch5 = {id: "ch5", when: [] as Statement[]};
        const placed = solve([ch3, ch5]);
        expect(placementMismatches(placed.network, placed.assembled.constraints)).toEqual([{event: "ch5", partner: "ch3", count: 1, criterion: "range"}]);
        const moved = solve([ch5, ch3]);
        expect(placementMismatches(moved.network, moved.assembled.constraints)).toEqual([]);
    });

    test("范围重叠、说法直接写了先后：也算；无穷的一端照常比；一件被安放得太早的事让后面几件各成一项、各带件数", () => {
        const statementOnly = solve([
            {id: "x", when: [{kind: "date", year: 2020, month: "m6", basis: author}, {kind: "after", of: "y", gap: {min: 3, max: 3, unit: "day"}, basis: author}]},
            {id: "y", when: [{kind: "date", year: 2020, month: "m6", basis: author}]},
        ]);
        expect(placementMismatches(statementOnly.network, statementOnly.assembled.constraints)).toEqual([{event: "y", partner: "x", count: 1, criterion: "statement"}]);
        // 只有说法判据成立、有两件：代表取最早时间最晚的那件，件数是 2。
        const two = solve([
            {id: "p", when: [{kind: "date", year: 2020, month: "m6", basis: author}, {kind: "after", of: "b", gap: {min: 1, max: 1, unit: "day"}, basis: author}]},
            {id: "q", when: [{kind: "date", year: 2020, month: "m6", basis: author}, {kind: "after", of: "b", gap: {min: 2, max: 2, unit: "day"}, basis: author}]},
            {id: "b", when: [{kind: "date", year: 2020, month: "m6", basis: author}]},
        ]);
        expect(placementMismatches(two.network, two.assembled.constraints)).toEqual([{event: "b", partner: "q", count: 2, criterion: "statement"}]);
        // 在 X 结束前一天之前：只推得出早于 X 的终点，推不出早于 X 的起点，不算对不上。
        const beforeEnd = solve([
            {id: "x", when: [{kind: "lasts", lasts: {min: 5, max: 5, unit: "day"}, basis: author}]},
            {id: "e", when: [{kind: "before", of: "x", edge: "end", gap: {min: 1, unit: "day"}, basis: author}]},
        ]);
        expect(placementMismatches(beforeEnd.network, beforeEnd.assembled.constraints)).toEqual([]);
        const unbounded = solve([
            {id: "late", when: [{kind: "after", of: "anchor", gap: {min: 10, unit: "year"}, basis: author}]},
            {id: "anchor", when: [{kind: "date", year: 1990, basis: author}]},
            {id: "early", when: [{kind: "before", of: "anchor", basis: author}]},
        ]);
        expect(placementMismatches(unbounded.network, unbounded.assembled.constraints).map((item) => [item.event, item.count])).toEqual([["anchor", 1], ["early", 1]]);
        const tooEarly = solve([
            {id: "future", when: [{kind: "date", year: 2030, basis: author}]},
            {id: "a", when: [{kind: "date", year: 2001, basis: author}]},
            {id: "b", when: [{kind: "date", year: 2002, basis: author}]},
        ]);
        expect(placementMismatches(tooEarly.network, tooEarly.assembled.constraints).map((item) => [item.event, item.partner, item.count])).toEqual([["a", "future", 1], ["b", "future", 1]]);
    });
});

describe("canon.time 输出 8：查询与格式化", () => {
    test("精度到两端落在同一个单位里的最细一级；跨年写两端到日；无穷的一端写之前、之后；时长写成天时分", () => {
        const june = dateRange(compiled, {year: 2012, month: "m6"}) as {lo: number; hi: number};
        // 同时给结构化的各级（精度与文字相同）。
        expect(formatRange(compiled, june.lo, june.hi)).toEqual({text: "公元2012年6月", level: "month", from: {year: 2012, era: {id: "ad", name: "公元", year: 2012}, month: {id: "m6", name: "6月"}}, to: {year: 2012, era: {id: "ad", name: "公元", year: 2012}, month: {id: "m6", name: "6月"}}});
        const day = dateRange(compiled, {year: 2012, month: "m6", day: 3}) as {lo: number; hi: number};
        expect(formatRange(compiled, day.lo, day.hi).text).toBe("公元2012年6月3日");
        expect(formatRange(compiled, june.lo, day.hi + 400 * DAY).text).toBe("公元2012年6月1日至公元2013年7月8日");
        expect(formatRange(compiled, june.lo, Number.POSITIVE_INFINITY)).toMatchObject({text: "公元2012年6月1日之后", from: {year: 2012, month: {id: "m6"}, day: 1}});
        expect(formatRange(compiled, june.lo, Number.POSITIVE_INFINITY).to).toBeUndefined();
        expect(formatRange(compiled, 0, 0).text).toBe("公元前1年1月1日0时0分");
        expect(formatSpan(compiled, 3 * DAY + 90)).toBe("3天1时30分");
    });

    test("一章合起来的范围与定下两端的事、一段时间里一定与可能的事、按纪年月日逐级的数目", () => {
        const {network} = solve([
            {id: "a", when: [{kind: "date", year: 2012, month: "m6", day: 3, basis: author}]},
            {id: "b", when: [{kind: "date", year: 2012, month: "m6", basis: author}]},
            {id: "c", when: [{kind: "after", of: "d", basis: author}]},
            {id: "d", when: []},
        ]);
        const june = dateRange(compiled, {year: 2012, month: "m6"}) as {lo: number; hi: number};
        expect(chapterHull(network, ["a", "b", "c"])).toEqual({range: {lo: june.lo, hi: june.hi}, earliestBy: "b", latestBy: "b", anchored: 2, unanchored: 1, conflict: 0});
        const third = dateRange(compiled, {year: 2012, month: "m6", day: 3}) as {lo: number; hi: number};
        expect(during(network, third.lo, third.hi)).toEqual({sure: ["a"], maybe: ["b"]});
        const units = (path: Parameters<typeof browse>[2]) => {
            const result = browse(network, compiled, path);
            return result === "not-found" ? [] : result.units.map((unit) => [unit.key, unit.sure, unit.maybe]);
        };
        expect(units({})).toEqual([["ad", 2, 0]]);
        expect(units({era: "ad"})).toEqual([[2012, 2, 0]]);
        expect(units({year: 2012})).toEqual([[5, 2, 0]]);
        expect(units({year: 2012, month: 5})).toEqual([[3, 1, 1], ...Array.from({length: 29}, (_, index) => [index + 1 + (index >= 2 ? 1 : 0), 0, 1]).filter(([key]) => key !== 3)].sort((x, y) => (x[0] as number) - (y[0] as number)));
        expect(browse(network, compiled, {era: "nope"})).toBe("not-found");
    });

    test("逐级浏览：跨几百年的一件事不挤掉别的年，按时间先后取前 200 个并给总数；纪之前的年合成一个单位", () => {
        const {network} = solve([
            {id: "anchor", when: [{kind: "date", year: 2000, basis: author}]},
            {id: "wide", when: [{kind: "after", of: "anchor", gap: {min: 0, max: 300, unit: "year"}, basis: author}]},
            {id: "old", when: [{kind: "date", year: 1500, month: "m3", basis: author}]},
            {id: "bc", when: [{kind: "date", year: -5, basis: author}]},
        ]);
        const top = browse(network, compiled, {});
        expect(top !== "not-found" && top.units.map((unit) => [unit.key, unit.sure, unit.maybe])).toEqual([[null, 1, 0], ["ad", 3, 0]]);
        const years = browse(network, compiled, {era: "ad"});
        if (years === "not-found") throw new Error("no era");
        expect(years.units[0]).toMatchObject({key: 1500, sure: 1});
        expect(years.units[1]).toMatchObject({key: 2000, sure: 1, maybe: 1});
        expect(years.units).toHaveLength(200);
        // 宽的那件按全局的最长 300 年算上界（可能进到 2301 年初）：总数是 1500 年加 2000 年到它的上界所在的那一年。
        const wide = network.bounds("wide");
        if (wide.state !== "ok") throw new Error("no range");
        expect(years.total).toBe(1 + (timeParts(compiled, wide.hi).year - 2000 + 1));
    });
});

describe("canon.time 输出 12（补）：所在分量不可确定", () => {
    test("事件的分量不可确定：没有年龄说法时答不可确定（先于没有出生事件的“不知道”）；有年龄说法时仍按说法答，不看网络", () => {
        const {network} = solve([
            {id: "b", when: [{kind: "date", year: 2000, month: "m1", day: 1, basis: author}]},
            {id: "e", when: [{kind: "date", year: 2005, basis: author}, {kind: "date", year: 2010, basis: author}]},
        ]);
        expect(network.bounds("e").state).toBe("conflict");
        expect(ageAt(network, compiled, "e", [], ["b"])).toEqual({kind: "conflict"});
        expect(ageAt(network, compiled, "e", [], [])).toEqual({kind: "conflict"});
        expect(ageAt(network, compiled, "e", [{min: 7, max: 7}], [])).toEqual({kind: "years", min: 7, max: 7});
    });
});
