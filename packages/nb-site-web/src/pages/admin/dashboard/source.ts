/**
 * 看板的数据从哪来（t10 计划 3.5“与 t11 的分界”）：页面只认这个接口，不直接导入数据。组件测试由注入的 `fetch` 回答，
 * 浏览器场景由假接口（`e2e/fake-api.ts`）回答，两边各自准备数据。
 *
 * 现在的实现是暂定的：路径取自 `site.telemetry-dashboard` 的接口表（`tests/dashboard.test.ts` 对着表核），查询参数是占位
 * （`days`、`dimension` 是这里自己起的名字，接口表要的是起止日期、日期与维度，`errors`、`series/retention` 也要起止），
 * 回答直接当作视图模型（`model.ts`），不是接口表的回答形状。查询接口的参数与响应的 schema 归 t11：t11 在这里改成按合同发请求，
 * 用适配器把响应转成视图模型，`DashboardSource` 的形状可以随之改；一块面板不一定对一个请求（今天的四个数要合并几个，见
 * `model.ts` 的 `DashboardToday`）。在那之前，真实服务上这些路径还不存在，各块面板显示出错与重试。
 */

import {TELEMETRY_API_PREFIX} from "@notnotype/nb-site-telemetry-contract/constants";

import type {ApiCore, Result} from "../../../http/core";
import type {ActiveSeries, Breakdown, DashboardRange, DashboardToday, OnlineSeries, Problems, Retention} from "./model";

/** 版本与系统两个维度（接口表里 `breakdown` 的维度还有别的，看板只用这两个）。 */
export type BreakdownDimension = "version" | "os";

export interface DashboardSource {
    /** 今天的四个数与清单版本（暂取 `overview`；其中几项 `overview` 给不了，见 `DashboardToday`）。 */
    today(): Promise<Result<DashboardToday>>;
    /** 最近 `range` 天的活跃（`series/active`）。 */
    active(range: DashboardRange): Promise<Result<ActiveSeries>>;
    /** 近 24 小时的心跳（`series/online`）。 */
    online(): Promise<Result<OnlineSeries>>;
    /** 今天按一个维度分的份数（`breakdown`）。 */
    breakdown(dimension: BreakdownDimension): Promise<Result<Breakdown>>;
    /** 最近几个安装周的留存（`series/retention`）。 */
    retention(): Promise<Result<Retention>>;
    /** 今天的错误、崩溃与升级（`errors`）。 */
    problems(): Promise<Result<Problems>>;
}

/** 看板请求的路径（查询串是占位，见文件头），组件测试与假接口按它回答。 */
export const DASHBOARD_PATHS = {
    today: `${TELEMETRY_API_PREFIX}/overview`,
    active: (range: DashboardRange): string => `${TELEMETRY_API_PREFIX}/series/active?days=${range}`,
    online: `${TELEMETRY_API_PREFIX}/series/online`,
    breakdown: (dimension: BreakdownDimension): string => `${TELEMETRY_API_PREFIX}/breakdown?dimension=${dimension}`,
    retention: `${TELEMETRY_API_PREFIX}/series/retention`,
    problems: `${TELEMETRY_API_PREFIX}/errors`,
} as const;

export function createDashboardSource(api: ApiCore): DashboardSource {
    const get = <T>(path: string): Promise<Result<T>> => api.request<T>({method: "GET", path});
    return {
        today: () => get(DASHBOARD_PATHS.today),
        active: (range) => get(DASHBOARD_PATHS.active(range)),
        online: () => get(DASHBOARD_PATHS.online),
        breakdown: (dimension) => get(DASHBOARD_PATHS.breakdown(dimension)),
        retention: () => get(DASHBOARD_PATHS.retention),
        problems: () => get(DASHBOARD_PATHS.problems),
    };
}
