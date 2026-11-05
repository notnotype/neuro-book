<script lang="ts">
import type {InjectionKey} from "vue";
import type {SashGestureScope} from "./useSashGesture";

/**
 * 独立 `Splitter` 自建的 scope。它不能 provide 公开的 `SASH_GESTURE_SCOPE_KEY`：
 * 面板插槽里嵌套的另一个独立 `Splitter` 会把它当成外层 scope，从而放弃自建 scope、不再自己开始手势。
 * 所以只给分隔线一个私有的键；`SashHandle` 先取公开的键（Grid 提供的那份），取不到再取这个。
 */
export const STANDALONE_SASH_SCOPE_KEY: InjectionKey<SashGestureScope> = Symbol("nb-layout.standalone-sash-scope");
</script>

<script setup lang="ts">
/**
 * 一条分隔线：`role="separator"` 的元素、它的 aria、命中登记与两层装饰。
 *
 * 独立 `Splitter` 与 Grid 都要画同样的分隔线，所以抽成一个组件；两者只有定位不同，定位由父组件经 `style`
 * 透传，这里不算位置。手势、命中、悬停与键盘全部交给 inject 来的 scope，这里只把 scope 的状态映射成 `data-sash-*`
 * 属性、并向它登记元素。几何对齐经 `useSashSnap` 的宿主合并到父组件的一帧里。
 */
import {computed, inject, onBeforeUnmount, watch} from "vue";
import {sashBandBox, type SashBandBox} from "./sash-feedback";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {injectSashSnap} from "./useSashSnap";

const props = defineProps<{
    /** 所属分支的 id 与第几条边界：`data-sash` 与登记的身份。 */
    branchId: string;
    index: number;
    /** 这条线调整哪根轴：`width` 是竖线。 */
    axis: "width" | "height";
    /** 主轴占用（CSS px）；0 是不可交互的接缝。 */
    size: number;
    /** 前后相邻面板此刻的主轴尺寸：`sashBandBox` 算装饰带要用。 */
    beforePx: number;
    afterPx: number;
    disabled: boolean;
    /** 长轴两端挨着的外层分隔线键；null 是自由端。那条线此刻也亮着，这一端就连着它，不按 `--sash-line-inset` 缩进。 */
    ends: {start: string | null; end: string | null};
    ariaLabel: string;
    ariaControls: string | undefined;
    ariaMin: number;
    ariaMax: number;
    ariaNow: number;
    ariaValueText: string;
}>();

/**
 * 静止接缝的厚度（CSS px）：与 `--border-w` 同口径的 1px。
 * 它不跟着接缝尺寸变粗（Lab 的 7px 接缝里仍是 1px），也不随 dpr 换算设备像素——
 * 主题里的每一条边框都是 1 CSS px，接缝不该是唯一的例外。
 */
const SEAM_THICKNESS_PX = 1;

const scope = resolveScope();
const snapHost = injectSashSnap();

function resolveScope(): SashGestureScope {
    const found = inject(SASH_GESTURE_SCOPE_KEY, null) ?? inject(STANDALONE_SASH_SCOPE_KEY, null);
    if (found === null) {
        throw new Error("[nb-layout] SashHandle must be rendered inside a Grid or Splitter that provides a sash gesture scope.");
    }
    return found;
}

/**
 * 分界线的命中事实由 scope 统一判定（与光标、拖动同源）；这里只把结果映射成属性，
 * 渲染层不自己算几何。
 */
const key = computed(() => `${props.branchId}:${props.index}`);
const seamOnly = computed(() => props.size === 0);
const inert = computed(() => props.disabled || seamOnly.value);

const isHovered = computed(() => scope.hovered.has(key.value));
const isActive = computed(() => scope.active.has(key.value));
/** T/十字：两根轴同时命中时两条线一起点亮，与实际可开拖的参与集合完全同源。 */
const isCross = computed(() => scope.hovered.has(key.value) && scope.hovered.size > 1);
/** 已满足停留时长（或正在拖、键盘聚焦）的线才显示装饰；`hovered` 只决定光标。 */
const isRevealed = computed(() => isLit(key.value));

/** 同一 scope 里任一条线（含外层分支的）此刻亮不亮；键盘聚焦只亮一条，不需要连。 */
function isLit(lineKey: string): boolean {
    return scope.revealed.has(lineKey) || scope.active.has(lineKey);
}

/** 线的这一端连着另一条亮着的线（T 形交汇）；挨着容器边缘或那条线没亮时按自由端缩进。 */
function endJoined(end: "start" | "end"): boolean {
    const endKey = props.ends[end];
    return endKey !== null && isLit(endKey);
}

let element: HTMLElement | null = null;
let registered: {branchId: string; index: number; element: HTMLElement} | null = null;

function setRef(value: unknown): void {
    element = value instanceof HTMLElement ? value : null;
    reRegister();
}

/**
 * 元素或身份（分支 id、序号、轴）变了都要重新登记。注销时带上元素：scope 只注销仍是当前登记项的那一份，
 * 重挂时新元素先登记、旧元素后注销也不会把新的误删。
 */
function reRegister(): void {
    if (registered !== null) {
        scope.unregisterSash(registered.branchId, registered.index, registered.element);
        registered = null;
    }
    if (element !== null) {
        scope.registerSash({branchId: props.branchId, sashIndex: props.index, axis: props.axis, element});
        registered = {branchId: props.branchId, index: props.index, element};
    }
}

watch(() => [props.branchId, props.index, props.axis], reRegister);

/** 装饰元素：常驻的静止接缝与悬停/拖动才亮的装饰带，几何都只写在自己身上。 */
let seamEl: HTMLElement | null = null;
let lineEl: HTMLElement | null = null;

function setSeamRef(value: unknown): void {
    seamEl = value instanceof HTMLElement ? value : null;
    snapHost.schedule();
}

function setLineRef(value: unknown): void {
    lineEl = value instanceof HTMLElement ? value : null;
    snapHost.schedule();
}

/**
 * 写装饰的几何：只写主轴（起点与厚度），长轴两端交给样式（按 `data-axis`，取缩进变量，缺省贴满）。宿主与主题改变量就能
 * 缩进，不用重新测量；换方向时把另一方向留下的值清掉。不用负 inset 外扩（那正是收起边界被裁细的来源），也不用
 * transform 叠位移（几何与样式各留一份会互相打架）。
 */
function writeDecorationGeometry(target: HTMLElement, box: SashBandBox, horizontal: boolean): void {
    const style = target.style;
    const start = `${Math.round(box.startPx * 10000) / 10000}px`;
    const thickness = `${Math.round(box.thicknessPx * 10000) / 10000}px`;
    style.top = style.bottom = style.left = style.right = "";
    if (horizontal) {
        style.height = "";
        style.left = start;
        style.width = thickness;
    } else {
        style.width = "";
        style.top = start;
        style.height = thickness;
    }
}

/**
 * 两层装饰的几何都只作用在装饰元素上：接缝自身仍是流内的 1px（或 Lab 的 sashSize），命中盒、ARIA 与
 * 面板分配都不受影响。这里的对齐位移最多半个设备像素，且只是装饰层的 CSS px。
 */
function snap(dpr: number): void {
    if (element === null) {
        return;
    }
    const horizontal = props.axis === "width";
    const sashPx = props.size;
    const rect = element.getBoundingClientRect();
    const box = horizontal ? rect.width : rect.height;
    const origin = horizontal ? rect.x : rect.y;
    const center = origin + box / 2;
    /**
     * 1 CSS px 的线盒在 dpr 1.25 上会被抗锯齿摊成两条更淡的线，横竖看起来就不一致，
     * 所以两层装饰各自按自己的性质对到设备像素网格：
     * - 3px 装饰带看**中心**：中心落在设备像素上、两侧对称，视觉重心才压在接缝上；
     * - 1px 静止接缝看**近端边**：这条线只有边缘落在设备像素边界上才是实的（dpr 1、2 都成立），
     *   按中心对齐反而会把它自己摊成两条半透明的线。
     * 缩放容器里 rect 是视口 px，位移要换回本地 CSS px，才能和 `sashBandBox` 的坐标系
     * （接缝与前后面板同尺度）对上。
     */
    const scale = Number.isFinite(box) && box > 0 && Number.isFinite(sashPx) && sashPx > 0 ? box / sashPx : 1;
    const snappedCenter = Math.round(center * dpr) / dpr;
    const band = sashBandBox({
        sashPx,
        beforePx: props.beforePx,
        afterPx: props.afterPx,
        alignmentDeltaPx: (snappedCenter - center) / scale,
    });
    /**
     * 接缝只认自己的盒：它标记的是边界本身，前后面板收起与否都不该把它推开，
     * 不套用装饰带的相邻面板扩展范围；设备像素对齐最多偏移半个设备像素。
     * 接缝盒没测到就不写——宁可不画，也不画一条位置不确定的线。
     */
    const seamStartPx = Number.isFinite(box) && box > 0
        ? (Math.round((center - SEAM_THICKNESS_PX * scale / 2) * dpr) / dpr - origin) / scale
        : null;
    if (lineEl !== null && band !== null) {
        writeDecorationGeometry(lineEl, band, horizontal);
        writeLineCore(lineEl, band, seamStartPx);
    }
    if (seamEl !== null && seamStartPx !== null) {
        writeDecorationGeometry(seamEl, {startPx: seamStartPx, thicknessPx: SEAM_THICKNESS_PX}, horizontal);
    }
}

/**
 * 线芯：主题经 `--sash-line-size` 把线画得比装饰带细（例如 1px 加发光）。装饰带按中心对齐设备像素，细线在里面居中
 * 会摊成两条半透明的线，所以细线芯对齐静止接缝（近端边落在设备像素上，奇数宽都是实的），再夹进装饰带，不越出去
 * 被祖先裁掉。不比装饰带细时清掉变量，线芯铺满装饰带，就是原来的样子。
 */
function writeLineCore(target: HTMLElement, band: SashBandBox, seamStartPx: number | null): void {
    const size = Number.parseFloat(getComputedStyle(target).getPropertyValue("--sash-line-size"));
    if (seamStartPx === null || !(size > 0) || size >= band.thicknessPx) {
        target.style.removeProperty("--nb-sash-core-start");
        target.style.removeProperty("--nb-sash-core-size");
        return;
    }
    const wanted = seamStartPx + (SEAM_THICKNESS_PX - size) / 2;
    const start = Math.min(Math.max(wanted, band.startPx), band.startPx + band.thicknessPx - size);
    target.style.setProperty("--nb-sash-core-start", `${Math.round((start - band.startPx) * 10000) / 10000}px`);
    target.style.setProperty("--nb-sash-core-size", `${size}px`);
}

const unregisterSnap = snapHost.register(snap);

onBeforeUnmount(() => {
    unregisterSnap();
    if (registered !== null) {
        scope.unregisterSash(registered.branchId, registered.index, registered.element);
        registered = null;
    }
    element = null;
    seamEl = null;
    lineEl = null;
});
</script>

<template>
    <div
        :ref="setRef"
        role="separator"
        :data-sash="key"
        :data-sash-hover="isHovered ? 'true' : undefined"
        :data-sash-active="isActive ? 'true' : undefined"
        :data-sash-cross="isCross ? 'true' : undefined"
        :data-sash-revealed="isRevealed ? 'true' : undefined"
        :aria-orientation="props.axis === 'width' ? 'vertical' : 'horizontal'"
        :aria-controls="props.ariaControls"
        :aria-label="props.ariaLabel"
        :aria-valuemin="props.ariaMin"
        :aria-valuemax="props.ariaMax"
        :aria-valuenow="props.ariaNow"
        :aria-valuetext="props.ariaValueText"
        :aria-disabled="inert ? 'true' : undefined"
        :data-disabled="seamOnly ? 'true' : undefined"
        :tabindex="inert ? -1 : 0"
        class="nb-splitter__sash"
        :class="[
            props.axis === 'height' ? 'nb-splitter__sash--vertical' : 'nb-splitter__sash--horizontal',
            seamOnly ? 'nb-splitter__sash--seam' : '',
        ]"
        @keydown="(event: KeyboardEvent) => scope.keydown(event, key)"
        @keyup="scope.keyup"
        @blur="scope.blur()"
    >
        <!--
            两层装饰，都盖在逻辑接缝上、都不占流内空间、都不接指针：
            - 静止接缝（`.sash-seam`）：常驻的 1 CSS px `--divider`，位置由 `snap()` 写内联。
              它回答的是「这条边界在哪」——主题色只管颜色，0 宽边界（不可交互的接缝）不渲染它。
            - 交互装饰带（`.sash-line`）：主轴起点与厚度由 `sashBandBox` 按前后相邻的当前呈现算，
              收起边界（相邻 0px）向内贴边，不会越出分隔盒被祖先的 `overflow-hidden` 裁细；
              它盖在接缝之上，静止态透明，悬停满 SASH_HOVER_DELAY_MS 才淡入，按下与键盘聚焦立即全亮
              ——显隐在下面 scoped CSS 里按 separator 自己的 data 属性取，不走祖先 group。
            两层的内联几何都只写主轴，长轴两端由样式按缩进变量定；不动分隔盒与命中盒。
        -->
        <template v-if="!seamOnly">
            <span
                :ref="setSeamRef"
                aria-hidden="true"
                class="sash-seam"
                :data-axis="props.axis"
            />
            <span
                :ref="setLineRef"
                aria-hidden="true"
                class="sash-line"
                :data-axis="props.axis"
                :data-joined-start="endJoined('start') ? 'true' : undefined"
                :data-joined-end="endJoined('end') ? 'true' : undefined"
            />
        </template>
    </div>
</template>

<style scoped>
.nb-splitter__sash {
    position: relative;
    z-index: 1;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    user-select: none;
}

.nb-splitter__sash:focus-visible {
    outline: none;
}

.nb-splitter__sash--vertical {
    width: 100%;
    cursor: row-resize;
}

.nb-splitter__sash--horizontal {
    height: 100%;
    cursor: col-resize;
}

.nb-splitter__sash--seam {
    pointer-events: none;
}

.sash-seam,
.sash-line {
    position: absolute;
    pointer-events: none;
}

/**
 * 静止接缝：常驻的 1 CSS px `--divider`。它标记的是**边界**本身，不是交互反馈——
 * 所以没有 hover / 拖动态，也不跟着 `disabled` 消失（不能拖不等于边界不存在）。
 * 位置与厚度由 `snap()` 写内联（和装饰带同一趟），这里只管颜色；0 宽边界不渲染这个元素。
 * 宿主可以经 `--nb-splitter-seam` 换颜色（例如部件之间本来就有缝、不需要线时设成透明），经 `--nb-splitter-seam-inset`
 * 让它沿长轴两端缩进（开放式分割线）。
 */
.sash-seam {
    background: var(--nb-splitter-seam, var(--divider));
}

/* 长轴两端：竖向的接缝（宽度轴的分隔）缩上下，横向的缩左右；装饰带照旧贴满。主轴由 `snap()` 写内联。 */
.sash-seam[data-axis="width"] {
    top: var(--nb-splitter-seam-inset, 0px);
    bottom: var(--nb-splitter-seam-inset, 0px);
}

.sash-seam[data-axis="height"] {
    left: var(--nb-splitter-seam-inset, 0px);
    right: var(--nb-splitter-seam-inset, 0px);
}

/*
 * 悬停线的长轴两端：自由端按主题的 `--sash-line-inset` 缩进；连着另一条亮着的线的一端（`data-joined-*`，T 形交汇）
 * 照旧到头，两条线连成一体。
 */
.sash-line[data-axis="width"] {
    top: var(--sash-line-inset, 0px);
    bottom: var(--sash-line-inset, 0px);
}

.sash-line[data-axis="height"] {
    left: var(--sash-line-inset, 0px);
    right: var(--sash-line-inset, 0px);
}

.sash-line[data-axis="width"][data-joined-start] {
    top: 0;
}

.sash-line[data-axis="width"][data-joined-end] {
    bottom: 0;
}

.sash-line[data-axis="height"][data-joined-start] {
    left: 0;
}

.sash-line[data-axis="height"][data-joined-end] {
    right: 0;
}

/* 线芯：颜色、圆角与发光取主题 token；位置与厚度由 `writeLineCore()` 写成变量，没写时铺满装饰带。 */
.sash-line::before {
    position: absolute;
    border-radius: var(--sash-line-radius, 0px);
    background: var(--sash-line-color, var(--accent-main));
    box-shadow: var(--sash-line-glow, none);
    content: "";
}

.sash-line[data-axis="width"]::before {
    top: 0;
    bottom: 0;
    left: var(--nb-sash-core-start, 0px);
    width: var(--nb-sash-core-size, 100%);
}

.sash-line[data-axis="height"]::before {
    left: 0;
    right: 0;
    top: var(--nb-sash-core-start, 0px);
    height: var(--nb-sash-core-size, 100%);
}

/**
 * 装饰带的显隐状态完全在这里：用 separator 的**直属子选择器**取自己的 data 属性，
 * 而不是 `group-data-*` 工具类——一条线的状态与父级/兄弟的 group 无关，
 * 祖先上恰好也叫 `group` 的节点不该把状态混进来。
 * 主轴几何由 `snap()` 写内联，这里只管透明度；线芯的颜色与发光在上面的 `::before`。
 */
.sash-line {
    opacity: 0;
    transition-property: opacity;
    transition-duration: var(--motion-fast);
    transition-timing-function: var(--ease-standard);
}

/* 悬停满 SASH_HOVER_DELAY_MS 后才由 scope 置 revealed：从 0 渐显到 1，离开立即淡出。 */
[data-sash-revealed="true"] > .sash-line {
    opacity: 1;
}

/* 拖动与键盘聚焦要求立即全亮：不等待、不渐变。 */
[data-sash-active="true"] > .sash-line,
[data-sash]:focus-visible > .sash-line {
    opacity: 1;
    transition: none;
}

/* 不可交互的接缝永远不亮（放在渐显规则之后：同为属性选择器时由顺序裁决）。 */
[aria-disabled="true"] > .sash-line {
    opacity: 0;
}

/**
 * 减少动效：保留「停留后才显示」的防误触语义（由 scope 的计时决定），只去掉淡入淡出。
 * 拖动与键盘聚焦本来就要求立即全亮，不受这条影响。
 */
@media (prefers-reduced-motion: reduce) {
    .sash-line {
        transition: none;
    }
}
</style>
