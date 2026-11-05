/**
 * 时间的查询（docs/specs/canon/time.md 输出 8、12）：在一份时间状态上回答，结果的时间按历法的写法给出，同时给 tick。列表（一段
 * 时间里的事）由调用方分页。依据给说法的键（所在变更与说法的规范 JSON），最多 20 条另给总数（nb-time 截好）。
 */

import {ageAt, browse, calendarSummary, chapterHull, dateRange, during, formatRange, formatSpan, type CompiledCalendar, type DateParts, type EventRange, type TimeNetwork} from "@notnotype/nb-time";

import type {Entry, StoryChange} from "../core/schema";
import {compiledOf, type TimeSettings} from "./network";
import type {TimeState} from "./state";

export type TimeQuery =
    | {readonly kind: "event"; readonly change: string}
    | {readonly kind: "chapter"; readonly chapter: string}
    | {readonly kind: "during"; readonly from: DateParts; readonly to: DateParts}
    | {readonly kind: "between"; readonly a: string; readonly b: string}
    | {readonly kind: "age"; readonly who: string; readonly at: string}
    | {readonly kind: "browse"; readonly year?: number; readonly month?: number}
    | {readonly kind: "calendar"};

/** 一个范围的回答：绝对的写成历法的样子，相对的写成相对哪件事、差多久。 */
function describe(compiled: CompiledCalendar, range: EventRange) {
    if (range.state !== "ok") return range;
    const text = range.anchored ? formatRange(compiled, range.lo, range.hi).text : `相对 ${range.relativeTo!}：${formatSpan(compiled, range.lo)} 到 ${formatSpan(compiled, range.hi)}`;
    return {...range, text};
}

export type TimeAnswer = Readonly<Record<string, unknown>> | {readonly code: "not-found" | "invalid-date"};

export function answerTime(state: TimeState, settings: TimeSettings, data: {readonly changes: ReadonlyMap<string, StoryChange>; readonly entries: ReadonlyMap<string, Entry>}, query: TimeQuery): TimeAnswer {
    const compiled = compiledOf(settings.calendar);
    const network: TimeNetwork = state.built.network;
    const inNetwork = (id: string) => network.component(id) !== undefined;
    switch (query.kind) {
        case "event": {
            if (!inNetwork(query.change)) return data.changes.has(query.change) ? {kind: "event", change: query.change, start: {state: "unconstrained"}} : {code: "not-found"};
            return {kind: "event", change: query.change, start: describe(compiled, network.range(query.change, "start")), end: describe(compiled, network.range(query.change, "end"))};
        }
        case "chapter": {
            const events = network.events.filter((id) => {
                const at = data.changes.get(id)?.at;
                return at?.kind === "chapter" && at.chapter === query.chapter;
            });
            const hull = chapterHull(network, events);
            return {kind: "chapter", chapter: query.chapter, ...hull, ...(hull.range === null ? {} : {text: formatRange(compiled, hull.range.lo, hull.range.hi).text})};
        }
        case "during": {
            const from = dateRange(compiled, query.from);
            const to = dateRange(compiled, query.to);
            if ("invalid" in from || "invalid" in to) return {code: "invalid-date"};
            return {kind: "during", ...during(network, from.lo, to.hi), text: formatRange(compiled, from.lo, to.hi).text};
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
            const path = query.year === undefined ? {} : query.month === undefined ? {year: query.year} : {year: query.year, month: query.month};
            return {kind: "browse", units: browse(network, compiled, path).map((unit) => ({...unit, text: formatRange(compiled, unit.lo, unit.hi).text}))};
        }
        case "calendar":
            return {kind: "calendar", ...calendarSummary(settings.calendar, settings.fuzzy)};
    }
}
