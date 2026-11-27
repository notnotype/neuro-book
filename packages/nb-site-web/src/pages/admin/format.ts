/**
 * 管理面板列表里的时间写法（照 t09 定稿的用户页与注册码页）：表格里只写日期，今年的写“11-24”，往年的带上年份；
 * 精确到分钟的时刻放进 `title`。合同的时间都是 ISO 8601 的 UTC 字符串，按浏览器的时区显示（计划 3.2 清单第 6 项）。
 */

const pad = (value: number): string => String(value).padStart(2, "0");

/** 表格里的日期：与 `now` 同一年时是“月-日”，否则是“年-月-日”。都按本地时区。 */
export function shortDate(iso: string, now: number): string {
    const date = new Date(iso);
    const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}-${monthDay}`;
}

/** `title` 里的完整时刻，按界面语言写到分钟。 */
export function fullTime(iso: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}).format(new Date(iso));
}

/**
 * 发放注册码时“过期日期”（`YYYY-MM-DD`）对应的时刻：那一天在本地时区结束的一刻（计划 3.13 的对话框，文案写“到这一天结束时失效”）。
 */
export function endOfLocalDay(day: string): string {
    const [year, month, date] = day.split("-").map(Number) as [number, number, number];
    return new Date(year, month - 1, date, 23, 59, 59, 999).toISOString();
}

/** 本地时区的今天，`YYYY-MM-DD`：过期日期要晚于它。 */
export function localToday(now: number): string {
    const date = new Date(now);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
