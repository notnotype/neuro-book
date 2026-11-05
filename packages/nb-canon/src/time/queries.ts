/**
 * 时间的查询（docs/specs/canon/time.md 输出 8、12）：在一份时间状态上回答，结果的时间按历法的写法给出，同时给结构化的各级与 tick。
 * 列表（一段时间里的事、浏览的这一级里的事）由调用方分页。依据给说法的键（所在变更与说法的规范 JSON），最多 20 条另给总数（nb-time
 * 截好）；“不可确定”给打架的环上的说法的键（与待处理里打架项的 `statements` 相同）。
 */

import {ageAt, browse, calendarSummary, chapterHull, dateRange, during, formatRange, formatSpan, type CompiledCalendar, type DateParts, type EventRange, type FormattedRange, type TimeNetwork} from "@notnotype/nb-time";

import type {Entry, StoryChange} from "../core/schema";
import {compiledOf, type TimeSettings} from "./network";
import type {TimeState} from "./state";

export type TimeQuery =
    | {readonly kind: "event"; readonly change: string}
    | {readonly kind: "chapter"; readonly chapter: string}
    | {readonly kind: "during"; readonly from: DateParts; readonly to: DateParts}
    | {readonly kind: "between"; readonly a: string; readonly b: string}
    | {readonly kind: "age"; readonly who: string; readonly at: string}
    | {readonly kind: "browse"; readonly era?: string; readonly year?: number; readonly month?: number}
    | {readonly kind: "calendar"};

/** 写好的时间：文字与两端的各级（`FormattedRange` 去掉 `level` 以外原样给）。 */
function written(formatted: FormattedRange) {
    return {text: formatted.text, ...(formatted.from === undefined ? {} : {from: formatted.from}), ...(formatted.to === undefined ? {} : {to: formatted.to})};
}

/** 一个范围的回答：绝对的写成历法的样子，相对的写成相对哪件事、差多久；不可确定的给打架的说法。 */
function describe(compiled: CompiledCalendar, network: TimeNetwork, range: EventRange) {
    if (range.state === "conflict") return {state: "conflict", statements: [...new Set(range.conflicts.flatMap((index) => network.conflicts[index]!.refs))].sort()};
    if (range.state !== "ok") return range;
    if (range.anchored) return {...range, ...written(formatRange(compiled, range.lo, range.hi))};
    return {...range, text: `相对 ${range.relativeTo!}：${formatSpan(compiled, range.lo)} 到 ${formatSpan(compiled, range.hi)}`};
}

export type TimeAnswer = Readonly<Record<string, unknown>> | {readonly code: "not-found" | "invalid-date"};

export function answerTime(state: TimeState, settings: TimeSettings, data: {readonly changes: ReadonlyMap<string, StoryChange>; readonly entries: ReadonlyMap<string, Entry>}, query: TimeQuery): TimeAnswer {
    const compiled = compiledOf(settings.calendar);
    const network: TimeNetwork = state.built.network;
    const inNetwork = (id: string) => network.component(id) !== undefined;
    switch (query.kind) {
        case "event": {
            if (!inNetwork(query.change)) return data.changes.has(query.change) ? {kind: "event", change: query.change, start: {state: "unconstrained"}} : {code: "not-found"};
            return {kind: "event", change: query.change, start: describe(compiled, network, network.range(query.change, "start")), end: describe(compiled, network, network.range(query.change, "end"))};
        }
        case "chapter": {
            const events = network.events.filter((id) => {
                const at = data.changes.get(id)?.at;
                return at?.kind === "chapter" && at.chapter === query.chapter;
            });
            const {earliestBy, latestBy, ...hull} = chapterHull(network, events);
            if (hull.range === null || earliestBy === undefined || latestBy === undefined) return {kind: "chapter", chapter: query.chapter, ...hull};
            // 依据：定下最早的那件事的最早依据、定下最晚的那件事的最晚依据。
            const [first, last] = [network.range(earliestBy), network.range(latestBy)];
            const basis = {earliest: first.state === "ok" ? first.earliest : {refs: [], total: 0}, latest: last.state === "ok" ? last.latest : {refs: [], total: 0}};
            return {kind: "chapter", chapter: query.chapter, ...hull, earliestBy, latestBy, ...basis, ...written(formatRange(compiled, hull.range.lo, hull.range.hi))};
        }
        case "during": {
            const from = dateRange(compiled, query.from);
            const to = dateRange(compiled, query.to);
            if ("invalid" in from || "invalid" in to) return {code: "invalid-date"};
            return {kind: "during", ...during(network, from.lo, to.hi), ...written(formatRange(compiled, from.lo, to.hi))};
        }
        case "between": {
            if (!inNetwork(query.a) || !inNetwork(query.b)) return {code: "not-found"};
            const result = network.between(query.a, query.b);
            return result.state === "ok" ? {kind: "between", ...result, text: `${formatSpan(compiled, result.lo)} 到 ${formatSpan(compiled, result.hi)}`} : {kind: "between", ...result};
        }
        case "age": {
            if (!inNetwork(query.at) || !data.entries.has(query.who)) return {code: "not-found"};
            const body = data.entries.get(query.who)?.sameAs ?? query.who;
            const ages = (data.changes.get(query.at)?.when ?? []).flatMap((statement) => (statement.kind === "age" && (data.entries.get(statement.who)?.sameAs ?? statement.who) === body ? [statement.years] : []));
            const answer = ageAt(network, compiled, query.at, ages, state.built.assembled.births.get(body) ?? []);
            const text = answer.kind === "years" ? (answer.min === answer.max ? `${String(answer.min)} 岁` : `${String(answer.min)} 到 ${String(answer.max)} 岁`) : answer.kind === "atLeast" ? `至少 ${String(answer.min)} 岁` : answer.kind === "notBorn" ? "尚未出生" : answer.kind === "conflict" ? "不可确定" : "不知道";
            // 几条年龄说法没有共同的岁数时，这次结果带提示（输出 12）。
            return {kind: "age", age: answer, text, ...(answer.kind === "years" && answer.disagree === true ? {hint: "time-age-disagree"} : {})};
        }
        case "browse": {
            const path = query.year !== undefined ? (query.month === undefined ? {year: query.year} : {year: query.year, month: query.month}) : query.era !== undefined ? {era: query.era} : {};
            const result = browse(network, compiled, path);
            if (result === "not-found") return {code: "not-found"};
            // 这一级本身里一定、可能发生的事（输出 8 的“数目与列表”）：列表由调用方分页，同 `during`。
            const listed = result.scope === null ? during(network, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY) : during(network, result.scope.lo, result.scope.hi);
            return {kind: "browse", units: result.units.map((unit) => ({...unit, ...written(formatRange(compiled, unit.lo, unit.hi))})), total: result.total, ...listed};
        }
        case "calendar":
            return {kind: "calendar", ...calendarSummary(settings.calendar, settings.fuzzy)};
    }
}
