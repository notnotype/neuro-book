/**
 * w00039 t32 时间原型：历法。一次性原型，不是产品代码。
 *
 * 内部统一用“分钟数”（从历元，即元年第一个月第一天 0 时起算）表示时间点；历法只管换算与显示。
 * 历法是数据：一天几小时、每月几天叫什么、闰年规则、纪年名、一天里的时段。
 */

export type CalendarDef = {
    readonly name: string;
    /** 纪年名，例如“王历”。相对历法（以开篇那天为第 1 天）不写。 */
    readonly era?: string;
    readonly hoursPerDay: number;
    readonly minutesPerHour: number;
    readonly months: ReadonlyArray<{readonly name: string; readonly days: number}>;
    /** 每隔 every 年，第 month 个月（从 1 起）多 extra 天。 */
    readonly leap?: {readonly every: number; readonly month: number; readonly extra: number};
    /** 一天里的时段，按小时 [from, to)。 */
    readonly dayParts?: ReadonlyArray<{readonly name: string; readonly from: number; readonly to: number}>;
    /** 相对历法：显示成“开篇前 N 年”“第 N 天”，历元是开篇那天。 */
    readonly relative?: boolean;
};

/** 日历上的一个日子，精度到哪一级就写到哪一级（借用 EDTF 的“精度”概念，不用它的字符串格式）。 */
export type CalendarDate = {
    readonly year: number;
    readonly month?: number;
    readonly day?: number;
    readonly part?: string;
    readonly hour?: number;
};

/** 一段时长：lo 到 hi 个单位（“两三天”是 2 到 3 天）。 */
export type Duration = {readonly lo: number; readonly hi: number; readonly unit: "year" | "month" | "day" | "hour" | "minute"};

export class Calendar {
    readonly minutesPerDay: number;
    readonly baseYearDays: number;

    constructor(readonly def: CalendarDef) {
        this.minutesPerDay = def.hoursPerDay * def.minutesPerHour;
        this.baseYearDays = def.months.reduce((sum, month) => sum + month.days, 0);
    }

    private isLeap(year: number): boolean {
        const leap = this.def.leap;
        return leap !== undefined && ((year % leap.every) + leap.every) % leap.every === 0;
    }

    private leapCount(from: number, to: number): number {
        const leap = this.def.leap;
        if (leap === undefined || to < from) return 0;
        return Math.floor(to / leap.every) - Math.floor((from - 1) / leap.every);
    }

    yearDays(year: number): number {
        return this.baseYearDays + (this.isLeap(year) ? this.def.leap!.extra : 0);
    }

    monthDays(year: number, month: number): number {
        const base = this.def.months[month - 1]!.days;
        return base + (this.isLeap(year) && this.def.leap!.month === month ? this.def.leap!.extra : 0);
    }

    /** 某年第一天在历元之后第几天（历元是元年第一天；元年之前的年份为负）。 */
    yearStartDay(year: number): number {
        const extra = this.def.leap?.extra ?? 0;
        if (year >= 1) return (year - 1) * this.baseYearDays + this.leapCount(1, year - 1) * extra;
        return -((1 - year) * this.baseYearDays + this.leapCount(year, 0) * extra);
    }

    /** 一个日子覆盖的区间 [start, end)，单位分钟。 */
    interval(date: CalendarDate): [number, number] {
        const yearStart = this.yearStartDay(date.year) * this.minutesPerDay;
        if (date.month === undefined) return [yearStart, yearStart + this.yearDays(date.year) * this.minutesPerDay];
        let day = 0;
        for (let month = 1; month < date.month; month += 1) day += this.monthDays(date.year, month);
        const monthStart = yearStart + day * this.minutesPerDay;
        if (date.day === undefined) return [monthStart, monthStart + this.monthDays(date.year, date.month) * this.minutesPerDay];
        const dayStart = monthStart + (date.day - 1) * this.minutesPerDay;
        if (date.part !== undefined) {
            const part = this.def.dayParts?.find((item) => item.name === date.part);
            if (part === undefined) throw new Error(`没有这个时段：${date.part}`);
            return [dayStart + part.from * this.def.minutesPerHour, dayStart + part.to * this.def.minutesPerHour];
        }
        if (date.hour !== undefined) return [dayStart + date.hour * this.def.minutesPerHour, dayStart + (date.hour + 1) * this.def.minutesPerHour];
        return [dayStart, dayStart + this.minutesPerDay];
    }

    /** 时长换成分钟数的范围：年、月按最短与最长的长度算，所以“十五年”在有闰年的历法里是一个小范围。 */
    span(duration: Duration): [number, number] {
        const shortestMonth = Math.min(...this.def.months.map((month) => month.days));
        const longestMonth = Math.max(...this.def.months.map((month) => month.days)) + (this.def.leap?.extra ?? 0);
        const extra = this.def.leap?.extra ?? 0;
        const [minUnit, maxUnit] = {
            year: [this.baseYearDays * this.minutesPerDay, (this.baseYearDays + extra) * this.minutesPerDay],
            month: [shortestMonth * this.minutesPerDay, longestMonth * this.minutesPerDay],
            day: [this.minutesPerDay, this.minutesPerDay],
            hour: [this.def.minutesPerHour, this.def.minutesPerHour],
            minute: [1, 1],
        }[duration.unit];
        return [duration.lo * minUnit!, duration.hi === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : duration.hi * maxUnit!];
    }

    /** 分钟数换成日子。 */
    dateOf(minute: number): {year: number; month: number; day: number; hour: number} {
        const dayIndex = Math.floor(minute / this.minutesPerDay);
        let year = Math.floor(dayIndex / this.baseYearDays) + 1;
        while (this.yearStartDay(year) > dayIndex) year -= 1;
        while (this.yearStartDay(year + 1) <= dayIndex) year += 1;
        let rest = dayIndex - this.yearStartDay(year);
        let month = 1;
        while (rest >= this.monthDays(year, month)) {
            rest -= this.monthDays(year, month);
            month += 1;
        }
        const hour = Math.floor((minute - dayIndex * this.minutesPerDay) / this.def.minutesPerHour);
        return {year, month, day: rest + 1, hour};
    }

    /** 显示一个时间点，精度由调用方给。 */
    format(minute: number, precision: "year" | "month" | "day" | "hour"): string {
        if (this.def.relative) return this.formatRelative(minute, precision);
        const date = this.dateOf(minute);
        const year = `${this.def.era ?? ""} ${date.year} 年`.trim();
        if (precision === "year") return year;
        const month = this.def.months[date.month - 1]!.name;
        if (precision === "month") return `${year}${month}`;
        if (precision === "day") return `${year}${month} ${date.day} 日`;
        const part = this.def.dayParts?.find((item) => date.hour >= item.from && date.hour < item.to)?.name;
        return `${year}${month} ${date.day} 日 ${date.hour} 时${part === undefined ? "" : `（${part}）`}`;
    }

    private formatRelative(minute: number, precision: "year" | "month" | "day" | "hour"): string {
        const days = Math.floor(minute / this.minutesPerDay);
        if (days >= 0) {
            if (precision === "hour") return `第 ${days + 1} 天 ${Math.floor((minute - days * this.minutesPerDay) / this.def.minutesPerHour)} 时`;
            return `第 ${days + 1} 天`;
        }
        const before = -days;
        if (precision === "year" || before >= this.baseYearDays) return `开篇前 ${(before / this.baseYearDays).toFixed(1)} 年`;
        return `开篇前 ${before} 天`;
    }

    /** 显示一个可能的范围：按范围的宽度选精度。 */
    formatRange(lo: number, hi: number): string {
        if (!Number.isFinite(lo) && !Number.isFinite(hi)) return "推不出";
        const width = hi - lo;
        const yearMinutes = this.baseYearDays * this.minutesPerDay;
        // 恰好是一整年、一整月、一整天的区间（[起, 止) 存成 [起, 止 − 1]）按那一级显示。
        const precision = width >= 0.9 * yearMinutes ? "year" : width >= 25 * this.minutesPerDay ? "month" : width >= 0.9 * this.minutesPerDay ? "day" : "hour";
        const left = Number.isFinite(lo) ? this.format(lo, precision) : "很早以前";
        const right = Number.isFinite(hi) ? this.format(hi, precision) : "之后某时";
        return left === right ? left : `${left} 至 ${right}`;
    }
}
