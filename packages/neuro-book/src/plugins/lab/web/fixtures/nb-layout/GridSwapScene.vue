<script setup lang="ts">
/**
 * NestedGrid 的交换场景（docs/specs/ui/nested-grid.md 的“交换”，断言在 e2e/lab-grid-swap.e2e.ts）。
 * 夹具自己扮演宿主：左边一列放一组叶（A 两块、B 一块、C 两块），按钮换组时给交换、换树，像工作台切换侧栏的容器；
 * 列的上下各有一块叶，滑出列的部分要是没被裁掉，会画在它们上面。每块组里的叶一个内容项，颜色按组分。
 * 右边另有一列（X、Y 各一块），按横向交换，像右栏、底部面板切换容器：网格同时只有一条带，左列滚到一半点右列时左列先到终点。
 */
import {computed, shallowRef, useTemplateRef} from "vue";

import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridContentInput, GridNodeInput, GridSwap} from "@notnotype/nb-layout";
import {NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";

const GROUPS = {A: ["a1", "a2"], B: ["b1"], C: ["c1", "c2"], X: ["x1"], Y: ["y1"]} as const;
type GroupName = keyof typeof GROUPS;
const ORDER: readonly GroupName[] = ["A", "B", "C"];
const RIGHT: readonly GroupName[] = ["X", "Y"];
const GAP = 8;

const leaf = (id: string, size: {width: number; height: number}): GridNodeInput<string> => ({kind: "leaf", id, ref: id, size});
function treeOf(group: GroupName, right: GroupName): Grid<string> {
    const ids = GROUPS[group];
    const side: GridNodeInput<string> = ids.length === 1
        ? leaf(ids[0], {width: 280, height: 0})
        : {kind: "branch", id: "side", orientation: "vertical", size: {width: 280, height: 0}, children: ids.map((id) => leaf(id, {width: 0, height: 200}))};
    return createGrid<string>({kind: "branch", id: "root", orientation: "vertical", children: [
        {...leaf("top", {width: 0, height: 60}), sizing: "fixed"},
        {kind: "branch", id: "body", orientation: "horizontal", children: [side, leaf("main", {width: 600, height: 0}), leaf(GROUPS[right][0], {width: 220, height: 0})]},
        {...leaf("bottom", {width: 0, height: 60}), sizing: "fixed"},
    ]}, {sashSize: 4});
}

const containerEl = useTemplateRef<HTMLElement>("containerEl");
const extent = useLayoutExtent(containerEl);
const current = shallowRef<GroupName>("A");
const currentRight = shallowRef<GroupName>("X");
const grid = shallowRef<Grid<string>>(treeOf("A", "X"));
const host = useGridLayout<string>({grid, extent, contextKey: () => "swap"});
const swap = shallowRef<GridSwap | null>(null);
const issues = shallowRef<readonly string[]>([]);

const contents = computed<GridContentInput[]>(() => [...ORDER, ...RIGHT].flatMap((name) => GROUPS[name].map((id) => ({key: `view-${id}`, leaf: id, insetTop: 0, active: true}))));
const groupOf = (id: string): GroupName | undefined => [...ORDER, ...RIGHT].find((name) => (GROUPS[name] as readonly string[]).includes(id));

/** 换组：交换和新树在同一个同步段里给，`useGridLayout` 在同一轮刷新里按新树发布布局。 */
function switchTo(name: GroupName): void {
    const right = RIGHT.includes(name);
    const order = right ? RIGHT : ORDER;
    const from = right ? currentRight.value : current.value;
    if (name === from) return;
    swap.value = {
        token: (swap.value?.token ?? 0) + 1,
        leaving: [...GROUPS[from]],
        entering: [...GROUPS[name]],
        axis: right ? "width" : "height",
        direction: order.indexOf(name) > order.indexOf(from) ? 1 : -1,
        gap: GAP,
    };
    if (right) currentRight.value = name;
    else current.value = name;
    grid.value = treeOf(current.value, currentRight.value);
}
</script>

<template>
    <div class="grid-swap-scene">
        <div class="grid-swap-scene__actions">
            <button v-for="name in ORDER" :key="name" type="button" :data-swap-action="name" :aria-pressed="current === name" @click="switchTo(name)">{{ name }}</button>
            <button v-for="name in RIGHT" :key="name" type="button" :data-swap-action="name" :aria-pressed="currentRight === name" @click="switchTo(name)">{{ name }}</button>
            <span data-swap-issues>{{ issues.join("；") }}</span>
        </div>
        <div ref="containerEl" class="grid-swap-scene__grid">
            <NestedGrid
                data-lab-subject
                :node="host.node.value"
                :layout="host.layout.value"
                context-key="swap"
                :revision="host.revision.value"
                :on-gesture-commit="host.onGestureCommit"
                :contents="contents"
                :swap="swap"
                @issues="(list) => (issues = list)"
            >
                <template #leaf="{node}">
                    <div v-if="groupOf(node.id) === undefined" class="grid-swap-scene__fixed" :data-swap-fixed="node.id">{{ node.id }}</div>
                </template>
                <template #content="{contentKey, leaf: owner}">
                    <div class="grid-swap-scene__card" :data-swap-group="groupOf(owner)" :data-swap-card="contentKey">
                        <span>{{ owner }}</span>
                        <input :data-swap-input="owner" :aria-label="`${owner} 的输入框`" />
                    </div>
                </template>
            </NestedGrid>
        </div>
    </div>
</template>

<style scoped>
.grid-swap-scene {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 8px;
}

.grid-swap-scene__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}

.grid-swap-scene__grid {
    flex: 1;
    min-height: 480px;
}

/* 颜色写死：e2e 按像素认组，不随主题变。 */
.grid-swap-scene__fixed {
    width: 100%;
    height: 100%;
    background: rgb(225, 225, 225);
}

.grid-swap-scene__card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    padding: 12px;
    color: white;
}

.grid-swap-scene__card[data-swap-group="A"] {
    background: rgb(200, 60, 60);
}

.grid-swap-scene__card[data-swap-group="B"] {
    background: rgb(60, 160, 60);
}

.grid-swap-scene__card[data-swap-group="C"] {
    background: rgb(60, 90, 200);
}

.grid-swap-scene__card[data-swap-group="X"] {
    background: rgb(150, 60, 170);
}

.grid-swap-scene__card[data-swap-group="Y"] {
    background: rgb(200, 140, 40);
}
</style>
