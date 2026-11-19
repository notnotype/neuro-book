<script setup lang="ts">
/**
 * NestedGrid 的结构变化场景（docs/specs/ui/nested-grid.md 的“按矩形摆放”到“读屏顺序”，断言在 e2e/lab-grid-structure.e2e.ts）。
 * 夹具自己扮演宿主：横排 a、b、c，c 可以拖到零；按钮做程序触发的结构与尺寸变化。按钮在 grid 外面，e2e 用脚本点它们，焦点不动。
 */
import {shallowRef, useTemplateRef} from "vue";

import {createGrid} from "@notnotype/nb-layout";
import type {Grid} from "@notnotype/nb-layout";
import {NestedGrid, moveGridFocus, useGridHost} from "@notnotype/nb-layout/vue";

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

/** F6 移动焦点的范围；尺寸由 `NestedGrid` 自己量。 */
const containerEl = useTemplateRef<HTMLElement>("containerEl");
const grid = shallowRef<Grid<string>>(createInitial());
const host = useGridHost<string>({grid, contextKey: "structure"});

const ACTIONS: Readonly<Record<string, () => void>> = {
    "split-before": () => grid.value.splitLeaf("a", {branchId: "a-split", orientation: "horizontal", side: "before", ratio: 0.5, leaf: {kind: "leaf", id: "n", ref: "n", minimumSize: {width: 40, height: 0}}}),
    "close-new": () => grid.value.removeLeaf("n"),
    // 同一分支内的序号是移除之前的：3 才是最后。
    "move-to-end": () => grid.value.moveLeaf("a", "root", 3),
    "widen": () => grid.value.resize("a", "width", 120),
    "narrow": () => grid.value.resize("a", "width", -60),
};

/** 收起与展开走宿主的入口（Spec `ui/nested-grid` 输出 149）：它自己重发布局，不再 `invalidate()`。 */
const COLLAPSE_ACTIONS: Readonly<Record<string, () => void>> = {
    "collapse-c": () => void host.setCollapsed("c", true),
    "expand-c": () => void host.setCollapsed("c", false),
};

/** 产品里是工作台的两条命令；这里不接命令系统，直接调。 */
function onKeydown(event: KeyboardEvent): void {
    if (event.key === "F6" && moveGridFocus(containerEl.value, event.shiftKey ? "previous" : "next")) event.preventDefault();
}

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
