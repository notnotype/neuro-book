import {createError} from "h3";
import type {Instant} from "nbook/server/world-engine/types";
import type {CalendarStrategy} from "nbook/server/world-engine/calendar-strategy";

/**
 * Custom Calendar 配置
 */
export type CustomCalendarConfig = {
    /** 类型标识 */
    type: "custom";
    /** 用户实现的 format 函数 */
    format: (instant: Instant) => string;
    /** 用户实现的 parse 函数 */
    parse: (input: string) => Instant;
    /** 可选：用户实现的 projection 函数 */
    projection?: () => {format: string; examples: string[]};
};

/**
 * Custom Calendar（用户手写函数）
 *
 * 简单包装用户提供的 format/parse 函数。
 * 用于复杂历法（如农历闰月）或任意自定义规则，无法通过 SimpleCalendar 配置表达。
 */
export class CustomCalendar implements CalendarStrategy {
    constructor(private readonly config: CustomCalendarConfig) {
        // 校验函数存在
        if (typeof config.format !== "function") {
            throw createError({statusCode: 400, message: "CustomCalendar.format 必须是函数"});
        }
        if (typeof config.parse !== "function") {
            throw createError({statusCode: 400, message: "CustomCalendar.parse 必须是函数"});
        }
    }

    format(instant: Instant): string {
        try {
            const result = this.config.format(instant);
            if (typeof result !== "string") {
                throw createError({statusCode: 500, message: "CustomCalendar.format 必须返回字符串"});
            }
            return result;
        } catch (error) {
            throw createError({statusCode: 500, message: `CustomCalendar.format 执行失败：${error instanceof Error ? error.message : String(error)}`});
        }
    }

    parse(input: string): Instant {
        try {
            const result = this.config.parse(input);
            if (typeof result !== "bigint") {
                throw createError({statusCode: 500, message: "CustomCalendar.parse 必须返回 bigint"});
            }
            return result;
        } catch (error) {
            throw createError({statusCode: 400, message: `CustomCalendar.parse 执行失败：${error instanceof Error ? error.message : String(error)}`});
        }
    }

    projection(): {format: string; examples: string[]} {
        if (this.config.projection && typeof this.config.projection === "function") {
            try {
                return this.config.projection();
            } catch (error) {
                throw createError({statusCode: 500, message: `CustomCalendar.projection 执行失败：${error instanceof Error ? error.message : String(error)}`});
            }
        }

        // 默认 projection：用 format(0) 和 format(31536000) 作为示例
        return {
            format: "自定义格式",
            examples: [this.format(BigInt(0)), this.format(BigInt(31536000))],
        };
    }
}

// ============================================================================
// 配置归一化
// ============================================================================

export function normalizeCustomCalendarConfig(input: unknown): CustomCalendarConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw createError({statusCode: 400, message: "Custom Calendar 配置必须是 object"});
    }

    const raw = input as Record<string, unknown>;

    if (raw.type !== "custom") {
        throw createError({statusCode: 400, message: `type 必须是 "custom"，实际为：${raw.type}`});
    }

    if (typeof raw.format !== "function") {
        throw createError({statusCode: 400, message: "format 必须是函数"});
    }

    if (typeof raw.parse !== "function") {
        throw createError({statusCode: 400, message: "parse 必须是函数"});
    }

    const projection = raw.projection !== undefined && typeof raw.projection === "function" ? (raw.projection as () => {format: string; examples: string[]}) : undefined;

    return {
        type: "custom",
        format: raw.format as (instant: Instant) => string,
        parse: raw.parse as (input: string) => Instant,
        projection,
    };
}
