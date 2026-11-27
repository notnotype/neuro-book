/**
 * 看板两张图的配置（t10 计划 3.5）：纯函数，输入视图模型、主题（`theme.ts` 读出的颜色与字体）与文字，输出 ECharts 的配置。
 * 颜色、字体只从主题来，文字只从 `ChartText` 来，所以换明暗、换语言都是同一个函数换个参数再画一遍。
 *
 * 本文件不碰 DOM，`bun test` 直接测它（`tests/dashboard.test.ts`）：提示框的内容由 `activeTooltip`、`onlineTooltip` 算出，
 * 拼成元素的那一步由调用方传进来（`TooltipRenderer`，产品里是 `tooltip.ts`）。配置与主题的类型也写在这里而不在
 * `echarts.ts`、`theme.ts`，那两个文件要用 DOM 的类型。
 */

import type {LineSeriesOption} from "echarts/charts";
import type {GridComponentOption, TooltipComponentOption} from "echarts/components";
import type {ComposeOption} from "echarts/core";

import {dayLabel, dayLabelIndices, isolatedPoints, isOnlineAxisTick} from "../model";
import type {ActiveChart, OnlineChart} from "../model";

/** 看板两张图的配置：只含 `echarts.ts` 引入的几样，写了别的组件的配置类型检查就不过。 */
export type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption | TooltipComponentOption>;

/** 图表的颜色与字体，由 `theme.ts` 从图表容器的计算样式里读出。 */
export interface ChartTheme {
    /** 正文字体族。 */
    readonly font: string;
    /** 线尾名字、提示框里的字。 */
    readonly text: string;
    /** 坐标轴上的字、指示线（`--text-secondary`：11 像素的字用更淡的 `--text-muted` 对面板底不到 4.5:1）。 */
    readonly axis: string;
    /** 坐标轴线与网格线。 */
    readonly grid: string;
    /** 面板底色：提示框的底。 */
    readonly surface: string;
    /** 三条序列的颜色（站点的 `--site-viz-1` 到 `--site-viz-3`）。 */
    readonly series: readonly [string, string, string];
}

/** 图里要用的字，由页面按当前语言给。 */
export interface ChartText {
    /** 活跃图三条线的名字：日活跃、7 日活跃、28 日活跃。 */
    readonly active: readonly [string, string, string];
    /** 在线图那条线的名字。 */
    readonly online: string;
    /** 那一格没有上报时提示框里写的字。 */
    readonly noReports: string;
    /** 在线图横轴的钟点：传入 0 到 23，回“6 时”这样的字。 */
    readonly hour: (hour: number) => string;
    /** 数字的写法（千分位）。 */
    readonly count: (value: number) => string;
}

export interface ChartMotion {
    /** 减弱动效时为假：首次画出与之后的更新都不放动画（计划 3.5“减弱动效”）。 */
    readonly animation: boolean;
}

/** 提示框里的内容：标题（日期或时刻）与每条线一行。 */
export interface Tooltip {
    readonly title: string;
    readonly rows: readonly {readonly name: string; readonly color: string; readonly value: string}[];
}

type TooltipFormatter = Extract<NonNullable<TooltipComponentOption["formatter"]>, (...args: never[]) => unknown>;

/** 把提示框的内容变成 ECharts 能放进提示框的东西（元素或字符串）。 */
export type TooltipRenderer = (tooltip: Tooltip) => ReturnType<TooltipFormatter>;

const AXIS_FONT_SIZE = 11;
/** 孤立的点的直径：比两像素的线粗一圈，看得出是一个点；比鼠标停住时那个空心点（8）小。 */
const ISOLATED_SYMBOL_SIZE = 6;

function valueText(value: number | null | undefined, text: ChartText): string {
    return value === null || value === undefined ? text.noReports : text.count(value);
}

export function activeTooltip(chart: ActiveChart, index: number, theme: ChartTheme, text: ChartText): Tooltip {
    const lines = [chart.daily, chart.weekly, chart.monthly];
    return {
        title: dayLabel(chart.dates[index] ?? ""),
        rows: lines.map((line, series) => ({name: text.active[series]!, color: theme.series[series]!, value: valueText(line[index], text)})),
    };
}

export function onlineTooltip(chart: OnlineChart, index: number, theme: ChartTheme, text: ChartText): Tooltip {
    return {title: chart.times[index] ?? "", rows: [{name: text.online, color: theme.series[0], value: valueText(chart.counts[index], text)}]};
}

/**
 * 数值轴：份数与心跳次数都是整数，刻度不出现 0.5 这样的小数（数小的头几天 ECharts 会自己取小数间隔），从 0 起。
 */
function countAxis(theme: ChartTheme, text: ChartText): NonNullable<ChartOption["yAxis"]> {
    return {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLabel: {color: theme.axis, fontSize: AXIS_FONT_SIZE, formatter: (value: number) => text.count(value)},
        splitLine: {lineStyle: {color: theme.grid}},
    };
}

/** ECharts 按坐标轴触发的提示框把这一格的类目下标放在每个参数的 `dataIndex` 上。 */
function indexOf(params: unknown): number {
    const first: unknown = Array.isArray(params) ? params[0] : params;
    const index = typeof first === "object" && first !== null ? (first as {dataIndex?: unknown}).dataIndex : undefined;
    return typeof index === "number" ? index : 0;
}

function tooltipBase(theme: ChartTheme): NonNullable<ChartOption["tooltip"]> {
    return {
        trigger: "axis",
        axisPointer: {type: "line", lineStyle: {color: theme.axis, type: "solid"}},
        backgroundColor: theme.surface,
        borderColor: theme.grid,
        padding: [8, 12],
        textStyle: {color: theme.text, fontSize: 12, fontFamily: theme.font},
    };
}

export function buildActiveOption(chart: ActiveChart, theme: ChartTheme, text: ChartText, motion: ChartMotion, render: TooltipRenderer): ChartOption {
    const lines = [chart.daily, chart.weekly, chart.monthly];
    const labelled = dayLabelIndices(chart.dates.length);
    return {
        animation: motion.animation,
        color: [...theme.series],
        textStyle: {fontFamily: theme.font},
        grid: {left: 48, right: 76, top: 12, bottom: 26},
        tooltip: {
            ...tooltipBase(theme),
            transitionDuration: motion.animation ? 0.2 : 0,
            formatter: (params) => render(activeTooltip(chart, indexOf(params), theme, text)),
        },
        xAxis: {
            type: "category",
            data: chart.dates.map(dayLabel),
            boundaryGap: false,
            axisLine: {lineStyle: {color: theme.grid}},
            axisTick: {show: false},
            axisLabel: {color: theme.axis, fontSize: AXIS_FONT_SIZE, interval: (index: number) => labelled.has(index)},
        },
        yAxis: countAxis(theme, text),
        series: [
            ...lines.map((data, series): LineSeriesOption => ({
                type: "line",
                name: text.active[series],
                data: [...data],
                // 空值处断开（输出 7 在图上的样子）：缺的天不连线，也不画成 0。
                connectNulls: false,
                showSymbol: false,
                symbolSize: 8,
                lineStyle: {width: 2},
                emphasis: {disabled: true},
                endLabel: {show: true, formatter: "{a}", color: theme.text, fontSize: AXIS_FONT_SIZE, distance: 6},
            })),
            // 孤立的点（前后都断开的那一天）在上面的线上画不出任何像素，另用一组只有这些点的系列画成实心的点。不并进上面的系列：
            // 那边 `showSymbol` 一开，每个点都要画；关着时 ECharts 只在鼠标停住时临时画那一格的点，提示框的样子不变。
            ...lines.map((data, series): LineSeriesOption => ({
                type: "line",
                data: isolatedPoints(data),
                connectNulls: false,
                showSymbol: true,
                showAllSymbol: true,
                symbol: "circle",
                symbolSize: ISOLATED_SYMBOL_SIZE,
                itemStyle: {color: theme.series[series]},
                lineStyle: {width: 0},
                silent: true,
                emphasis: {disabled: true},
            })),
        ],
    };
}

export function buildOnlineOption(chart: OnlineChart, theme: ChartTheme, text: ChartText, motion: ChartMotion, render: TooltipRenderer): ChartOption {
    return {
        animation: motion.animation,
        color: [theme.series[0]],
        textStyle: {fontFamily: theme.font},
        grid: {left: 36, right: 12, top: 12, bottom: 26},
        tooltip: {
            ...tooltipBase(theme),
            transitionDuration: motion.animation ? 0.2 : 0,
            formatter: (params) => render(onlineTooltip(chart, indexOf(params), theme, text)),
        },
        xAxis: {
            type: "category",
            data: [...chart.times],
            boundaryGap: false,
            axisLine: {lineStyle: {color: theme.grid}},
            axisTick: {show: false},
            axisLabel: {
                color: theme.axis,
                fontSize: AXIS_FONT_SIZE,
                interval: (_index: number, time: string) => isOnlineAxisTick(time),
                formatter: (time: string) => text.hour(Number(time.slice(0, 2))),
            },
        },
        yAxis: countAxis(theme, text),
        series: [{
            type: "line",
            name: text.online,
            data: [...chart.counts],
            connectNulls: false,
            step: "end",
            showSymbol: false,
            lineStyle: {width: 2},
            areaStyle: {opacity: 0.1},
            emphasis: {disabled: true},
        }],
    };
}
