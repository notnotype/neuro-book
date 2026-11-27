<script setup lang="ts">
/**
 * 内容层的场景（docs/specs/ui/nested-grid.md 的“内容层”、docs/specs/ui/workbench-layout.md 验收 1，断言在 e2e/lab-grid-panels.e2e.ts）。
 * 夹具自己扮演工作台：`侧栏(视图 A | 视图 B) | (编辑器 甲 | 编辑器 乙) | 右栏(视图 C | 视图 D)`，一份布局文档算出呈现树。按钮做拖放会提交的那些结构变化，用来试位移的手感；
 * 真实的拖动手势在工作台接上。
 */
import {computed, shallowRef, useTemplateRef} from "vue";

import {
    createGrid,
    GRID_SNAPSHOT_VERSION,
} from "@notnotype/nb-layout";
import {
    activateTab,
    applyGestureCommit,
    edgeTargetOf,
    movePanelToEdge,
    moveTabToEdge,
    moveTabToStrip,
    openPanelAtEdge,
    panelRef,
    barRef,
    projectLayoutDoc,
    rebaseForOperation,
    removeTab,
    setPanelCollapsed,
    tabKey,
} from "@notnotype/nb-workbench-layout";
import type {Grid, GridFloatInput, GridRect} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutEdge, LayoutPolicy, LayoutProjectionOptions, LayoutResult, PanelRecord, TabRef} from "@notnotype/nb-workbench-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

import GridStructureLeaf from "nbook/plugins/workbench/web/lab/GridStructureLeaf.vue";
import {createInstanceCounter, moveFocusOnF6} from "./scene-support";

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

/** F6 移动焦点的范围；尺寸由 `NestedGrid` 自己量。 */
const containerEl = useTemplateRef<HTMLElement>("containerEl");
const host = useGridHost({
    grid,
    contextKey: "panels",
    // 意图只从呈现尺寸写回（workbench-layout 输出 8、49）：落账前后的布局都交给库，它挑出这次没动的保留像素节点。
    // 只接手势：这个场景不调 `host.setCollapsed`、`host.setSize`，收起走文档再投影。
    onApplied: (change, before) => {
        if (change.kind !== "gesture") return;
        doc.value = applyGestureCommit(doc.value, projection.value, {before: before.sizes, after: host.layout.value.sizes, collapsed: change.collapsed}).doc;
    },
    // 用 debug 不用 warn：lab-scenes 按手机宽度跑这个场景，放不下是正常结果，不是接线错误。
    onIssues: (issues) => console.debug("[lab] nb-layout issues", issues),
});

/** 结构操作之前把呈现尺寸写回意图（workbench-layout 输出 8、49）。 */
function commit(operation: (current: LayoutDoc) => LayoutResult): void {
    const result = operation(rebaseForOperation(doc.value, projection.value, host.layout.value.sizes));
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

/**
 * 叠放的几层（nested-grid 输出 87、90、104）：一个浮动窗压在 ea 与 eb 之间的分隔线上，宿主的盖层画一条洋红的带，拿起的 A 带一条绿色的头。
 * 三者的矩形相对网格根、彼此部分重叠，e2e 按重叠处的像素与命中断言谁在上面。默认都关着，不影响别的用例。
 * Lab 的画布缺省约 640 宽，分隔线 ea|eb 在根的 x≈340 处：三层都摆在 200 到 620 之间。
 */
const FLOAT_ID = "fw";
const FLOAT_RECT: GridRect = {x: 200, y: 120, width: 320, height: 240};
const LIFTED_RECT: GridRect = {x: 400, y: 180, width: 220, height: 200};
const LIFTED_TALLER: GridRect = {...LIFTED_RECT, height: 260};
const floatOn = shallowRef(false);
const overlayOn = shallowRef(false);
const lifted = shallowRef<{readonly key: string} | null>(null);
const gridEl = useTemplateRef<{placeLifted(rect: GridRect): void}>("gridEl");
const floats = computed<ReadonlyArray<GridFloatInput>>(() => (floatOn.value ? [{id: FLOAT_ID, rect: FLOAT_RECT}] : []));

/** 拿起：先写矩形再给 `lifted`，刚拿起这次渲染从写下的矩形取（`placeLifted` 的约定）。 */
function lift(rect: GridRect): void {
    gridEl.value?.placeLifted(rect);
    lifted.value = {key: "view:a"};
}

/** 这几个按钮排在 `ACTIONS` 前面：e2e 从 `maximize-b` 按 Tab 进 grid，它要是 grid 前面最后一个控件。 */
const LAYER_ACTIONS: Readonly<Record<string, () => void>> = {
    // 右栏里竖着长出一块新面板、再关掉：它的内容标了留住，关掉时叶留着缩回去（nested-grid 输出 86、155）。
    "open-c3-below-c": () => commit((current) => openPanelAtEdge(current, {id: "c3", panel: tool("c3"), target: target(current, "c", "bottom")}, POLICY)),
    "close-c3": () => commit((current) => removeTab(current, "view:c3")),
    // DOM 里排最后的 d 挪到左栏最上面：树序的最后一站成了 c，DOM 序的最后还是 d（nested-grid 输出 125）。
    "d-above-b": () => commit((current) => movePanelToEdge(current, {panel: "d", target: target(current, "b", "top")}, POLICY)),
    "float-fw": () => {
        floatOn.value = !floatOn.value;
    },
    "overlay": () => {
        overlayOn.value = !overlayOn.value;
    },
    "lift-a": () => lift(LIFTED_RECT),
    "lift-a-taller": () => lift(LIFTED_TALLER),
    "drop-lifted": () => {
        lifted.value = null;
    },
};

function run(name: string): void {
    (ACTIONS[name] ?? LAYER_ACTIONS[name])?.();
}

const contents = computed(() => [
    ...Object.entries(doc.value.panels).flatMap(([id, panel]) => panel.tabs.map((tab) => ({
        key: tabKey(tab),
        leaf: id,
        insetTop: HEAD,
        active: panel.active === tabKey(tab),
        ...(tabKey(tab) === "view:c3" ? {leave: "retain" as const} : {}),
    }))),
    ...(floatOn.value ? [{key: `view:${FLOAT_ID}`, leaf: FLOAT_ID, insetTop: HEAD, active: true}] : []),
]);

const labelOf = (key: string): string => key.slice(key.indexOf(":") + 1);
const createInstance = createInstanceCounter();
const onKeydown = (event: KeyboardEvent): void => moveFocusOnF6(event, containerEl.value);
</script>

<template>
    <div class="grid-panels-scene" @keydown="onKeydown">
        <div class="grid-panels-scene__actions">
            <button v-for="(_, name) in LAYER_ACTIONS" :key="name" type="button" :data-panels-action="name" @click="run(name)">{{ name }}</button>
            <button v-for="(_, name) in ACTIONS" :key="name" type="button" :data-panels-action="name" @click="run(name)">{{ name }}</button>
        </div>
        <div ref="containerEl" class="grid-panels-scene__grid" data-panels-host>
            <NestedGrid
                ref="gridEl"
                data-lab-subject
                v-bind="host.bindings.value"
                :contents="contents"
                :floats="floats"
                :lifted="lifted"
                :maximized="maximized === null ? null : {leaf: maximized, exclude: BARS}"
            >
                <template #leaf="{node}">
                    <div v-if="node.id === FLOAT_ID" class="grid-panels-scene__head" :data-panel-head="node.id">{{ node.id }}</div>
                    <div v-else-if="doc.panels[node.id] !== undefined" class="grid-panels-scene__head" :data-panel-head="node.id">
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
                <template #lifted-head>
                    <div class="grid-panels-scene__lifted-head" data-panels-lifted-head>拿起</div>
                </template>
                <template v-if="floatOn" #float-chrome>
                    <div class="grid-panels-scene__float-handle" data-panels-float-handle></div>
                </template>
                <template v-if="overlayOn" #overlay>
                    <div class="grid-panels-scene__overlay" data-panels-overlay></div>
                </template>
            </NestedGrid>
        </div>
        <!-- grid 后面的控件：从这里按 Shift+Tab 进 grid（nested-grid 输出 125）。 -->
        <input class="grid-panels-scene__after" data-panels-after aria-label="grid 后面的输入框" />
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

/* 叠放用例按像素认这几层：颜色要和主题里的任何底色都分得开。 */
.grid-panels-scene__lifted-head {
    height: 40px;
    flex: none;
    background: rgb(0 200 0);
}

.grid-panels-scene__overlay {
    position: absolute;
    left: 300px;
    top: 150px;
    width: 200px;
    height: 60px;
    background: rgb(255 0 255);
}

/* 手柄只在右下角开一小块接指针，其余是空白（nested-grid 输出 113）。 */
.grid-panels-scene__float-handle {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 12px;
    height: 12px;
    pointer-events: auto;
}

.grid-panels-scene__after {
    align-self: flex-start;
    min-width: 0;
    max-width: 100%;
}
</style>
