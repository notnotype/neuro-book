/**
 * 图表的颜色与字体（t10 计划 3.5“颜色与字体”）：ECharts 画在 canvas 上，不认 CSS 变量，所以从图表容器的计算样式里读出来，
 * 得到一个普通对象交给配置生成函数（`options.ts`）。换明暗之后要重读一遍（`TrendChart.vue`）。
 */

import type {ChartTheme} from "./options";

function read(style: CSSStyleDeclaration, name: string): string {
    const value = style.getPropertyValue(name).trim();
    // 读不到说明主题或站点变量没装上（`host/theme.ts`、`styles/site.css`）：抛出，不让图悄悄画成黑色。
    if (value === "") throw new Error(`图表容器上读不到 ${name}`);
    return value;
}

export function readChartTheme(element: HTMLElement): ChartTheme {
    const style = getComputedStyle(element);
    return {
        font: style.fontFamily,
        text: read(style, "--text-main"),
        axis: read(style, "--text-muted"),
        grid: read(style, "--border-color"),
        surface: read(style, "--bg-panel"),
        series: [read(style, "--site-viz-1"), read(style, "--site-viz-2"), read(style, "--site-viz-3")],
    };
}
