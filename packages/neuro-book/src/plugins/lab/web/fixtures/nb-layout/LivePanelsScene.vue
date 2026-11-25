<script setup lang="ts">
/**
 * 实时布局的第二个形状（docs/specs/ui/layout-drag.md 的“实时布局的编排”，断言在 e2e/lab-live-panels.e2e.ts）：不是标签页的宿主，只经 nb-layout 的公开入口。
 * 四块卡片两列，拖一块的头到别的卡片的外缘：预览里来源收起（树里摘掉、兄弟补上）、目标那条边长出新块；回到自己原来那块是原位，来源展开；松手才写进树。
 *
 * 宿主的领域判断：判定的几何拿起后从 DOM 量（引擎在第一帧开头调，那时这一场的渲染已经做完）；收起后的几何按摘掉来源的树用 `placeGrid` 算；
 * 判定在冻结的几何上用 `resolveGridEdgeDrop` 判外缘，中央不是落点。预览是在快照复制出的网格上摘掉来源、在目标边拆出新叶。
 */
import {computed, ref, shallowRef} from "vue";

import {createGrid, placeGrid, resolveGridEdgeDrop} from "@notnotype/nb-layout";
import type {Grid, GridContentInput, GridDropPoint, GridDropRect, GridNodeInput} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost, useLiveDragSession} from "@notnotype/nb-layout/vue";
import type {LiveDragHost} from "@notnotype/nb-layout/vue";

const HEAD = 28;
const SASH = 4;
const EDGE_RATIO = 0.3;
const TITLES: Readonly<Record<string, string>> = {a: "卡片 A", b: "卡片 B", c: "卡片 C", d: "卡片 D"};

/** 落点：放到哪块卡片的哪条边；原位是回到来源自己原来那块。 */
type LiveDrop = {readonly kind: "edge"; readonly target: string; readonly side: "left" | "right" | "top" | "bottom"} | {readonly kind: "in-place"};
/** 判定的几何：每块卡片的矩形（视口坐标）。 */
type Rects = ReadonlyMap<string, GridDropRect>;

/** 两列各两块；`left`、`right` 是两列的份额。 */
const tree = (left: number, right: number): GridNodeInput<string> => ({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: [
        {kind: "branch", id: "left", orientation: "vertical", size: {width: left, height: 0}, children: [{kind: "leaf", id: "a", ref: "a"}, {kind: "leaf", id: "b", ref: "b"}]},
        {kind: "branch", id: "right", orientation: "vertical", size: {width: right, height: 0}, children: [{kind: "leaf", id: "c", ref: "c"}, {kind: "leaf", id: "d", ref: "d"}]},
    ],
});
const grid = shallowRef<Grid<string>>(createGrid<string>(tree(1, 1), {sashSize: SASH}));
const host = useGridHost<string>({
    grid,
    contextKey: "live-panels",
    // 用 debug 不用 warn：lab-scenes 按手机宽度跑这个场景，放不下是正常结果，不是接线错误。
    onIssues: (issues) => console.debug("[lab] nb-layout issues", issues),
});
const gridRef = ref<InstanceType<typeof NestedGrid> | null>(null);
const box = ref<HTMLElement | null>(null);
const CARDS = ["a", "b", "c", "d"] as const;
/** 写进树的次数：e2e 判“松手不写”。 */
const commits = ref(0);
/** 预览的网格：null 是已提交的样子。 */
const preview = shallowRef<Grid<string> | null>(null);
/** 最近一次判定：收起、展开那一刻起指针没动时沿用它。 */
let judged: LiveDrop | null = null;
/** 来源拿起时所在的那块（视口坐标）：回到这里是原位。 */
let homeRect: GridDropRect | null = null;

/** 已提交的树复制一份（连同约束与分隔线宽度），在上面做预览的结构操作，不碰已提交的。 */
function copyOf(): Grid<string> {
    return grid.value.clone();
}
function removed(source: string): Grid<string> | null {
    const copy = copyOf();
    return copy.removeLeaf(source).ok ? copy : null;
}
function placed(source: string, drop: LiveDrop): Grid<string> | null {
    if (drop.kind === "in-place") return null;
    const copy = removed(source);
    if (copy === null) return null;
    const orientation = drop.side === "left" || drop.side === "right" ? "horizontal" : "vertical";
    const side = drop.side === "left" || drop.side === "top" ? "before" : "after";
    return copy.splitLeaf(drop.target, {branchId: `split-${source}`, orientation, side, ratio: 0.5, leaf: {kind: "leaf", id: source, ref: source}}).ok ? copy : null;
}

/** 网格根的左上角加这棵树每块叶的矩形：拿起后渲染做完时从 DOM 量，收起之后按树算。 */
function measured(): Rects {
    const root = box.value;
    const rects = new Map<string, GridDropRect>();
    for (const element of root?.querySelectorAll<HTMLElement>("[data-leaf]") ?? []) {
        const {left, top, right, bottom} = element.getBoundingClientRect();
        if (right > left && bottom > top) rects.set(element.dataset.leaf ?? "", {left, top, right, bottom});
    }
    return rects;
}
function computedRects(tree: Grid<string>): Rects | null {
    const extent = host.extent.value;
    const node = tree.root();
    if (extent === null || node === null) return null;
    const origin = gridRef.value?.origin() ?? {x: 0, y: 0};
    const rects = new Map<string, GridDropRect>();
    for (const item of placeGrid(node, tree.layout(extent), extent, 1).items) {
        if (item.kind === "leaf") rects.set(item.node.id, {left: item.rect.x + origin.x, top: item.rect.y + origin.y, right: item.rect.x + item.rect.width + origin.x, bottom: item.rect.y + item.rect.height + origin.y});
    }
    return rects;
}
const inside = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

/** 长出的新块在预览里的矩形（视口坐标）：指针在里面候选不变。 */
function slotOf(source: string, drop: LiveDrop): GridDropRect | null {
    const tree = placed(source, drop);
    return tree === null ? null : (computedRects(tree)?.get(source) ?? null);
}

const liveHost: LiveDragHost<string, LiveDrop, Rects> = {
    facts: (source, drop) => ({key: drop.kind === "in-place" ? "in-place" : `${drop.target}:${drop.side}`, inPlace: drop.kind === "in-place", home: false, slotOnScreen: slotOf(source, drop)}),
    show: (target, {source}) => {
        if (target === null) {
            preview.value = null;
            return false;
        }
        if (target.kind === "source-removed") {
            preview.value = removed(source);
            return false;
        }
        const tree = placed(source, target.drop);
        // 原位、摆不出来：来源收起着时是来源收起的样子，没收起是已提交的样子。
        preview.value = tree;
        return tree !== null;
    },
    measure: (source) => {
        const rects = measured();
        // 原位按引擎量到的那份：拿起那一刻 DOM 可能还在过渡中间。
        homeRect = rects.get(source) ?? homeRect;
        return rects;
    },
    collapsed: (source) => {
        const tree = removed(source);
        return tree === null ? null : computedRects(tree);
    },
    card: {
        key: (source) => source,
        rect: (source, _container, geometry) => geometry.get(source) ?? null,
        compact: {width: 220, height: 160},
    },
};

const {liveState, lifted: liftedItem, dragging} = useLiveDragSession<string, LiveDrop, never, string, Rects>(box, (live) => ({
    sourceAt: (target) => target.closest<HTMLElement>("[data-live-head]")?.dataset.liveHead ?? null,
    structure: () => String(host.revision.value),
    live: (source) => source,
    host: liveHost,
    grid: () => gridRef.value,
    resolve: ({source, point}): LiveDrop | null => {
        if (live.unmoved(point)) return judged;
        const kept = live.sticky(point);
        if (kept !== null) {
            judged = kept;
            return kept;
        }
        // 引擎量到之前（拿起那一刻的第一次判定）现量一份，不存。
        const rects = live.geometry() ?? measured();
        // 回到自己原来那块（拿起时的位置）：原位。来源收起之后那块被兄弟占着，也先算原位。
        if (homeRect !== null && inside(homeRect, point)) {
            judged = {kind: "in-place"};
            return judged;
        }
        judged = null;
        for (const [id, rect] of rects) {
            if (id === source || !inside(rect, point)) continue;
            const edge = resolveGridEdgeDrop({point, rect, edgeRatio: EDGE_RATIO});
            if (edge !== null && edge !== "center") judged = {kind: "edge", target: id, side: edge};
        }
        return judged;
    },
    actionKey: (drop) => (drop.kind === "in-place" ? null : `${drop.target}:${drop.side}`),
    commit: (drop, source) => {
        const tree = placed(source, drop);
        if (tree === null) return;
        grid.value = tree;
        commits.value += 1;
    },
    activate: (source) => {
        homeRect = measured().get(source) ?? null;
        return true;
    },
}));

const shown = computed(() => preview.value ?? grid.value);
// 没有预览时用宿主的 `node`、`layout`：它们按 `revision` 重读，拖完分隔线（提交换了树）才跟得上；预览树每次都是新的 `Grid`，直接读。
const node = computed(() => (preview.value === null ? host.node.value : preview.value.root()));
const layout = computed(() => (preview.value === null || host.extent.value === null ? host.layout.value : preview.value.layout(host.extent.value)));
const contents = computed<GridContentInput[]>(() => {
    // 预览摘掉了来源时它的内容项不在这里：网格自己留住拿起的那一项（`lifted`）。
    const tree = shown.value;
    return CARDS.flatMap((id) => (tree.find(id) === null ? [] : [{key: id, leaf: id, insetTop: HEAD, active: true}]));
});
const previewKey = computed(() => (liveState.value.preview.kind === "candidate" ? liveState.value.preview.key : liveState.value.preview.kind));
const slotStyle = computed(() => {
    const slot = liveState.value.slotInGrid;
    return slot === null ? {display: "none"} : {left: `${String(slot.x)}px`, top: `${String(slot.y)}px`, width: `${String(slot.width)}px`, height: `${String(slot.height)}px`};
});
/** 两列的份额换成 left 比 right：给 e2e 在过渡进行中拿起（3 比 1），或还原（1 比 1）。 */
function setColumns(left: number, right: number): void {
    grid.value = createGrid<string>(tree(left, right), {sashSize: SASH});
}
</script>

<template>
    <div class="live-panels-scene" :data-live-preview="previewKey" :data-live-collapsed="String(liveState.collapsed)" :data-live-active="String(liveState.active)" :data-live-commits="String(commits)">
        <div class="live-panels-scene__actions">
            <button type="button" data-live-action="widen" @click="setColumns(3, 1)">改宽左列</button>
            <button type="button" data-live-action="reset" @click="setColumns(1, 1)">还原</button>
        </div>
        <div ref="box" class="live-panels-scene__grid">
            <NestedGrid
                ref="gridRef"
                data-lab-subject
                v-bind="host.bindings.value"
                :node="node"
                :layout="layout"
                :contents="contents"
                :lifted="liftedItem"
                :dragging="dragging"
            >
                <template #leaf="{node: leaf}">
                    <div class="live-panels-scene__head" :data-live-head="leaf.id">{{ TITLES[leaf.id] }}</div>
                </template>
                <template #content="{contentKey}">
                    <div class="live-panels-scene__body">
                        <input :data-live-input="contentKey" :aria-label="`${TITLES[contentKey]} 的输入`" />
                    </div>
                </template>
                <template #lifted-head="{contentKey}">
                    <div class="live-panels-scene__head">{{ TITLES[contentKey] }}</div>
                </template>
                <template #overlay>
                    <div class="live-panels-scene__slot" data-live-slot :style="slotStyle"></div>
                </template>
            </NestedGrid>
        </div>
    </div>
</template>

<style scoped>
.live-panels-scene {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
}

.live-panels-scene__actions {
    display: flex;
    gap: 8px;
}

.live-panels-scene__grid {
    flex: 1;
    min-height: 420px;
}

.live-panels-scene__head {
    height: 28px;
    padding: 4px 8px;
    cursor: grab;
    background: rgb(230, 230, 230);
}

.live-panels-scene__body {
    height: 100%;
    padding: 8px;
    background: rgb(250, 250, 250);
}

.live-panels-scene__slot {
    position: absolute;
    outline: 2px dashed rgb(120, 120, 220);
}
</style>
