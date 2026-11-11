/**
 * 列表里一个时刻的短写法（docs/specs/workbench/background-tasks.md 输出 10 的“时间”，通知视图同一规则）：当天写“时:分”，
 * 前一天写“昨天”（文字由调用方按语言给），更早写月日；按浏览器的本地时区算日子。完整写法给悬停提示用。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** formatter 按语言缓存：列表每行都要格式化，不在循环里反复构建。 */
const clocks = new Map<string, Intl.DateTimeFormat>();
const dates = new Map<string, Intl.DateTimeFormat>();
const fulls = new Map<string, Intl.DateTimeFormat>();

function cached(cache: Map<string, Intl.DateTimeFormat>, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    let formatter = cache.get(locale);
    if (formatter === undefined) {
        formatter = new Intl.DateTimeFormat(locale, options);
        cache.set(locale, formatter);
    }
    return formatter;
}

function startOfDay(at: number): number {
    const date = new Date(at);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function shortTime(at: number, now: number, locale: string, yesterday: string): string {
    // 按日历日相减再四舍五入：跨夏令时的那天不是整 24 小时。
    const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
    if (days <= 0) return cached(clocks, locale, {hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(at);
    if (days === 1) return yesterday;
    return cached(dates, locale, {month: "numeric", day: "numeric"}).format(at);
}

export function fullTime(at: number, locale: string): string {
    return cached(fulls, locale, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(at);
}
