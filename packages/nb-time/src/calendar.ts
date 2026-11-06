/**
 * 历法（docs/specs/canon/time.md 输入表的历法、输出 13）：校验、编译成周期表、日期说法到绝对范围、绝对时间拆回各级。
 *
 * 绝对时间是从绝对年份 0 的第一个月第一天零点起的整数个最小单位（tick）。闰年规则对绝对年份 y 适用当且仅当
 * `(y - offset)` 除以 `every` 的非负余数为 0，所以年份的月天数按 `y mod P`（P 是各 `every` 的最小公倍数）周期重复：编译时把一个
 * 周期的每一年算好，之后的“某年之前共多少天”“连续 n 年最短、最长多少天”都查这张表，不展开长周期。
 */

export type TimeUnit = "minute" | "hour" | "day";

export interface CalendarMonth {
    readonly id: string;
    readonly name: string;
    readonly days: number;
}

export interface LeapRule {
    readonly every: number;
    readonly offset?: number;
    readonly months: Readonly<Record<string, number>>;
}

export interface CalendarEra {
    readonly id: string;
    readonly name: string;
    /** 这一纪的元年是绝对年份 `start`。 */
    readonly start: number;
}

export interface CalendarPeriod {
    readonly id: string;
    readonly name: string;
    /** 从 `from` 时起、到 `to` 时之前；`to` 小于 `from` 跨夜，等于 `from` 是整整一天。 */
    readonly from: number;
    readonly to: number;
}

export interface Calendar {
    readonly version: number;
    readonly unit: TimeUnit;
    readonly hoursPerDay: number;
    readonly minutesPerHour: number;
    readonly months: readonly CalendarMonth[];
    readonly leap?: readonly LeapRule[];
    readonly eras?: readonly CalendarEra[];
    readonly periods?: readonly CalendarPeriod[];
}

export interface CalendarProblem {
    /** JSON 指针式的位置，例如 `/leap/1/months/frost`。 */
    readonly path: string;
    readonly code: "calendar-invalid";
    readonly message: string;
}

/** 绝对年份的上限（输出 13）：年份与纪的 `start` 都在正负一千万以内。 */
export const MAX_ABS_YEAR = 10_000_000;
/** 闰年周期乘月数的上限（输出 13）：编译时要把一个周期的每一年、每一月算出来。 */
export const MAX_CYCLE_MONTHS = 2_000_000;

/** 内置的公历（输出 13）：天文纪年（有 0 年，公元前 1 年是 0 年），最小单位是分钟。 */
export const GREGORIAN: Calendar = {
    version: 1,
    unit: "minute",
    hoursPerDay: 24,
    minutesPerHour: 60,
    months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, index) => ({id: `m${String(index + 1)}`, name: `${String(index + 1)}月`, days})),
    leap: [{every: 4, months: {m2: 29}}, {every: 100, months: {m2: 28}}, {every: 400, months: {m2: 29}}],
    eras: [{id: "ad", name: "公元", start: 1}],
    periods: [],
};

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** 非负余数（负年份按向下取整的除法）。 */
export const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

/** 校验作品设置里的历法（输出 13）。合法时返回它（形状收窄），不合法时列出每一处。 */
export function validateCalendar(raw: unknown): {readonly ok: true; readonly calendar: Calendar} | {readonly ok: false; readonly problems: readonly CalendarProblem[]} {
    const problems: CalendarProblem[] = [];
    const fail = (path: string, message: string) => problems.push({path, code: "calendar-invalid", message});
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {ok: false, problems: [{path: "", code: "calendar-invalid", message: "calendar must be an object"}]};
    const value = raw as Record<string, unknown>;
    if (!isPositiveInteger(value.version)) fail("/version", "version must be a positive integer");
    if (!["minute", "hour", "day"].includes(value.unit as string)) fail("/unit", "unit must be minute, hour or day");
    for (const key of ["hoursPerDay", "minutesPerHour"] as const) if (!isPositiveInteger(value[key])) fail(`/${key}`, `${key} must be a positive integer`);
    const months = Array.isArray(value.months) ? (value.months as unknown[]) : null;
    if (months === null || months.length === 0) fail("/months", "months must be a non-empty list");
    const monthIds = new Set<string>();
    for (const [index, month] of (months ?? []).entries()) {
        const item = month as Partial<CalendarMonth> | null;
        if (item === null || typeof item !== "object" || typeof item.id !== "string" || item.id === "" || typeof item.name !== "string") {
            fail(`/months/${String(index)}`, "a month is {id, name, days}");
            continue;
        }
        if (monthIds.has(item.id)) fail(`/months/${String(index)}/id`, `month id "${item.id}" appears twice`);
        monthIds.add(item.id);
        if (!isPositiveInteger(item.days)) fail(`/months/${String(index)}/days`, "days must be a positive integer");
    }
    const leap = value.leap === undefined ? [] : Array.isArray(value.leap) ? (value.leap as unknown[]) : null;
    if (leap === null) fail("/leap", "leap must be a list");
    let cycle = 1;
    for (const [index, rule] of (leap ?? []).entries()) {
        const item = rule as Partial<LeapRule> | null;
        if (item === null || typeof item !== "object" || !isPositiveInteger(item.every)) {
            fail(`/leap/${String(index)}/every`, "every must be a positive integer");
            continue;
        }
        const offset = item.offset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || offset >= item.every) fail(`/leap/${String(index)}/offset`, "offset must be an integer from 0 to every - 1");
        if (item.months === null || typeof item.months !== "object") fail(`/leap/${String(index)}/months`, "months must map month ids to days");
        else for (const [id, days] of Object.entries(item.months)) {
            if (!monthIds.has(id)) fail(`/leap/${String(index)}/months/${id}`, `month "${id}" is not in months`);
            else if (!isPositiveInteger(days)) fail(`/leap/${String(index)}/months/${id}`, "days must be a positive integer");
        }
        cycle = (cycle / gcd(cycle, item.every)) * item.every;
        if (cycle * Math.max(monthIds.size, 1) > MAX_CYCLE_MONTHS) {
            fail("/leap", `the leap cycle times the number of months must not exceed ${String(MAX_CYCLE_MONTHS)}`);
            break;
        }
    }
    const eras = value.eras === undefined ? [] : Array.isArray(value.eras) ? (value.eras as unknown[]) : null;
    if (eras === null) fail("/eras", "eras must be a list");
    const eraIds = new Set<string>();
    let previousStart = Number.NEGATIVE_INFINITY;
    for (const [index, era] of (eras ?? []).entries()) {
        const item = era as Partial<CalendarEra> | null;
        if (item === null || typeof item !== "object" || typeof item.id !== "string" || item.id === "" || typeof item.name !== "string" || !Number.isInteger(item.start)) {
            fail(`/eras/${String(index)}`, "an era is {id, name, start} with an integer start");
            continue;
        }
        if (eraIds.has(item.id)) fail(`/eras/${String(index)}/id`, `era id "${item.id}" appears twice`);
        eraIds.add(item.id);
        if (Math.abs(item.start!) > MAX_ABS_YEAR) fail(`/eras/${String(index)}/start`, `start must be within ±${String(MAX_ABS_YEAR)}`);
        if (item.start! <= previousStart) fail(`/eras/${String(index)}/start`, "eras must be in strictly increasing order of start");
        previousStart = item.start!;
    }
    const periods = value.periods === undefined ? [] : Array.isArray(value.periods) ? (value.periods as unknown[]) : null;
    if (periods === null) fail("/periods", "periods must be a list");
    const periodIds = new Set<string>();
    const hours = isPositiveInteger(value.hoursPerDay) ? value.hoursPerDay : 0;
    for (const [index, period] of (periods ?? []).entries()) {
        const item = period as Partial<CalendarPeriod> | null;
        if (item === null || typeof item !== "object" || typeof item.id !== "string" || item.id === "" || typeof item.name !== "string") {
            fail(`/periods/${String(index)}`, "a period is {id, name, from, to}");
            continue;
        }
        if (periodIds.has(item.id)) fail(`/periods/${String(index)}/id`, `period id "${item.id}" appears twice`);
        periodIds.add(item.id);
        // 一天几小时本身不合法时不再拿它比，免得一处错连带报出每个时段。
        if (hours === 0) continue;
        for (const key of ["from", "to"] as const) {
            const hour = item[key];
            if (!Number.isInteger(hour) || hour! < 0 || hour! >= hours) fail(`/periods/${String(index)}/${key}`, `${key} must be an hour from 0 to hoursPerDay - 1`);
        }
    }
    if (problems.length > 0) return {ok: false, problems};
    const calendar = value as unknown as Calendar;
    // tick 要在 2^53 以内（输出 13）：一年最长的最小单位数乘一千万零一。
    const compiled = compileCalendar(calendar);
    if (compiled.longestYearTicks * (MAX_ABS_YEAR + 1) > Number.MAX_SAFE_INTEGER) return {ok: false, problems: [{path: "", code: "calendar-invalid", message: "a year is too long for the time range: make the unit coarser"}]};
    return {ok: true, calendar};
}

/** 编译好的历法：周期表与换算。只由 `compileCalendar` 建，调用方按历法缓存。 */
export interface CompiledCalendar {
    readonly calendar: Calendar;
    readonly ticksPerDay: number;
    readonly ticksPerHour: number;
    readonly ticksPerMinute: number;
    /** 闰年周期（年）。 */
    readonly cycle: number;
    readonly longestYearTicks: number;
    /** 绝对年份 y 的各月天数。 */
    monthDays(year: number): readonly number[];
    /** 绝对年份 0 的开头到 y 年开头的天数（y 为负时是负数）。 */
    daysBefore(year: number): number;
    /** 这一年第 month 个月（从 0 起）开头的日序号。 */
    monthStart(year: number, month: number): number;
    /** 日序号所在的年、月（从 0 起）、日（从 1 起）。 */
    dayParts(day: number): {readonly year: number; readonly month: number; readonly day: number};
    /** 连续 n 年（月）最短、最长共多少天（输出 12 与输入表的 `L_min`、`L_max`）。 */
    spanDays(unit: "year" | "month", n: number, extreme: "min" | "max"): number;
    monthIndex(id: string): number | undefined;
    era(id: string): CalendarEra | undefined;
    period(id: string): CalendarPeriod | undefined;
}

export function compileCalendar(calendar: Calendar): CompiledCalendar {
    const rules = calendar.leap ?? [];
    const cycle = rules.reduce((value, rule) => (value / gcd(value, rule.every)) * rule.every, 1);
    const ids = calendar.months.map((month) => month.id);
    const table: number[][] = [];
    const yearDays: number[] = [];
    for (let r = 0; r < cycle; r += 1) {
        const days = calendar.months.map((month) => month.days);
        // 按规则的先后检查，后适用的覆盖先适用的。
        for (const rule of rules) {
            if (mod(r - (rule.offset ?? 0), rule.every) !== 0) continue;
            for (const [id, value] of Object.entries(rule.months)) days[ids.indexOf(id)] = value;
        }
        table.push(days);
        yearDays.push(days.reduce((sum, value) => sum + value, 0));
    }
    const prefixYears = [0];
    for (const days of yearDays) prefixYears.push(prefixYears.at(-1)! + days);
    // 周期内每一年各月开头距年初的天数：monthStart 常数时间（月很多的历法也不按月扫）。
    const monthCount = calendar.months.length;
    const monthPrefix = new Float64Array(cycle * (monthCount + 1));
    for (let r = 0; r < cycle; r += 1) for (let m = 0; m < monthCount; m += 1) monthPrefix[r * (monthCount + 1) + m + 1] = monthPrefix[r * (monthCount + 1) + m]! + table[r]![m]!;
    let longestYear = 0;
    for (const days of yearDays) if (days > longestYear) longestYear = days;
    const cycleDays = prefixYears.at(-1)!;
    const ticksPerMinute = calendar.unit === "minute" ? 1 : 0;
    const ticksPerHour = calendar.unit === "day" ? 0 : calendar.unit === "hour" ? 1 : calendar.minutesPerHour;
    const ticksPerDay = calendar.unit === "day" ? 1 : calendar.hoursPerDay * ticksPerHour;
    const monthIds = new Map(ids.map((id, index) => [id, index]));
    const eras = new Map((calendar.eras ?? []).map((era) => [era.id, era]));
    const periods = new Map((calendar.periods ?? []).map((period) => [period.id, period]));
    const daysBefore = (year: number) => Math.floor(year / cycle) * cycleDays + prefixYears[mod(year, cycle)]!;
    // 连续 n 个单位的长度 = 整周期数乘周期长度 + 余下 r 个单位在循环序列上的最短（最长）窗口和；按 r 缓存。
    const sequences = {year: yearDays, month: table.flat()};
    const windows = new Map<string, number>();
    const windowSum = (unit: "year" | "month", r: number, extreme: "min" | "max"): number => {
        const key = `${unit}|${String(r)}|${extreme}`;
        const cached = windows.get(key);
        if (cached !== undefined) return cached;
        const sequence = sequences[unit];
        let sum = 0;
        for (let index = 0; index < r; index += 1) sum += sequence[index]!;
        let best = sum;
        for (let start = 1; start < sequence.length; start += 1) {
            sum += sequence[(start + r - 1) % sequence.length]! - sequence[start - 1]!;
            best = extreme === "min" ? Math.min(best, sum) : Math.max(best, sum);
        }
        windows.set(key, best);
        return best;
    };
    return {
        calendar,
        ticksPerDay,
        ticksPerHour,
        ticksPerMinute,
        cycle,
        // 不用 Math.max(...yearDays)：周期可以有上百万年，展开成参数会撑爆调用栈。
        longestYearTicks: longestYear * ticksPerDay,
        monthDays: (year) => table[mod(year, cycle)]!,
        daysBefore,
        monthStart: (year, month) => daysBefore(year) + monthPrefix[mod(year, cycle) * (monthCount + 1) + month]!,
        dayParts: (day) => {
            const turns = Math.floor(day / cycleDays);
            const rest = day - turns * cycleDays;
            // prefixYears 递增：找最后一个不大于 rest 的下标。
            let low = 0;
            let high = cycle - 1;
            while (low < high) {
                const middle = Math.ceil((low + high) / 2);
                if (prefixYears[middle]! <= rest) low = middle;
                else high = middle - 1;
            }
            let ofYear = rest - prefixYears[low]!;
            const months = table[low]!;
            let month = 0;
            while (ofYear >= months[month]!) {
                ofYear -= months[month]!;
                month += 1;
            }
            return {year: turns * cycle + low, month, day: ofYear + 1};
        },
        // 两个序列各自一圈的总和都是一个闰年周期的天数。
        spanDays: (unit, n, extreme) => Math.floor(n / sequences[unit].length) * cycleDays + windowSum(unit, n % sequences[unit].length, extreme),
        monthIndex: (id) => monthIds.get(id),
        era: (id) => eras.get(id),
        period: (id) => periods.get(id),
    };
}

/** 日期说法（time.md 输入表的 `date`），只含日期本身的几级。 */
export interface DateParts {
    readonly era?: string;
    readonly year: number;
    readonly month?: string;
    readonly day?: number;
    readonly period?: string;
    readonly hour?: number;
    readonly minute?: number;
}

/** “约”的放宽量（模糊词表的 `approx`）：各级都是非负整数。 */
export interface Approx {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly hour: number;
}

export type DateInvalid = "era-missing" | "month-missing" | "period-missing" | "day-out-of-range" | "hour-out-of-range" | "minute-out-of-range" | "year-out-of-range" | "unit-too-fine" | "not-contiguous" | "out-of-range";

/** 日期给到的最细一级。 */
export type Precision = "year" | "month" | "day" | "period" | "hour" | "minute";

/**
 * 日期说法到绝对时间的闭区间（time.md 输入表的 `date`）：E.s 落在这个日期单位里。给了 `approx` 时按给到的最细一级两侧对称放宽
 * （分钟与时段用小时那一级）。不成立时给原因（输出 3）。
 */
export function dateRange(compiled: CompiledCalendar, date: DateParts, approx?: Approx): {readonly lo: number; readonly hi: number; readonly precision: Precision} | {readonly invalid: DateInvalid} {
    const result = dateRangeRaw(compiled, date, approx);
    // 放宽以后的端点也要在时间的范围里（输出 13 的上限）：“约”的量写得极大时不让不精确的数进网络。
    return "invalid" in result || (withinTime(compiled, result.lo) && withinTime(compiled, result.hi)) ? result : {invalid: "out-of-range"};
}

/** 一个 tick 在时间的范围里：绝对年份正负一千万以内（输出 13），换成 tick 一定是安全整数。 */
export function withinTime(compiled: CompiledCalendar, tick: number): boolean {
    return Math.abs(tick) <= compiled.longestYearTicks * (MAX_ABS_YEAR + 1);
}

function dateRangeRaw(compiled: CompiledCalendar, date: DateParts, approx?: Approx): {readonly lo: number; readonly hi: number; readonly precision: Precision} | {readonly invalid: DateInvalid} {
    const {calendar} = compiled;
    if ((date.day !== undefined && date.month === undefined) || ((date.period !== undefined || date.hour !== undefined) && date.day === undefined) || (date.period !== undefined && date.hour !== undefined) || (date.minute !== undefined && date.hour === undefined)) return {invalid: "not-contiguous"};
    if (calendar.unit === "day" && (date.hour !== undefined || date.minute !== undefined || date.period !== undefined)) return {invalid: "unit-too-fine"};
    if (calendar.unit === "hour" && date.minute !== undefined) return {invalid: "unit-too-fine"};
    let year = date.year;
    if (date.era !== undefined) {
        const era = compiled.era(date.era);
        if (era === undefined) return {invalid: "era-missing"};
        year = era.start + date.year - 1;
    }
    if (!Number.isInteger(year) || Math.abs(year) > MAX_ABS_YEAR) return {invalid: "year-out-of-range"};
    const tpd = compiled.ticksPerDay;
    const tph = compiled.ticksPerHour;
    const yearRange = (y: number) => ({lo: compiled.daysBefore(y) * tpd, hi: compiled.daysBefore(y + 1) * tpd - 1});
    if (date.month === undefined) {
        const k = approx?.year ?? 0;
        return {lo: yearRange(year - k).lo, hi: yearRange(year + k).hi, precision: "year"};
    }
    const month = compiled.monthIndex(date.month);
    if (month === undefined) return {invalid: "month-missing"};
    const monthCount = calendar.months.length;
    // 第 index 个月（从绝对年份 0 的第一个月起数）的开头日序号；放宽时按月逐个步进，跨年照算。
    const monthAt = (index: number) => compiled.monthStart(Math.floor(index / monthCount), mod(index, monthCount));
    const monthIndex = year * monthCount + month;
    if (date.day === undefined) {
        const k = approx?.month ?? 0;
        return {lo: monthAt(monthIndex - k) * tpd, hi: monthAt(monthIndex + k + 1) * tpd - 1, precision: "month"};
    }
    if (!Number.isInteger(date.day) || date.day < 1 || date.day > compiled.monthDays(year)[month]!) return {invalid: "day-out-of-range"};
    const day = compiled.monthStart(year, month) + date.day - 1;
    if (date.period === undefined && date.hour === undefined) {
        const k = approx?.day ?? 0;
        return {lo: (day - k) * tpd, hi: (day + k + 1) * tpd - 1, precision: "day"};
    }
    const hourWidth = (approx?.hour ?? 0) * tph;
    if (date.period !== undefined) {
        const period = compiled.period(date.period);
        if (period === undefined) return {invalid: "period-missing"};
        const lo = day * tpd + period.from * tph;
        const hi = period.to > period.from ? day * tpd + period.to * tph - 1 : (day + 1) * tpd + period.to * tph - 1;
        return {lo: lo - hourWidth, hi: hi + hourWidth, precision: "period"};
    }
    const hour = date.hour!;
    if (!Number.isInteger(hour) || hour < 0 || hour >= calendar.hoursPerDay) return {invalid: "hour-out-of-range"};
    const start = day * tpd + hour * tph;
    if (date.minute === undefined) return {lo: start - hourWidth, hi: start + tph - 1 + hourWidth, precision: "hour"};
    if (!Number.isInteger(date.minute) || date.minute < 0 || date.minute >= calendar.minutesPerHour) return {invalid: "minute-out-of-range"};
    return {lo: start + date.minute - hourWidth, hi: start + date.minute + hourWidth, precision: "minute"};
}

/** 一个绝对时间拆回各级（格式化用）：绝对年份、所在的纪与纪内年份（早于第一纪时没有）、月、日、时、分。 */
export function timeParts(compiled: CompiledCalendar, tick: number): {readonly year: number; readonly era?: CalendarEra; readonly eraYear?: number; readonly month: CalendarMonth; readonly day: number; readonly hour?: number; readonly minute?: number} {
    const day = Math.floor(tick / compiled.ticksPerDay);
    const parts = compiled.dayParts(day);
    const within = tick - day * compiled.ticksPerDay;
    const eras = compiled.calendar.eras ?? [];
    let era: CalendarEra | undefined;
    for (const item of eras) if (item.start <= parts.year) era = item;
    return {
        year: parts.year,
        ...(era === undefined ? {} : {era, eraYear: parts.year - era.start + 1}),
        month: compiled.calendar.months[parts.month]!,
        day: parts.day,
        ...(compiled.ticksPerHour === 0 ? {} : {hour: Math.floor(within / compiled.ticksPerHour)}),
        ...(compiled.ticksPerMinute === 0 ? {} : {minute: within % compiled.ticksPerHour}),
    };
}
