<script setup lang="ts">
import {computed, shallowRef} from "vue";
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
            collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24},
        },
        {kind: "leaf", id: "editor", ref: "editor", size: {width: 600, height: 0}},
    ],
}, {sashSize: 4}));

// 快照只存结构与尺寸；保留像素、最小尺寸、收起策略不在里面，恢复时由解析函数按 ref 再给（见“约定”）。
const saved = shallowRef(grid.value.serialize());
function save(): void {
    saved.value = grid.value.serialize();
}

// 2 到 4. 量容器、算布局、接纳手势提交：都在 useGridHost 里，整包绑到 NestedGrid 上。
// contextKey 标出这是哪一块布局：换了它，进行中的旧手势就不落账。
const host = useGridHost({
    grid,
    contextKey: "starter",
    onApplied: save,
    // 诊断的唯一出口：放不下、被拒的提交都从这里交出。不给时库不打印，开发检查只警告一次“没有出口”。
    onIssues: (issues) => console.warn("nb-layout issues", issues),
});

// 5. 结构变了要通知：原地改了树之后调 invalidate()。收起与展开用 host.setCollapsed，它自己重发布局。
function split(): void {
    const result = grid.value.splitLeaf("editor", {branchId: "editor-split", orientation: "vertical", side: "after", ratio: 0.5, leaf: {kind: "leaf", id: "preview", ref: "preview"}});
    if (!result.ok) return;
    host.invalidate();
    save();
}

// 收起状态从网格读：拖过最小尺寸也会收起，按钮要跟着它。每次重发布局版本都会变，读它就会跟着重算。
const filesCollapsed = computed(() => {
    void host.revision.value;
    return grid.value.find("files")?.collapse?.collapsed === true;
});
function toggleFiles(): void {
    host.setCollapsed("files", !filesCollapsed.value);
}
</script>

<template>
    <!-- 承载盒要有确定的高度：NestedGrid 的根铺满它，尺寸由它自己量。这里直接给外层一个高度。 -->
    <div style="display: flex; flex-direction: column; gap: 8px; height: 480px">
        <div style="display: flex; gap: 8px">
            <button type="button" data-starter-action="split" @click="split()">拆分编辑区</button>
            <button type="button" data-starter-action="toggle" @click="toggleFiles()">{{ filesCollapsed ? "展开左栏" : "收起左栏" }}</button>
        </div>
        <div style="flex: 1; min-height: 0">
            <NestedGrid v-bind="host.bindings.value">
                <template #leaf="{node}">{{ node.id }}</template>
            </NestedGrid>
        </div>
    </div>
</template>
