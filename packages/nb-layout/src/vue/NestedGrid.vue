<script setup lang="ts">
/**
 * 一个公开 Grid：树与几何由宿主给出（`node` + 同一容器下的 `layout`），手势由本组件独占一份会话。
 *
 * - 叶与分隔线是同一父元素的子元素，矩形来自 `placeGrid`（docs/specs/ui/nested-grid.md 的“按矩形摆放”）。树的结构变了只换矩形，
 *   不搬、不重建还在的叶，内容的滚动、输入与焦点都留着。
 * - 一次按下命中的**最多两根轴**（一根 width + 一根 height）属于同一场手势、只提交一次；叶槽里再嵌一个公开
 *   `NestedGrid` 会得到自己的 scope，不会继承外层拖动成员。
 * - 手势期间发布预览布局（编辑器等内容随外框实时变化），松手时才把冻结的 `GridGestureCommit` 交给宿主的
 *   `onGestureCommit`；宿主拒绝就地回滚并给出诊断。
 * - 这里没有百分比往返、不读存储、不写意图：几何算法全在 `grid-geometry` / `sash-drag` / `grid-rects`。
 */
import {computed, nextTick, onBeforeUnmount, provide, ref, shallowRef, useId, watch} from "vue";
import {createGridGestureSession, type GridBranchChange, type GridGestureCommit, type GridGesturePreview} from "../grid-gesture";
import {layerItems, placeContents, placeGrid, type GridContentInput, type GridContentPlacement, type GridLayerItem, type GridLeafPlacement, type GridRect, type GridSashPlacement} from "../grid-rects";
import {ariaMax, buildGridBranchPanels, panelBounds} from "./grid-splitter";
import SashHandle from "./SashHandle.vue";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {useLayoutText} from "./text";
import {useDevicePixelRatio} from "./useDevicePixelRatio";
import {useGridMotion} from "./useGridMotion";
import {useLeafParking} from "./useLeafParking";
import {useGridFocus} from "./useGridFocus";
import {useLayoutExtent} from "./useLayoutExtent";
import {useRenderOrder} from "./useRenderOrder";
import {useSashGesture} from "./useSashGesture";
import {useSashSnap} from "./useSashSnap";
import type {GridExtent, GridLayoutResult, GridLeaf, GridNode} from "../grid-types";
import type {GridSashRef, SashGestureBinding, SashGestureHost} from "../sash-gesture";
import type {SplitterGestureCancelReason, SplitterGestureSource} from "../splitter-gesture";

defineOptions({name: "NestedGrid"});

const props = withDefaults(defineProps<{
    /** 当前的树：叶交给 `leaf` 插槽，`null` 交给 `empty` 插槽。 */
    node: GridNode<unknown> | null;
    /** 与 `node` 同源的呈现结果；约束按「能够承载的语法」直接消费，不再夹取。 */
    layout: GridLayoutResult;
    disabled?: boolean;
    /** 副作用上下文（工作面 / 布局键）：与 `revision` 一起构成手势开始时冻结的外部事实。 */
    contextKey?: string;
    /** 外部版本：树、约束或容器尺寸变化时递增；进行中的手势据此失效。 */
    revision?: number;
    /** 同步接纳一次手势提交：`{ok:false}` 时本组件回滚预览并给出诊断。 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
    /** 会话诊断出口（容量不足、提交被拒绝等）。 */
    onIssues?: (issues: readonly string[]) => void;
    /** 内容层（docs/specs/ui/nested-grid.md 的“内容层”）：和叶外框同一父元素的内容，换叶不重建。不传时内容放在 `leaf` 插槽里。 */
    contents?: ReadonlyArray<GridContentInput>;
}>(), {
    disabled: false,
    contextKey: "",
    revision: 0,
    onGestureCommit: undefined,
    onIssues: undefined,
    contents: () => [],
});

const emit = defineEmits<{
    (e: "gesture-start", info: {sessionId: string; contextKey: string; source: SplitterGestureSource; revision: number; sashes: readonly GridSashRef[]}): void;
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    (e: "gesture-end", commit: GridGestureCommit): void;
    (e: "gesture-cancel", info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
    (e: "issues", issues: readonly string[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：宿主决定焦点去哪。 */
    (e: "content-parked", key: string): void;
}>();

defineSlots<{
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    content(props: {contentKey: string; active: boolean}): unknown;
    empty(): unknown;
}>();

const instanceId = useId();
const rootEl = ref<HTMLElement | null>(null);
const preview = shallowRef<GridGesturePreview<unknown> | null>(null);
/** 会话根盒来自共享的布局盒测量：未挂载是 `null`，与「真实零尺寸」区分。 */
const measuredExtent = useLayoutExtent(rootEl);
let sessionCounter = 0;

/** 手势期间渲染预览；提交被拒绝、取消或宿主发布新布局后回到受控事实。 */
const renderTree = computed(() => preview.value?.tree ?? props.node);
const renderLayout = computed(() => preview.value?.layout ?? props.layout);

const dpr = useDevicePixelRatio();
const text = useLayoutText();
const snapHost = useSashSnap();

/** 摆放的容器：实测盒；还没挂上时退回布局发布的根节点尺寸。 */
const placementExtent = computed<GridExtent>(() => rootExtent() ?? {width: 0, height: 0});
const placement = computed(() => {
    const root = renderTree.value;
    return root === null ? null : placeGrid(root, renderLayout.value, placementExtent.value, dpr.value);
});

const contentPlacements = computed(() => placeContents(placement.value?.items ?? [], props.contents, dpr.value));
/** 渲染层的全部项，树序：每块叶后面紧跟属于它的内容。 */
const layers = computed<ReadonlyArray<GridLayerItem<unknown>>>(() => layerItems(placement.value?.items ?? [], contentPlacements.value));
const hasContents = computed(() => props.contents.length > 0);

const order = useRenderOrder(layers, instanceId);
const {domIdOf} = order;
const focus = useGridFocus({root: rootEl, layers, order});

function rectStyle(rect: GridRect): Record<string, string> {
    return {transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.width}px`, height: `${rect.height}px`};
}

function sashStyle(rect: GridRect): Record<string, string> {
    return {position: "absolute", left: "0", top: "0", ...rectStyle(rect)};
}

/** 分隔线控制的窗格：外框里只剩面板头时，真正被调整的是活动的内容。 */
function controlledIds(leaf: string): string {
    const frame = domIdOf(`leaf:${leaf}`);
    const content = contentPlacements.value.find((item) => item.leaf === leaf && item.active);
    return content === undefined ? frame : `${frame} ${domIdOf(content.key)}`;
}

function sashProps(sash: GridSashPlacement<unknown>) {
    const sizes = renderLayout.value.sizes;
    const nowPx = Math.max(0, sizes[sash.before]?.[sash.axis] ?? 0);
    const panel = buildGridBranchPanels(sash.branch.children, renderLayout.value, sash.axis)[sash.index];
    return {
        branchId: sash.branch.id,
        index: sash.index,
        axis: sash.axis,
        size: sash.size,
        beforePx: nowPx,
        afterPx: Math.max(0, sizes[sash.after]?.[sash.axis] ?? 0),
        disabled: props.disabled,
        ends: sash.ends,
        ariaLabel: text(sash.axis === "width" ? "splitter.resizeWidth" : "splitter.resizeHeight", {before: sash.before, after: sash.after}),
        ariaControls: controlledIds(sash.controls),
        ariaMin: Math.round(panelBounds(panel).low),
        ariaMax: ariaMax(panel, sash.branchLength),
        ariaNow: Math.round(nowPx),
        ariaValueText: panel?.collapse?.collapsed === true ? text("splitter.collapsed") : text("splitter.pixels", {size: Math.round(nowPx)}),
    };
}

const motion = useGridMotion({root: rootEl, onSettled: () => snapHost.schedule()});
const {moving, growing, following, flying} = motion;
const parking = useLeafParking();
const {parked} = parking;

function contentStyle(item: GridLeafPlacement<unknown>): Record<string, string> {
    if (following.value.has(item.key)) return {width: "100%", height: "100%"};
    const size = parking.contentSize(item);
    return {width: `${size.width}px`, height: `${size.height}px`, ...(parked.value.has(item.node.id) ? {visibility: "hidden"} : {})};
}

/** 内容项最后的矩形与非零尺寸：停放时保持，重新有尺寸时不用重排；叶暂时找不到时外层也留在原处。 */
const contentMemory = new Map<string, {rect: GridRect; size: GridExtent}>();
const parkedContents = new Set<string>();
/** 矩形降到零的内容项（面板收成标题行时叶还有高度，内容是零）。曾有过尺寸才算，规则同 `useLeafParking`。 */
const zeroContents = shallowRef<ReadonlySet<string>>(new Set());

function isContentParked(item: GridContentPlacement): boolean {
    return !item.active || item.rect === null || parked.value.has(item.leaf) || zeroContents.value.has(item.key);
}

function rememberContents(): void {
    const isZero = (item: GridContentPlacement): boolean => item.rect !== null && (item.rect.width <= 0 || item.rect.height <= 0) && contentMemory.has(item.key);
    // 预览不会把内容停放：往零拖时要等落账。从零往外拉时内容在拖动中就要出现。
    zeroContents.value = new Set(contentPlacements.value.filter((item) => isZero(item) && (preview.value === null || zeroContents.value.has(item.key))).map((item) => item.key));
    const alive = new Set<string>();
    for (const item of contentPlacements.value) {
        alive.add(item.key);
        const parkedNow = isContentParked(item);
        if (parkedNow && !parkedContents.has(item.key)) {
            parkedContents.add(item.key);
            // 在 `pre` 刷新里：DOM 还没变，焦点还在里面。
            const element = rootEl.value?.ownerDocument.getElementById(domIdOf(item.key));
            if (element != null && element.contains(element.ownerDocument.activeElement)) emit("content-parked", item.contentKey);
        } else if (!parkedNow) {
            parkedContents.delete(item.key);
        }
        if (!parkedNow && item.rect !== null && item.rect.width > 0 && item.rect.height > 0) contentMemory.set(item.key, {rect: item.rect, size: {width: item.rect.width, height: item.rect.height}});
    }
    for (const key of contentMemory.keys()) {
        if (!alive.has(key)) contentMemory.delete(key);
    }
    for (const key of parkedContents) {
        if (!alive.has(key)) parkedContents.delete(key);
    }
}

function contentFrameStyle(item: GridContentPlacement): Record<string, string> {
    const rect = growing.value.get(item.key) ?? item.rect ?? contentMemory.get(item.key)?.rect ?? {x: 0, y: 0, width: 0, height: 0};
    return {...rectStyle(rect), ...(isContentParked(item) ? {visibility: "hidden"} : {})};
}

/** 内层的尺寸规则和叶的内容相同：跟外框的是 100%；否则是最终尺寸，停放时是最后的非零尺寸。 */
function contentBodyStyle(item: GridContentPlacement): Record<string, string> {
    if (following.value.has(item.key)) return {width: "100%", height: "100%"};
    const rect = item.rect;
    const size = !isContentParked(item) && rect !== null && rect.width > 0 && rect.height > 0 ? rect : (contentMemory.get(item.key)?.size ?? rect ?? {width: 0, height: 0});
    return {width: `${size.width}px`, height: `${size.height}px`};
}

watch(layers, (next, previous) => {
    // 分隔线的矩形变了要重新对齐设备像素。
    snapHost.schedule();
    const items = placement.value?.items ?? [];
    parking.update(items, preview.value !== null);
    rememberContents();
    const root = renderTree.value;
    motion.update({items: next, previous: previous ?? null, rootSize: root === null ? null : (props.layout.sizes[root.id] ?? null), extent: placementExtent.value, dpr: dpr.value, previewing: preview.value !== null});
}, {immediate: true});

/**
 * 会话的根盒：优先用本组件实测盒（宿主正是按这个盒算布局），拿不到测量时退回布局发布的根节点尺寸。
 * 两者都拿不到（未挂载 / 无布局）时不开始手势。
 */
function rootExtent(): GridExtent | null {
    if (measuredExtent.value !== null) {
        return measuredExtent.value;
    }
    const root = renderTree.value;
    if (root === null) {
        return null;
    }
    const size = renderLayout.value.sizes[root.id];
    if (size === undefined) {
        return null;
    }
    return {width: size.width, height: size.height};
}

/** 预览重投影沿用本次呈现的真实 sash 占用（含宿主按容器压缩的结果）。 */
function sashResolver(): (branchId: string, sashIndex: number) => number {
    return (branchId, sashIndex) => Math.max(0, renderLayout.value.sashSizes[branchId]?.[sashIndex] ?? 0);
}

/** 宿主发布的新布局是否已经反映本次提交（只核对真正改变的叶）。 */
function publishedMatches(previewLayout: GridLayoutResult, published: GridLayoutResult, changes: readonly GridBranchChange[]): boolean {
    for (const change of changes) {
        for (const id of [...change.active, ...change.compensated]) {
            const before = previewLayout.sizes[id];
            const after = published.sizes[id];
            if (before === undefined || after === undefined) {
                continue;
            }
            if (Math.abs(before.width - after.width) > 1 || Math.abs(before.height - after.height) > 1) {
                return false;
            }
        }
    }
    return true;
}

/** 手势撤下预览：回到已发布的布局。这次几何变化不过渡，`useGridMotion` 按“上一次还在预览中”认出来。 */
function releasePreview(): void {
    preview.value = null;
}

function onPreview(next: GridGesturePreview<unknown> | null): void {
    if (next === null) {
        // 预览撤回（拖回基线、无变化松手、取消、提交被拒）也是一次几何变化：宿主可能按预览改了别的状态（例如把内容提前
        // 搬出停放区），要知道画面已回到已发布的布局。已经在基线上时不重复发。
        const wasPreviewing = preview.value !== null;
        releasePreview();
        if (wasPreviewing) emit("gesture-update", {layout: props.layout, tree: props.node, changes: [], issues: []});
        return;
    }
    preview.value = next;
    emit("gesture-update", next);
}

const host: SashGestureHost<GridGesturePreview<unknown>, GridBranchChange> = {
    begin(input) {
        const root = renderTree.value;
        const extent = rootExtent();
        if (root === null || extent === null) {
            return null;
        }
        sessionCounter += 1;
        const sessionId = `${instanceId}-${sessionCounter}`;
        const session = createGridGestureSession<unknown>({
            sessionId,
            contextKey: props.contextKey,
            source: input.source,
            revision: props.revision,
            root,
            extent,
            layout: renderLayout.value,
            sashSize: sashResolver(),
            sashes: input.sashes,
        });
        emit("gesture-start", {sessionId, contextKey: props.contextKey, source: input.source, revision: props.revision, sashes: session.sashes});
        return {
            session,
            onPreview,
            onCommit(commit) {
                emit("gesture-end", commit);
                const outcome = props.onGestureCommit?.(commit);
                if (outcome === undefined) {
                    releasePreview();
                    emit("issues", ["宿主没有提供 onGestureCommit，本次调整没有落账"]);
                    return {ok: false, reason: "宿主没有提供 onGestureCommit"};
                }
                if (!outcome.ok) {
                    releasePreview();
                    return outcome;
                }
                /**
                 * 接纳成功：保持最后一帧预览，等宿主把匹配布局发布出来再释放（避免闪回旧尺寸）。
                 * 一个 tick 之后仍没有匹配发布就按宿主机合同错误处理：释放预览并给出诊断。
                 */
                const held = preview.value;
                if (held !== null) {
                    void nextTick(() => {
                        if (preview.value === held && !publishedMatches(held.layout, props.layout, commit.changes)) {
                            releasePreview();
                            emit("issues", ["宿主接纳了这次调整但没有发布匹配布局，已回到原布局"]);
                        }
                    });
                }
                return outcome;
            },
            onCancel(info) {
                emit("gesture-cancel", info);
            },
        } satisfies SashGestureBinding<GridGesturePreview<unknown>, GridBranchChange>;
    },
};

const scope = useSashGesture<GridGesturePreview<unknown>, GridBranchChange>({
    host: () => host,
    root: rootEl,
    disabled: () => props.disabled,
});
provide(SASH_GESTURE_SCOPE_KEY, scope);

watch(() => scope.issues, (issues) => {
    if (issues.length > 0) {
        emit("issues", issues);
        props.onIssues?.(issues);
    }
});

/** 外部事实变化（上下文、版本、结构、禁用）取消进行中的手势：不沿旧基线写新上下文。 */
watch([() => props.contextKey, () => props.revision, () => props.disabled, () => props.node], () => {
    scope.invalidate();
});

/** 宿主发布新布局即视为几何事实已更新，释放最后一帧预览（避免重复渲染到下一 tick 之后）。 */
watch(() => props.layout, releasePreview);

/** 过渡中开始手势：外框直接到终点，拖动没有拖尾。 */
watch(() => scope.active.size > 0, (active) => {
    if (active) motion.stop();
});

onBeforeUnmount(() => {
    scope.dispose();
});
</script>

<template>
    <div ref="rootEl" class="nb-nested-grid" :data-grid-scope="instanceId" :aria-owns="order.ariaOwns.value" @keydown="focus.onKeydown" @focusin="focus.onFocusin">
        <span v-if="order.outOfOrder.value" :ref="(el) => (focus.enterSentinel.value = el as HTMLElement | null)" tabindex="-1" aria-hidden="true"></span>
        <template v-for="item in order.items.value" :key="item.key">
            <div
                v-if="item.kind === 'leaf'"
                :id="domIdOf(item.key)"
                class="nb-grid-frame"
                :data-leaf="item.node.id"
                :data-moving="moving ? '' : undefined"
                :data-flying="flying.has(item.key) ? '' : undefined"
                :tabindex="hasContents ? -1 : undefined"
                :style="rectStyle(growing.get(item.key) ?? item.rect)"
            >
                <div class="nb-grid-leaf" :data-leaf-content="item.node.id" :inert="parked.has(item.node.id)" :style="contentStyle(item)">
                    <slot name="leaf" :node="item.node"></slot>
                </div>
            </div>
            <SashHandle v-else-if="item.kind === 'sash'" :dom-id="domIdOf(item.key)" class="nb-grid-sash" v-bind="sashProps(item)" :data-moving="moving ? '' : undefined" :style="sashStyle(growing.get(item.key) ?? item.rect)" />
            <div
                v-else
                :id="domIdOf(item.key)"
                class="nb-grid-content"
                :data-content="item.contentKey"
                :data-content-leaf="item.leaf"
                :data-moving="moving && item.active ? '' : undefined"
                :data-flying="flying.has(item.key) ? '' : undefined"
                :inert="isContentParked(item)"
                tabindex="-1"
                :style="contentFrameStyle(item)"
            >
                <div class="nb-grid-content__body" :style="contentBodyStyle(item)">
                    <slot name="content" :content-key="item.contentKey" :active="item.active"></slot>
                </div>
            </div>
        </template>
        <span v-if="order.outOfOrder.value" :ref="(el) => (focus.exitSentinel.value = el as HTMLElement | null)" tabindex="-1" aria-hidden="true"></span>
        <slot v-if="node === null" name="empty"></slot>
    </div>
</template>

<style scoped>
/* `clip` 不用 `hidden`：`scrollIntoView` 滚不动 `clip`，否则内容里的滚动会把外框挪走。 */
.nb-nested-grid {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: clip;
    /* 三层叠放固定在这个根里：外框、内容、分隔线。内容换叶后 DOM 位置不变，不靠 DOM 序。 */
    isolation: isolate;
}

.nb-grid-frame {
    position: absolute;
    top: 0;
    left: 0;
    overflow: clip;
    outline: none;
}

/* 内容自己的裁切框，不是叶外框：飞过别的叶时不被它们裁。 */
.nb-grid-content {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    overflow: clip;
    outline: none;
}

.nb-grid-frame[data-flying],
.nb-grid-content[data-flying] {
    z-index: 2;
}

.nb-grid-content__body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.nb-nested-grid > .nb-grid-sash {
    z-index: 3;
}

/* 标记写在外框上，不写在根上：实时布局拖动中要一部分动、一部分跟手。 */
.nb-grid-frame[data-moving],
.nb-grid-content[data-moving],
.nb-grid-sash[data-moving] {
    transition: transform var(--motion-layout) var(--ease-layout), width var(--motion-layout) var(--ease-layout), height var(--motion-layout) var(--ease-layout);
    will-change: transform, width, height;
}

.nb-grid-leaf {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
</style>
