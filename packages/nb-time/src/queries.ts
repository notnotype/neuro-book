/**
 * 查询（docs/specs/canon/time.md 输出 8、12）：一章的范围、一段时间里一定与可能发生的事、年龄、按纪年月日逐级浏览、历法简表。
 * 一件事的范围与两件事的差直接用网络的 `range`、`between`。列表的分页由调用方（nb-canon）做。
 */

import {MAX_ABS_YEAR, type Calendar, type CompiledCalendar} from "./calendar";
import type {FuzzyTable} from "./fuzzy";
import type {TimeNetwork} from "./network";

/**
 * 一章（安放在这一章的事合起来）的范围：有锚的合成一个绝对范围，没有锚的与打架的另给件数。`earliestBy`、`latestBy` 是定下最早、
 * 最晚的那件事（同样早或晚时取安放在前的），调用方取它们的依据。
 */
export function chapterHull(network: TimeNetwork, events: readonly string[]): {readonly range: {readonly lo: number; readonly hi: number} | null; readonly earliestBy?: string; readonly latestBy?: string; readonly anchored: number; readonly unanchored: number; readonly conflict: number} {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let earliestBy: string | undefined;
    let latestBy: string | undefined;
    let anchored = 0;
    let unanchored = 0;
    let conflict = 0;
    for (const id of events) {
        const range = network.bounds(id);
        if (range.state === "conflict") conflict += 1;
        else if (range.state !== "ok" || !range.anchored) unanchored += 1;
        else {
            anchored += 1;
            if (earliestBy === undefined || range.lo < lo) [lo, earliestBy] = [range.lo, id];
            if (latestBy === undefined || range.hi > hi) [hi, latestBy] = [range.hi, id];
        }
    }
    return anchored === 0 ? {range: null, anchored, unanchored, conflict} : {range: {lo, hi}, earliestBy: earliestBy!, latestBy: latestBy!, anchored, unanchored, conflict};
}

/** 一段时间 `[from, to]` 里一定发生（整个范围在里面）与可能发生（范围与它相交）的事（只算有锚的）。 */
export function during(network: TimeNetwork, from: number, to: number): {readonly sure: readonly string[]; readonly maybe: readonly string[]} {
    const sure: string[] = [];
    const maybe: string[] = [];
    for (const id of network.events) {
        const range = network.bounds(id);
        if (range.state !== "ok" || !range.anchored) continue;
        if (range.lo >= from && range.hi <= to) sure.push(id);
        else if (range.lo <= to && range.hi >= from) maybe.push(id);
    }
    return {sure, maybe};
}

export type AgeAnswer =
    | {readonly kind: "years"; readonly min: number; readonly max: number; readonly disagree?: true}
    | {readonly kind: "atLeast"; readonly min: number}
    | {readonly kind: "notBorn"}
    | {readonly kind: "conflict"}
    | {readonly kind: "unknown"; readonly reason?: "birth-ambiguous"};

/**
 * 某人 P 在某件事 E 时几岁（输出 12），按顺序取第一个适用的。`ages` 是 E 上关于 P（已归到本体）的年龄说法的岁数；`births` 是 P 在
 * 这份网络里的出生事件。
 */
export function ageAt(network: TimeNetwork, compiled: CompiledCalendar, event: string, ages: readonly {readonly min: number; readonly max: number}[], births: readonly string[]): AgeAnswer {
    if (ages.length > 0) {
        const min = Math.max(...ages.map((age) => age.min));
        const max = Math.min(...ages.map((age) => age.max));
        if (min <= max) return {kind: "years", min, max};
        return {kind: "years", min: Math.min(...ages.map((age) => age.min)), max: Math.max(...ages.map((age) => age.max)), disagree: true};
    }
    if (network.bounds(event).state === "conflict") return {kind: "conflict"};
    if (births.length === 0) return {kind: "unknown"};
    if (births.length > 1) return {kind: "unknown", reason: "birth-ambiguous"};
    const span = network.between(births[0]!, event);
    if (span.state === "conflict") return {kind: "conflict"};
    if (span.state !== "ok") return {kind: "unknown"};
    if (span.hi < 0) return {kind: "notBorn"};
    const lo = Math.max(span.lo, 0);
    const length = (n: number, extreme: "min" | "max") => compiled.spanDays("year", n, extreme) * compiled.ticksPerDay;
    // 所有满足“D 里有一个值 v，L_min(k) ≤ v < L_max(k + 1)”的非负整数 k；两个界对 k 都不减，二分。
    const limit = MAX_ABS_YEAR * 2;
    const firstK = smallest(0, limit, (k) => length(k + 1, "max") > lo);
    if (!Number.isFinite(span.hi)) return {kind: "atLeast", min: firstK};
    const lastK = smallest(0, limit, (k) => length(k + 1, "min") > span.hi);
    return lastK < firstK ? {kind: "unknown"} : {kind: "years", min: firstK, max: lastK};
}

/** [low, high] 里第一个让 `ok` 成立的整数（`ok` 单调由假变真）；都不成立时为 high。 */
function smallest(low: number, high: number, ok: (value: number) => boolean): number {
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (ok(middle)) high = middle;
        else low = middle + 1;
    }
    return low;
}

/**
 * 浏览的一级（输出 8 的最后一项）：不给是最上一级——历法有纪时按纪（第一个纪之前的年合成一个单位，`key` 为 null），没有纪时按绝对
 * 年份；给 `era` 是这个纪里的年；给 `year` 是这一年里的月；再给 `month` 是这个月里的日。
 */
export type BrowsePath = {readonly era?: undefined; readonly year?: undefined} | {readonly era: string; readonly year?: undefined} | {readonly year: number; readonly month?: number};

export interface BrowseUnit {
    /** 纪的 id（第一个纪之前为 null）、绝对年份、月的下标（从 0 起）或日（从 1 起）。 */
    readonly key: string | number | null;
    readonly lo: number;
    readonly hi: number;
    readonly sure: number;
    readonly maybe: number;
}

export interface BrowseResult {
    /** 按时间先后，最多 `BROWSE_LIMIT` 个，只列与事件相交的。 */
    readonly units: readonly BrowseUnit[];
    /** 与事件相交的单位共有几个（多于列出的时候说明被截了）。 */
    readonly total: number;
    /** 这一级本身的范围（最上一级为 null）：调用方按它列出这一级里的事（`during`）。 */
    readonly scope: {readonly lo: number; readonly hi: number} | null;
}

export const BROWSE_LIMIT = 200;

export function browse(network: TimeNetwork, compiled: CompiledCalendar, path: BrowsePath): BrowseResult | "not-found" {
    const tpd = compiled.ticksPerDay;
    const ranges = network.events.flatMap((id) => {
        const range = network.bounds(id);
        return range.state === "ok" && range.anchored && Number.isFinite(range.lo) && Number.isFinite(range.hi) ? [range] : [];
    });
    const count = (unit: Omit<BrowseUnit, "sure" | "maybe">): BrowseUnit => {
        let sure = 0;
        let maybe = 0;
        for (const range of ranges) {
            if (range.lo >= unit.lo && range.hi <= unit.hi) sure += 1;
            else if (range.lo <= unit.hi && range.hi >= unit.lo) maybe += 1;
        }
        return {...unit, sure, maybe};
    };
    const yearOf = (tick: number) => compiled.dayParts(Math.floor(tick / tpd)).year;
    const yearUnit = (year: number) => ({key: year, lo: compiled.daysBefore(year) * tpd, hi: compiled.daysBefore(year + 1) * tpd - 1});
    /** `[from, to]` 年里与事件相交的年：每件事占一段年，合并以后按先后取前 BROWSE_LIMIT 个（一件跨几百年的事不会挤掉别的年）。 */
    const years = (from: number, to: number): BrowseResult => {
        const spans = ranges.map((range) => [Math.max(from, yearOf(range.lo)), Math.min(to, yearOf(range.hi))] as const).filter(([a, b]) => a <= b).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const merged: [number, number][] = [];
        for (const [a, b] of spans) {
            const last = merged.at(-1);
            if (last !== undefined && a <= last[1] + 1) last[1] = Math.max(last[1], b);
            else merged.push([a, b]);
        }
        const units: BrowseUnit[] = [];
        for (const [a, b] of merged) for (let year = a; year <= b && units.length < BROWSE_LIMIT; year += 1) units.push(count(yearUnit(year)));
        const total = merged.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
        const scope = Number.isFinite(from) && Number.isFinite(to) ? {lo: yearUnit(from).lo, hi: yearUnit(to).hi} : null;
        return {units, total, scope};
    };
    const eras = compiled.calendar.eras ?? [];
    if (path.year === undefined && path.era === undefined) {
        if (eras.length === 0) return {...years(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY), scope: null};
        const bounds = [{key: null, from: Number.NEGATIVE_INFINITY, to: eras[0]!.start - 1}, ...eras.map((era, index) => ({key: era.id, from: era.start, to: index + 1 < eras.length ? eras[index + 1]!.start - 1 : Number.POSITIVE_INFINITY}))];
        const units = bounds.flatMap((era) => {
            const lo = Number.isFinite(era.from) ? yearUnit(era.from).lo : Number.NEGATIVE_INFINITY;
            const hi = Number.isFinite(era.to) ? yearUnit(era.to).hi : Number.POSITIVE_INFINITY;
            const unit = count({key: era.key, lo, hi});
            return unit.sure + unit.maybe === 0 ? [] : [unit];
        });
        return {units, total: units.length, scope: null};
    }
    if (path.year === undefined) {
        const index = eras.findIndex((era) => era.id === path.era);
        if (index < 0) return "not-found";
        return years(eras[index]!.start, index + 1 < eras.length ? eras[index + 1]!.start - 1 : Number.POSITIVE_INFINITY);
    }
    const units: BrowseUnit[] = [];
    if (path.month === undefined) {
        const days = compiled.monthDays(path.year);
        for (let month = 0; month < days.length; month += 1) {
            const lo = compiled.monthStart(path.year, month) * tpd;
            units.push(count({key: month, lo, hi: lo + days[month]! * tpd - 1}));
        }
        return {units: units.filter((unit) => unit.sure + unit.maybe > 0), total: units.filter((unit) => unit.sure + unit.maybe > 0).length, scope: yearUnit(path.year)};
    }
    const monthDays = compiled.monthDays(path.year)[path.month];
    if (monthDays === undefined) return "not-found";
    const start = compiled.monthStart(path.year, path.month);
    for (let day = 0; day < monthDays; day += 1) units.push(count({key: day + 1, lo: (start + day) * tpd, hi: (start + day + 1) * tpd - 1}));
    const listed = units.filter((unit) => unit.sure + unit.maybe > 0);
    return {units: listed, total: listed.length, scope: {lo: start * tpd, hi: (start + monthDays) * tpd - 1}};
}

/** 历法简表与词表（输出 8 的 `calendar`）：给写入者查月、纪、时段的 id。 */
export function calendarSummary(calendar: Calendar, fuzzy: FuzzyTable) {
    return {
        unit: calendar.unit,
        months: calendar.months.map((month) => ({id: month.id, name: month.name, days: month.days})),
        eras: (calendar.eras ?? []).map((era) => ({id: era.id, name: era.name, start: era.start})),
        periods: (calendar.periods ?? []).map((period) => ({id: period.id, name: period.name, from: period.from, to: period.to})),
        words: fuzzy.words,
        approx: fuzzy.approx,
    };
}
