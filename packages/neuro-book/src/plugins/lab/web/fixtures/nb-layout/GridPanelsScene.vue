<script setup lang="ts">
/**
 * 内容层的场景（docs/specs/ui/nested-grid.md 的“内容层”、docs/specs/ui/workbench-layout.md 验收 1，断言在 e2e/lab-grid-panels.e2e.ts）。
 * 夹具自己扮演工作台：`侧栏(视图 A | 视图 B) | (编辑器 甲 | 编辑器 乙) | 右栏(视图 C | 视图 D)`，一份布局文档算出呈现树。按钮做拖放会提交的那些结构变化，用来试位移的手感；
 * 真实的拖动手势在工作台接上。
 */
import {computed, shallowRef, useTemplateRef} from "vue";

import {
    activateTab,
    createGrid,
    edgeTargetOf,
    GRID_SNAPSHOT_VERSION,
    movePanelToEdge,
    moveTabToEdge,
    moveTabToStrip,
    openPanelAtEdge,
    panelRef,
    barRef,
    projectLayoutDoc,
    rebaseIntents,
    setPanelCollapsed,
    tabKey,
} from "@notnotype/nb-layout";
import type {Grid, LayoutDoc, LayoutEdge, LayoutPolicy, LayoutProjectionOptions, LayoutResult, PanelRecord, TabRef} from "@notnotype/nb-layout";
import {moveGridFocus, NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";

import GridStructureLeaf from "./GridStructureLeaf.vue";

const HEAD = 32;
const BARS = ["activitybar", "statusbar"];
const UNBOUNDED = {width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY};

const view = (viewId: string): TabRef => ({kind: "view", viewId});
const tool = (viewId: string, name?: PanelRecord["name"]): PanelRecord => ({role: "tool", ...(name === undefined ? {} : {name}), tabs: [view(viewId)], active: `view:${viewId}`});
const editor = (tabId: string): PanelRecord => ({role: "editor", tabs: [{kind: "tab", type: "lab", tabId}], active: `tab:${tabId}`});

function initialDoc(): LayoutDoc {
    const leaf = (id: string, width: number, height: number) => ({kind: "leaf" as const, id, ref: panelRef(id), size: {width, height}});
    return {
        version: 1,
        tree: {
            version: GRID_SNAPSHOT_VERSION,
            root: {kind: "branch", id: "root", orientation: "vertical", size: {width: 1400, height: 700}, children: [
                {kind: "branch", id: "body", orientation: "horizontal", size: {width: 1400, height: 678}, children: [
                    {kind: "leaf", id: "activitybar", ref: barRef("activitybar"), size: {width: 48, height: 0}},
                    {kind: "branch", id: "left", orientation: "vertical", size: {width: 280, height: 678}, children: [leaf("a", 280, 339), leaf("b", 280, 339)]},
                    leaf("ea", 380, 678),
                    leaf("eb", 380, 678),
                    {kind: "branch", id: "right", orientation: "vertical", size: {width: 280, height: 678}, children: [leaf("c", 280, 339), leaf("d", 280, 339)]},
                ]},
                {kind: "leaf", id: "statusbar", ref: barRef("statusbar"), size: {width: 0, height: 22}},
            ]},
        },
        panels: {a: tool("a"), b: {...tool("b"), tabs: [view("b"), view("b2")]}, c: tool("c"), d: tool("d"), ea: editor("ea"), eb: editor("eb")},
        floats: [],
        hiddenBars: [],
        currentEditor: "ea",
    };
}

let idCounter = 0;
const POLICY: LayoutPolicy = {
    accepts: (tabs, target, region) => region === "edge" || tabs.every((tab) => (tab.kind === "view" ? target.role === "tool" : target.role === "editor")),
    newId: (kind) => {
        idCounter += 1;
        return `${kind}-${String(idCounter)}`;
    },
};

const doc = shallowRef<LayoutDoc>(initialDoc());
const maximized = shallowRef<string | null>(null);

const projectionOptions = computed<LayoutProjectionOptions>(() => ({
    constraints: (_id, panel) => ({minimumSize: panel.role === "editor" ? {width: 160, height: 120} : {width: 120, height: 80}, maximumSize: UNBOUNDED}),
    barThickness: (bar) => (bar === "activitybar" ? 48 : 22),
    headHeight: HEAD,
    collapseThreshold: 24,
    sashSize: 4,
}));
const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
const grid = computed<Grid<string>>(() => createGrid<string>(projection.value.input, {sashSize: projection.value.sashSize}));

const containerEl = useTemplateRef<HTMLElement>("containerEl");
const extent = useLayoutExtent(containerEl);
const host = useGridLayout({
    grid,
    extent,
    contextKey: () => "panels",
    onApplied: (_commit, result) => {
        // 意图只从呈现尺寸写回（workbench-layout 输出 8）；收起状态来自这次手势，先改它：收起的面板呈现尺寸不是意图。
        let next = doc.value;
        for (const [id, collapsed] of Object.entries(result.collapsed)) {
            const updated = setPanelCollapsed(next, id, collapsed);
            if (updated.ok) next = updated.doc;
        }
        doc.value = rebaseIntents(next, host.layout.value.sizes, projection.value.collapsedTo);
    },
});

/** 结构操作之前把呈现尺寸写回意图（workbench-layout 输出 8）。 */
function commit(operation: (current: LayoutDoc) => LayoutResult): void {
    const result = operation(rebaseIntents(doc.value, host.layout.value.sizes, projection.value.collapsedTo));
    if (result.ok) doc.value = result.doc;
}

const target = (current: LayoutDoc, panel: string, edge: LayoutEdge) => {
    const found = edgeTargetOf(current, panel, edge);
    if (found === null) throw new Error(`没有 ${panel} 的 ${edge}`);
    return found;
};

const ACTIONS: Readonly<Record<string, () => void>> = {
    "a-between-c-d": () => commit((current) => movePanelToEdge(current, {panel: "a", target: target(current, "c", "bottom")}, POLICY)),
    "a-into-c-strip": () => commit((current) => moveTabToStrip(current, {tab: "view:a", panel: "c", index: 1}, POLICY)),
    "a-back-above-b": () => commit((current) => moveTabToEdge(current, {tab: "view:a", target: target(current, "b", "top")}, POLICY)),
    "b2-into-d-strip": () => commit((current) => moveTabToStrip(current, {tab: "view:b2", panel: "d", index: 1}, POLICY)),
    "b2-to-eb-edge": () => commit((current) => moveTabToEdge(current, {tab: "view:b2", target: target(current, "eb", "right")}, POLICY)),
    "open-e3-right-of-eb": () => commit((current) => openPanelAtEdge(current, {id: "e3", panel: editor("e3"), target: target(current, "eb", "right")}, POLICY)),
    "eb-left-of-ea": () => commit((current) => movePanelToEdge(current, {panel: "eb", target: target(current, "ea", "left")}, POLICY)),
    "eb-in-place": () => commit((current) => movePanelToEdge(current, {panel: "eb", target: target(current, "ea", "right")}, POLICY)),
    "collapse-d": () => commit((current) => setPanelCollapsed(current, "d", current.panels.d?.collapsed !== true)),
    "maximize-b": () => {
        maximized.value = maximized.value === "b" ? null : "b";
    },
};

function run(name: string): void {
    ACTIONS[name]?.();
}

const contents = computed(() => Object.entries(doc.value.panels).flatMap(([id, panel]) => panel.tabs.map((tab) => ({
    key: tabKey(tab),
    leaf: id,
    insetTop: HEAD,
    active: panel.active === tabKey(tab),
}))));

const labelOf = (key: string): string => key.slice(key.indexOf(":") + 1);
let created = 0;
const createInstance = (): number => {
    created += 1;
    return created;
};

/** 产品里是工作台的两条命令；这里不接命令系统，直接调。 */
function onKeydown(event: KeyboardEvent): void {
    if (event.key === "F6" && moveGridFocus(containerEl.value, event.shiftKey ? "previous" : "next")) event.preventDefault();
}
</script>

<template>
    <div class="grid-panels-scene" @keydown="onKeydown">
        <div class="grid-panels-scene__actions">
            <button v-for="(_, name) in ACTIONS" :key="name" type="button" :data-panels-action="name" @click="run(name)">{{ name }}</button>
        </div>
        <div ref="containerEl" class="grid-panels-scene__grid" data-panels-host>
            <NestedGrid data-lab-subject :node="host.node.value" :layout="host.layout.value" context-key="panels" :revision="host.revision.value" :on-gesture-commit="host.onGestureCommit" :contents="contents" :maximized="maximized === null ? null : {leaf: maximized, exclude: BARS}">
                <template #leaf="{node}">
                    <div v-if="doc.panels[node.id] !== undefined" class="grid-panels-scene__head" :data-panel-head="node.id">
                        <button
                            v-for="tab in doc.panels[node.id]?.tabs"
                            :key="tabKey(tab)"
                            type="button"
                            :data-panel-tab="tabKey(tab)"
                            :aria-pressed="doc.panels[node.id]?.active === tabKey(tab)"
                            @click="commit((current) => activateTab(current, tabKey(tab)))"
                        >{{ labelOf(tabKey(tab)) }}</button>
                    </div>
                    <div v-else class="grid-panels-scene__bar">{{ node.id }}</div>
                </template>
                <template #content="{contentKey}">
                    <GridStructureLeaf :id="labelOf(contentKey)" :create-instance="createInstance" />
                </template>
            </NestedGrid>
        </div>
    </div>
</template>

<style scoped>
.grid-panels-scene {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    height: 100%;
    min-height: 0;
}

.grid-panels-scene__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.grid-panels-scene__grid {
    flex: 1;
    min-height: 560px;
    background: var(--bg-main);
}

.grid-panels-scene__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--panel-surface);
    border-bottom: 1px solid var(--divider);
    font-size: var(--text-xs);
}

.grid-panels-scene__head [aria-pressed="true"] {
    font-weight: 600;
}

.grid-panels-scene__bar {
    height: 100%;
    background: var(--panel-surface);
    font-size: var(--text-xs);
}
</style>
