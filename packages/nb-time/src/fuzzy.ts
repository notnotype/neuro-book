/**
 * 间隔与模糊词表（docs/specs/canon/time.md 输入表的“模糊词表”“间隔”）。间隔换成 tick 的闭区间；以年、月为单位时取连续 n 年（月）
 * 的最短与最长（`L_min`、`L_max`），不看起点，所以范围比按具体日期推算宽（Spec 的取舍）。
 */

import type {Approx, Calendar, CompiledCalendar} from "./calendar";

export type GapUnit = "minute" | "hour" | "day" | "month" | "year";

/** 间隔：`min` 缺省 0，`max` 缺省无穷，都是非负整数。 */
export interface Gap {
    readonly min?: number;
    readonly max?: number;
    readonly unit: GapUnit;
}

/** 说法里写的间隔：直接给，或写一个模糊词（按词表换成间隔）。 */
export type GapSpec = Gap | {readonly word: string};

/** 生效的模糊词表：作品设置里合法的项盖在内置的缺省上。 */
export interface FuzzyTable {
    readonly words: Readonly<Record<string, Gap>>;
    readonly approx: Approx;
}

export interface FuzzyProblem {
    readonly path: string;
    readonly code: "fuzzy-word-invalid";
    readonly message: string;
}

/** 内置的缺省词表与“约”的放宽量（time.md 输入表）；作品设置里给了的项覆盖它。 */
export const DEFAULT_FUZZY: FuzzyTable = {
    words: {
        几天: {min: 2, max: 9, unit: "day"},
        几个月: {min: 2, max: 11, unit: "month"},
        几年: {min: 2, max: 9, unit: "year"},
        不久: {min: 0, max: 7, unit: "day"},
        多年: {min: 5, unit: "year"},
    },
    approx: {year: 1, month: 1, day: 1, hour: 1},
};

const UNITS: readonly GapUnit[] = ["minute", "hour", "day", "month", "year"];
const CALENDAR_UNIT_RANK = {minute: 0, hour: 1, day: 2} as const;
const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** 间隔的单位比历法的最小单位细（写入时拒收，time.md 输入表）。 */
export function unitTooFine(unit: GapUnit, calendar: Calendar): boolean {
    return UNITS.indexOf(unit) < CALENDAR_UNIT_RANK[calendar.unit];
}

/** 一个间隔本身的问题（不看词表）：单位、上下界的形状与先后、比历法细。合格时为 null。 */
export function gapProblem(gap: unknown, calendar: Calendar): string | null {
    if (gap === null || typeof gap !== "object") return "a gap is {min?, max?, unit} or {word}";
    const value = gap as Partial<Gap> & {word?: unknown};
    if ("word" in value) return typeof value.word === "string" && value.word !== "" ? null : "word must be text";
    if (!UNITS.includes(value.unit as GapUnit)) return `unit must be one of ${UNITS.join(", ")}`;
    if (value.min !== undefined && !isNonNegativeInteger(value.min)) return "min must be a non-negative integer";
    if (value.max !== undefined && !isNonNegativeInteger(value.max)) return "max must be a non-negative integer";
    if ((value.min ?? 0) > (value.max ?? Number.POSITIVE_INFINITY)) return "min must not exceed max";
    if (unitTooFine(value.unit as GapUnit, calendar)) return "the unit is finer than the calendar's smallest unit";
    return null;
}

/**
 * 作品设置里的模糊词表（`{words?: {词: 间隔}, approx?: {year, month, day, hour}}`）盖在缺省上。不合法的项作废并给诊断
 * `fuzzy-word-invalid`：作废的词不退回缺省，用到它的说法不成立（输出 3）；`approx` 不合法的那一级用缺省。
 */
export function resolveFuzzy(raw: unknown, calendar: Calendar): {readonly table: FuzzyTable; readonly problems: readonly FuzzyProblem[]} {
    const problems: FuzzyProblem[] = [];
    const words: Record<string, Gap> = {...DEFAULT_FUZZY.words};
    const approx: {-readonly [K in keyof Approx]: number} = {...DEFAULT_FUZZY.approx};
    if (raw === undefined || raw === null) return {table: {words, approx}, problems};
    if (typeof raw !== "object" || Array.isArray(raw)) return {table: {words, approx}, problems: [{path: "", code: "fuzzy-word-invalid", message: "the fuzzy table must be {words, approx}"}]};
    const value = raw as {words?: unknown; approx?: unknown};
    if (value.words !== undefined) {
        if (value.words === null || typeof value.words !== "object" || Array.isArray(value.words)) problems.push({path: "/words", code: "fuzzy-word-invalid", message: "words must map words to gaps"});
        else for (const [word, gap] of Object.entries(value.words)) {
            const problem = gap !== null && typeof gap === "object" && "word" in gap ? "a word must map to {min?, max?, unit}, not another word" : gapProblem(gap, calendar);
            if (problem === null) words[word] = gap as Gap;
            else {
                delete words[word];
                problems.push({path: `/words/${word}`, code: "fuzzy-word-invalid", message: problem});
            }
        }
    }
    if (value.approx !== undefined) {
        const given = value.approx as Partial<Record<keyof Approx, unknown>> | null;
        for (const level of ["year", "month", "day", "hour"] as const) {
            const amount = given?.[level];
            if (amount === undefined) continue;
            if (isNonNegativeInteger(amount)) approx[level] = amount;
            else problems.push({path: `/approx/${level}`, code: "fuzzy-word-invalid", message: `approx.${level} must be a non-negative integer`});
        }
    }
    return {table: {words, approx}, problems};
}

/** 间隔换成 tick 的闭区间（上界可以是无穷）；词不在表里、单位比历法细时给原因。 */
export function gapRange(compiled: CompiledCalendar, fuzzy: FuzzyTable, spec: GapSpec): {readonly lo: number; readonly hi: number} | {readonly invalid: "word-missing" | "unit-too-fine"} {
    const gap = "word" in spec ? fuzzy.words[spec.word] : spec;
    if (gap === undefined) return {invalid: "word-missing"};
    if (unitTooFine(gap.unit, compiled.calendar)) return {invalid: "unit-too-fine"};
    const min = gap.min ?? 0;
    const max = gap.max ?? Number.POSITIVE_INFINITY;
    if (gap.unit === "month" || gap.unit === "year") {
        const days = (n: number, extreme: "min" | "max") => compiled.spanDays(gap.unit as "month" | "year", n, extreme) * compiled.ticksPerDay;
        return {lo: days(min, "min"), hi: Number.isFinite(max) ? days(max, "max") : Number.POSITIVE_INFINITY};
    }
    const unit = gap.unit === "day" ? compiled.ticksPerDay : gap.unit === "hour" ? compiled.ticksPerHour : compiled.ticksPerMinute;
    return {lo: min * unit, hi: Number.isFinite(max) ? max * unit : Number.POSITIVE_INFINITY};
}
