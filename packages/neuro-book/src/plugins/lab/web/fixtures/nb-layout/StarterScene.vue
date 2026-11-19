<script setup lang="ts">
import {shallowRef} from "vue";
import {createGrid} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";

// 1. 建树：左栏保留像素、可以收起，编辑区吸收余量。sashSize 要给正数：缺省是 0，分隔条没有宽度、拖不动。
const grid = shallowRef(createGrid<string>({
    kind: "branch",
    id: "root",
    orientation: "horizontal",
    children: [
        {
            kind: "leaf",
            id: "files",
            ref: "files",
            size: {width: 240, height: 0},
            sizing: "fixed",
            minimumSize: {width: 160, height: 0},
            collapse: {collapsed: false, collapsedSize: 0, restoreSize: 240, collapseThreshold: 24, expandThreshold: 24},
        },
        {kind: "leaf", id: "editor", ref: "editor", size: {width: 600, height: 0}},
    ],
}, {sashSize: 4}));

// 2 到 4. 量容器、算布局、接纳手势提交：都在 useGridHost 里，整包绑到 NestedGrid 上。拖完落账之后存快照。
const saved = shallowRef(grid.value.serialize());
const host = useGridHost({
    grid,
    contextKey: "starter",
    onApplied: () => {
        saved.value = grid.value.serialize();
    },
});

// 5. 结构变了要通知：原地改了树之后调 invalidate()。收起与展开用 host.setCollapsed，它自己重发布局。
function split(): void {
    const result = grid.value.splitLeaf("editor", {branchId: "editor-split", orientation: "vertical", side: "after", ratio: 0.5, leaf: {kind: "leaf", id: "preview", ref: "preview"}});
    if (result.ok) host.invalidate();
}

const filesCollapsed = shallowRef(false);
function toggleFiles(): void {
    const result = host.setCollapsed("files", !filesCollapsed.value);
    if (result.ok) filesCollapsed.value = result.collapse.collapsed;
}
</script>

<template>
    <div style="display: flex; flex-direction: column; gap: 8px; height: 100%">
        <div style="display: flex; gap: 8px">
            <button type="button" data-starter-action="split" @click="split()">拆分编辑区</button>
            <button type="button" data-starter-action="toggle" @click="toggleFiles()">{{ filesCollapsed ? "展开左栏" : "收起左栏" }}</button>
        </div>
        <!-- 承载盒要有确定的高度：NestedGrid 的根铺满它，尺寸由它自己量。 -->
        <div style="flex: 1; min-height: 240px">
            <NestedGrid v-bind="host.bindings.value">
                <template #leaf="{node}">{{ node.id }}</template>
            </NestedGrid>
        </div>
    </div>
</template>
