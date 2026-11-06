<script setup lang="ts">
/**
 * 分支树（docs/specs/ui/agent-conversation-view.md 的“分支树”）：列表与图两种视图，共用搜索、过滤、选中与切换。算法在
 * `session-tree.ts`，这里只管显示与键盘。外框与开关在视图里。
 */
import {computed, nextTick, ref, watch} from "vue";
import {Button, IconButton, Input, SegmentedControl, Spinner} from "@notnotype/nb-ui/components";

import {
    graphEdgePath,
    graphPosition,
    graphSize,
    SESSION_TREE_GRAPH_LIMIT,
    SESSION_TREE_NODE_SIZE,
    sessionTreeGraph,
    sessionTreeRows,
} from "../../session-tree";
import type {SessionTreeDirection, SessionTreeFilter, SessionTreeGraphNode, SessionTreeNodeKind} from "../../session-tree";
import type {SessionTreeView} from "../../types";
import {useAgentText} from "../host";

const props = defineProps<{
    tree: SessionTreeView;
    /** 能切换（可写且空闲）。 */
    canActivate: boolean;
}>();

const emit = defineEmits<{
    (e: "activate", id: string): void;
    (e: "copy", id: string): void;
}>();

const {t} = useAgentText();

const KIND_ICONS: Record<SessionTreeNodeKind, string> = {
    user: "i-lucide-user",
    assistant: "i-lucide-bot",
    tool: "i-lucide-wrench",
    other: "i-lucide-dot",
};

const mode = ref<"list" | "graph">("list");
const direction = ref<SessionTreeDirection>("down");
const filter = ref<SessionTreeFilter>("default");
const query = ref("");
const collapsed = ref(new Set<string>());
const selected = ref<string | null>(null);
const bodyRef = ref<HTMLElement | null>(null);

const ready = computed(() => (props.tree.state === "ready" ? props.tree : null));
const modes = computed(() => [{label: t("panel.tree.list"), value: "list"}, {label: t("panel.tree.graph"), value: "graph"}]);

/** 每条分支一种颜色，当前路径（0）独占强调色；别的分支多于颜色时循环。 */
const LANE_COLORS = ["var(--accent-main)", "var(--status-success)", "var(--status-warning)", "var(--status-danger)"];
const laneColor = (lane: number): string => (lane === 0 ? LANE_COLORS[0]! : LANE_COLORS[1 + (lane - 1) % (LANE_COLORS.length - 1)]!);
/** 缩进线最多画几层：分叉多的长会话能到几十层，标签会被挤没。更深的只留最里面几层，前面写“还有几层”。 */
const MAX_GUIDES = 6;
const filters = computed(() => (["default", "no-tools", "user", "all"] as const).map((value) => ({label: t(`panel.tree.filter.${value}`), value})));

const rows = computed(() => (ready.value === null ? [] : sessionTreeRows({nodes: ready.value.nodes, activePath: ready.value.activePath, filter: filter.value, query: query.value, collapsed: collapsed.value})));
/** 节点数不随收起变化，两种视图一样。 */
const shownCount = computed(() => (ready.value === null ? 0 : sessionTreeRows({nodes: ready.value.nodes, activePath: ready.value.activePath, filter: filter.value}).length));
const forkCount = computed(() => {
    if (ready.value === null) return 0;
    const seen = new Map<string, number>();
    for (const node of ready.value.nodes) if (node.parent !== null) seen.set(node.parent, (seen.get(node.parent) ?? 0) + 1);
    return [...seen.values()].filter((count) => count > 1).length;
});

const graph = computed(() => (ready.value === null || mode.value !== "graph" ? null : sessionTreeGraph({nodes: ready.value.nodes, activePath: ready.value.activePath, filter: filter.value, query: query.value})));
const tooLarge = computed(() => graph.value !== null && graph.value.nodes.length > SESSION_TREE_GRAPH_LIMIT);
const graphNodes = computed(() => new Map((graph.value?.nodes ?? []).map((node) => [node.id, node])));
const parents = computed(() => new Map((graph.value?.edges ?? []).map((edge) => [edge.to, edge.from])));
const canvas = computed(() => (graph.value === null ? {width: 0, height: 0} : graphSize(graph.value, direction.value)));
const edges = computed(() => (graph.value?.edges ?? []).flatMap((edge) => {
    const from = graphNodes.value.get(edge.from);
    const to = graphNodes.value.get(edge.to);
    return from === undefined || to === undefined ? [] : [{key: `${edge.from}>${edge.to}`, path: graphEdgePath(from, to, direction.value), onPath: edge.onPath, color: laneColor(to.lane)}];
}));

/** 从根到选中节点的路径：分叉上写走到第几条时按它算，切分支前先看得到要切去哪。 */
const selectedPath = computed(() => {
    const path = new Set<string>();
    for (let id = selected.value; id !== null && id !== undefined; id = parents.value.get(id) ?? null) path.add(id);
    return path;
});

function forkIndex(node: SessionTreeGraphNode): number {
    if (node.fork === null) return 0;
    const chosen = node.fork.children.findIndex((child) => selectedPath.value.has(child));
    return chosen >= 0 ? chosen : node.fork.index;
}

function switchFork(node: SessionTreeGraphNode, step: number): void {
    const children = node.fork?.children ?? [];
    const next = children[forkIndex(node) + step];
    if (next !== undefined) selected.value = next;
}

/** 选中的节点被过滤、搜索或收起之后不再算选中：底部不能切到一个看不见的节点。 */
watch([rows, () => graph.value?.nodes, mode], () => {
    if (selected.value === null) return;
    const visible = mode.value === "graph" ? graphNodes.value.has(selected.value) : rows.value.some((row) => row.id === selected.value);
    if (!visible) selected.value = null;
});

const selectedLabel = computed(() => {
    if (selected.value === null || ready.value === null) return null;
    const node = ready.value.nodes.find((item) => item.id === selected.value);
    return node === undefined ? null : node.label ?? node.type;
});
const selectedOnPath = computed(() => selected.value !== null && ready.value?.activePath.includes(selected.value) === true);

function toggle(id: string): void {
    const next = new Set(collapsed.value);
    if (!next.delete(id)) next.add(id);
    collapsed.value = next;
}

function activate(): void {
    if (selected.value !== null && props.canActivate && !selectedOnPath.value) emit("activate", selected.value);
}

function moveInList(step: number): void {
    const list = rows.value;
    const at = list.findIndex((row) => row.id === selected.value);
    const next = list[at < 0 ? 0 : at + step];
    if (next !== undefined) selected.value = next.id;
}

/** 图里走：沿时间的方向到父节点或第一个孩子，垂直于时间的方向换到相邻的分支。 */
function moveInGraph(along: number, across: number): void {
    const at = selected.value === null ? undefined : graphNodes.value.get(selected.value);
    if (at === undefined) {
        selected.value = graph.value?.nodes.find((node) => node.current)?.id ?? null;
        return;
    }
    if (along < 0) {
        selected.value = parents.value.get(at.id) ?? at.id;
    }
    else if (along > 0) {
        const child = at.fork?.children[forkIndex(at)] ?? graph.value?.edges.find((edge) => edge.from === at.id)?.to;
        if (child !== undefined) selected.value = child;
    }
    else {
        const parent = graphNodes.value.get(parents.value.get(at.id) ?? "");
        const siblings = parent?.fork?.children ?? [];
        const next = siblings[siblings.indexOf(at.id) + across];
        if (next !== undefined) selected.value = next;
    }
}

function onKeydown(event: KeyboardEvent): void {
    // 树里的按钮（折叠、分叉切换）自己处理回车与方向键，容器不抢。
    if (event.target !== event.currentTarget) return;
    const down = direction.value === "down";
    const keys: Record<string, () => void> = mode.value === "list"
        ? {
            ArrowDown: () => moveInList(1),
            ArrowUp: () => moveInList(-1),
            Home: () => {
                selected.value = rows.value[0]?.id ?? null;
            },
            End: () => {
                selected.value = rows.value.at(-1)?.id ?? null;
            },
            ArrowLeft: () => selected.value !== null && rows.value.find((row) => row.id === selected.value)?.collapsible && !collapsed.value.has(selected.value) && toggle(selected.value),
            ArrowRight: () => selected.value !== null && collapsed.value.has(selected.value) && toggle(selected.value),
            Enter: activate,
        }
        : {
            ArrowDown: () => (down ? moveInGraph(1, 0) : moveInGraph(0, 1)),
            ArrowUp: () => (down ? moveInGraph(-1, 0) : moveInGraph(0, -1)),
            ArrowRight: () => (down ? moveInGraph(0, 1) : moveInGraph(1, 0)),
            ArrowLeft: () => (down ? moveInGraph(0, -1) : moveInGraph(-1, 0)),
            Enter: activate,
        };
    const run = keys[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
}

/** 打开、换视图、换方向时滚到当前位置；长会话从头翻太远。 */
function scrollToCurrent(): void {
    void nextTick(() => bodyRef.value?.querySelector("[data-tree-current]")?.scrollIntoView?.({block: "center", inline: "center"}));
}
watch(ready, (value, old) => {
    if (value !== null && old === null) scrollToCurrent();
});
watch([mode, direction], scrollToCurrent);
watch(selected, () => {
    void nextTick(() => bodyRef.value?.querySelector("[data-tree-selected]")?.scrollIntoView?.({block: "nearest", inline: "nearest"}));
});
</script>

<template>
    <div class="acv-tree" data-session-tree>
        <p v-if="props.tree.state === 'loading'" class="acv-tree__state" role="status">
            <Spinner size="sm" :label="t('panel.tree.loading', {count: props.tree.loaded})" />{{ t("panel.tree.loading", {count: props.tree.loaded}) }}
        </p>
        <p v-else-if="props.tree.state === 'unavailable'" class="acv-tree__state" data-tree-unavailable>
            <span class="i-lucide-info" aria-hidden="true" />{{ props.tree.reason }}
        </p>
        <template v-else>
            <div class="acv-tree__bar">
                <span class="acv-tree__count" data-tree-count>{{ t("panel.tree.count", {nodes: shownCount, forks: forkCount}) }}</span>
                <span class="acv-tree__spacer" />
                <div v-if="mode === 'graph'" class="acv-tree__directions">
                    <IconButton size="sm" icon-class="i-lucide-arrow-down" :title="t('panel.tree.down')" :aria-label="t('panel.tree.down')" :aria-pressed="direction === 'down'" :class="{'is-on': direction === 'down'}" data-tree-direction="down" @click="direction = 'down'" />
                    <IconButton size="sm" icon-class="i-lucide-arrow-right" :title="t('panel.tree.right')" :aria-label="t('panel.tree.right')" :aria-pressed="direction === 'right'" :class="{'is-on': direction === 'right'}" data-tree-direction="right" @click="direction = 'right'" />
                </div>
                <SegmentedControl v-model="mode" :options="modes" size="xs" class="acv-tree__modes" data-tree-modes />
            </div>
            <div class="acv-tree__filters">
                <Input v-model="query" size="sm" icon-class="i-lucide-search" class="acv-tree__search" :placeholder="t('panel.tree.search')" :aria-label="t('panel.tree.search')" data-tree-search />
                <SegmentedControl v-model="filter" :options="filters" size="xs" class="acv-tree__filter" data-tree-filter />
            </div>
            <div ref="bodyRef" class="acv-tree__body" tabindex="0" role="tree" :aria-label="t('panel.tree.title')" :aria-activedescendant="selected === null ? undefined : `tree-item-${selected}`" data-tree-body @keydown="onKeydown">
                <template v-if="mode === 'list'">
                    <p v-if="rows.length === 0" class="acv-tree__state">{{ t("panel.tree.empty") }}</p>
                    <div
                        v-for="row in rows"
                        :key="row.id"
                        :id="`tree-item-${row.id}`"
                        class="acv-tree__row"
                        :class="{'is-on': row.onPath, 'is-current': row.current, 'is-selected': row.id === selected}"
                        role="treeitem"
                        :aria-selected="row.id === selected"
                        :aria-level="row.guides.length + 1"
                        :aria-expanded="row.collapsible ? !row.collapsed : undefined"
                        :data-tree-row="row.id"
                        :data-tree-current="row.current ? '' : undefined"
                        :data-tree-selected="row.id === selected ? '' : undefined"
                        @click="selected = row.id"
                        @dblclick="activate"
                    >
                        <span v-if="row.guides.length > MAX_GUIDES" class="acv-tree__deeper" :title="t('panel.tree.deeper', {count: row.guides.length})">+{{ row.guides.length - MAX_GUIDES }}</span>
                        <span v-for="(guide, index) in row.guides.slice(-MAX_GUIDES)" :key="index" class="acv-tree__guide" :data-kind="guide" :style="{'--acv-lane': laneColor(row.guideLanes.slice(-MAX_GUIDES)[index] ?? 0)}" />
                        <button v-if="row.collapsible" type="button" class="acv-tree__fold" :aria-label="t(row.collapsed ? 'panel.tree.expand' : 'panel.tree.collapse')" data-tree-fold @click.stop="toggle(row.id)">
                            <span :class="row.collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" aria-hidden="true" />
                        </button>
                        <!-- 分支里没有折叠箭头的行留出同样的宽度，图标才对得齐。 -->
                        <span v-else-if="row.guides.length > 0" class="acv-tree__fold" aria-hidden="true" />
                        <span :class="KIND_ICONS[row.kind]" class="acv-tree__icon" :data-kind="row.kind" aria-hidden="true" />
                        <span class="acv-tree__label">{{ row.label }}</span>
                        <span v-if="row.forks > 0" class="acv-tree__tag" data-tree-fork>{{ t("panel.tree.fork", {count: row.forks}) }}</span>
                        <span v-if="row.collapsed" class="acv-tree__tag">{{ t("panel.tree.hidden", {count: row.hidden}) }}</span>
                        <span v-if="row.current" class="acv-tree__tag is-accent">{{ t("panel.tree.current") }}</span>
                    </div>
                </template>
                <p v-else-if="tooLarge" class="acv-tree__state" data-tree-too-large>{{ t("panel.tree.tooLarge", {limit: SESSION_TREE_GRAPH_LIMIT}) }}</p>
                <div v-else-if="graph !== null" class="acv-tree__canvas" :style="{width: `${canvas.width}px`, height: `${canvas.height}px`}" data-tree-canvas :data-direction="direction">
                    <svg class="acv-tree__edges" :width="canvas.width" :height="canvas.height" aria-hidden="true">
                        <path v-for="edge in edges" :key="edge.key" :d="edge.path" class="acv-tree__edge" :class="{'is-on': edge.onPath}" :style="{stroke: edge.color}" />
                    </svg>
                    <div
                        v-for="node in graph.nodes"
                        :key="node.id"
                        class="acv-tree__node"
                        :class="{'is-on': node.onPath, 'is-current': node.current, 'is-selected': node.id === selected}"
                        :style="{left: `${graphPosition(node, direction).x}px`, top: `${graphPosition(node, direction).y}px`, width: `${SESSION_TREE_NODE_SIZE.width}px`, height: `${SESSION_TREE_NODE_SIZE.height}px`, '--acv-lane': laneColor(node.lane)}"
                        :id="`tree-item-${node.id}`"
                        role="treeitem"
                        :aria-selected="node.id === selected"
                        :title="node.label"
                        :data-tree-node="node.id"
                        :data-tree-current="node.current ? '' : undefined"
                        :data-tree-selected="node.id === selected ? '' : undefined"
                        @click="selected = node.id"
                        @dblclick="activate"
                    >
                        <span :class="KIND_ICONS[node.kind]" class="acv-tree__icon" :data-kind="node.kind" aria-hidden="true" />
                        <span class="acv-tree__label">{{ node.label }}</span>
                        <span v-if="node.fork !== null" class="acv-tree__switch" data-tree-switch>
                            <button type="button" :aria-label="t('panel.tree.previous')" :disabled="forkIndex(node) === 0" @click.stop="switchFork(node, -1)"><span class="i-lucide-chevron-left" aria-hidden="true" /></button>
                            {{ forkIndex(node) + 1 }}/{{ node.fork.children.length }}
                            <button type="button" :aria-label="t('panel.tree.next')" :disabled="forkIndex(node) === node.fork.children.length - 1" @click.stop="switchFork(node, 1)"><span class="i-lucide-chevron-right" aria-hidden="true" /></button>
                        </span>
                    </div>
                </div>
            </div>
            <footer class="acv-tree__detail">
                <div class="acv-tree__detail-text">
                    <span class="acv-tree__selected-label" data-tree-selected-label>{{ selectedLabel ?? t("panel.tree.hint") }}</span>
                    <button v-if="selected !== null" type="button" class="acv-tree__id" :title="t('panel.tree.copyId')" data-tree-copy @click="emit('copy', selected)">
                        {{ selected }}<span class="i-lucide-copy" aria-hidden="true" />
                    </button>
                </div>
                <Button size="sm" :disabled="selected === null || selectedOnPath || !props.canActivate" data-tree-activate @click="activate">{{ t("panel.tree.activate") }}</Button>
            </footer>
        </template>
    </div>
</template>

<style scoped>
.acv-tree {
    display: flex;
    /* 外框的正文区有上限；树自己撑满并在内部滚动，工具条和底部不跟着滚。 */
    height: min(560px, 70vh, 70cqh);
    flex-direction: column;
    gap: 8px;
    color: var(--text-main);
    font-size: var(--text-xs);
}

.acv-tree__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px 0;
    color: var(--text-secondary);
}

.acv-tree__bar,
.acv-tree__filters {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.acv-tree__count {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-tree__spacer {
    flex: 1;
}

.acv-tree__directions {
    display: inline-flex;
    gap: 2px;
}

.acv-tree__directions .is-on {
    background: var(--bg-hover);
    color: var(--text-main);
}

.acv-tree__modes {
    width: 112px;
    flex: none;
}

.acv-tree__search {
    min-width: 120px;
    flex: 1;
}

.acv-tree__filter {
    flex: none;
}

.acv-tree__body {
    min-height: 0;
    flex: 1;
    overflow: auto;
    outline: none;
    border-radius: var(--radius-control);
}

.acv-tree__body:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: -2px;
}

.acv-tree__row {
    display: flex;
    height: 28px;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    cursor: pointer;
    /* 长会话几万行：看不见的行不排版。 */
    content-visibility: auto;
    contain-intrinsic-size: auto 28px;
}

.acv-tree__row:hover {
    background: var(--bg-hover);
}

.acv-tree__row.is-on {
    color: var(--text-main);
}

.acv-tree__row.is-current {
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
}

.acv-tree__row.is-selected {
    outline: 1px solid var(--focus-outline);
    outline-offset: -1px;
}

.acv-tree__guide {
    position: relative;
    width: 18px;
    height: 28px;
    flex: none;
}

.acv-tree__guide::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 8px;
    width: 2px;
    background: var(--acv-lane);
    content: "";
}

.acv-tree__guide[data-kind="space"]::before {
    display: none;
}

.acv-tree__guide[data-kind="end"]::before {
    bottom: 50%;
}

.acv-tree__guide[data-kind="branch"]::after,
.acv-tree__guide[data-kind="end"]::after {
    position: absolute;
    top: 50%;
    right: 0;
    left: 8px;
    height: 2px;
    background: var(--acv-lane);
    content: "";
}

.acv-tree__deeper {
    flex: none;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-tree__fold {
    display: inline-flex;
    width: 14px;
    flex: none;
    color: var(--text-muted);
}

.acv-tree__icon {
    width: 13px;
    height: 13px;
    flex: none;
}

/* 说话的人一眼分得开；不在当前路径的整行暗下去，颜色也跟着淡。 */
.acv-tree__icon[data-kind="user"] {
    color: var(--accent-text);
}

.acv-tree__icon[data-kind="assistant"] {
    color: var(--status-success);
}

.acv-tree__icon[data-kind="tool"] {
    color: var(--status-warning);
}

.acv-tree__row:not(.is-on) .acv-tree__icon,
.acv-tree__node:not(.is-on) .acv-tree__icon {
    opacity: 0.65;
}

.acv-tree__label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-tree__tag {
    flex: none;
    padding: 0 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-tree__tag.is-accent {
    border-color: var(--accent-main);
    color: var(--accent-text);
}

.acv-tree__canvas {
    position: relative;
    /* 给分叉节点上面的切换器留位置。 */
    margin: 18px 8px 8px;
}

.acv-tree__edges {
    position: absolute;
    inset: 0;
    overflow: visible;
}

.acv-tree__edge {
    fill: none;
    stroke-opacity: 0.7;
    stroke-width: 2;
}

.acv-tree__edge.is-on {
    stroke-opacity: 1;
    stroke-width: 2.5;
}

.acv-tree__node {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, var(--acv-lane) 55%, transparent);
    border-radius: var(--radius-control);
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    cursor: pointer;
}

.acv-tree__node.is-on {
    border-color: var(--accent-main);
    color: var(--text-main);
}

.acv-tree__node.is-current {
    background: color-mix(in srgb, var(--accent-main) 14%, var(--bg-panel));
}

.acv-tree__node.is-selected {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-tree__switch {
    position: absolute;
    bottom: 100%;
    right: 2px;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    margin-bottom: 1px;
    padding: 0 2px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--accent-main) 14%, var(--bg-panel));
    color: var(--accent-text);
    font-size: var(--text-2xs);
    font-weight: var(--weight-strong);
    white-space: nowrap;
}

.acv-tree__switch button {
    display: inline-flex;
    color: inherit;
}

.acv-tree__switch button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.acv-tree__detail {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--divider, var(--border-color));
}

.acv-tree__detail-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
}

.acv-tree__selected-label {
    overflow: hidden;
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-tree__id {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-2xs);
}
</style>
