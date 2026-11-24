/**
 * 服务端日、心跳段与 ISO 周的计算。全是 UTC 的整数运算，时间一律由调用方从 `ModuleContext.clock` 取来传入，
 * 这里不读系统时钟：合同测试拨的是那只时钟（`nb-site-server/AGENTS.md` 的测试控制入口）。
 *
 * - 服务端日：UTC 1970-01-01 起的天数（`site.telemetry-ingest` 的术语、输出 2）。库里存这个整数，对外写成 `YYYY-MM-DD`。
 * - 心跳段：UTC 时间按 15 分钟切出的一段的序号（同上）。
 * - ISO 周：周一开始、含 1 月 4 日的那一周是第 1 周（ISO 8601）；所以 12 月底的几天可能属于下一年的第 1 周，
 *   1 月初的几天可能属于上一年的第 52 或 53 周。
 */

export const DAY_MS = 86_400_000;

export const HEARTBEAT_SEGMENT_MS = 900_000;

/** `nowMs` 所在的服务端日。 */
export function serverDayAt(nowMs: number): number {
    return Math.floor(nowMs / DAY_MS);
}

/** `nowMs` 所在的心跳段。 */
export function heartbeatSegmentAt(nowMs: number): number {
    return Math.floor(nowMs / HEARTBEAT_SEGMENT_MS);
}

/** 服务端日的对外写法 `YYYY-MM-DD`（协议输出 1）。 */
export function formatServerDay(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 原始上报的删除界：记入日早于它的原始上报要删（`site.telemetry-ingest` 输出 3 的“早于今天减保留天数”）。
 * 第 D 天记入的一份在今天到了 D + 保留天数 + 1 时才早于界，所以至少留满保留天数个整天。
 */
export function retentionCutoffDay(today: number, retentionDays: number): number {
    return today - retentionDays;
}

/** 1970-01-01 是周四；周一记 0。 */
function weekdayFromMonday(day: number): number {
    return (((day + 3) % 7) + 7) % 7;
}

/** `day` 所在 ISO 周的周一。 */
export function isoWeekMondayOf(day: number): number {
    return day - weekdayFromMonday(day);
}

/** 某年某月某日的服务端日。不用 `Date.UTC`：它把 0 到 99 年当成 1900 年代。 */
function civilDay(year: number, monthIndex: number, date: number): number {
    const moment = new Date(0);
    moment.setUTCFullYear(year, monthIndex, date);
    return Math.floor(moment.getTime() / DAY_MS);
}

/** `day` 属于哪一年的第几周（ISO）：按这一周的周四所在的年份算。 */
export function isoWeekOf(day: number): {readonly year: number; readonly week: number} {
    const thursday = isoWeekMondayOf(day) + 3;
    const year = new Date(thursday * DAY_MS).getUTCFullYear();
    return {year, week: Math.floor((thursday - civilDay(year, 0, 1)) / 7) + 1};
}

/** `day` 所在的 ISO 周写成 `YYYY-Www`，与清单里 `installWeek` 的写法相同。 */
export function formatIsoWeek(day: number): string {
    const {year, week} = isoWeekOf(day);
    return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

/**
 * `year` 年第 `week` 周的周一；这一年没有这一周时（例如没有第 53 周的年份写了 W53）为 null。
 * 写法本身（四位年份、两位周号 01 到 53）由调用方先按清单的 schema 判过。
 */
export function isoWeekMonday(year: number, week: number): number | null {
    const monday = isoWeekMondayOf(civilDay(year, 0, 4)) + 7 * (week - 1);
    const actual = isoWeekOf(monday);
    return actual.year === year && actual.week === week ? monday : null;
}
