import {describe, expect, test} from "bun:test";

import {compileCalendar, DEFAULT_FUZZY, gapRange, GREGORIAN, lowerStatement, resolveFuzzy, validateStatements, type Calendar, type Statement} from "../src/index";

const DAY = 24 * 60;
const author = {kind: "author"} as const;
const compiled = compileCalendar(GREGORIAN);

describe("canon.time 输入表：模糊词表", () => {
    test("没设置时用内置的缺省；设置里合法的项覆盖它；不合法的项作废（不退回缺省）并给诊断", () => {
        expect(resolveFuzzy(undefined, GREGORIAN)).toEqual({table: DEFAULT_FUZZY, problems: []});
        const resolved = resolveFuzzy({words: {几天: {min: 3, max: 5, unit: "day"}, 一阵子: {min: 1, max: 3, unit: "month"}, 多年: {min: 9, max: 2, unit: "year"}, 转眼: {word: "不久"}}, approx: {day: 2, hour: -1}}, GREGORIAN);
        expect(resolved.table.words.几天).toEqual({min: 3, max: 5, unit: "day"});
        expect(resolved.table.words.一阵子).toEqual({min: 1, max: 3, unit: "month"});
        expect(resolved.table.words.多年).toBeUndefined();
        expect(resolved.table.words.转眼).toBeUndefined();
        expect(resolved.table.approx).toEqual({year: 1, month: 1, day: 2, hour: 1});
        expect(resolved.problems.map((problem) => problem.path)).toEqual(["/words/多年", "/words/转眼", "/approx/hour"]);
    });

    test("单位比历法的最小单位细的项作废", () => {
        const dayCalendar: Calendar = {...GREGORIAN, unit: "day"};
        expect(resolveFuzzy({words: {片刻: {max: 2, unit: "hour"}}}, dayCalendar).problems.map((problem) => problem.path)).toEqual(["/words/片刻"]);
    });
});

describe("canon.time 输入表：间隔", () => {
    test("分、时、日按固定长度；年、月取连续 n 年（月）的最短与最长；max 缺省无穷；词按词表换", () => {
        expect(gapRange(compiled, DEFAULT_FUZZY, {min: 3, max: 3, unit: "day"})).toEqual({lo: 3 * DAY, hi: 3 * DAY});
        expect(gapRange(compiled, DEFAULT_FUZZY, {min: 2, unit: "hour"})).toEqual({lo: 120, hi: Number.POSITIVE_INFINITY});
        expect(gapRange(compiled, DEFAULT_FUZZY, {min: 1, max: 1, unit: "year"})).toEqual({lo: 365 * DAY, hi: 366 * DAY});
        expect(gapRange(compiled, DEFAULT_FUZZY, {word: "几天"})).toEqual({lo: 2 * DAY, hi: 9 * DAY});
        expect(gapRange(compiled, DEFAULT_FUZZY, {word: "好些天"})).toEqual({invalid: "word-missing"});
    });
});

describe("canon.time 输入表：说法降成约束", () => {
    const self = {kind: "event", event: "self", edge: "start"} as const;

    test("日期：元年到这件事的起点；约按给到的那一级放宽", () => {
        const day = compiled.monthStart(2012, 5) + 2;
        expect(lowerStatement({kind: "date", year: 2012, month: "m6", day: 3, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: {kind: "origin"}, to: self, lo: day * DAY, hi: (day + 1) * DAY - 1}]});
        expect(lowerStatement({kind: "date", year: 2012, month: "m6", day: 3, approx: true, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: {kind: "origin"}, to: self, lo: (day - 1) * DAY, hi: (day + 2) * DAY - 1}]});
    });

    test("之后与之前：of 的哪一端、间隔；之前是 of 那一端减这件事", () => {
        expect(lowerStatement({kind: "after", of: "c1", edge: "end", gap: {min: 3, max: 3, unit: "day"}, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: {kind: "event", event: "c1", edge: "end"}, to: self, lo: 3 * DAY, hi: 3 * DAY}]});
        expect(lowerStatement({kind: "before", of: "c1", basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: self, to: {kind: "event", event: "c1", edge: "start"}, lo: 0, hi: Number.POSITIVE_INFINITY}]});
    });

    test("持续：起点到终点；年龄：出生到起点落在 [L_min(min), L_max(max + 1))；出生只登记", () => {
        expect(lowerStatement({kind: "lasts", lasts: {min: 1, max: 2, unit: "hour"}, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: self, to: {kind: "event", event: "self", edge: "end"}, lo: 60, hi: 120}]});
        expect(lowerStatement({kind: "age", who: "e1", years: {min: 15, max: 15}, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "constraints", constraints: [{from: {kind: "birth", who: "e1"}, to: self, lo: 5477 * DAY, hi: 5844 * DAY - 1}]});
        expect(lowerStatement({kind: "birth", who: "e1", basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "birth", who: "e1"});
    });

    test("间隔与年数大到超出时间的范围：不成立（out-of-range）", () => {
        expect(gapRange(compiled, DEFAULT_FUZZY, {min: Number.MAX_SAFE_INTEGER, unit: "year"})).toEqual({invalid: "out-of-range"});
        expect(lowerStatement({kind: "age", who: "e1", years: {min: 1, max: 20_000_000}, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "invalid", reason: "out-of-range"});
    });

    test("不成立的给原因（输出 3）：月不在、词不在", () => {
        expect(lowerStatement({kind: "date", year: 2012, month: "m13", basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "invalid", reason: "month-missing"});
        expect(lowerStatement({kind: "after", of: "c1", gap: {word: "好些天"}, basis: author}, compiled, DEFAULT_FUZZY)).toEqual({kind: "invalid", reason: "word-missing"});
    });
});

describe("canon.time 输出 9：说法自己的校验", () => {
    test("日期不连续、比最小单位细、min 大于 max、of 是自己、一件事两条出生（两条都报）、年数倒着，都给出是第几条", () => {
        const dayCalendar: Calendar = {...GREGORIAN, unit: "day"};
        const statements: Statement[] = [
            {kind: "date", year: 2012, day: 3, basis: author},
            {kind: "date", year: 2012, month: "m1", day: 1, hour: 5, basis: author},
            {kind: "after", of: "c9", gap: {min: 5, max: 2, unit: "day"}, basis: author},
            {kind: "before", of: "c1", basis: author},
            {kind: "birth", who: "e1", basis: author},
            {kind: "birth", who: "e2", basis: author},
            {kind: "age", who: "e1", years: {min: 16, max: 15}, basis: author},
            {kind: "lasts", lasts: {max: 3, unit: "hour"}, basis: author},
        ];
        expect(validateStatements(statements, dayCalendar, "c1").map((problem) => problem.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(validateStatements([{kind: "after", of: "c2", gap: {word: "几天"}, basis: {kind: "telling", id: "t1"}}], GREGORIAN, "c1")).toEqual([]);
    });
});
