/**
 * 假接口回答的看板数据。查询接口的响应 schema 归 t11，现在没有合同可对：每份按看板的视图模型（`src/pages/admin/dashboard/model.ts`）
 * 写，`satisfies` 管形状；`tests/e2e-fixtures.test.ts` 只核账号模块那几份。t11 出了查询接口的合同后，这里改成按合同写、过 schema。
 *
 * 数据照真实的样子：活跃图近 28 天里有两天没有任何上报（线在那里断开）、一天有上报而日活跃为 0；在线图近 24 小时里有一段没有心跳。
 * 组件测试另有一份（`src/testing/dashboard-answers.ts`），两边各自准备，页面不导入任何一份。
 */

import type {ActiveDay, ActiveSeries, Breakdown, DashboardRange, DashboardToday, OnlineSeries, Problems, Retention} from "../../src/pages/admin/dashboard/model";

/** 范围的最后一天。 */
export const LAST_DAY = "2026-11-26";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateBefore = (days: number): string => new Date(Date.parse(`${LAST_DAY}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/** 近 28 天里没有任何上报的两天，与有上报而日活跃为 0 的那天。 */
export const MISSING_DAYS = [dateBefore(9), dateBefore(8)] as const;
export const ZERO_DAY = dateBefore(4);

/** 第 `offset` 天（0 是范围的第一天）的三个数：日活跃有周末的起伏，7 日、28 日活跃平缓上升。 */
function day(date: string, offset: number): ActiveDay {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    return {
        date,
        daily: date === ZERO_DAY ? 0 : Math.round((weekend ? 820 : 1180) + offset * 6 + ((offset * 37) % 90)),
        weekly: 2400 + offset * 18,
        monthly: 5200 + offset * 25,
    };
}

function activeSeries(range: DashboardRange): ActiveSeries {
    const from = dateBefore(range - 1);
    const days = Array.from({length: range}, (_, offset) => dateBefore(range - 1 - offset))
        .map((date, offset) => day(date, offset))
        .filter((entry) => !(MISSING_DAYS as readonly string[]).includes(entry.date));
    return {from, to: LAST_DAY, days};
}

export const dashboardToday = {
    manifestVersion: 1,
    active: 1248,
    activeChange: 36,
    fresh: 42,
    freshChange: -5,
    online: 317,
    onlineWindowMinutes: 5,
    usageShare: 0.384,
} satisfies DashboardToday;

export const dashboardActive = {7: activeSeries(7), 28: activeSeries(28), 90: activeSeries(90)} satisfies Record<DashboardRange, ActiveSeries>;

const ONLINE_FROM = Date.parse(`${LAST_DAY}T10:00:00Z`) - DAY_MS;
/** 近 24 小时、每 30 分钟一段；凌晨有两段没有心跳（不在里面）。 */
export const dashboardOnline = {
    from: new Date(ONLINE_FROM).toISOString(),
    segmentMinutes: 30,
    segmentCount: 48,
    segments: Array.from({length: 48}, (_, index) => index)
        .filter((index) => index !== 30 && index !== 31)
        .map((index) => ({start: new Date(ONLINE_FROM + index * 30 * 60 * 1000).toISOString(), count: 120 + Math.round(200 * Math.abs(Math.sin(index / 7.6)))})),
} satisfies OnlineSeries;

export const dashboardVersions = {
    rows: [
        {label: "0.15.0", count: 812},
        {label: "0.14.2", count: 301},
        {label: "0.14.1", count: 96},
        {label: "0.13.0", count: 27},
        {label: "", count: 12, rest: true},
    ],
} satisfies Breakdown;

export const dashboardSystems = {
    rows: [
        {label: "Windows", count: 724},
        {label: "macOS", count: 386},
        {label: "Linux", count: 138},
    ],
} satisfies Breakdown;

export const dashboardRetention = {
    cohorts: [
        {week: dateBefore(55), fresh: 210, retained: [118, 96, 74, 51]},
        {week: dateBefore(48), fresh: 236, retained: [131, 104, 80, 58]},
        {week: dateBefore(41), fresh: 198, retained: [106, 88, 69, null]},
        {week: dateBefore(34), fresh: 251, retained: [142, 113, 85, null]},
        {week: dateBefore(27), fresh: 264, retained: [150, 121, null, null]},
        {week: dateBefore(20), fresh: 243, retained: [139, null, null, null]},
    ],
} satisfies Retention;

export const dashboardProblems = {
    reports: 980,
    errors: [
        {owner: "nbook", code: "store_locked", reports: 64, bins: [30, 18, 9, 5, 2]},
        {owner: "agent", code: "model_timeout", reports: 41, bins: [25, 10, 4, 2, 0]},
        {owner: "nbook", code: "plugin_failed", reports: 17, bins: [12, 4, 1, 0, 0]},
        {owner: "story", code: "index_corrupt", reports: 6, bins: [5, 1, 0, 0, 0]},
    ],
    crashes: {none: 921, once: 41, few: 14, many: 4},
    upgrades: {none: 802, succeeded: 163, failed: 15},
} satisfies Problems;

/** 还没有任何上报的看板：每块都是“没有数据”。 */
export const dashboardEmpty = {
    today: {manifestVersion: 1, active: 0, activeChange: null, fresh: 0, freshChange: null, online: 0, onlineWindowMinutes: 5, usageShare: null} satisfies DashboardToday,
    active: {from: dateBefore(27), to: LAST_DAY, days: []} satisfies ActiveSeries,
    online: {...dashboardOnline, segments: []} satisfies OnlineSeries,
    breakdown: {rows: []} satisfies Breakdown,
    retention: {cohorts: []} satisfies Retention,
    problems: {reports: 0, errors: [], crashes: {none: 0, once: 0, few: 0, many: 0}, upgrades: {none: 0, succeeded: 0, failed: 0}} satisfies Problems,
};
