/**
 * 时间说法（docs/specs/canon/time.md 输入表的“说法”）：形状、只看说法本身的校验（输出 9 里属于说法自己的那几条），与降成约束。
 *
 * 降成约束只看说法、历法与词表：端点写成“这件事自己”“`of` 指的那件事”“某人的出生”或元年，组网时才解析成节点（那时才知道
 * `of` 那件事算不算事件、谁的出生事件是哪一件）。所以降约束的结果可以按（说法的内容、历法、词表）缓存，别的变更变了不会用到旧结果。
 */

import {dateRange, MAX_ABS_YEAR, type Calendar, type CompiledCalendar, type DateInvalid, type DateParts} from "./calendar";
import {gapProblem, gapRange, type FuzzyTable, type GapSpec} from "./fuzzy";

export type Basis = {readonly kind: "telling"; readonly id: string} | {readonly kind: "author"} | {readonly kind: "inferred"; readonly note?: string};
export type Edge = "start" | "end";

interface StatementBase {
    /** 原话。 */
    readonly quote?: string;
    readonly basis: Basis;
}

export type Statement = StatementBase & (
    | ({readonly kind: "date"; readonly approx?: boolean; readonly uncertain?: boolean} & DateParts)
    | {readonly kind: "after" | "before"; readonly of: string; readonly edge?: Edge; readonly gap?: GapSpec}
    | {readonly kind: "lasts"; readonly lasts: GapSpec}
    | {readonly kind: "age"; readonly who: string; readonly years: {readonly min: number; readonly max: number}}
    | {readonly kind: "birth"; readonly who: string}
);

/** 约束的端点：元年、这件事（`self`）或 `of` 指的那件事的一端、某人出生事件的起点。 */
export type Endpoint =
    | {readonly kind: "origin"}
    | {readonly kind: "event"; readonly event: "self" | string; readonly edge: Edge}
    | {readonly kind: "birth"; readonly who: string};

/** `to - from` 落在 `[lo, hi]`（tick，闭区间，hi 可以是无穷）。 */
export interface ConstraintTemplate {
    readonly from: Endpoint;
    readonly to: Endpoint;
    readonly lo: number;
    readonly hi: number;
}

/** 说法在当前历法与词表里不成立的原因（输出 3）。 */
export type StatementInvalid = DateInvalid | "word-missing" | "out-of-range";

export type Lowered =
    | {readonly kind: "constraints"; readonly constraints: readonly ConstraintTemplate[]}
    | {readonly kind: "birth"; readonly who: string}
    | {readonly kind: "invalid"; readonly reason: StatementInvalid};

export interface StatementProblem {
    readonly index: number;
    readonly code: "invalid-time";
    readonly message: string;
}

const SELF_START: Endpoint = {kind: "event", event: "self", edge: "start"};

/**
 * 只看说法自己的规则（输出 9 与输入表）：形状、日期各级连续、单位不比历法细、`min` 不大于 `max`、`of` 不是自己、同一件事最多一条
 * `birth`。引用存不存在、`basis` 的讲述在不在 `told` 里由调用方（nb-canon）查。`self` 是这件事的 id（新建时可以是临时 id）。
 */
export function validateStatements(statements: readonly Statement[], calendar: Calendar, self?: string): StatementProblem[] {
    const problems: StatementProblem[] = [];
    const fail = (index: number, message: string) => problems.push({index, code: "invalid-time", message});
    let births = 0;
    for (const [index, statement] of statements.entries()) {
        switch (statement.kind) {
            case "date": {
                if (!Number.isInteger(statement.year)) fail(index, "a date needs an integer year");
                if ((statement.day !== undefined && statement.month === undefined) || ((statement.period !== undefined || statement.hour !== undefined) && statement.day === undefined) || (statement.period !== undefined && statement.hour !== undefined) || (statement.minute !== undefined && statement.hour === undefined)) fail(index, "a date must be given level by level from the year (month before day, day before period or hour, hour before minute)");
                if (calendar.unit === "day" && (statement.hour !== undefined || statement.minute !== undefined || statement.period !== undefined)) fail(index, "the calendar's smallest unit is a day");
                if (calendar.unit === "hour" && statement.minute !== undefined) fail(index, "the calendar's smallest unit is an hour");
                break;
            }
            case "after":
            case "before": {
                if (typeof statement.of !== "string" || statement.of === "") fail(index, "of must name a story change");
                else if (statement.of === self) fail(index, "a statement cannot be relative to its own change");
                if (statement.edge !== undefined && statement.edge !== "start" && statement.edge !== "end") fail(index, "edge must be start or end");
                const problem = statement.gap === undefined ? null : gapProblem(statement.gap, calendar);
                if (problem !== null) fail(index, problem);
                break;
            }
            case "lasts": {
                const problem = gapProblem(statement.lasts, calendar);
                if (problem !== null) fail(index, problem);
                break;
            }
            case "age": {
                const {min, max} = statement.years ?? {};
                if (!Number.isInteger(min) || !Number.isInteger(max) || min! < 0 || min! > max!) fail(index, "years must be {min, max} with 0 <= min <= max");
                break;
            }
            case "birth":
                births += 1;
                if (births === 2) fail(index, "a change can be the birth of at most one person");
                break;
            default:
                fail(index, `unknown statement kind "${String((statement as {kind?: unknown}).kind)}"`);
        }
    }
    return problems;
}

/** 一条说法降成约束（输入表的“约束”一栏）；不成立时给原因。 */
export function lowerStatement(statement: Statement, compiled: CompiledCalendar, fuzzy: FuzzyTable): Lowered {
    switch (statement.kind) {
        case "date": {
            const range = dateRange(compiled, statement, statement.approx === true ? fuzzy.approx : undefined);
            if ("invalid" in range) return {kind: "invalid", reason: range.invalid};
            return {kind: "constraints", constraints: [{from: {kind: "origin"}, to: SELF_START, lo: range.lo, hi: range.hi}]};
        }
        case "after":
        case "before": {
            const range = statement.gap === undefined ? {lo: 0, hi: Number.POSITIVE_INFINITY} : gapRange(compiled, fuzzy, statement.gap);
            if ("invalid" in range) return {kind: "invalid", reason: range.invalid};
            const other: Endpoint = {kind: "event", event: statement.of, edge: statement.edge ?? "start"};
            // after：E.s 减 of 那一端落在间隔里；before：of 那一端减 E.s 落在间隔里。
            const [from, to] = statement.kind === "after" ? [other, SELF_START] : [SELF_START, other];
            return {kind: "constraints", constraints: [{from, to, lo: range.lo, hi: range.hi}]};
        }
        case "lasts": {
            const range = gapRange(compiled, fuzzy, statement.lasts);
            if ("invalid" in range) return {kind: "invalid", reason: range.invalid};
            return {kind: "constraints", constraints: [{from: SELF_START, to: {kind: "event", event: "self", edge: "end"}, lo: range.lo, hi: range.hi}]};
        }
        case "age": {
            // E.s 减出生落在 [L_min(min), L_max(max + 1))：半开区间换成闭区间减一个 tick（输出 12）。
            const ticks = (n: number, extreme: "min" | "max") => compiled.spanDays("year", n, extreme) * compiled.ticksPerDay;
            if (statement.years.max >= MAX_ABS_YEAR) return {kind: "invalid", reason: "out-of-range"};
            return {kind: "constraints", constraints: [{from: {kind: "birth", who: statement.who}, to: SELF_START, lo: ticks(statement.years.min, "min"), hi: ticks(statement.years.max + 1, "max") - 1}]};
        }
        case "birth":
            return {kind: "birth", who: statement.who};
    }
}
