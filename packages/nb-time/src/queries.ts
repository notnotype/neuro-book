/**
 * 查询（docs/specs/canon/time.md 输出 8、12）：一章的范围、一段时间里一定与可能发生的事、年龄、按纪年月日逐级浏览、历法简表。
 * 一件事的范围与两件事的差直接用网络的 `range`、`between`。列表的分页由调用方（nb-canon）做。
 */

import {MAX_ABS_YEAR, type Calendar, type CompiledCalendar} from "./calendar";
import type {FuzzyTable} from "./fuzzy";
import type {TimeNetwork} from "./network";

/** 一章（安放在这一章的事合起来）的范围：有锚的合成一个绝对范围，没有锚的与打架的另给件数。 */
export function chapterHull(network: TimeNetwork, events: readonly string[]): {readonly range: {readonly lo: number; readonly hi: number} | null; readonly anchored: number; readonly unanchored: number; readonly conflict: number} {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let anchored = 0;
    let unanchored = 0;
    let conflict = 0;
    for (const id of events) {
        const range = network.range(id);
        if (range.state === "conflict") conflict += 1;
        else if (range.state !== "ok" || !range.anchored) unanchored += 1;
        else {
            anchored += 1;
            lo = Math.min(lo, range.lo);
            hi = Math.max(hi, range.hi);
        }
    }
    return {range: anchored === 0 ? null : {lo, hi}, anchored, unanchored, conflict};
}

/** 一段时间 `[from, to]` 里一定发生（整个范围在里面）与可能发生（范围与它相交）的事（只算有锚的）。 */
export function during(network: TimeNetwork, from: number, to: number): {readonly sure: readonly string[]; readonly maybe: readonly string[]} {
    const sure: string[] = [];
    const maybe: string[] = [];
    for (const id of network.events) {
        const range = network.range(id);
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
    if (network.range(event).state === "conflict") return {kind: "conflict"};
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

/** 浏览的一级：一个纪（或没有纪的绝对年份）里的年、一年里的月、一个月里的日。 */
export type BrowsePath = {readonly year?: undefined} | {readonly year: number; readonly month?: number};

export interface BrowseUnit {
    /** 绝对年份、月的下标（从 0 起）或日（从 1 起）。 */
    readonly key: number;
    readonly lo: number;
    readonly hi: number;
    readonly sure: number;
    readonly maybe: number;
}

/** 按年、月、日逐级列出这一级里每个单位一定、可能发生的事的数目（输出 8 的最后一项）；年最多列 200 个，只列与事件相交的。 */
export function browse(network: TimeNetwork, compiled: CompiledCalendar, path: BrowsePath): readonly BrowseUnit[] {
    const tpd = compiled.ticksPerDay;
    const ranges = network.events.flatMap((id) => {
        const range = network.range(id);
        return range.state === "ok" && range.anchored && Number.isFinite(range.lo) && Number.isFinite(range.hi) ? [range] : [];
    });
    const count = (lo: number, hi: number): BrowseUnit["sure"][] => {
        let sure = 0;
        let maybe = 0;
        for (const range of ranges) {
            if (range.lo >= lo && range.hi <= hi) sure += 1;
            else if (range.lo <= hi && range.hi >= lo) maybe += 1;
        }
        return [sure, maybe];
    };
    const units: BrowseUnit[] = [];
    if (path.year === undefined) {
        const years = new Set<number>();
        for (const range of ranges) {
            const first = compiled.dayParts(Math.floor(range.lo / tpd)).year;
            const last = compiled.dayParts(Math.floor(range.hi / tpd)).year;
            for (let year = first; year <= last && years.size < 200; year += 1) years.add(year);
        }
        for (const year of [...years].sort((a, b) => a - b)) {
            const lo = compiled.daysBefore(year) * tpd;
            const hi = compiled.daysBefore(year + 1) * tpd - 1;
            const [sure, maybe] = count(lo, hi);
            units.push({key: year, lo, hi, sure: sure!, maybe: maybe!});
        }
        return units;
    }
    if (path.month === undefined) {
        const days = compiled.monthDays(path.year);
        for (let month = 0; month < days.length; month += 1) {
            const lo = compiled.monthStart(path.year, month) * tpd;
            const hi = lo + days[month]! * tpd - 1;
            const [sure, maybe] = count(lo, hi);
            units.push({key: month, lo, hi, sure: sure!, maybe: maybe!});
        }
        return units;
    }
    const start = compiled.monthStart(path.year, path.month);
    for (let day = 0; day < compiled.monthDays(path.year)[path.month]!; day += 1) {
        const lo = (start + day) * tpd;
        const [sure, maybe] = count(lo, lo + tpd - 1);
        units.push({key: day + 1, lo, hi: lo + tpd - 1, sure: sure!, maybe: maybe!});
    }
    return units;
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
