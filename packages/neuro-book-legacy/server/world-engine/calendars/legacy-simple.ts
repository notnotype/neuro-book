import {createError} from "h3";
import type {Instant} from "nbook/server/world-engine/types";
import type {CalendarStrategy} from "nbook/server/world-engine/calendar-strategy";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const DEFAULT_FORMAT = "{era}{year}年 {month}月{day}日 {hour:02}:{minute:02}:{second:02}";
const FORMAT_TIME_FIELDS = new Map<string, string>([
    ["year", "year"],
    ["month", "month"],
    ["day", "day"],
    ["hour", "hour"],
    ["hour:02", "hour"],
    ["minute", "minute"],
    ["minute:02", "minute"],
    ["second", "second"],
    ["second:02", "second"],
]);

type LegacyCalendarConfig = {
    era: string;
    format: string;
    secondsPerMinute: bigint;
    minutesPerHour: bigint;
    hoursPerDay: bigint;
    daysPerMonth: bigint;
    monthsPerYear: bigint;
};

/**
 * Legacy Simple Calendar（旧 calendar.yaml 历史实现参考）
 *
 * 支持固定单位的简单历法：
 * - 固定的 secondsPerMinute / minutesPerHour / hoursPerDay / daysPerMonth / monthsPerYear
 * - 每月等长、每年等长
 * - 不支持闰年、闰月、不等长月份
 *
 * 当前 loader 已硬切到 calendar.ts，不再实例化本类；文件仅保留作历史实现参考。
 */
export class LegacySimpleCalendar implements CalendarStrategy {
    constructor(private readonly config: LegacyCalendarConfig) {}

    format(instant: Instant): string {
        const parts = this.partsFromInstant(instant);
        return this.config.format
            .replaceAll("{era}", this.config.era)
            .replaceAll("{year}", String(parts.year))
            .replaceAll("{month}", String(parts.month))
            .replaceAll("{day}", String(parts.day))
            .replaceAll("{hour}", String(parts.hour))
            .replaceAll("{minute}", String(parts.minute))
            .replaceAll("{second}", String(parts.second))
            .replaceAll("{hour:02}", pad2(parts.hour))
            .replaceAll("{minute:02}", pad2(parts.minute))
            .replaceAll("{second:02}", pad2(parts.second));
    }

    parse(input: string): Instant {
        const text = input.trim();
        // 兼容 instant:<number> 格式（底层调试用，不暴露到工具层）
        const rawInstant = /^instant:\s*(-?\d+)$/i.exec(text);
        const rawInstantValue = rawInstant?.[1];
        if (rawInstantValue) {
            return BigInt(rawInstantValue);
        }

        const regex = this.regexFromFormat();
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
        return this.instantFromParts({year, month, day, hour, minute, second});
    }

    projection(): {format: string; examples: string[]} {
        return {
            format: this.config.format,
            examples: [this.format(ZERO), this.format(this.instantFromParts({year: BigInt(488), month: ONE, day: BigInt(15), hour: BigInt(14), minute: ZERO, second: ZERO}))],
        };
    }

    private partsFromInstant(instant: Instant): {year: bigint; month: bigint; day: bigint; hour: bigint; minute: bigint; second: bigint} {
        const secondsPerHour = this.config.secondsPerMinute * this.config.minutesPerHour;
        const secondsPerDay = secondsPerHour * this.config.hoursPerDay;
        const secondsPerMonth = secondsPerDay * this.config.daysPerMonth;
        const secondsPerYear = secondsPerMonth * this.config.monthsPerYear;
        let rest = instant;
        const yearOffset = floorDiv(rest, secondsPerYear);
        rest -= yearOffset * secondsPerYear;
        const monthOffset = floorDiv(rest, secondsPerMonth);
        rest -= monthOffset * secondsPerMonth;
        const dayOffset = floorDiv(rest, secondsPerDay);
        rest -= dayOffset * secondsPerDay;
        const hour = floorDiv(rest, secondsPerHour);
        rest -= hour * secondsPerHour;
        const minute = floorDiv(rest, this.config.secondsPerMinute);
        rest -= minute * this.config.secondsPerMinute;
        return {
            year: yearOffset + ONE,
            month: monthOffset + ONE,
            day: dayOffset + ONE,
            hour,
            minute,
            second: rest,
        };
    }

    private instantFromParts(parts: {year: bigint; month: bigint; day: bigint; hour: bigint; minute: bigint; second: bigint}): Instant {
        if (parts.month < ONE || parts.month > this.config.monthsPerYear) {
            throw createError({statusCode: 400, message: `月份超出范围：${parts.month}`});
        }
        if (parts.day < ONE || parts.day > this.config.daysPerMonth) {
            throw createError({statusCode: 400, message: `日期超出范围：${parts.day}`});
        }
        if (parts.hour < ZERO || parts.hour >= this.config.hoursPerDay || parts.minute < ZERO || parts.minute >= this.config.minutesPerHour || parts.second < ZERO || parts.second >= this.config.secondsPerMinute) {
            throw createError({statusCode: 400, message: "时分秒超出日历范围"});
        }
        const secondsPerHour = this.config.secondsPerMinute * this.config.minutesPerHour;
        const secondsPerDay = secondsPerHour * this.config.hoursPerDay;
        const secondsPerMonth = secondsPerDay * this.config.daysPerMonth;
        const secondsPerYear = secondsPerMonth * this.config.monthsPerYear;
        return (parts.year - ONE) * secondsPerYear + (parts.month - ONE) * secondsPerMonth + (parts.day - ONE) * secondsPerDay + parts.hour * secondsPerHour + parts.minute * this.config.secondsPerMinute + parts.second;
    }

    private regexFromFormat(): RegExp {
        const tokenPattern: Record<string, string> = {
            era: escapeRegExp(this.config.era),
            year: "(?<year>-?\\d+)",
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
// 工具函数（从 calendar.ts 迁移）
// ============================================================================

function floorDiv(left: bigint, right: bigint): bigint {
    const quotient = left / right;
    const remainder = left % right;
    return remainder < ZERO ? quotient - ONE : quotient;
}

function pad2(input: bigint): string {
    return input.toString().padStart(2, "0");
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

// ============================================================================
// Legacy YAML Config 归一化（从 calendar.ts 迁移）
// ============================================================================

const DEFAULT_SECONDS_PER_MINUTE = BigInt(60);
const DEFAULT_MINUTES_PER_HOUR = BigInt(60);
const DEFAULT_HOURS_PER_DAY = BigInt(24);
const DEFAULT_DAYS_PER_MONTH = BigInt(30);
const DEFAULT_MONTHS_PER_YEAR = BigInt(12);

type RawCalendarConfig = Record<string, unknown>;

export function normalizeLegacyCalendarConfig(input: unknown): LegacyCalendarConfig {
    const config = readCalendarConfig(input);
    return {
        era: readEra(config?.era),
        format: readFormat(config?.format),
        secondsPerMinute: readConfigBigInt(config?.secondsPerMinute, DEFAULT_SECONDS_PER_MINUTE, "secondsPerMinute"),
        minutesPerHour: readConfigBigInt(config?.minutesPerHour, DEFAULT_MINUTES_PER_HOUR, "minutesPerHour"),
        hoursPerDay: readConfigBigInt(config?.hoursPerDay, DEFAULT_HOURS_PER_DAY, "hoursPerDay"),
        daysPerMonth: readConfigBigInt(config?.daysPerMonth, DEFAULT_DAYS_PER_MONTH, "daysPerMonth"),
        monthsPerYear: readConfigBigInt(config?.monthsPerYear, DEFAULT_MONTHS_PER_YEAR, "monthsPerYear"),
    };
}

function readCalendarConfig(input: unknown): RawCalendarConfig | null {
    if (input === null || input === undefined) {
        return null;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw createError({statusCode: 400, message: "calendar 配置必须是 object"});
    }
    return input as RawCalendarConfig;
}

function readEra(input: unknown): string {
    if (input === undefined) {
        return "复兴纪元";
    }
    if (typeof input !== "string") {
        throw createError({statusCode: 400, message: "era 必须是字符串"});
    }
    return input;
}

function readFormat(input: unknown): string {
    if (input === undefined) {
        return DEFAULT_FORMAT;
    }
    if (typeof input !== "string" || !input.trim()) {
        throw createError({statusCode: 400, message: "format 必须是非空字符串"});
    }
    for (const token of ["{year}", "{month}", "{day}"]) {
        if (!input.includes(token)) {
            throw createError({statusCode: 400, message: `format 缺少必要 token：${token}`});
        }
    }
    assertUniqueTimeFields(input);
    return input;
}

function assertUniqueTimeFields(format: string): void {
    const seen = new Map<string, string>();
    for (const match of format.matchAll(/\{([^}]+)\}/g)) {
        const token = match[1] ?? "";
        const field = FORMAT_TIME_FIELDS.get(token);
        if (!field) {
            continue;
        }
        const previousToken = seen.get(field);
        if (previousToken) {
            throw createError({statusCode: 400, message: `format 时间字段不能重复：${previousToken} / ${token}`});
        }
        seen.set(field, token);
    }
}

function readConfigBigInt(input: unknown, fallback: bigint, key: string): bigint {
    if (input === undefined) {
        return fallback;
    }
    if (typeof input === "number") {
        if (Number.isSafeInteger(input) && input > 0) {
            return BigInt(input);
        }
        throw createError({statusCode: 400, message: `${key} 必须是安全正整数`});
    }
    if (typeof input === "string" && /^\d+$/.test(input)) {
        const value = BigInt(input);
        if (value > ZERO) {
            return value;
        }
    }
    throw createError({statusCode: 400, message: `${key} 必须是正整数`});
}
