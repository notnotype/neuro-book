/**
 * 全站唯一导入 ECharts 的文件（t10 计划 3.5 的按需清单；`tests/boundary.test.ts` 守着：别处只许 `import type`）。
 * 只引入两张折线图用到的图、组件与渲染器：整包约 390 KB（gzip），按需约 178 KB。读屏的概括由图表容器自己的 `aria-label` 写，
 * 不用 `AriaComponent`（它生成英文模板）；图例由面板标题行的 HTML 与线尾名字承担，不用 `LegendComponent`。
 *
 * 只有看板页导入本文件，它跟着看板的块走，访客与普通用户的入口里没有（`tests/build.test.ts`）。
 */

import {LineChart} from "echarts/charts";
import {GridComponent, TooltipComponent} from "echarts/components";
import * as echarts from "echarts/core";
import {CanvasRenderer} from "echarts/renderers";

import type {ChartOption} from "./options";

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

/** 一张画在某个容器里的图。 */
export interface ChartHandle {
    /** 整份换掉配置重画（不与上一份合并：换明暗时每处颜色都要换）。 */
    draw(option: ChartOption): void;
    /** 容器尺寸变了之后调用。 */
    resize(): void;
    dispose(): void;
}

/** 在容器里建一张图。容器此时要有非零的宽高：ECharts 按建图那一刻的尺寸开画布。 */
export function createChart(host: HTMLElement): ChartHandle {
    const chart = echarts.init(host);
    return {
        draw: (option) => chart.setOption(option, {notMerge: true}),
        resize: () => chart.resize(),
        dispose: () => chart.dispose(),
    };
}
