/**
 * 组件测试里看板的数据：按 `source.ts` 的路径回答 `GET`，回答直接是视图模型（`pages/admin/dashboard/model.ts`），类型写错时类型检查不过。
 * 浏览器场景另有一份（`e2e/fixtures/dashboard.ts`），两边各自准备数据，页面不导入任何一份。
 *
 * 只给测试导入；产品代码不导入它，所以不进构建产物。
 */

import type {ActiveSeries, Breakdown, DashboardRange, DashboardToday, OnlineSeries, Problems, Retention} from "../pages/admin/dashboard/model";
import {DASHBOARD_PATHS} from "../pages/admin/dashboard/source";
import type {Handler} from "./site-harness";

/** 看板一次要取的全部数据。活跃图按范围各一份。 */
export interface DashboardData {
    readonly today: DashboardToday;
    readonly active: Readonly<Record<DashboardRange, ActiveSeries>>;
    readonly online: OnlineSeries;
    readonly versions: Breakdown;
    readonly systems: Breakdown;
    readonly retention: Retention;
    readonly problems: Problems;
}

function emptyActive(from: string): ActiveSeries {
    return {from, to: "2026-11-26", days: []};
}

/** 还没有任何上报的看板：管理员登录之后落在看板上的用例，不在乎看板时用它。 */
export const EMPTY_DASHBOARD: DashboardData = {
    today: {manifestVersion: 1, active: 0, activeChange: null, fresh: 0, freshChange: null, online: 0, onlineWindowMinutes: 5, usageShare: null},
    active: {7: emptyActive("2026-11-20"), 28: emptyActive("2026-10-30"), 90: emptyActive("2026-08-29")},
    online: {from: "2026-11-25T10:00:00.000Z", segmentMinutes: 30, segmentCount: 48, segments: []},
    versions: {rows: []},
    systems: {rows: []},
    retention: {cohorts: []},
    problems: {reports: 0, errors: [], crashes: {none: 0, once: 0, few: 0, many: 0}, upgrades: {none: 0, succeeded: 0, failed: 0}},
};

/** 每条 `GET` 的路径与它回答的那份数据。 */
export function dashboardBodies(data: DashboardData): ReadonlyMap<string, unknown> {
    return new Map<string, unknown>([
        [DASHBOARD_PATHS.today, data.today],
        [DASHBOARD_PATHS.active(7), data.active[7]],
        [DASHBOARD_PATHS.active(28), data.active[28]],
        [DASHBOARD_PATHS.active(90), data.active[90]],
        [DASHBOARD_PATHS.online, data.online],
        [DASHBOARD_PATHS.breakdown("version"), data.versions],
        [DASHBOARD_PATHS.breakdown("os"), data.systems],
        [DASHBOARD_PATHS.retention, data.retention],
        [DASHBOARD_PATHS.problems, data.problems],
    ]);
}

/** 装置的处理器：键是 `"GET /api/telemetry/v1/overview"` 这样的写法，用例可以再盖掉其中几条（让它失败、晚到）。 */
export function dashboardHandlers(data: DashboardData): Record<string, Handler> {
    return Object.fromEntries([...dashboardBodies(data)].map(([path, body]) => [`GET ${path}`, () => Response.json(body)]));
}
