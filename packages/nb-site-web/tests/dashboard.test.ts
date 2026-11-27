/**
 * 看板的视图模型与两张图的配置（`pages/admin/dashboard/model.ts`、`charts/options.ts`）：都是纯函数，这里直接调用，断言画出来会是什么样——
 * 线叫什么、什么颜色、哪一格断开、提示框里写什么。真的画在 canvas 上、鼠标移上去的样子在 `e2e/dashboard.e2e.ts`。
 *
 * 两套序列色从 `site.css` 里读：换明暗换的就是那几个变量，用例对着真实的值。其余颜色（正文、网格）是 nb-ui 主题的，这里写两套
 * 不同的值，只看它们走到了配置里。
 *
 * 画出来才看得出的几样（孤立的点有没有画、坐标轴标了哪些字）用 ECharts 自己的服务端渲染：同一份配置画成 SVG，读里面的点与字。
 * 产品在浏览器里用 canvas 画，两种渲染器排版用的是同一套坐标轴与系列的逻辑；canvas 上的像素在 `e2e/dashboard.e2e.ts` 另看。
 */

import {describe, expect, it} from "bun:test";
import {LineChart} from "echarts/charts";
import {GridComponent, TooltipComponent} from "echarts/components";
import * as echarts from "echarts/core";
import {SVGRenderer} from "echarts/renderers";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {buildActiveOption, buildOnlineOption} from "../src/pages/admin/dashboard/charts/options";
import type {ChartOption, ChartText, ChartTheme, Tooltip, TooltipRenderer} from "../src/pages/admin/dashboard/charts/options";
import {
    activeChart,
    formatChange,
    formatCount,
    formatShare,
    isOnlineAxisTick,
    onlineChart,
    rangeFromQuery,
    rangeQuery,
    RETENTION_SHOWN_WEEKS,
    retentionShare,
    shownCohorts,
    withShares,
} from "../src/pages/admin/dashboard/model";
import type {ActiveSeries, OnlineSeries, Retention} from "../src/pages/admin/dashboard/model";
import {DASHBOARD_PATHS} from "../src/pages/admin/dashboard/source";

const SITE_CSS = readFileSync(join(import.meta.dir, "..", "src", "styles", "site.css"), "utf8");

/** `site.css` 里某种明暗的三条序列色。 */
function seriesColors(appearance: "light" | "dark"): [string, string, string] {
    const block = new RegExp(`\\[data-nb-appearance="${appearance}"\\]\\s*\\{([^}]*)\\}`, "u").exec(SITE_CSS)?.[1];
    if (block === undefined) throw new Error(`site.css 里没有 ${appearance} 那一套`);
    const color = (index: number): string => {
        const value = new RegExp(`--site-viz-${index}:\\s*([^;]+);`, "u").exec(block)?.[1];
        if (value === undefined) throw new Error(`site.css 的 ${appearance} 里没有 --site-viz-${index}`);
        return value.trim();
    };
    return [color(1), color(2), color(3)];
}

const LIGHT: ChartTheme = {font: "Inter", text: "#1f1d1a", axis: "#6b645b", grid: "#e4ddd0", surface: "#fffcf5", series: seriesColors("light")};
const DARK: ChartTheme = {font: "Inter", text: "#ece6dc", axis: "#b5ada2", grid: "#3d3833", surface: "#2d2925", series: seriesColors("dark")};

const TEXT: ChartText = {
    active: ["日活跃", "7 日活跃", "28 日活跃"],
    online: "心跳次数",
    noReports: "没有上报",
    hour: (hour) => `${hour} 时`,
    count: (value) => formatCount(value, "zh-CN"),
};

const MOTION = {animation: true};

/** 提示框的内容原样交回：用例从格式化函数的结果里读出它算出的标题与几行。 */
const asJson: TooltipRenderer = (tooltip) => JSON.stringify(tooltip);

/** 鼠标停在第 `index` 格时提示框里的内容：照 ECharts 按坐标轴触发时的参数调用配置里的格式化函数。 */
function tooltipAt(option: ChartOption, index: number): Tooltip {
    const tooltip = option.tooltip;
    if (tooltip === undefined || Array.isArray(tooltip) || typeof tooltip.formatter !== "function") throw new Error("配置里没有提示框的格式化函数");
    const params = [{dataIndex: index}, {dataIndex: index}];
    return JSON.parse(String(tooltip.formatter(params as never, ""))) as Tooltip;
}

interface LineSeries {
    readonly name?: unknown;
    readonly data?: unknown;
    readonly connectNulls?: unknown;
}

function seriesOf(option: ChartOption): LineSeries[] {
    const series = option.series;
    if (series === undefined) return [];
    return (Array.isArray(series) ? series : [series]) as LineSeries[];
}

/** 有名字的线：线尾写着名字、提示框里列出来的那几条。 */
function namedSeries(option: ChartOption): LineSeries[] {
    return seriesOf(option).filter((line) => line.name !== undefined);
}

echarts.use([LineChart, GridComponent, TooltipComponent, SVGRenderer]);

/** 把配置画成 SVG（面板里图的大小）。 */
function render(option: ChartOption): string {
    const chart = echarts.init(null, null, {renderer: "svg", ssr: true, width: 600, height: 230});
    try {
        chart.setOption(option);
        return chart.renderToSVGString();
    } finally {
        chart.dispose();
    }
}

/** 图上写出来的字：坐标轴的刻度与线尾的名字，按画出的先后。 */
function textsOf(svg: string): string[] {
    return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1]!);
}

/** 数值轴的刻度：图上只由数字（含千分位）组成的字。 */
function countLabels(svg: string): string[] {
    return textsOf(svg).filter((text) => /^[\d,.]+$/u.test(text));
}

/** 横轴的日期：图上 `MM-DD` 样子的字。 */
function dayLabels(svg: string): string[] {
    return textsOf(svg).filter((text) => /^\d\d-\d\d$/u.test(text));
}

/** 图上画出来的点：颜色与落在第几格。线本身与鼠标停住时的空心点（服务端渲染里没有鼠标）都不在内。 */
function markersOf(svg: string): {readonly color: string; readonly index: number}[] {
    return [...svg.matchAll(/<path\b[^>]*>/gu)]
        .map((match) => match[0])
        .filter((path) => path.includes("ecmeta_data_index="))
        .map((path) => ({color: /\bfill="([^"]+)"/u.exec(path)?.[1] ?? "", index: Number(/ecmeta_data_index="(\d+)"/u.exec(path)?.[1])}));
}

/** `from` 起的 `count` 天，`YYYY-MM-DD`（按 UTC 推日子，与时区无关）。 */
function daysFrom(from: string, count: number): string[] {
    return Array.from({length: count}, (_, offset) => new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10));
}

/** 11 月 1 日到 7 日：3 日没有任何上报（不在 `days` 里），5 日有上报而日活跃为 0。 */
const WEEK: ActiveSeries = {
    from: "2026-11-01",
    to: "2026-11-07",
    days: [
        {date: "2026-11-01", daily: 120, weekly: 300, monthly: 900},
        {date: "2026-11-02", daily: 130, weekly: 310, monthly: 910},
        {date: "2026-11-04", daily: 1250, weekly: 320, monthly: 920},
        {date: "2026-11-05", daily: 0, weekly: 300, monthly: 915},
        {date: "2026-11-06", daily: 110, weekly: 305, monthly: 918},
        {date: "2026-11-07", daily: 115, weekly: 308, monthly: 921},
    ],
};

describe("时间范围", () => {
    it("地址里认得出的范围照用，认不出的按近 28 天；近 28 天不写进地址", () => {
        expect(rangeFromQuery("7")).toBe(7);
        expect(rangeFromQuery("90")).toBe(90);
        for (const value of [undefined, "", "30", "7d", ["7"], null]) expect({value, range: rangeFromQuery(value)}).toEqual({value, range: 28});
        expect(rangeQuery(7)).toEqual({range: "7"});
        expect(rangeQuery(90)).toEqual({range: "90"});
        expect(rangeQuery(28)).toEqual({});
    });
});

describe("活跃图", () => {
    it("范围里的每一天一格；没有上报的那天三条线都是空值，有上报而为 0 的是 0", () => {
        const chart = activeChart(WEEK);
        expect(chart.dates).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
        expect(chart.daily).toEqual([120, 130, null, 1250, 0, 110, 115]);
        expect(chart.weekly[2]).toBeNull();
        expect(chart.monthly[2]).toBeNull();
    });

    it("范围首尾没有上报时也有那几格（空值），线从有数的那天开始", () => {
        const chart = activeChart({from: "2026-10-30", to: "2026-11-02", days: [{date: "2026-11-01", daily: 5, weekly: 5, monthly: 5}]});
        expect(chart.dates).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
        expect(chart.daily).toEqual([null, null, 5, null]);
    });

    it("线名来自文字、颜色来自主题；缺的那天在线上是空值并且断开，不画成 0", () => {
        const option = buildActiveOption(activeChart(WEEK), LIGHT, TEXT, MOTION, asJson);
        expect(option.color).toEqual([...LIGHT.series]);
        const series = namedSeries(option);
        expect(series.map((line) => line.name)).toEqual([...TEXT.active]);
        expect(series[0]?.data).toEqual([120, 130, null, 1250, 0, 110, 115]);
        expect(seriesOf(option).every((line) => line.connectNulls === false)).toBe(true);
    });

    it("前后都没有数据的那一天画成线色的点；连成线的日子不画点", () => {
        // 11 月 1、2 日连成一段，5 日前后两天都没有上报：只有 5 日（第 4 格）有点，三条线各一个，各用自己的颜色。
        const chart = activeChart({
            from: "2026-11-01",
            to: "2026-11-07",
            days: [
                {date: "2026-11-01", daily: 1, weekly: 1, monthly: 1},
                {date: "2026-11-02", daily: 2, weekly: 2, monthly: 2},
                {date: "2026-11-05", daily: 3, weekly: 3, monthly: 3},
            ],
        });
        for (const theme of [LIGHT, DARK]) {
            const markers = markersOf(render(buildActiveOption(chart, theme, TEXT, {animation: false}, asJson)));
            expect(markers).toEqual(theme.series.map((color) => ({color, index: 4})));
        }
        // 范围里只有一天有数（上线第一天）：那一天也画出来。
        const first = activeChart({from: "2026-11-01", to: "2026-11-28", days: [{date: "2026-11-28", daily: 1, weekly: 1, monthly: 1}]});
        expect(markersOf(render(buildActiveOption(first, LIGHT, TEXT, {animation: false}, asJson)))).toEqual(LIGHT.series.map((color) => ({color, index: 27})));
        // 每天都有数时没有点，线照常。
        expect(markersOf(render(buildActiveOption(activeChart(WEEK), LIGHT, TEXT, {animation: false}, asJson)))).toEqual([]);
    });

    it("提示框只列三条有名字的线：画孤立点的那几组不进提示框", () => {
        const chart = activeChart({from: "2026-11-01", to: "2026-11-03", days: [{date: "2026-11-02", daily: 4, weekly: 4, monthly: 4}]});
        const option = buildActiveOption(chart, LIGHT, TEXT, MOTION, asJson);
        expect(tooltipAt(option, 1).rows.map((row) => row.name)).toEqual([...TEXT.active]);
    });

    it("提示框写那一天的日期与三条线的数；没有上报的那天写“没有上报”，为 0 的写 0", () => {
        const option = buildActiveOption(activeChart(WEEK), LIGHT, TEXT, MOTION, asJson);
        expect(tooltipAt(option, 3)).toEqual({
            title: "11-04",
            rows: [
                {name: "日活跃", color: LIGHT.series[0], value: "1,250"},
                {name: "7 日活跃", color: LIGHT.series[1], value: "320"},
                {name: "28 日活跃", color: LIGHT.series[2], value: "920"},
            ],
        });
        expect(tooltipAt(option, 2).rows.map((row) => row.value)).toEqual(["没有上报", "没有上报", "没有上报"]);
        expect(tooltipAt(option, 4).rows[0]?.value).toBe("0");
    });

    it("换成暗色的主题：线、提示框、坐标轴的颜色都换了", () => {
        const light = buildActiveOption(activeChart(WEEK), LIGHT, TEXT, MOTION, asJson);
        const dark = buildActiveOption(activeChart(WEEK), DARK, TEXT, MOTION, asJson);
        expect(DARK.series).not.toEqual(LIGHT.series);
        expect(dark.color).toEqual([...DARK.series]);
        expect(tooltipAt(dark, 0).rows.map((row) => row.color)).toEqual([...DARK.series]);
        const surfaceOf = (option: ChartOption): unknown => (Array.isArray(option.tooltip) ? undefined : option.tooltip?.backgroundColor);
        expect({light: surfaceOf(light), dark: surfaceOf(dark)}).toEqual({light: LIGHT.surface, dark: DARK.surface});
        expect(JSON.stringify(dark.xAxis)).toContain(DARK.axis);
        expect(JSON.stringify(dark.xAxis)).not.toContain(LIGHT.axis);
    });

    it("减弱动效时配置不带动画", () => {
        expect(buildActiveOption(activeChart(WEEK), LIGHT, TEXT, {animation: false}, asJson).animation).toBe(false);
        expect(buildActiveOption(activeChart(WEEK), LIGHT, TEXT, MOTION, asJson).animation).toBe(true);
    });

    it("横轴标四个日期：第一天、最后一天与中间两处，7、28、90 天都一样", () => {
        for (const count of [7, 28, 90]) {
            const dates = daysFrom("2026-08-10", count);
            const chart = activeChart({from: dates[0]!, to: dates.at(-1)!, days: [{date: dates[0]!, daily: 3, weekly: 3, monthly: 3}]});
            const labels = dayLabels(render(buildActiveOption(chart, LIGHT, TEXT, {animation: false}, asJson)));
            expect({count, labels: labels.length, first: labels[0], last: labels.at(-1)}).toEqual({count, labels: 4, first: dates[0]!.slice(5), last: dates.at(-1)!.slice(5)});
        }
    });

    it("数值轴从 0 起、刻度都是整数：头几天数很小时也不出现 0.5", () => {
        for (const peak of [1, 2, 3]) {
            const chart = activeChart({from: "2026-11-01", to: "2026-11-02", days: [{date: "2026-11-01", daily: 1, weekly: peak, monthly: peak}, {date: "2026-11-02", daily: 1, weekly: peak, monthly: peak}]});
            const labels = countLabels(render(buildActiveOption(chart, LIGHT, TEXT, {animation: false}, asJson)));
            expect({peak, first: labels[0], integers: labels.every((label) => /^\d+$/u.test(label))}).toEqual({peak, first: "0", integers: true});
        }
    });
});

describe("在线图", () => {
    // 从本地时间 0 点起的 4 段、每段 6 小时：时刻按看的人的本地时间写。
    const from = new Date(2026, 10, 26, 0, 0).toISOString();
    const at = (hours: number): string => new Date(Date.parse(from) + hours * 3600_000).toISOString();
    const ONLINE: OnlineSeries = {from, segmentMinutes: 360, segmentCount: 4, segments: [{start: at(0), count: 12}, {start: at(12), count: 0}, {start: at(18), count: 40}]};

    it("每段一格；没有记录的段是空值，记录为 0 的是 0", () => {
        const chart = onlineChart(ONLINE);
        expect(chart.times).toEqual(["00:00", "06:00", "12:00", "18:00"]);
        expect(chart.counts).toEqual([12, null, 0, 40]);
    });

    it("只在 0、6、12、18 时的整点标字", () => {
        expect(["00:00", "06:00", "12:00", "18:00"].map(isOnlineAxisTick)).toEqual([true, true, true, true]);
        expect(["00:30", "03:00", "07:00", "23:00"].map(isOnlineAxisTick)).toEqual([false, false, false, false]);
    });

    it("线名来自文字、颜色是第一格序列色；提示框写时刻与次数，没有记录写“没有上报”", () => {
        const option = buildOnlineOption(onlineChart(ONLINE), DARK, TEXT, MOTION, asJson);
        expect(option.color).toEqual([DARK.series[0]]);
        expect(seriesOf(option).map((line) => ({name: line.name, data: line.data, connectNulls: line.connectNulls}))).toEqual([{name: "心跳次数", data: [12, null, 0, 40], connectNulls: false}]);
        expect(tooltipAt(option, 3)).toEqual({title: "18:00", rows: [{name: "心跳次数", color: DARK.series[0], value: "40"}]});
        expect(tooltipAt(option, 1).rows[0]?.value).toBe("没有上报");
    });

    it("数值轴从 0 起、刻度都是整数", () => {
        const chart = onlineChart({from, segmentMinutes: 360, segmentCount: 4, segments: [{start: at(0), count: 1}, {start: at(6), count: 2}]});
        const labels = countLabels(render(buildOnlineOption(chart, LIGHT, TEXT, {animation: false}, asJson)));
        expect(labels[0]).toBe("0");
        expect(labels.every((label) => /^\d+$/u.test(label))).toBe(true);
    });
});

describe("比例与数字", () => {
    it("占比按合计算，合计为 0 时都是 0", () => {
        expect(withShares([{count: 3}, {count: 1}]).map((row) => row.share)).toEqual([0.75, 0.25]);
        expect(withShares([{count: 0}, {count: 0}]).map((row) => row.share)).toEqual([0, 0]);
    });

    it("留存只显示最近四个安装周，从早到晚；不满四周时有几周显示几周", () => {
        const weeks = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
        const retention = (count: number): Retention => ({cohorts: weeks.slice(0, count).map((week) => ({week, fresh: 10, retained: [5, 4, 3, 2]}))});
        expect(RETENTION_SHOWN_WEEKS).toBe(4);
        expect(shownCohorts(retention(6)).map((cohort) => cohort.week)).toEqual(weeks.slice(2, 6));
        expect(shownCohorts(retention(2)).map((cohort) => cohort.week)).toEqual(weeks.slice(0, 2));
    });

    it("留存：还没到那一周、那周没有新增时是空格", () => {
        expect(retentionShare({week: "2026-11-02", fresh: 40, retained: [20, 10, null, null]}, 0)).toBe(0.5);
        expect(retentionShare({week: "2026-11-02", fresh: 40, retained: [20, 10, null, null]}, 2)).toBeNull();
        expect(retentionShare({week: "2026-11-02", fresh: 0, retained: [0, 0, 0, 0]}, 0)).toBeNull();
    });

    it("较昨日带正负号，0 不带；比例至多一位小数", () => {
        expect([formatChange(12, "zh-CN"), formatChange(-3, "zh-CN"), formatChange(0, "zh-CN")]).toEqual(["+12", "-3", "0"]);
        expect(formatShare(0.4567, "zh-CN")).toBe("45.7%");
        // 不为 0 却不到 0.1% 的不写成“0%”：份数少的崩溃、升级失败正是要看的。
        expect([formatShare(0.0004, "zh-CN"), formatShare(0.001, "zh-CN"), formatShare(0, "zh-CN")]).toEqual(["<0.1%", "0.1%", "0%"]);
        expect(formatCount(12345, "zh-CN")).toBe("12,345");
    });
});

describe("请求的路径", () => {
    it("看板请求的路径都在 Spec 的接口表里（查询参数是占位，不比）", () => {
        // 抄自 docs/specs/site/telemetry-dashboard.md 的“输入与前置条件”：前缀加接口表里的六个接口。Spec 改了接口，这里跟着改。
        const SPEC = ["overview", "series/active", "series/retention", "series/online", "breakdown", "errors"].map((name) => `/api/telemetry/v1/${name}`);
        const paths = [
            DASHBOARD_PATHS.today,
            DASHBOARD_PATHS.active(7),
            DASHBOARD_PATHS.active(90),
            DASHBOARD_PATHS.online,
            DASHBOARD_PATHS.breakdown("version"),
            DASHBOARD_PATHS.breakdown("os"),
            DASHBOARD_PATHS.retention,
            DASHBOARD_PATHS.problems,
        ].map((path) => path.split("?")[0]!);
        for (const path of paths) expect({path, inSpec: SPEC.includes(path)}).toEqual({path, inSpec: true});
        // 六个接口每个都用到了：今天的四个数暂取 `overview`，t11 要从别的接口补几项（见 `model.ts` 的 `DashboardToday`）。
        expect(new Set(paths)).toEqual(new Set(SPEC));
    });
});
