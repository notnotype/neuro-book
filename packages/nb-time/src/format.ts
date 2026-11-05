/**
 * 按历法的写法给出时间（docs/specs/canon/time.md 输出 8）：精度到两端落在同一个单位里的最细一级（“王历 612 年霜月”）；跨年时两端
 * 各写到日；无穷的一端写“之前”“之后”。同时给结构化的各级，界面可以自己排。文字固定用中文（年、月、日、时、分、天）。
 */

import {timeParts, type CompiledCalendar} from "./calendar";

export type Level = "year" | "month" | "day" | "hour" | "minute";

export interface FormattedRange {
    readonly text: string;
    /** 两端落在同一个单位里的最细一级；跨年时为 null。 */
    readonly level: Level | null;
}

/** 一个绝对时间写到某一级。 */
export function formatTick(compiled: CompiledCalendar, tick: number, level: Level): string {
    const parts = timeParts(compiled, tick);
    const first = compiled.calendar.eras?.[0];
    const year = parts.era !== undefined ? `${parts.era.name}${String(parts.eraYear)}年` : first !== undefined ? `${first.name}前${String(first.start - parts.year)}年` : `${String(parts.year)}年`;
    if (level === "year") return year;
    const month = `${year}${parts.month.name}`;
    if (level === "month") return month;
    const day = `${month}${String(parts.day)}日`;
    if (level === "day" || parts.hour === undefined) return day;
    const hour = `${day}${String(parts.hour)}时`;
    if (level === "hour" || parts.minute === undefined) return hour;
    return `${hour}${String(parts.minute)}分`;
}

/** 一个闭区间 `[lo, hi]` 按历法写出来。 */
export function formatRange(compiled: CompiledCalendar, lo: number, hi: number): FormattedRange {
    if (!Number.isFinite(lo) && !Number.isFinite(hi)) return {text: "不知道", level: null};
    if (!Number.isFinite(lo)) return {text: `${formatTick(compiled, hi, "day")}之前`, level: null};
    if (!Number.isFinite(hi)) return {text: `${formatTick(compiled, lo, "day")}之后`, level: null};
    const a = timeParts(compiled, lo);
    const b = timeParts(compiled, hi);
    let level: Level | null = null;
    if (a.year === b.year) {
        level = "year";
        if (a.month.id === b.month.id) {
            level = "month";
            if (a.day === b.day) {
                level = "day";
                if (a.hour !== undefined && a.hour === b.hour) {
                    level = "hour";
                    if (a.minute !== undefined && a.minute === b.minute) level = "minute";
                }
            }
        }
    }
    if (level === null) return {text: `${formatTick(compiled, lo, "day")}至${formatTick(compiled, hi, "day")}`, level};
    return {text: formatTick(compiled, lo, level), level};
}

/** 一段时长（tick）写成天、时、分；相对范围用。 */
export function formatSpan(compiled: CompiledCalendar, ticks: number): string {
    if (!Number.isFinite(ticks)) return ticks > 0 ? "无穷久" : "无穷久之前";
    const sign = ticks < 0 ? "-" : "";
    let rest = Math.abs(ticks);
    const days = Math.floor(rest / compiled.ticksPerDay);
    rest -= days * compiled.ticksPerDay;
    const hours = compiled.ticksPerHour === 0 ? 0 : Math.floor(rest / compiled.ticksPerHour);
    const minutes = compiled.ticksPerHour === 0 ? 0 : rest - hours * compiled.ticksPerHour;
    const pieces = [days > 0 ? `${String(days)}天` : "", hours > 0 ? `${String(hours)}时` : "", minutes > 0 ? `${String(minutes)}分` : ""].filter((piece) => piece !== "");
    return `${sign}${pieces.length === 0 ? "0" : pieces.join("")}`;
}
