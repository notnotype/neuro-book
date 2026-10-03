import {createError} from "h3";
import type {Instant} from "nbook/server/world-engine/types";
import type {CalendarStrategy} from "nbook/server/world-engine/calendar-strategy";

const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * 单位配置：定义一个时间单位及其与父单位的换算关系
 */
export type UnitConfig = {
    /** 单位名称（如 "minute" / "hour" / "day" / "week" / "month" / "year"） */
    name: string;
    /** 父单位名称（如 "second" / "minute" / "hour"） */
    parent: string;
    /** 换算比例：1 个当前单位 = ratio 个父单位（如 1 minute = 60 second） */
    ratio: number;
    /** 可选：循环名称数组（如周的星期名、月的月份名），长度必须等于 ratio */
    cycleNames?: string[];
    /** 可选：起始偏移（用于 week 等循环单位，默认 0） */
    startOffset?: number;
};

/**
 * Simple Calendar 配置
 */
export type SimpleCalendarConfig = {
    /** 类型标识 */
    type: "simple";
    /** 纪元名（instant < 0 时） */
    eraBefore: string;
    /** 纪元名（instant >= 0 时） */
    eraAfter: string;
    /** 基准单位（instant 的单位，通常是 "second"） */
    baseUnit: string;
    /** 单位链（从小到大） */
    units: UnitConfig[];
    /** Format 模板 */
    format: string;
    /** 年份零点模式：hasZero（有公元0年，数学连续）/ noZero（无公元0年，对齐真实公历） */
    yearZeroMode?: "hasZero" | "noZero";
};

/**
 * Simple Calendar（通用单位链）
 *
 * 支持用户自定义单位层级：
 * - 从 baseUnit（通常是 second）开始，逐层向上定义单位
 * - 每个单位有固定的换算比例（ratio）
 * - 支持循环单位（如 week 的 cycleNames）
 * - 支持 era 前后缀（eraBefore / eraAfter）
 *
 * 限制：
 * - 不支持动态 ratio（闰年/闰月必须走 GregorianCalendar 或 CustomCalendar）
 * - Units 必须形成严格层级（不能有分叉或循环依赖）
 */
export class SimpleCalendar implements CalendarStrategy {
    private readonly unitMap: Map<string, UnitConfig>;
    private readonly unitChain: UnitConfig[]; // 从小到大排序
    private readonly secondsPerUnit: Map<string, bigint>; // 每个单位对应的秒数

    constructor(private readonly config: SimpleCalendarConfig) {
        // 校验并构建单位链
        this.unitMap = new Map(config.units.map(u => [u.name, u]));
        this.unitChain = this.buildUnitChain();
        this.secondsPerUnit = this.computeSecondsPerUnit();
    }

    format(instant: Instant): string {
        const parts = this.partsFromInstant(instant);
        const totalDays = this.getTotalDays(instant);

        let result = this.config.format;

        // Era 处理
        const eraName = instant >= ZERO ? this.config.eraAfter : this.config.eraBefore;
        result = result.replaceAll("{eraName}", eraName);

        // 扩展 token（先替换，避免与主单位冲突）
        result = this.replaceExtendedTokens(result, parts, totalDays);

        // 主单位（year / month / day / hour / minute / second）
        // 先替换 :02 格式，再替换普通格式（避免 {hour} 把 {hour:02} 的一部分替换掉）
        for (const [unitName, value] of Object.entries(parts)) {
            result = result.replaceAll(`{${unitName}:02}`, pad2(value));
            result = result.replaceAll(`{${unitName}}`, String(value));
        }

        return result;
    }

    parse(input: string): Instant {
        const text = input.trim();
        // 兼容 instant:<number> 格式（底层调试用）
        const rawInstant = /^instant:\s*(-?\d+)$/i.exec(text);
        if (rawInstant?.[1]) {
            return BigInt(rawInstant[1]);
        }

        const regex = this.buildParseRegex();
        const match = regex.exec(text);
        if (!match?.groups) {
            throw createError({statusCode: 400, message: `时间字符串不符合日历格式：${this.config.format}`});
        }

        // 提取 parts
        const parts: Record<string, bigint> = {};
        for (const unit of this.unitChain) {
            const value = match.groups[unit.name];
            if (value) {
                parts[unit.name] = BigInt(value);
            }
        }

        // baseUnit (second)
        const baseValue = match.groups[this.config.baseUnit];
        if (baseValue) {
            parts[this.config.baseUnit] = BigInt(baseValue);
        }

        return this.instantFromParts(parts);
    }

    projection(): {format: string; examples: string[]} {
        return {
            format: this.config.format,
            examples: [this.format(ZERO), this.format(BigInt(31536000))], // 0 和 1 年后
        };
    }

    private partsFromInstant(instant: Instant): Record<string, bigint> {
        const parts: Record<string, bigint> = {};
        let rest = instant;

        // 从最大单位开始，逐层除
        for (let i = this.unitChain.length - 1; i >= 0; i--) {
            const unit = this.unitChain[i]!;
            const secondsForUnit = this.secondsPerUnit.get(unit.name)!;
            const offset = floorDiv(rest, secondsForUnit);

            // year/month/day 是 1-based，hour/minute/second 是 0-based
            // 简单判断：如果单位名包含 "year" / "month" / "day"，就是 1-based
            const is1Based = ["year", "month", "day"].includes(unit.name);
            parts[unit.name] = is1Based ? offset + ONE : offset;

            rest -= offset * secondsForUnit;
        }

        // 剩余的 rest 就是 baseUnit（通常是 second，0-based）
        parts[this.config.baseUnit] = rest;

        return parts;
    }

    private getTotalDays(instant: Instant): bigint {
        const dayUnit = this.unitMap.get("day");
        if (!dayUnit) return ZERO;
        const secondsPerDay = this.secondsPerUnit.get("day") ?? ONE;
        return floorDiv(instant, secondsPerDay);
    }

    private replaceExtendedTokens(text: string, parts: Record<string, bigint>, totalDays: bigint): string {
        let result = text;

        // {dayOfYear}
        if (result.includes("{dayOfYear}")) {
            const dayOfYear = this.computeDayOfYear(parts);
            result = result.replaceAll("{dayOfYear}", String(dayOfYear));
        }

        const weekUnit = this.unitMap.get("week");

        // {week} / {weekName}（优先处理，避免被数字替换）
        if (weekUnit && (result.includes("{week}") || result.includes("{weekName}"))) {
            const dayOfWeek = this.computeDayOfWeek(totalDays, weekUnit);
            if (weekUnit.cycleNames) {
                const weekName = weekUnit.cycleNames[Number(dayOfWeek - ONE)] ?? String(dayOfWeek);
                result = result.replaceAll("{week}", weekName);
                result = result.replaceAll("{weekName}", weekName);
            } else {
                // 没有 cycleNames 时，输出数字
                result = result.replaceAll("{week}", String(dayOfWeek));
                result = result.replaceAll("{weekName}", String(dayOfWeek));
            }
        }

        // {dayOfWeek} / {weekOfDay}（数字形式）
        if (weekUnit && (result.includes("{dayOfWeek}") || result.includes("{weekOfDay}"))) {
            const dayOfWeek = this.computeDayOfWeek(totalDays, weekUnit);
            result = result.replaceAll("{dayOfWeek}", String(dayOfWeek));
            result = result.replaceAll("{weekOfDay}", String(dayOfWeek));
        }

        // {weekOfMonth}
        if (result.includes("{weekOfMonth}")) {
            const dayOfMonth = parts.day ?? ONE;
            const weekOfMonth = floorDiv(dayOfMonth - ONE, BigInt(7)) + ONE;
            result = result.replaceAll("{weekOfMonth}", String(weekOfMonth));
        }

        // {monthName}
        const monthUnit = this.unitMap.get("month");
        if (monthUnit && monthUnit.cycleNames && result.includes("{monthName}")) {
            const month = parts.month ?? ONE;
            const monthName = monthUnit.cycleNames[Number(month - ONE)];
            result = result.replaceAll("{monthName}", monthName ?? "");
        }

        return result;
    }

    private computeDayOfYear(parts: Record<string, bigint>): bigint {
        // 累加本年内已过的天数
        // TODO: 实现基于 units 的累加逻辑
        return parts.day ?? ONE;
    }

    private computeDayOfWeek(totalDays: bigint, weekUnit: UnitConfig): bigint {
        const startOffset = BigInt(weekUnit.startOffset ?? 0);
        return ((totalDays + startOffset) % BigInt(weekUnit.ratio)) + ONE;
    }

    private buildParseRegex(): RegExp {
        const tokenPattern: Record<string, string> = {
            eraName: `(?:${escapeRegExp(this.config.eraBefore)}|${escapeRegExp(this.config.eraAfter)})`,
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

        // 扩展 token（暂不支持 parse，只做占位匹配）
        const extendedTokens = [
            "dayOfYear",
            "dayOfWeek",
            "weekOfDay",
            "week",
            "weekName",
            "weekOfMonth",
            "monthName",
        ];
        for (const token of extendedTokens) {
            tokenPattern[token] = "\\S+"; // 匹配任意非空白字符
        }

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

    private instantFromParts(parts: Record<string, bigint>): Instant {
        let instant = ZERO;

        // 从最大单位开始累加
        for (let i = this.unitChain.length - 1; i >= 0; i--) {
            const unit = this.unitChain[i]!;
            const value = parts[unit.name];
            if (value === undefined) {
                throw createError({statusCode: 400, message: `缺少必要单位：${unit.name}`});
            }

            const secondsForUnit = this.secondsPerUnit.get(unit.name)!;

            // year/month/day 是 1-based，需要减 1 后再乘
            const is1Based = ["year", "month", "day"].includes(unit.name);
            const offset = is1Based ? value - ONE : value;

            // 范围校验
            if (is1Based && value < ONE) {
                throw createError({statusCode: 400, message: `${unit.name} 必须 >= 1，实际为：${value}`});
            }
            if (!is1Based && value < ZERO) {
                throw createError({statusCode: 400, message: `${unit.name} 必须 >= 0，实际为：${value}`});
            }

            // 上界校验（根据父单位的 ratio）
            if (unit.parent !== this.config.baseUnit) {
                const parentUnit = this.unitMap.get(unit.parent);
                if (parentUnit) {
                    // 找到以当前单位为 parent 的单位，其 ratio 就是上界
                    const childUnit = this.unitChain.find(u => u.parent === unit.name);
                    if (childUnit && !is1Based && value >= BigInt(childUnit.ratio)) {
                        throw createError({statusCode: 400, message: `${unit.name} 超出范围（0-${childUnit.ratio - 1}），实际为：${value}`});
                    }
                    if (childUnit && is1Based && value > BigInt(childUnit.ratio)) {
                        throw createError({statusCode: 400, message: `${unit.name} 超出范围（1-${childUnit.ratio}），实际为：${value}`});
                    }
                }
            }

            instant += offset * secondsForUnit;
        }

        // baseUnit (second)
        const baseValue = parts[this.config.baseUnit] ?? ZERO;
        if (baseValue < ZERO) {
            throw createError({statusCode: 400, message: `${this.config.baseUnit} 不能为负数`});
        }
        instant += baseValue;

        return instant;
    }

    private buildUnitChain(): UnitConfig[] {
        // 拓扑排序：从 baseUnit 开始，逐层向上构建链
        const visited = new Set<string>();
        const chain: UnitConfig[] = [];

        const visit = (unitName: string): void => {
            if (visited.has(unitName)) return;
            visited.add(unitName);

            // 找到所有以 unitName 为 parent 的单位
            const children = this.config.units.filter(u => u.parent === unitName);

            for (const child of children) {
                visit(child.name);
            }

            // 后序遍历：先访问子节点，再访问当前节点
            const unit = this.unitMap.get(unitName);
            if (unit) {
                chain.push(unit);
            }
        };

        // 从 baseUnit 开始遍历
        visit(this.config.baseUnit);

        // 检查是否所有 units 都被访问到
        if (chain.length !== this.config.units.length) {
            const missing = this.config.units.filter(u => !visited.has(u.name)).map(u => u.name);
            throw createError({statusCode: 400, message: `Units 存在孤立节点或环：${missing.join(", ")}`});
        }

        // 反转：后序遍历是从大到小，需要反转成从小到大（minute → hour → day → month → year）
        return chain.reverse();
    }

    private computeSecondsPerUnit(): Map<string, bigint> {
        const result = new Map<string, bigint>();
        result.set(this.config.baseUnit, ONE);

        // unitChain 已经是拓扑排序（从小到大），按顺序累乘
        for (const unit of this.unitChain) {
            const parentSeconds = result.get(unit.parent);
            if (!parentSeconds) {
                throw createError({statusCode: 400, message: `单位 ${unit.name} 的父单位 ${unit.parent} 不存在`});
            }
            result.set(unit.name, parentSeconds * BigInt(unit.ratio));
        }

        return result;
    }
}

// ============================================================================
// 配置归一化与校验
// ============================================================================

export function normalizeSimpleCalendarConfig(input: unknown): SimpleCalendarConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw createError({statusCode: 400, message: "Simple Calendar 配置必须是 object"});
    }

    const raw = input as Record<string, unknown>;

    if (raw.type !== "simple") {
        throw createError({statusCode: 400, message: `type 必须是 "simple"，实际为：${raw.type}`});
    }

    const eraBefore = readString(raw.eraBefore, "eraBefore", "蒙昧纪元");
    const eraAfter = readString(raw.eraAfter, "eraAfter", "新生纪元");
    const baseUnit = readString(raw.baseUnit, "baseUnit", "second");
    const format = readString(raw.format, "format");
    const yearZeroMode = readYearZeroMode(raw.yearZeroMode);

    if (!format) {
        throw createError({statusCode: 400, message: "format 不能为空"});
    }

    const units = readUnits(raw.units);

    return {
        type: "simple",
        eraBefore,
        eraAfter,
        baseUnit,
        units,
        format,
        yearZeroMode,
    };
}

function readUnits(input: unknown): UnitConfig[] {
    if (!Array.isArray(input)) {
        throw createError({statusCode: 400, message: "units 必须是数组"});
    }

    if (input.length === 0) {
        throw createError({statusCode: 400, message: "units 不能为空"});
    }

    return input.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw createError({statusCode: 400, message: `units[${index}] 必须是 object`});
        }

        const raw = item as Record<string, unknown>;
        const name = readString(raw.name, `units[${index}].name`);
        const parent = readString(raw.parent, `units[${index}].parent`);
        const ratio = readPositiveInt(raw.ratio, `units[${index}].ratio`);

        if (!name || !parent) {
            throw createError({statusCode: 400, message: `units[${index}] 缺少 name 或 parent`});
        }

        const cycleNames = readCycleNames(raw.cycleNames, ratio, `units[${index}]`);
        const startOffset = readNonNegativeInt(raw.startOffset, `units[${index}].startOffset`, 0);

        return {name, parent, ratio, cycleNames, startOffset};
    });
}

function readCycleNames(input: unknown, ratio: number, context: string): string[] | undefined {
    if (input === undefined) {
        return undefined;
    }

    if (!Array.isArray(input)) {
        throw createError({statusCode: 400, message: `${context}.cycleNames 必须是数组`});
    }

    if (input.length !== ratio) {
        throw createError({statusCode: 400, message: `${context}.cycleNames 长度（${input.length}）必须等于 ratio（${ratio}）`});
    }

    return input.map((item, i) => {
        if (typeof item !== "string") {
            throw createError({statusCode: 400, message: `${context}.cycleNames[${i}] 必须是字符串`});
        }
        return item;
    });
}

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

function readPositiveInt(input: unknown, key: string): number {
    if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) {
        throw createError({statusCode: 400, message: `${key} 必须是正整数`});
    }
    return input;
}

function readNonNegativeInt(input: unknown, key: string, fallback: number): number {
    if (input === undefined) {
        return fallback;
    }

    if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0) {
        throw createError({statusCode: 400, message: `${key} 必须是非负整数`});
    }

    return input;
}

function readYearZeroMode(input: unknown): "hasZero" | "noZero" {
    if (input === undefined) {
        return "hasZero";
    }

    if (input !== "hasZero" && input !== "noZero") {
        throw createError({statusCode: 400, message: `yearZeroMode 必须是 "hasZero" 或 "noZero"，实际为：${input}`});
    }

    return input;
}

// ============================================================================
// 工具函数
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
