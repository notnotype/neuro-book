/**
 * 看板的视图模型（t10 计划 3.5、第 9 节 D8）：每块面板要画的数据的类型，与从它们算出图表序列、比例、格式化文字的纯函数。
 *
 * t11 的适配器把查询接口的响应转成这些类型（`source.ts` 是接口与这里的接缝）：查询接口与合同的 schema 归 t11，这里不认识它们。
 * t11 开工时可以改这些类型，改动连同页面一起由 t11 负责。
 *
 * “没有数据与零”（`site.telemetry-dashboard` 输出 7）由这里保证：某天没有任何上报时那天不在序列里，补成空值、线在那里断开；
 * 有上报而为 0 的照样是 0。
 */

/** 时间范围（天）。只管活跃图：别的面板是“今天”“近 24 小时”或最近几个安装周，不随它变。 */
export const DASHBOARD_RANGES = [7, 28, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
export const DEFAULT_RANGE: DashboardRange = 28;

/** 地址里 `?range=` 的值；认不出（没写、写错、写了几个）时按缺省。 */
export function rangeFromQuery(value: unknown): DashboardRange {
    if (typeof value !== "string") return DEFAULT_RANGE;
    return DASHBOARD_RANGES.find((range) => String(range) === value) ?? DEFAULT_RANGE;
}

/** 写回地址的查询参数：缺省的范围不写，`/admin` 就是近 28 天。 */
export function rangeQuery(range: DashboardRange): {readonly range?: string} {
    return range === DEFAULT_RANGE ? {} : {range: String(range)};
}

// ---- 今天的四个数 ----

/**
 * 今天的四个数与清单版本。接口表的 `overview` 只给当天、近 7 天、近 28 天的活跃数与新增和开启比例；下面标着“不在 `overview` 里”
 * 的几项要 t11 从别的接口取（计划 3.5：较昨日从 `series/active` 的最后两天算，当前在线取 `series/online` 的最后一段，清单版本
 * 按输出 6 的分段），也就是这一块面板在 t11 要合并几个请求，其中一个失败时怎样显示也由 t11 定。
 */
export interface DashboardToday {
    /** 今天的上报用的收集清单版本（输出 6 按版本分段；怎样显示几段归 t11）。不在 `overview` 里。 */
    readonly manifestVersion: number;
    readonly active: number;
    /** 较昨日的差；昨天没有上报时为 `null`。不在 `overview` 里。 */
    readonly activeChange: number | null;
    /** 今日新增（`daysSinceLast` 为 `first` 的份数）。 */
    readonly fresh: number;
    /** 不在 `overview` 里。 */
    readonly freshChange: number | null;
    /** 最近一个心跳窗口里的心跳次数。不在 `overview` 里。 */
    readonly online: number;
    /** 不在 `overview` 里。 */
    readonly onlineWindowMinutes: number;
    /** 今日上报里打开了使用统计的占比（0 到 1）；今天还没有上报时为 `null`。 */
    readonly usageShare: number | null;
}

// ---- 活跃 ----

export interface ActiveDay {
    /** `YYYY-MM-DD`。 */
    readonly date: string;
    readonly daily: number;
    readonly weekly: number;
    readonly monthly: number;
}

export interface ActiveSeries {
    /** 范围的第一天与最后一天（含），`YYYY-MM-DD`。 */
    readonly from: string;
    readonly to: string;
    /** 有上报的日子，按日期先后；没有上报的日子不在里面（输出 7）。 */
    readonly days: readonly ActiveDay[];
}

/** 活跃图要画的样子：范围里的每一天一格，没有上报的那天三条线都是空值。 */
export interface ActiveChart {
    readonly dates: readonly string[];
    readonly daily: readonly (number | null)[];
    readonly weekly: readonly (number | null)[];
    readonly monthly: readonly (number | null)[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayIndex(date: string): number {
    return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function dateOf(index: number): string {
    return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

export function activeChart(series: ActiveSeries): ActiveChart {
    const first = dayIndex(series.from);
    const count = Math.max(0, dayIndex(series.to) - first + 1);
    const dates = Array.from({length: count}, (_, offset) => dateOf(first + offset));
    const byDate = new Map(series.days.map((day) => [day.date, day]));
    const pick = (field: "daily" | "weekly" | "monthly") => dates.map((date) => byDate.get(date)?.[field] ?? null);
    return {dates, daily: pick("daily"), weekly: pick("weekly"), monthly: pick("monthly")};
}

/** 横轴的日期写 `MM-DD`。 */
export function dayLabel(date: string): string {
    return date.slice(5);
}

/** 横轴标字的那几格：首尾两天一定标，中间再均分两处，一共至多四处（7、28、90 天都一样）。 */
export function dayLabelIndices(count: number): ReadonlySet<number> {
    if (count <= 0) return new Set();
    return new Set([0, 1, 2, 3].map((part) => Math.round((part * (count - 1)) / 3)));
}

/**
 * 孤立的点：自己有数、前后一格都没有（或在范围的头尾）。线在空值处断开（输出 7），孤立的一天两边都断，线段长度为 0、画不出任何
 * 像素：上线头几天只有一天上报、或之后零星几天有上报时，有数据却看不见。返回与输入等长的一列，只留孤立的点，其余是空值，
 * 由配置另画成实心的点（`charts/options.ts`）。
 */
export function isolatedPoints(values: readonly (number | null)[]): (number | null)[] {
    return values.map((value, index) => (value !== null && (values[index - 1] ?? null) === null && (values[index + 1] ?? null) === null ? value : null));
}

// ---- 在线 ----

export interface OnlineSegment {
    /** 这一段的起点（ISO 时间）。 */
    readonly start: string;
    readonly count: number;
}

export interface OnlineSeries {
    /** 第一段的起点（ISO 时间）。 */
    readonly from: string;
    readonly segmentMinutes: number;
    readonly segmentCount: number;
    /** 有心跳的段；没有记录的段不在里面。 */
    readonly segments: readonly OnlineSegment[];
}

export interface OnlineChart {
    /** 每段起点的本地时刻 `HH:mm`。 */
    readonly times: readonly string[];
    readonly counts: readonly (number | null)[];
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 时刻按看的人的本地时间写：管理员看的是自己这一天的起落。 */
function localTime(ms: number): string {
    const date = new Date(ms);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function onlineChart(series: OnlineSeries): OnlineChart {
    const from = Date.parse(series.from);
    const step = series.segmentMinutes * 60 * 1000;
    const counts: (number | null)[] = Array.from({length: series.segmentCount}, () => null);
    for (const segment of series.segments) {
        const index = Math.round((Date.parse(segment.start) - from) / step);
        if (index >= 0 && index < counts.length) counts[index] = segment.count;
    }
    return {times: counts.map((_, index) => localTime(from + index * step)), counts};
}

/** 在线图的横轴只在整点、且是 6 的倍数的钟点上标字（0、6、12、18 时）。 */
export function isOnlineAxisTick(time: string): boolean {
    return time.endsWith(":00") && Number(time.slice(0, 2)) % 6 === 0;
}

// ---- 分维度的份数（版本、系统） ----

export interface BreakdownRow {
    /** 版本号、系统名。`rest` 的那一行没有名字，界面写“少于 5 份”。 */
    readonly label: string;
    readonly count: number;
    /** 份数小于 5 的格子合并成的一行（输出 5）。 */
    readonly rest?: true;
}

export interface Breakdown {
    /** 按份数从多到少，`rest` 在最后。 */
    readonly rows: readonly BreakdownRow[];
}

/** 每行加上占合计的比例（0 到 1）。合计为 0 时都是 0。 */
export function withShares<Row extends {readonly count: number}>(rows: readonly Row[]): (Row & {readonly share: number})[] {
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return rows.map((row) => ({...row, share: total === 0 ? 0 : row.count / total}));
}

// ---- 留存 ----

/** 留存看安装之后的第几周（输出 3）。 */
export const RETENTION_WEEKS = [1, 2, 4, 8] as const;

/**
 * 留存一块显示最近几个安装周（照 t09 定稿 r5，四行）。面板高度是按这个行数定的（`DashboardPage.vue` 的 `PANEL_HEIGHT.table`），
 * 多给的更早的安装周不显示：行数不随服务端给几行而变，就不会出现切掉半行的面板。t11 的查询按这个数请求。
 */
export const RETENTION_SHOWN_WEEKS = 4;

/** 要显示的安装周：最近 `RETENTION_SHOWN_WEEKS` 个，仍从早到晚。 */
export function shownCohorts(retention: Retention): readonly RetentionCohort[] {
    return retention.cohorts.slice(-RETENTION_SHOWN_WEEKS);
}

export interface RetentionCohort {
    /** 安装周的第一天，`YYYY-MM-DD`。 */
    readonly week: string;
    /** 那一周的新增份数。 */
    readonly fresh: number;
    /** 与 `RETENTION_WEEKS` 一一对应：那一周的 7 日活跃数；还没到那一周时为 `null`。 */
    readonly retained: readonly (number | null)[];
}

export interface Retention {
    /** 最近几个安装周，从早到晚。 */
    readonly cohorts: readonly RetentionCohort[];
}

/** 一格的留存比例（0 到 1）；还没到那一周、或那周没有新增时为 `null`。 */
export function retentionShare(cohort: RetentionCohort, index: number): number | null {
    const retained = cohort.retained[index];
    if (retained === null || retained === undefined || cohort.fresh === 0) return null;
    return retained / cohort.fresh;
}

// ---- 错误、崩溃、升级 ----

/** 错误次数的五档（清单版本 1：1 次、2 到 4、5 到 9、10 到 49、50 以上），由少到多。 */
export const ERROR_BIN_COUNT = 5;

export interface ErrorRow {
    readonly owner: string;
    readonly code: string;
    /** 带这个错误的上报份数。 */
    readonly reports: number;
    /** 这些上报按当天出错次数落在五档里的份数，由少到多。 */
    readonly bins: readonly number[];
}

export interface Problems {
    /** 今天带使用统计的上报份数：错误占比的分母。 */
    readonly reports: number;
    /** 按份数从多到少。 */
    readonly errors: readonly ErrorRow[];
    readonly crashes: {readonly none: number; readonly once: number; readonly few: number; readonly many: number};
    readonly upgrades: {readonly none: number; readonly succeeded: number; readonly failed: number};
}

export const CRASH_KEYS = ["none", "once", "few", "many"] as const;
export const UPGRADE_KEYS = ["none", "succeeded", "failed"] as const;

/** 一种错误占今天上报的比例（0 到 1）。 */
export function errorShare(problems: Problems, row: ErrorRow): number {
    return problems.reports === 0 ? 0 : row.reports / problems.reports;
}

// ---- 数字的写法 ----

/** 份数、次数：千分位。 */
export function formatCount(value: number, locale: string): string {
    return new Intl.NumberFormat(locale).format(value);
}

/** 较昨日的差：带正负号，0 不带。 */
export function formatChange(value: number, locale: string): string {
    return new Intl.NumberFormat(locale, {signDisplay: "exceptZero"}).format(value);
}

/** 一位小数的百分数能写出的最小的非 0 比例。 */
const SMALLEST_SHARE = 0.001;

/**
 * 比例（0 到 1）写成百分数，至多一位小数。不为 0 而小于 0.1% 的写“<0.1%”：四舍五入成“0%”读起来像没有（崩溃、升级失败这类
 * 份数少的行正是要看的）。
 */
export function formatShare(value: number, locale: string): string {
    const format = new Intl.NumberFormat(locale, {style: "percent", maximumFractionDigits: 1});
    return value > 0 && value < SMALLEST_SHARE ? `<${format.format(SMALLEST_SHARE)}` : format.format(value);
}
