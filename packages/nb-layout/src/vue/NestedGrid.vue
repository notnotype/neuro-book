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
import {computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, useId, useTemplateRef, watch} from "vue";
import {createGridGestureSession, type GridBranchChange, type GridGestureCommit, type GridGesturePreview} from "../grid-gesture";
import {placeGrid, stableOrder, type GridLeafPlacement, type GridPlacementItem, type GridRect, type GridSashPlacement} from "../grid-rects";
import {moveTab, noteFocus, registerGridFocus, type GridFocusItems} from "./grid-focus";
import {ariaMax, buildGridBranchPanels, panelBounds} from "./grid-splitter";
import SashHandle from "./SashHandle.vue";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {useLayoutText} from "./text";
import {useDevicePixelRatio} from "./useDevicePixelRatio";
import {useGridMotion} from "./useGridMotion";
import {useLeafParking} from "./useLeafParking";
import {useLayoutExtent} from "./useLayoutExtent";
import {useSashGesture} from "./useSashGesture";
import {useSashSnap} from "./useSashSnap";
import type {GridExtent, GridLayoutResult, GridLeaf, GridNode} from "../grid-types";
import type {GridBranchChange as GridBranchChangeType} from "../grid-gesture";
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
}>(), {
    disabled: false,
    contextKey: "",
    revision: 0,
    onGestureCommit: undefined,
    onIssues: undefined,
});

const emit = defineEmits<{
    (e: "gesture-start", info: {sessionId: string; contextKey: string; source: SplitterGestureSource; revision: number; sashes: readonly GridSashRef[]}): void;
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    (e: "gesture-end", commit: GridGestureCommit): void;
    (e: "gesture-cancel", info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
    (e: "issues", issues: readonly string[]): void;
}>();

defineSlots<{
    leaf(props: {node: GridLeaf<unknown>}): unknown;
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
const placementExtent = computed<GridExtent>(() => sessionExtent() ?? {width: 0, height: 0});
const placement = computed(() => {
    const root = renderTree.value;
    return root === null ? null : placeGrid(root, renderLayout.value, placementExtent.value, dpr.value);
});

/**
 * 渲染序列（`stableOrder`）：这一轮的序列要由上一轮的算出来，所以记在外面。要同步算，不能放进 watch：外壳在下一个 tick 就按
 * `data-leaf-content` 找 Teleport 的目标，新叶的外框必须在同一轮渲染里出来。
 */
let renderedKeys: string[] = [];
const renderItems = computed<ReadonlyArray<GridPlacementItem<unknown>>>(() => {
    const items = placement.value?.items ?? [];
    const byKey = new Map(items.map((item) => [item.key, item]));
    renderedKeys = stableOrder(renderedKeys, items.map((item) => item.key));
    for (const key of domIds.keys()) {
        if (!byKey.has(key)) domIds.delete(key);
    }
    return renderedKeys.map((key) => byKey.get(key) as GridPlacementItem<unknown>);
});

/** 叶外框与分隔线的 DOM id：节点 id 可以含空格，`aria-owns`、`aria-controls` 按空白切分，所以用不透明的串。 */
const domIds = new Map<string, string>();
let nextDomId = 0;
function domIdOf(key: string): string {
    let id = domIds.get(key);
    if (id === undefined) {
        nextDomId += 1;
        id = `${instanceId}-${nextDomId}`;
        domIds.set(key, id);
    }
    return id;
}

/** DOM 序与树序不一致（叶换了位置）：Tab 由布局层接管，读屏顺序靠 `aria-owns`。一致时全是浏览器的原生行为。 */
const outOfOrder = computed(() => {
    const tree = placement.value?.items ?? [];
    return renderItems.value.some((item, index) => item.key !== tree[index]?.key);
});
const ariaOwns = computed(() => (outOfOrder.value ? (placement.value?.items ?? []).map((item) => domIdOf(item.key)).join(" ") : undefined));

const focusScope: GridFocusItems = {
    items: () => (placement.value?.items ?? []).flatMap((item) => {
        // 经 `getRootNode` 取：grid 可能在 Shadow DOM 里。
        const element = (rootEl.value?.getRootNode() as Document | ShadowRoot | undefined)?.getElementById(domIdOf(item.key));
        return element == null ? [] : [{element, leaf: item.kind === "leaf"}];
    }),
};
const enterSentinel = useTemplateRef<HTMLElement>("enterSentinel");
const exitSentinel = useTemplateRef<HTMLElement>("exitSentinel");

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !outOfOrder.value) return;
    if (moveTab(event, focusScope) !== "leave") return;
    // 走完了：焦点放到边上的哨兵，这次按键的默认动作从那里移到 grid 外面，不按 DOM 序回到里面的别的块。
    (event.shiftKey ? enterSentinel.value : exitSentinel.value)?.focus();
}

let releaseFocusScope: (() => void) | null = null;
onMounted(() => {
    if (rootEl.value !== null) releaseFocusScope = registerGridFocus(rootEl.value, focusScope);
});

function rectStyle(rect: GridRect): Record<string, string> {
    return {transform: `translate(${rect.x}px, ${rect.y}px)`, width: `${rect.width}px`, height: `${rect.height}px`};
}

function sashStyle(rect: GridRect): Record<string, string> {
    return {position: "absolute", left: "0", top: "0", ...rectStyle(rect)};
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
        ariaControls: domIdOf(`leaf:${sash.controls}`),
        ariaMin: Math.round(panelBounds(panel).low),
        ariaMax: ariaMax(panel, sash.branchLength),
        ariaNow: Math.round(nowPx),
        ariaValueText: panel?.collapse?.collapsed === true ? text("splitter.collapsed") : text("splitter.pixels", {size: Math.round(nowPx)}),
    };
}

const motion = useGridMotion({root: rootEl, onSettled: () => snapHost.schedule()});
const {moving, growing} = motion;
const parking = useLeafParking();
const {parked} = parking;

function contentStyle(item: GridLeafPlacement<unknown>): Record<string, string> {
    const size = parking.contentSize(item);
    return {width: `${size.width}px`, height: `${size.height}px`, ...(parked.value.has(item.node.id) ? {visibility: "hidden"} : {})};
}

// 这个 watcher 要建在下面的 `watch(props.layout, releasePreview)` 之前：预览被保持时 `placement` 不依赖 `props.layout`，所以是
// `releasePreview` 先标记手势，这里随后消费。
watch(placement, (next, previous) => {
    // 分隔线的矩形变了要重新对齐设备像素。
    snapHost.schedule();
    const items = next?.items ?? [];
    parking.update(items, preview.value !== null);
    const root = renderTree.value;
    motion.update({items, previous: previous?.items ?? null, rootSize: root === null ? null : (props.layout.sizes[root.id] ?? null), extent: placementExtent.value, dpr: dpr.value});
}, {immediate: true});

/**
 * 会话的根盒：优先用本组件实测盒（宿主正是按这个盒算布局），拿不到测量时退回布局发布的根节点尺寸。
 * 两者都拿不到（未挂载 / 无布局）时不开始手势。
 */
function sessionExtent(): GridExtent | null {
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
function publishedMatches(previewLayout: GridLayoutResult, published: GridLayoutResult, changes: readonly GridBranchChangeType[]): boolean {
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

/** 手势撤下预览：回到已发布的布局，这次几何变化不过渡。 */
function releasePreview(): void {
    if (preview.value === null) return;
    motion.markGesture();
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
    motion.markGesture();
    preview.value = next;
    emit("gesture-update", next);
}

const host: SashGestureHost<GridGesturePreview<unknown>, GridBranchChange> = {
    begin(input) {
        const root = renderTree.value;
        const extent = sessionExtent();
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
    releaseFocusScope?.();
    scope.dispose();
});
</script>

<template>
    <div ref="rootEl" class="nb-nested-grid" :data-grid-scope="instanceId" :aria-owns="ariaOwns" @keydown="onKeydown" @focusin="noteFocus(focusScope, $event.target)">
        <span v-if="outOfOrder" ref="enterSentinel" tabindex="-1" aria-hidden="true"></span>
        <template v-for="item in renderItems" :key="item.key">
            <div
                v-if="item.kind === 'leaf'"
                :id="domIdOf(item.key)"
                class="nb-grid-frame"
                :data-leaf="item.node.id"
                :data-moving="moving ? '' : undefined"
                :style="rectStyle(growing.get(item.key) ?? item.rect)"
            >
                <div class="nb-grid-leaf" :data-leaf-content="item.node.id" :inert="parked.has(item.node.id)" :style="contentStyle(item)">
                    <slot name="leaf" :node="item.node"></slot>
                </div>
            </div>
            <SashHandle v-else :dom-id="domIdOf(item.key)" class="nb-grid-sash" v-bind="sashProps(item)" :data-moving="moving ? '' : undefined" :style="sashStyle(growing.get(item.key) ?? item.rect)" />
        </template>
        <span v-if="outOfOrder" ref="exitSentinel" tabindex="-1" aria-hidden="true"></span>
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
}

.nb-grid-frame {
    position: absolute;
    top: 0;
    left: 0;
    overflow: clip;
}

/* 标记写在外框上，不写在根上：实时布局拖动中要一部分动、一部分跟手。 */
.nb-grid-frame[data-moving],
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
