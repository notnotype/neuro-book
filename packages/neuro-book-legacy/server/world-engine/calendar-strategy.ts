import type {Instant} from "nbook/server/world-engine/types";

/**
 * Calendar Strategy 抽象接口
 *
 * 负责 Instant ↔ 人读时间字符串的双向转换。
 * 不同历法系统（Simple / Gregorian / Custom）实现此接口。
 */
export interface CalendarStrategy {
    /**
     * 将 Instant 格式化成人读时间字符串
     * @param instant 自世界零点起的秒数（BigInt）
     * @returns 人读时间字符串，如 "复兴纪元312年 5月15日 14:00:00"
     */
    format(instant: Instant): string;

    /**
     * 从人读时间字符串解析 Instant
     * @param input 人读时间字符串
     * @returns Instant（BigInt）
     * @throws 400 错误：格式不符、超出范围
     */
    parse(input: string): Instant;

    /**
     * 返回 schema 投影使用的格式说明
     * @returns format 模板和示例时间数组
     */
    projection(): {format: string; examples: string[]};
}
