<script setup lang="ts">
/**
 * NestedGrid 的结构变化场景（docs/specs/ui/nested-grid.md 的“按矩形摆放”到“读屏顺序”，断言在 e2e/lab-grid-structure.e2e.ts）。
 * 夹具自己扮演宿主：横排 a、b、c，c 可以拖到零；按钮做程序触发的结构与尺寸变化。按钮在 grid 外面，e2e 用脚本点它们，焦点不动。
 */
import {shallowRef, useTemplateRef} from "vue";

import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridBranch, GridNode} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

import GridStructureLeaf from "nbook/plugins/workbench/web/lab/GridStructureLeaf.vue";
import {createInstanceCounter, moveFocusOnF6} from "./scene-support";

const createInitial = (): Grid<string> => createGrid<string>({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: [
        {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, minimumSize: {width: 80, height: 0}},
        {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}, minimumSize: {width: 80, height: 0}},
        {
            kind: "leaf",
            id: "c",
            ref: "c",
            size: {width: 300, height: 0},
            minimumSize: {width: 120, height: 0},
            collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24},
        },
    ],
}, {sashSize: 4});

const createInstance = createInstanceCounter();

/** F6 移动焦点的范围；尺寸由 `NestedGrid` 自己量。 */
const containerEl = useTemplateRef<HTMLElement>("containerEl");
const grid = shallowRef<Grid<string>>(createInitial());
const host = useGridHost<string>({
    grid,
    contextKey: "structure",
    // 用 debug 不用 warn：lab-scenes 按手机宽度跑这个场景，放不下是正常结果，不是接线错误。
    onIssues: (issues) => console.debug("[lab] nb-layout issues", issues),
});

function parentBranchOf(node: GridNode<string> | null, id: string): GridBranch<string> | null {
    if (node?.kind !== "branch") return null;
    if (node.children.some((child) => child.id === id)) return node;
    for (const child of node.children) {
        const found = parentBranchOf(child, id);
        if (found !== null) return found;
    }
    return null;
}

/** 把 `id` 沿父分支的主轴（横排）拉宽 `delta` px：同一分支的兄弟平分差额。基线取当前呈现，守恒与约束由 `resizeBranches` 核对。 */
function widenBy(id: string, delta: number): void {
    const extent = host.extent.value;
    const parent = parentBranchOf(grid.value.root(), id);
    if (extent === null || parent === null) return;
    const sizes = grid.value.layout(extent).sizes;
    const baseline = Object.fromEntries(parent.children.map((child) => [child.id, sizes[child.id]!.width]));
    const share = delta / (parent.children.length - 1);
    const target = Object.fromEntries(parent.children.map((child) => [child.id, baseline[child.id]! + (child.id === id ? delta : -share)]));
    grid.value.resizeBranches([{branchId: parent.id, axis: "width", baseline, target}]);
}

const ACTIONS: Readonly<Record<string, () => void>> = {
    "split-before": () => grid.value.splitLeaf("a", {branchId: "a-split", orientation: "horizontal", side: "before", ratio: 0.5, leaf: {kind: "leaf", id: "n", ref: "n", minimumSize: {width: 40, height: 0}}}),
    "close-new": () => grid.value.removeLeaf("n"),
    // 同一分支内的序号是移除之前的：3 才是最后。
    "move-to-end": () => grid.value.moveLeaf("a", "root", 3),
    "widen": () => widenBy("a", 120),
    "narrow": () => widenBy("a", -60),
};

/** 收起与展开走宿主的入口（Spec `ui/nested-grid` 输出 149）：它自己重发布局，不再 `invalidate()`。 */
const COLLAPSE_ACTIONS: Readonly<Record<string, () => void>> = {
    "collapse-c": () => void host.setCollapsed("c", true),
    "expand-c": () => void host.setCollapsed("c", false),
};

const onKeydown = (event: KeyboardEvent): void => moveFocusOnF6(event, containerEl.value);

function run(name: string): void {
    ACTIONS[name]?.();
    host.invalidate();
}
</script>

<template>
    <div class="grid-structure-scene" @keydown="onKeydown">
        <div class="grid-structure-scene__actions">
            <button v-for="(_, name) in ACTIONS" :key="name" type="button" :data-structure-action="name" @click="run(name)">{{ name }}</button>
            <button v-for="(action, name) in COLLAPSE_ACTIONS" :key="name" type="button" :data-structure-action="name" @click="action()">{{ name }}</button>
            <input data-structure-outside aria-label="grid 外面的输入框" />
        </div>
        <div ref="containerEl" class="grid-structure-scene__grid" data-structure-host>
            <NestedGrid data-lab-subject v-bind="host.bindings.value">
                <template #leaf="{node}">
                    <GridStructureLeaf :id="node.id" :create-instance="createInstance" />
                </template>
            </NestedGrid>
        </div>
    </div>
</template>

<style scoped>
.grid-structure-scene {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
}

.grid-structure-scene__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.grid-structure-scene__actions input {
    min-width: 0;
    max-width: 100%;
}

.grid-structure-scene__grid {
    flex: 1;
    min-height: 240px;
}
</style>
