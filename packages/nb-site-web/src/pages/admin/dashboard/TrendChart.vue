<script setup lang="ts">
/**
 * 一张 ECharts 折线图的容器（t10 计划 3.5）。配置由调用方按主题与动效生成（`options.ts`），这里管图的一生：
 *
 * - 建图：等容器有了非零的宽高才建（`ResizeObserver` 第一次报尺寸时）。ECharts 按建图那一刻的尺寸开画布，零尺寸的图要等下一次
 *   `resize` 才画得出；组件测试（happy-dom）里容器永远没有尺寸，也就不建图。
 * - 换明暗：`theme.resolved` 变了之后在下一帧重读颜色再画。等一帧是让根元素的 `data-nb-appearance` 与配色先换完、计算样式更新。
 * - `data-chart-appearance`：每次按某种明暗的颜色画完后写上它，浏览器测试与截图等它（t09 记过“图表异步挂载，截图截到空白”）。
 * - 尺寸：`ResizeObserver` 报的变化在下一帧里合成一次 `resize`。
 * - 减弱动效：`prefers-reduced-motion: reduce` 为真时配置不带动画，并跟着它的变化重画。
 * - 卸载：`dispose`、断开观察器、取消没跑的那一帧。
 */

import {onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch} from "vue";

import {useSite} from "../../../context";
import type {ResolvedAppearance} from "../../../host/theme";
import {createChart} from "./charts/echarts";
import type {ChartHandle} from "./charts/echarts";
import type {ChartMotion, ChartOption, ChartTheme} from "./charts/options";
import {readChartTheme} from "./charts/theme";

const props = defineProps<{
    /** 认这张图用（`data-site-chart`）。 */
    id: string;
    /** 读屏的概括（计划 3.5“读屏”）：提示框里的数不靠读屏取得，同样的数在下面的 HTML 面板里本来就有。 */
    label: string;
    /** 按主题与动效生成配置。换了函数（数据或文字变了）就重画。 */
    option: (theme: ChartTheme, motion: ChartMotion) => ChartOption;
}>();

const {theme} = useSite();
const host = useTemplateRef<HTMLElement>("host");
/** 最近一次画图用的明暗；还没画过时不写。 */
const drawnAppearance = shallowRef<ResolvedAppearance>();

let chart: ChartHandle | undefined;
let observer: ResizeObserver | undefined;
let frame = 0;
let redrawInFrame = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function draw(): void {
    const element = host.value;
    if (chart === undefined || element === null) return;
    const appearance = theme.resolved.value;
    chart.draw(props.option(readChartTheme(element), {animation: !reducedMotion.matches}));
    drawnAppearance.value = appearance;
}

function flush(): void {
    frame = 0;
    const element = host.value;
    if (element === null) return;
    if (chart === undefined) {
        if (element.clientWidth === 0 || element.clientHeight === 0) return;
        chart = createChart(element);
        draw();
        redrawInFrame = false;
        return;
    }
    chart.resize();
    if (redrawInFrame) {
        redrawInFrame = false;
        draw();
    }
}

/** 下一帧里做：同一帧里多次尺寸变化、明暗变化只做一次。`redraw` 为真时连同重读颜色重画。 */
function schedule(redraw: boolean): void {
    redrawInFrame ||= redraw;
    if (frame === 0) frame = requestAnimationFrame(flush);
}

const onMotionChange = () => draw();

onMounted(() => {
    const element = host.value;
    if (element === null) return;
    observer = new ResizeObserver(() => schedule(false));
    observer.observe(element);
    reducedMotion.addEventListener("change", onMotionChange);
});

watch(() => theme.resolved.value, () => schedule(true));
watch(() => props.option, draw);

onBeforeUnmount(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    observer?.disconnect();
    reducedMotion.removeEventListener("change", onMotionChange);
    chart?.dispose();
    chart = undefined;
});
</script>

<template>
    <div ref="host" class="trend-chart" role="img" :aria-label="props.label" :data-site-chart="props.id" :data-chart-appearance="drawnAppearance" />
</template>

<style scoped>
.trend-chart {
    width: 100%;
    height: 100%;
}
</style>
