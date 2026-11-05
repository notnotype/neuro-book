<script setup lang="ts">
/**
 * NestedGrid 的结构变化场景（docs/specs/ui/nested-grid.md 的“按矩形摆放”到“读屏顺序”，断言在 e2e/lab-grid-structure.e2e.ts）。
 * 夹具自己扮演宿主：横排 a、b、c，c 可以拖到零；按钮做程序触发的结构与尺寸变化。按钮在 grid 外面，e2e 用脚本点它们，焦点不动。
 */
import {shallowRef, useTemplateRef} from "vue";

import {createGrid} from "@notnotype/nb-layout";
import type {Grid} from "@notnotype/nb-layout";
import {NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";

import GridStructureLeaf from "./GridStructureLeaf.vue";

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
            collapse: {collapsed: false, collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24},
        },
    ],
}, {sashSize: 4});

let instances = 0;
const createInstance = (): number => {
    instances += 1;
    return instances;
};

const containerEl = useTemplateRef<HTMLElement>("containerEl");
const extent = useLayoutExtent(containerEl);
const grid = shallowRef<Grid<string>>(createInitial());
const host = useGridLayout<string>({grid, extent, contextKey: () => "structure"});

const ACTIONS: Readonly<Record<string, () => void>> = {
    "split-before": () => grid.value.splitLeaf("a", {branchId: "a-split", orientation: "horizontal", side: "before", ratio: 0.5, leaf: {kind: "leaf", id: "n", ref: "n", minimumSize: {width: 40, height: 0}}}),
    "close-new": () => grid.value.removeLeaf("n"),
    "move-to-end": () => grid.value.moveLeaf("a", "root", 2),
    "widen": () => grid.value.resize("a", "width", 120),
    "narrow": () => grid.value.resize("a", "width", -60),
};

function run(name: string): void {
    ACTIONS[name]?.();
    host.invalidate();
}
</script>

<template>
    <div class="grid-structure-scene">
        <div class="grid-structure-scene__actions">
            <button v-for="(_, name) in ACTIONS" :key="name" type="button" :data-structure-action="name" @click="run(name)">{{ name }}</button>
            <input data-structure-outside aria-label="grid 外面的输入框" />
        </div>
        <div ref="containerEl" class="grid-structure-scene__grid" data-structure-host>
            <NestedGrid data-lab-subject :node="host.node.value" :layout="host.layout.value" context-key="structure" :revision="host.revision.value" :on-gesture-commit="host.onGestureCommit">
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
    gap: 8px;
}

.grid-structure-scene__grid {
    flex: 1;
    min-height: 240px;
}
</style>
