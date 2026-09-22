<script setup lang="ts">
/**
 * 一维分隔面板。两种用法共用一个组件：
 *
 * - **受控**（Grid 的每个分支）：宿主给 `sizesPx`，分隔线把元素注册进外层 `useSashGesture` scope，
 *   自己不开始手势——一整棵 Grid 只有一份会话，交汇处两根轴才能一起提交。几何改动由 scope 拥有者发布。
 * - **独立**：没有外层 scope 时自建单层 scope，用同一批纯函数在自己身上求解，发 `gesture-*` 与 `layout`。
 *
 * 几何一律 CSS px：`sizesPx` 与 `panels` 同序，合计等于面板空间（不含 sash 占用）。没有百分比往返。
 */
import {computed, inject, onBeforeUnmount, ref, useId, watch} from "vue";
import {allocateSashPanels, sashPanelBounds, type SashPanel} from "./grid-geometry";
import {sashPanelsOfConfig} from "./grid-splitter";
import {sashBandBox, type SashBandBox} from "./sash-feedback";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {createSplitterSession, type SplitterGestureChange} from "./splitter-session";
import {useLayoutExtent} from "../../composables/useLayoutExtent";
import {useSashGesture, type SashGestureScope} from "../../composables/useSashGesture";
import type {SashGestureBinding, SashGestureHost} from "./sash-gesture";
import type {SplitterGestureCancellation, SplitterGestureState} from "./splitter-gesture";
import type {GridAxis, GridExtent, SashCollapseState} from "./grid-types";

export interface SplitterPanelConfig {
    id?: string;
    /** 主轴初始 px（独立模式下未受控时由它分配）。 */
    defaultSizePx?: number;
    minSizePx?: number;
    maxSizePx?: number;
    /** 主轴分配策略；缺省 `weight`。 */
    sizing?: "fixed" | "weight";
    /** 收起策略与状态；缺省不可收起。 */
    collapse?: SashCollapseState;
}

const props = withDefaults(defineProps<{
    direction?: "horizontal" | "vertical";
    disabled?: boolean;
    panels?: SplitterPanelConfig[];
    /** 每条边界的主轴 px 占用；缺项 1px，0 表示不可交互的接缝。 */
    sashSizes?: readonly number[];
    /** 受控呈现 px（合计 = 面板空间，不含 sash）。缺省时组件在自己的 scope 内分配。 */
    sizesPx?: readonly number[];
    /** 所属 Grid 的分支 id；独立使用时省略。分隔线身份与 aria 都用它。 */
    branchId?: string;
}>(), {
    direction: "horizontal",
    disabled: false,
    panels: () => [],
    sashSizes: () => [],
    sizesPx: undefined,
    branchId: "panels",
});

const emit = defineEmits<{
    (e: "layout", sizesPx: readonly number[]): void;
    (e: "gesture-start", state: SplitterGestureState): void;
    (e: "gesture-update", state: SplitterGestureState): void;
    (e: "gesture-end", state: SplitterGestureState): void;
    (e: "gesture-cancel", info: SplitterGestureCancellation): void;
}>();

defineSlots<Record<`panel-${string}`, (props: {panel: SplitterPanelConfig; index: number}) => unknown> & {default(): unknown}>();

const DEFAULT_SASH_SIZE = 1;

/**
 * 静止接缝的厚度（CSS px）：与 `--border-w` 同口径的 1px。
 * 它不跟着接缝尺寸变粗（Lab 的 7px 接缝里仍是 1px），也不随 dpr 换算设备像素——
 * 主题里的每一条边框都是 1 CSS px，接缝不该是唯一的例外。
 */
const SEAM_THICKNESS_PX = 1;

const axis = computed<GridAxis>(() => props.direction === "horizontal" ? "width" : "height");
const panelIds = computed(() => props.panels.map((panel, index) => panel.id ?? `panel-${index}`));
const panelIdsKey = computed(() => panelIds.value.join("|"));
const instanceId = useId();
const domPanelIds = computed(() => panelIds.value.map((id) => `${instanceId}-${id}`));

const sashSizes = computed(() => {
    const boundaryCount = Math.max(0, props.panels.length - 1);
    if (props.sashSizes.length > boundaryCount) {
        console.warn(`[nb-ui/Splitter] sashSizes has ${props.sashSizes.length} entries for ${boundaryCount} boundaries; extra entries are ignored.`);
    }
    return Array.from({length: boundaryCount}, (_, index) => {
        const size = props.sashSizes[index] ?? DEFAULT_SASH_SIZE;
        if (Number.isFinite(size) && size >= 0) {
            return size;
        }
        console.warn(`[nb-ui/Splitter] sashSizes[${index}] must be a finite non-negative number; using ${DEFAULT_SASH_SIZE}px.`);
        return DEFAULT_SASH_SIZE;
    });
});
const sashTotal = computed(() => sashSizes.value.reduce((sum, size) => sum + size, 0));
const sashSizesKey = computed(() => sashSizes.value.join(","));

/** 面板配置 → 会话/aria 共用的 SashPanel；尺寸取当前呈现。 */
const sashPanels = computed<SashPanel[]>(() => sashPanelsOfConfig(props.panels, renderedSizes.value));

const rootEl = ref<HTMLElement | null>(null);
/** 主轴承载尺寸：与 Grid 会话共用同一份**布局盒**测量（变换后的 rect 不是分配依据）。 */
const measuredExtent = useLayoutExtent(rootEl);
const measuredMain = computed(() => {
    const extent = measuredExtent.value;
    if (extent === null) {
        return 0;
    }
    return axis.value === "width" ? extent.width : extent.height;
});

/**
 * 独立模式：自建 scope。受控模式下分隔线只注册进外层 scope，本组件不再持有第二份手势状态。
 */
const parentScope = inject(SASH_GESTURE_SCOPE_KEY, null);
const localSizes = ref<number[]>([]);
let localSnapshot: readonly number[] | null = null;
let lastState: SplitterGestureState | null = null;
let sessionCounter = 0;

const localHost: SashGestureHost<SplitterGestureState, SplitterGestureChange> = {
    begin(input) {
        const sashIndex = input.sashes.find((sash) => sash.branchId === props.branchId)?.index ?? input.sashes[0]?.index;
        if (sashIndex === undefined || props.panels.length < 2) {
            return null;
        }
        const baselinePx = renderedSizes.value;
        if (baselinePx.length !== props.panels.length) {
            return null;
        }
        sessionCounter += 1;
        const session = createSplitterSession({
            sessionId: `${instanceId}-${sessionCounter}`,
            contextKey: props.branchId,
            source: input.source,
            revision: 0,
            branchId: props.branchId,
            axis: axis.value,
            ids: panelIds.value,
            panels: sashPanels.value,
            baselinePx,
            sashIndex,
            extent: extentOf(),
        });
        localSnapshot = [...baselinePx];
        lastState = null;
        const label = sashLabel(sashIndex);
        emit("gesture-start", {
            source: input.source,
            sash: label,
            active: [],
            compensated: [],
            sizesPx: [...baselinePx],
            collapsed: {},
        });
        return {
            session,
            onPreview: (state) => {
                if (state === null) {
                    if (localSnapshot !== null) {
                        localSizes.value = [...localSnapshot];
                    }
                    return;
                }
                lastState = state;
                localSizes.value = [...state.sizesPx];
                emit("gesture-update", state);
            },
            onCommit: () => {
                if (lastState !== null) {
                    emit("gesture-end", lastState);
                }
                localSnapshot = null;
                lastState = null;
                return {ok: true};
            },
            onCancel: (info) => {
                emit("gesture-cancel", {source: input.source, sash: label, reason: info.reason});
                localSnapshot = null;
                lastState = null;
            },
        } satisfies SashGestureBinding<SplitterGestureState, SplitterGestureChange>;
    },
};

/**
 * 受控模式只注册进外层 scope，本组件不再持有第二份手势状态；
 * 独立模式的 scope 根就是本组件根元素。两条路径的判定在 setup 阶段一次性完成。
 */
const localScope: SashGestureScope | null = parentScope === null
    ? useSashGesture<SplitterGestureState, SplitterGestureChange>({
        host: () => localHost,
        root: rootEl,
        disabled: () => props.disabled,
    })
    : null;
const scope: SashGestureScope = parentScope ?? localScope!;

function extentOf(): GridExtent {
    const main = measuredMain.value || renderedSizes.value.reduce((sum, value) => sum + value, 0) + sashTotal.value;
    return axis.value === "width" ? {width: main, height: 0} : {width: 0, height: main};
}

const collapseMotion = ref<ReadonlySet<number>>(new Set());

function renderedCollapsed(index: number): boolean {
    const panel = props.panels[index];
    return panel?.collapse?.collapsed === true;
}

function collapseSignature(): string {
    return props.panels.map((panel) => panel.collapse?.collapsed === true ? "1" : "0").join("");
}

watch(collapseSignature, (next, previous) => {
    const moving = new Set<number>();
    const length = Math.max(next.length, previous.length);
    for (let index = 0; index < length; index += 1) {
        if (next[index] !== previous[index]) {
            moving.add(index);
        }
    }
    collapseMotion.value = moving;
});

/** 可访问性上限：面板的主轴上限不可能超过容器可用空间。 */
function ariaMax(index: number): number {
    const {low, high} = panelBounds(index);
    const available = measuredMain.value || renderedSizes.value.reduce((sum, value) => sum + value, 0) + sashTotal.value;
    return Math.round(Math.max(low, Math.min(high, available)));
}

function panelBounds(index: number): {low: number; high: number} {
    const panel = props.panels[index];
    if (panel === undefined) {
        return {low: 0, high: Number.MAX_SAFE_INTEGER};
    }
    if (panel.collapse?.collapsed === true) {
        const size = Math.max(0, panel.collapse.collapsedSize);
        return {low: size, high: size};
    }
    const low = Math.max(0, panel.minSizePx ?? 0);
    return {low, high: Math.max(low, panel.maxSizePx ?? Number.MAX_SAFE_INTEGER)};
}

/** 受控：宿主发布的 px 就是唯一事实；独立：本组件的分配结果。 */
const renderedSizes = computed<number[]>(() => {
    const count = props.panels.length;
    const published = props.sizesPx;
    if (published !== undefined && published.length === count) {
        return published.map((size) => Math.max(0, Number.isFinite(size) ? size : 0));
    }
    if (localSizes.value.length === count) {
        return localSizes.value;
    }
    return allocateLocal();
});

function allocateLocal(): number[] {
    if (props.panels.length === 0) {
        return [];
    }
    const declared = props.panels.reduce((sum, panel) => sum + Math.max(0, panel.defaultSizePx ?? 0), 0);
    const available = Math.max(0, (measuredMain.value || declared) - sashTotal.value);
    return allocateSashPanels(sashPanelsOfConfig(props.panels), available);
}

const isControlled = computed(() => props.sizesPx !== undefined && props.sizesPx.length === props.panels.length);

/**
 * 取消必须先于重排：约束变化时本 watcher 先作废手势（`dragging` 变 false），
 * 紧接着的分配 watcher 才有机会按新约束重新分配。注册顺序就是执行顺序。
 */
/**
 * 约束语义（面板身份、上下界、分配策略、收起策略）变化会让进行中的手势基线作废；
 * **呈现 px 与收起状态不在其中**：手势预览每帧都会重发它们，把它们当外部变化会让拖动自己取消自己。
 * 同值重建得到同一个键，因此不取消——这正是「等值重建保留手势、真实约束变化取消」的判据。
 */
const panelConstraintsKey = computed(() => JSON.stringify(props.panels.map((panel, index) => [
    panel.id ?? `panel-${index}`,
    // 受控模式的 min/max 来自宿主发布的有效约束（随容器尺寸变化），把它当外部变化会让拖动自己取消自己；
    // 真正的约束变化由宿主递增 `revision` 让会话失效。独立模式没有宿主，这里必须看住声明的约束。
    isControlled.value ? null : panel.minSizePx ?? null,
    isControlled.value ? null : panel.maxSizePx ?? null,
    panel.sizing ?? null,
    panel.collapse?.collapsedSize ?? null,
    panel.collapse?.restoreSize ?? null,
    panel.collapse?.collapseThreshold ?? null,
    panel.collapse?.expandThreshold ?? null,
])));

watch(() => [props.branchId, props.direction, panelIdsKey.value, panelConstraintsKey.value, isControlled.value ? null : sashSizesKey.value].join("|"), () => {
    scope.invalidate();
    reRegister();
});

watch([measuredMain, sashSizesKey, panelIdsKey, () => props.panels], () => {
    if (isControlled.value) {
        return;
    }
    if (scope.dragging) {
        return;
    }
    const next = allocateLocal();
    if (next.length === localSizes.value.length && next.every((size, index) => size === localSizes.value[index])) {
        return;
    }
    localSizes.value = next;
    emit("layout", [...next]);
}, {deep: false});

/** 主轴 px 的面板/分隔线样式；交叉轴由 flex 拉伸占满，不写尺寸。 */
function panelStyle(index: number): Record<string, string> {
    const size = `${renderedSizes.value[index] ?? 0}px`;
    return axis.value === "width"
        ? {width: size, flex: `0 0 ${size}`}
        : {height: size, flex: `0 0 ${size}`};
}

function sashStyle(index: number): Record<string, string> {
    const size = `${sashSizes.value[index] ?? DEFAULT_SASH_SIZE}px`;
    return axis.value === "width"
        ? {width: size, minWidth: size, flex: `0 0 ${size}`}
        : {height: size, minHeight: size, flex: `0 0 ${size}`};
}

/**
 * 分界线的命中事实由 scope 统一判定（与光标、拖动同源）；这里只把结果映射成属性，
 * 渲染层不自己算几何。
 */
function sashKey(index: number): string {
    return `${props.branchId}:${index}`;
}

const sashEls = new Map<number, HTMLElement>();
let registered: {key: string; element: HTMLElement}[] = [];

function setSashRef(index: number, value: Element | null): void {
    const element = value instanceof HTMLElement ? value : null;
    if (element === null) {
        sashEls.delete(index);
    } else {
        sashEls.set(index, element);
    }
    reRegister();
}

function reRegister(): void {
    for (const item of registered) {
        const [branchId, indexText] = item.key.split(":");
        scope.unregisterSash(branchId ?? props.branchId, Number(indexText), item.element);
    }
    registered = [];
    for (const [index, element] of sashEls) {
        scope.registerSash({branchId: props.branchId, sashIndex: index, axis: axis.value, element});
        registered.push({key: sashKey(index), element});
    }
}

/** 主动操作的 sash 稳定 id，形如 `outline~editor`；开始/更新/结束/取消共用它。 */
function sashLabel(index: number): string {
    const before = panelIds.value[index] ?? `panel-${index}`;
    const after = panelIds.value[index + 1] ?? `panel-${index + 1}`;
    return `${before}~${after}`;
}

function isHovered(index: number): boolean {
    return scope.hovered.has(sashKey(index));
}

function isActive(index: number): boolean {
    return scope.active.has(sashKey(index));
}

/** T/十字：两根轴同时命中时两条线一起点亮，与实际可开拖的参与集合完全同源。 */
function isCross(index: number): boolean {
    return scope.hovered.has(sashKey(index)) && scope.hovered.size > 1;
}

/** 已满足停留时长（或正在拖、键盘聚焦）的线才显示装饰；`hovered` 只决定光标。 */
function isRevealed(index: number): boolean {
    const key = sashKey(index);
    return scope.revealed.has(key) || scope.active.has(key);
}

const viewportScale = ref(typeof window === "undefined" ? 1 : (window.devicePixelRatio || 1));
/** 装饰元素：常驻的静止接缝与悬停/拖动才亮的装饰带，几何都只写在自己身上。 */
const seamEls = new Map<number, HTMLElement | null>();
const lineEls = new Map<number, HTMLElement | null>();
let snapFrame = 0;

/**
 * 两层装饰的几何都只作用在装饰元素上：接缝自身仍是流内的 1px（或 Lab 的 sashSize），命中盒、ARIA 与
 * 面板分配都不受影响。这里的对齐位移最多半个设备像素，且只是装饰层的 CSS px。
 *
 * 触发源很多（拖动预览、宿主发布尺寸、接缝尺寸、方向、挂载与窗口变化），统一合并到一帧：
 * 重复请求只多跑一次 `snapLines()`，不会各排一个回调。
 */
function scheduleSnap(): void {
    if (typeof requestAnimationFrame !== "function") {
        return;
    }
    if (snapFrame) {
        return;
    }
    snapFrame = requestAnimationFrame(() => {
        snapFrame = 0;
        snapLines();
    });
}

/**
 * 写呈现用的四个长度：主轴起点/厚度 + 交叉轴铺满分隔盒。
 * 不用负 inset 外扩（那正是收起边界被裁细的来源），也不用 transform 叠位移（几何与样式各留一份会互相打架）。
 */
function writeDecorationGeometry(element: HTMLElement, box: SashBandBox, horizontal: boolean): void {
    const style = element.style;
    const start = `${Math.round(box.startPx * 10000) / 10000}px`;
    const thickness = `${Math.round(box.thicknessPx * 10000) / 10000}px`;
    if (horizontal) {
        style.height = "";
        style.left = start;
        style.width = thickness;
        style.top = "0px";
        style.bottom = "0px";
    } else {
        style.width = "";
        style.top = start;
        style.height = thickness;
        style.left = "0px";
        style.right = "0px";
    }
}

function snapLines(): void {
    const dpr = viewportScale.value;
    const horizontal = axis.value === "width";
    for (const [index, sash] of sashEls) {
        const sashPx = sashSizes.value[index] ?? DEFAULT_SASH_SIZE;
        const rect = sash.getBoundingClientRect();
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
            beforePx: renderedSizes.value[index] ?? 0,
            afterPx: renderedSizes.value[index + 1] ?? 0,
            alignmentDeltaPx: (snappedCenter - center) / scale,
        });
        const line = lineEls.get(index);
        if (line !== null && line !== undefined && band !== null) {
            writeDecorationGeometry(line, band, horizontal);
        }
        /**
         * 接缝只认自己的盒：它标记的是边界本身，前后面板收起与否都不该把它推开，
         * 不套用装饰带的相邻面板扩展范围；设备像素对齐最多偏移半个设备像素。
         * 接缝盒没测到就不写——宁可不画，也不画一条位置不确定的线。
         */
        const seam = seamEls.get(index);
        if (seam !== null && seam !== undefined && Number.isFinite(box) && box > 0) {
            const startPx = (Math.round((center - SEAM_THICKNESS_PX * scale / 2) * dpr) / dpr - origin) / scale;
            writeDecorationGeometry(seam, {startPx, thicknessPx: SEAM_THICKNESS_PX}, horizontal);
        }
    }
}

function setSeamRef(index: number, value: Element | null): void {
    seamEls.set(index, value instanceof HTMLElement ? value : null);
    scheduleSnap();
}

function setLineRef(index: number, value: Element | null): void {
    lineEls.set(index, value instanceof HTMLElement ? value : null);
    scheduleSnap();
}

function onViewportChange(): void {
    viewportScale.value = window.devicePixelRatio || 1;
    scheduleSnap();
}

/**
 * 滚动改变接缝在视口里的位置，叠加 dpr 后会算出不同的对齐位移：捕获阶段监听（滚动不冒泡）挂到 window，
 * 一次覆盖所有滚动容器；只排一帧几何，不读布局，也不产生滚动副作用。
 */
function onViewportScroll(): void {
    scheduleSnap();
}

watch(rootEl, (element, previous) => {
    if (previous !== null) {
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("scroll", onViewportScroll, {capture: true});
    }
    if (element === null) {
        return;
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportScroll, {capture: true, passive: true});
    localSizes.value = isControlled.value ? [] : allocateLocal();
    reRegister();
    scheduleSnap();
}, {immediate: true});

/**
 * 装饰带的可用范围是前后相邻面板的当前呈现，厚度与方向也来自布局：任一变化都要重排几何，
 * 否则收起/展开后线会停在旧范围里，或被旧范围的负起点裁细。与拖动预览同频，只写装饰元素。
 */
watch([renderedSizes, sashSizes, () => props.direction], () => scheduleSnap());

watch(() => props.disabled, (disabled) => {
    if (disabled) {
        scope.invalidate();
    }
});

onBeforeUnmount(() => {
    scope.invalidate();
    for (const item of registered) {
        const [branchId, indexText] = item.key.split(":");
        scope.unregisterSash(branchId ?? props.branchId, Number(indexText), item.element);
    }
    registered = [];
    sashEls.clear();
    seamEls.clear();
    lineEls.clear();
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportScroll, {capture: true});
    if (snapFrame) {
        cancelAnimationFrame(snapFrame);
    }
    snapFrame = 0;
});
</script>

<template>
    <div
        ref="rootEl"
        class="flex h-full w-full overflow-hidden"
        :class="props.direction === 'vertical' ? 'flex-col' : 'flex-row'"
        :data-splitter="props.branchId"
        :data-splitter-axis="axis"
    >
        <template v-if="props.panels.length > 0">
            <template v-for="(panel, index) in props.panels" :key="panel.id || index">
                <div
                    :id="domPanelIds[index]"
                    class="nb-grid-panel relative min-h-0 min-w-0 overflow-hidden"
                    :data-animating="scope.active.size === 0 && collapseMotion.has(index) ? 'true' : undefined"
                    :data-panel-id="panelIds[index]"
                    :data-state="renderedCollapsed(index) ? 'collapsed' : 'expanded'"
                    :style="panelStyle(index)"
                >
                    <slot :name="`panel-${panel.id || index}`" :panel="panel" :index="index" />
                </div>

                <div
                    v-if="index < props.panels.length - 1"
                    :ref="(value) => setSashRef(index, value as Element | null)"
                    role="separator"
                    :data-sash="sashKey(index)"
                    :data-sash-hover="isHovered(index) ? 'true' : undefined"
                    :data-sash-active="isActive(index) ? 'true' : undefined"
                    :data-sash-cross="isCross(index) ? 'true' : undefined"
                    :data-sash-revealed="isRevealed(index) ? 'true' : undefined"
                    :aria-orientation="props.direction === 'horizontal' ? 'vertical' : 'horizontal'"
                    :aria-controls="domPanelIds[index]"
                    :aria-label="`调整 ${panelIds[index]} 与 ${panelIds[index + 1]} 的${axis === 'width' ? '宽度' : '高度'}`"
                    :aria-valuemin="Math.round(panelBounds(index).low)"
                    :aria-valuemax="ariaMax(index)"
                    :aria-valuenow="Math.round(renderedSizes[index] ?? 0)"
                    :aria-valuetext="renderedCollapsed(index) ? '已收起' : `${Math.round(renderedSizes[index] ?? 0)} 像素`"
                    :aria-disabled="props.disabled || sashSizes[index] === 0 ? 'true' : undefined"
                    :data-disabled="sashSizes[index] === 0 ? 'true' : undefined"
                    :tabindex="props.disabled || sashSizes[index] === 0 ? -1 : 0"
                    :style="sashStyle(index)"
                    class="relative z-[1] flex shrink-0 items-center justify-center select-none focus-visible:outline-none"
                    :class="[
                        props.direction === 'vertical'
                            ? 'w-full cursor-row-resize'
                            : 'h-full cursor-col-resize',
                        sashSizes[index] === 0 ? 'pointer-events-none' : '',
                    ]"
                    @keydown="(event: KeyboardEvent) => scope.keydown(event, sashKey(index))"
                    @keyup="scope.keyup"
                    @blur="scope.blur()"
                >
                    <!--
                        两层装饰，都盖在逻辑接缝上、都不占流内空间、都不接指针：
                        - 静止接缝（`.sash-seam`）：常驻的 1 CSS px `--divider`，位置由 `snapLines()` 写内联。
                          它回答的是「这条边界在哪」——主题色只管颜色，0 宽边界（不可交互的接缝）不渲染它。
                        - 交互装饰带（`.sash-line`）：主轴起点与厚度由 `sashBandBox` 按前后相邻的当前呈现算，
                          收起边界（相邻 0px）向内贴边，不会越出分隔盒被祖先的 `overflow-hidden` 裁细；
                          它盖在接缝之上，静止态透明，悬停满 SASH_HOVER_DELAY_MS 才淡入，按下与键盘聚焦立即全亮
                          ——显隐在下面 scoped CSS 里按 separator 自己的 data 属性取，不走祖先 group。
                        两层都用分隔盒的交叉轴铺满（上下 / 左右为 0），只写内联几何，不动分隔盒与命中盒。
                    -->
                    <template v-if="sashSizes[index] !== 0">
                        <span
                            :ref="(value) => setSeamRef(index, value as Element | null)"
                            aria-hidden="true"
                            class="sash-seam pointer-events-none absolute"
                        />
                        <span
                            :ref="(value) => setLineRef(index, value as Element | null)"
                            aria-hidden="true"
                            class="sash-line pointer-events-none absolute"
                        />
                    </template>
                </div>
            </template>
        </template>
        <template v-else>
            <slot />
        </template>
    </div>
</template>

<style scoped>
/**
 * 静止接缝：常驻的 1 CSS px `--divider`。它标记的是**边界**本身，不是交互反馈——
 * 所以没有 hover / 拖动态，也不跟着 `disabled` 消失（不能拖不等于边界不存在）。
 * 位置与厚度由 `snapLines()` 写内联（和装饰带同一趟），这里只管颜色；0 宽边界不渲染这个元素。
 */
.sash-seam {
    background: var(--divider);
}

/* 收起/展开是控件形变，走 --motion-base；拖动中关闭，避免跟手延迟。 */
.nb-grid-panel[data-animating] {
    transition: flex-basis var(--motion-base) var(--ease-standard), width var(--motion-base) var(--ease-standard), height var(--motion-base) var(--ease-standard);
}

/**
 * 装饰带的显隐状态完全在这里：用 separator 的**直属子选择器**取自己的 data 属性，
 * 而不是 `group-data-*` 工具类——一条线的状态与父级/兄弟的 group 无关，
 * 祖先上恰好也叫 `group` 的节点不该把状态混进来。
 * 几何（left/top/width/height）由 `snapLines()` 写内联，样式只负责颜色与透明度。
 */
.sash-line {
    background: var(--accent-main);
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
