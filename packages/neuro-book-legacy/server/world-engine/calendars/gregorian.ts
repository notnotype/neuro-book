import {createError} from "h3";
import type {Instant} from "nbook/server/world-engine/types";
import type {CalendarStrategy} from "nbook/server/world-engine/calendar-strategy";

const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Gregorian Calendar 配置
 */
export type GregorianCalendarConfig = {
    /** 类型标识 */
    type: "gregorian";
    /** 纪元名（instant < 0 时） */
    eraBefore: string;
    /** 纪元名（instant >= 0 时） */
    eraAfter: string;
    /** Format 模板 */
    format: string;
    /** 年份零点模式：hasZero（有0年）/ noZero（无0年，对齐真实公历） */
    yearZeroMode?: "hasZero" | "noZero";
};

/**
 * Gregorian Calendar（预置公历）
 *
 * 内置真实公历规则：
 * - 闰年：能被4整除 且（不能被100整除 或 能被400整除）
 * - 大小月：1/3/5/7/8/10/12 月 31 天，4/6/9/11 月 30 天，2 月平年 28、闰年 29
 * - yearZeroMode 强制 "noZero"（无公元0年，对齐真实公历）
 *
 * 注意：instant ↔ parts 需要逐年遍历（因为闰年动态），复杂度 O(year)。
 */
export class GregorianCalendar implements CalendarStrategy {
    private readonly config: GregorianCalendarConfig;

    constructor(config: GregorianCalendarConfig) {
        // Gregorian 强制 noZero
        this.config = {...config, yearZeroMode: "noZero"};
    }

    format(instant: Instant): string {
        const parts = this.partsFromInstant(instant);
        const eraName = parts.year > ZERO ? this.config.eraAfter : this.config.eraBefore;

        let result = this.config.format;
        result = result.replaceAll("{eraName}", eraName);

        // 先替换 :02 格式，再替换普通格式
        result = result.replaceAll("{year:02}", pad2(parts.year > ZERO ? parts.year : -parts.year + ONE));
        result = result.replaceAll("{month:02}", pad2(parts.month));
        result = result.replaceAll("{day:02}", pad2(parts.day));
        result = result.replaceAll("{hour:02}", pad2(parts.hour));
        result = result.replaceAll("{minute:02}", pad2(parts.minute));
        result = result.replaceAll("{second:02}", pad2(parts.second));

        result = result.replaceAll("{year}", String(parts.year > ZERO ? parts.year : -parts.year + ONE));
        result = result.replaceAll("{month}", String(parts.month));
        result = result.replaceAll("{day}", String(parts.day));
        result = result.replaceAll("{hour}", String(parts.hour));
        result = result.replaceAll("{minute}", String(parts.minute));
        result = result.replaceAll("{second}", String(parts.second));

        return result;
    }

    parse(input: string): Instant {
        const text = input.trim();
        // 兼容 instant:<number> 格式
        const rawInstant = /^instant:\s*(-?\d+)$/i.exec(text);
        if (rawInstant?.[1]) {
            return BigInt(rawInstant[1]);
        }

        const regex = this.buildParseRegex();
        const match = regex.exec(text);
        if (!match?.groups) {
            throw createError({statusCode: 400, message: `时间字符串不符合日历格式：${this.config.format}`});
        }

        const year = readInt(match.groups.year, "year");
        const month = readPositiveInt(match.groups.month, "month");
        const day = readPositiveInt(match.groups.day, "day");
        const hour = readNonNegativeInt(match.groups.hour ?? "0", "hour");
        const minute = readNonNegativeInt(match.groups.minute ?? "0", "minute");
        const second = readNonNegativeInt(match.groups.second ?? "0", "second");

        // 检测 era 判断正负
        const fullMatch = text;
        const isBeforeEra = fullMatch.includes(this.config.eraBefore);
        const actualYear = isBeforeEra ? -(year - ONE) : year;

        return this.instantFromParts({year: actualYear, month, day, hour, minute, second});
    }

    projection(): {format: string; examples: string[]} {
        return {
            format: this.config.format,
            examples: [this.format(ZERO), this.format(BigInt(31536000))],
        };
    }

    private partsFromInstant(instant: Instant): {year: bigint; month: bigint; day: bigint; hour: bigint; minute: bigint; second: bigint} {
        let rest = instant;

        // 计算年份（逐年累减，因为闰年动态）。内部 year=0 表示公元前 1 年。
        let year = ONE;
        if (rest >= ZERO) {
            while (rest >= this.secondsInYear(year)) {
                rest -= this.secondsInYear(year);
                year += ONE;
            }
        } else {
            year = ZERO;
            while (rest < ZERO) {
                rest += this.secondsInYear(year);
                if (rest < ZERO) {
                    year -= ONE;
                }
            }
        }

        // 现在 rest 是本年内的秒数，计算 month/day/hour/minute/second
        const daysInMonths = this.getDaysInMonths(year);
        const secondsPerDay = BigInt(86400);
        const secondsPerHour = BigInt(3600);
        const secondsPerMinute = BigInt(60);

        let month = ONE;
        for (let m = 0; m < daysInMonths.length; m++) {
            const secondsThisMonth = BigInt(daysInMonths[m]!) * secondsPerDay;
            if (rest < secondsThisMonth) {
                month = BigInt(m + 1);
                break;
            }
            rest -= secondsThisMonth;
        }

        const day = rest / secondsPerDay + ONE;
        rest %= secondsPerDay;

        const hour = rest / secondsPerHour;
        rest %= secondsPerHour;

        const minute = rest / secondsPerMinute;
        const second = rest % secondsPerMinute;

        return {year, month, day, hour, minute, second};
    }

    private instantFromParts(parts: {year: bigint; month: bigint; day: bigint; hour: bigint; minute: bigint; second: bigint}): Instant {
        const {year, month, day, hour, minute, second} = parts;

        // 校验范围
        if (month < ONE || month > BigInt(12)) {
            throw createError({statusCode: 400, message: `月份超出范围：${month}`});
        }

        const daysInMonths = this.getDaysInMonths(year);
        const maxDay = BigInt(daysInMonths[Number(month) - 1]!);
        if (day < ONE || day > maxDay) {
            throw createError({statusCode: 400, message: `日期超出范围：${day}（${month}月最多${maxDay}天）`});
        }

        if (hour < ZERO || hour >= BigInt(24) || minute < ZERO || minute >= BigInt(60) || second < ZERO || second >= BigInt(60)) {
            throw createError({statusCode: 400, message: "时分秒超出范围"});
        }

        let instant = ZERO;

        // 累加完整年份；内部 year=0 表示公元前 1 年，需向负方向包含该年整年。
        if (year > ZERO) {
            for (let y = ONE; y < year; y += ONE) {
                instant += this.secondsInYear(y);
            }
        } else {
            for (let y = ZERO; y >= year; y -= ONE) {
                instant -= this.secondsInYear(y);
            }
        }

        // 累加本年已过月份
        for (let m = 1; m < Number(month); m++) {
            instant += BigInt(daysInMonths[m - 1]!) * BigInt(86400);
        }

        // 累加本月已过天数 + 时分秒
        instant += (day - ONE) * BigInt(86400);
        instant += hour * BigInt(3600);
        instant += minute * BigInt(60);
        instant += second;

        return instant;
    }

    private isLeapYear(year: bigint): boolean {
        const y = Number(year);
        return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    }

    private secondsInYear(year: bigint): bigint {
        return this.isLeapYear(year) ? BigInt(31622400) : BigInt(31536000); // 366*86400 : 365*86400
    }

    private getDaysInMonths(year: bigint): number[] {
        const feb = this.isLeapYear(year) ? 29 : 28;
        return [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    }

    private buildParseRegex(): RegExp {
        const tokenPattern: Record<string, string> = {
            eraName: `(?:${escapeRegExp(this.config.eraBefore)}|${escapeRegExp(this.config.eraAfter)})`,
            year: "(?<year>\\d+)",
            month: "(?<month>\\d+)",
            day: "(?<day>\\d+)",
            hour: "(?<hour>\\d+)",
            minute: "(?<minute>\\d+)",
            second: "(?<second>\\d+)",
            "hour:02": "(?<hour>\\d{1,2})",
            "minute:02": "(?<minute>\\d{1,2})",
            "second:02": "(?<second>\\d{1,2})",
        };

        let pattern = "";
        let cursor = 0;
        for (const match of this.config.format.matchAll(/\{([^}]+)\}/g)) {
            pattern += escapeRegExp(this.config.format.slice(cursor, match.index));
            const token = match[1] ?? "";
            pattern += tokenPattern[token] ?? escapeRegExp(match[0]);
            cursor = match.index + match[0].length;
        }
        pattern += escapeRegExp(this.config.format.slice(cursor));
        return new RegExp(`^${pattern}$`);
    }
}

// ============================================================================
// 配置归一化
// ============================================================================

export function normalizeGregorianCalendarConfig(input: unknown): GregorianCalendarConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw createError({statusCode: 400, message: "Gregorian Calendar 配置必须是 object"});
    }

    const raw = input as Record<string, unknown>;

    if (raw.type !== "gregorian") {
        throw createError({statusCode: 400, message: `type 必须是 "gregorian"，实际为：${raw.type}`});
    }

    const eraBefore = readString(raw.eraBefore, "eraBefore", "公元前");
    const eraAfter = readString(raw.eraAfter, "eraAfter", "公元");
    const format = readString(raw.format, "format");

    if (!format) {
        throw createError({statusCode: 400, message: "format 不能为空"});
    }

    return {
        type: "gregorian",
        eraBefore,
        eraAfter,
        format,
    };
}

// ============================================================================
// 工具函数
// ============================================================================

function readString(input: unknown, key: string, fallback?: string): string {
    if (input === undefined) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw createError({statusCode: 400, message: `${key} 不能为空`});
    }

    if (typeof input !== "string") {
        throw createError({statusCode: 400, message: `${key} 必须是字符串`});
    }

    return input;
}

function readPositiveInt(input: string | undefined, label: string): bigint {
    const value = readInt(input, label);
    if (value <= ZERO) {
        throw createError({statusCode: 400, message: `${label} 必须大于 0`});
    }
    return value;
}

function readNonNegativeInt(input: string | undefined, label: string): bigint {
    const value = readInt(input, label);
    if (value < ZERO) {
        throw createError({statusCode: 400, message: `${label} 不能小于 0`});
    }
    return value;
}

function readInt(input: string | undefined, label: string): bigint {
    if (!input || !/^-?\d+$/.test(input)) {
        throw createError({statusCode: 400, message: `${label} 不是有效整数`});
    }
    return BigInt(input);
}

function pad2(input: bigint): string {
    return input.toString().padStart(2, "0");
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
