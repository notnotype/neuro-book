<script setup lang="ts">
import type {HTMLAttributes} from "vue";
/**
 * 一维分隔面板：自建一份手势 scope，用纯函数在自己身上求解，发 `gesture-*` 与 `layout`。Grid 不用它，叶与分隔线由 `NestedGrid`
 * 直接摆放，两边共用的是 `SashHandle`。
 *
 * 几何一律 CSS px：`sizesPx` 与 `panels` 同序，合计等于面板空间（不含 sash 占用）。没有百分比往返。
 */
import {computed, onBeforeUnmount, provide, ref, useId, watch} from "vue";
import {allocateSashPanels, sashPanelBounds, type SashPanel} from "../grid-geometry";
import {DEFAULT_SASH_SIZE} from "../grid-rects";
import {ariaMax, panelBounds, sashPanelsOfConfig} from "./grid-splitter";
import type {SplitterPanelConfig} from "./grid-splitter";
import SashHandle from "./SashHandle.vue";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {createSplitterSession, type SplitterGestureChange} from "../splitter-session";
import {useLayoutExtent} from "./useLayoutExtent";
import {useLayoutText} from "./text";
import {useSashSnap} from "./useSashSnap";
import {useSashGesture} from "./useSashGesture";
import type {SashGestureBinding, SashGestureHost} from "../sash-gesture";
import type {SplitterGestureCancellation, SplitterGestureState} from "../splitter-gesture";
import type {GridAxis, GridExtent, SashCollapseState} from "../grid-types";

const props = withDefaults(defineProps<{
    direction?: "horizontal" | "vertical";
    disabled?: boolean;
    panels?: SplitterPanelConfig[];
    /** 每条边界的主轴 px 占用；缺项 1px，0 表示不可交互的接缝。 */
    sashSizes?: readonly number[];
    /** 受控呈现 px（合计 = 面板空间，不含 sash）。缺省时组件在自己的 scope 内分配。 */
    sizesPx?: readonly number[];
} & /* @vue-ignore */ HTMLAttributes>(), {
    direction: "horizontal",
    disabled: false,
    panels: () => [],
    sashSizes: () => [],
    sizesPx: undefined,
});

const emit = defineEmits<{
    (e: "layout", sizesPx: readonly number[]): void;
    (e: "gesture-start", state: SplitterGestureState): void;
    (e: "gesture-update", state: SplitterGestureState): void;
    (e: "gesture-end", state: SplitterGestureState): void;
    (e: "gesture-cancel", info: SplitterGestureCancellation): void;
}>();

defineSlots<Record<`panel-${string}`, (props: {panel: SplitterPanelConfig; index: number}) => unknown> & {default(): unknown}>();

/** 分隔线身份（`data-sash`、会话）里的分支 id：独立的 Splitter 只有这一个。 */
const BRANCH_ID = "panels";

const text = useLayoutText();
const axis = computed<GridAxis>(() => props.direction === "horizontal" ? "width" : "height");
const panelIds = computed(() => props.panels.map((panel, index) => panel.id ?? `panel-${index}`));
const panelIdsKey = computed(() => panelIds.value.join("|"));
const instanceId = useId();
const domPanelIds = computed(() => panelIds.value.map((id) => `${instanceId}-${id}`));

const sashSizes = computed(() => {
    const boundaryCount = Math.max(0, props.panels.length - 1);
    if (props.sashSizes.length > boundaryCount) {
        console.warn(`[nb-layout/Splitter] sashSizes has ${props.sashSizes.length} entries for ${boundaryCount} boundaries; extra entries are ignored.`);
    }
    return Array.from({length: boundaryCount}, (_, index) => {
        const size = props.sashSizes[index] ?? DEFAULT_SASH_SIZE;
        if (Number.isFinite(size) && size >= 0) {
            return size;
        }
        console.warn(`[nb-layout/Splitter] sashSizes[${index}] must be a finite non-negative number; using ${DEFAULT_SASH_SIZE}px.`);
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

const localSizes = ref<number[]>([]);
let localSnapshot: readonly number[] | null = null;
let lastState: SplitterGestureState | null = null;
let sessionCounter = 0;

const localHost: SashGestureHost<SplitterGestureState, SplitterGestureChange> = {
    begin(input) {
        const sashIndex = input.sashes[0]?.index;
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
            contextKey: BRANCH_ID,
            source: input.source,
            revision: 0,
            branchId: BRANCH_ID,
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

const scope = useSashGesture<SplitterGestureState, SplitterGestureChange>({
    host: () => localHost,
    root: rootEl,
    disabled: () => props.disabled,
});
provide(SASH_GESTURE_SCOPE_KEY, scope);
const snapHost = useSashSnap();

function extentOf(): GridExtent {
    const main = measuredMain.value || renderedSizes.value.reduce((sum, value) => sum + value, 0) + sashTotal.value;
    return axis.value === "width" ? {width: main, height: 0} : {width: 0, height: main};
}

/** 容器可用长度：`ariaMax` 的上限；没量到时退回当前呈现合计加接缝。 */
const availableMain = computed(() => measuredMain.value || renderedSizes.value.reduce((sum, value) => sum + value, 0) + sashTotal.value);

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

watch(() => [props.direction, panelIdsKey.value, panelConstraintsKey.value, isControlled.value ? null : sashSizesKey.value].join("|"), () => {
    scope.invalidate();
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

/** 主动操作的 sash 稳定 id，形如 `outline~editor`；开始/更新/结束/取消共用它。 */
function sashLabel(index: number): string {
    const before = panelIds.value[index] ?? `panel-${index}`;
    const after = panelIds.value[index + 1] ?? `panel-${index + 1}`;
    return `${before}~${after}`;
}

watch(rootEl, (element) => {
    if (element === null) {
        return;
    }
    localSizes.value = isControlled.value ? [] : allocateLocal();
    snapHost.schedule();
}, {immediate: true});

/**
 * 装饰带的可用范围是前后相邻面板的当前呈现，厚度与方向也来自布局：任一变化都要重排几何，
 * 否则收起/展开后线会停在旧范围里，或被旧范围的负起点裁细。与拖动预览同频，只写装饰元素。
 */
watch([renderedSizes, sashSizes, () => props.direction], () => snapHost.schedule());

watch(() => props.disabled, (disabled) => {
    if (disabled) {
        scope.invalidate();
    }
});

onBeforeUnmount(() => {
    scope.invalidate();
});
</script>

<template>
    <div
        ref="rootEl"
        class="nb-splitter"
        :class="props.direction === 'vertical' ? 'nb-splitter--vertical' : 'nb-splitter--horizontal'"
        :data-splitter="BRANCH_ID"
        :data-splitter-axis="axis"
    >
        <template v-if="props.panels.length > 0">
            <template v-for="(panel, index) in props.panels" :key="panel.id || index">
                <div
                    :id="domPanelIds[index]"
                    class="nb-grid-panel"
                    :data-animating="scope.active.size === 0 && collapseMotion.has(index) ? 'true' : undefined"
                    :data-panel-id="panelIds[index]"
                    :data-state="renderedCollapsed(index) ? 'collapsed' : 'expanded'"
                    :style="panelStyle(index)"
                >
                    <slot :name="`panel-${panel.id || index}`" :panel="panel" :index="index" />
                </div>

                <SashHandle
                    v-if="index < props.panels.length - 1"
                    :branch-id="BRANCH_ID"
                    :index="index"
                    :axis="axis"
                    :size="sashSizes[index] ?? DEFAULT_SASH_SIZE"
                    :before-px="renderedSizes[index] ?? 0"
                    :after-px="renderedSizes[index + 1] ?? 0"
                    :disabled="props.disabled"
                    :ends="{start: null, end: null}"
                    :ariaLabel="text(axis === 'width' ? 'splitter.resizeWidth' : 'splitter.resizeHeight', {before: panelIds[index] ?? '', after: panelIds[index + 1] ?? ''})"
                    :ariaControls="domPanelIds[index]"
                    :ariaMin="Math.round(panelBounds(props.panels[index]).low)"
                    :ariaMax="ariaMax(props.panels[index], availableMain)"
                    :ariaNow="Math.round(renderedSizes[index] ?? 0)"
                    :ariaValueText="renderedCollapsed(index) ? text('splitter.collapsed') : text('splitter.pixels', {size: Math.round(renderedSizes[index] ?? 0)})"
                    :style="sashStyle(index)"
                />
            </template>
        </template>
        <template v-else>
            <slot />
        </template>
    </div>
</template>

<style scoped>
.nb-splitter {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
}

.nb-splitter--horizontal {
    flex-direction: row;
}

.nb-splitter--vertical {
    flex-direction: column;
}

.nb-grid-panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

/* 收起/展开是控件形变，走 --motion-base；拖动中关闭，避免跟手延迟。 */
.nb-grid-panel[data-animating] {
    transition: flex-basis var(--motion-base) var(--ease-standard), width var(--motion-base) var(--ease-standard), height var(--motion-base) var(--ease-standard);
}
</style>
