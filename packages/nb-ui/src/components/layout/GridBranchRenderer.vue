<script setup lang="ts">
/**
 * 私有递归渲染：一个分支一个 `Splitter`，叶交给 `leaf` 插槽。
 *
 * 它不建自己的手势 scope——整棵 Grid 共享最外层 `GridRenderer` 的那一份，所以交汇处
 * 两根轴属于同一场会话。几何全部来自传入的 `layout`（手势期间是预览布局），
 * 面板盒就是布局 px，不需要「祖先拖动时按百分比跟随」的旁路。
 */
import {computed} from "vue";
import Splitter from "./Splitter.vue";
import {buildGridBranchPanels, gridBranchSizesPx} from "./grid-splitter";
import type {GridAxis, GridBranch, GridLeaf, GridLayoutResult, GridNode} from "./grid-types";

defineOptions({name: "GridBranchRenderer"});

const props = defineProps<{
    node: GridNode<unknown>;
    layout: GridLayoutResult;
    disabled: boolean;
}>();

defineSlots<{
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    empty(): unknown;
}>();

const branch = computed<GridBranch<unknown> | null>(() => props.node.kind === "branch" ? props.node : null);
const leafNode = computed<GridLeaf<unknown> | null>(() => props.node.kind === "leaf" ? props.node : null);
const children = computed<GridNode<unknown>[]>(() => branch.value?.children ?? []);
const axis = computed<GridAxis>(() => branch.value?.orientation === "vertical" ? "height" : "width");
const panels = computed(() => buildGridBranchPanels(children.value, props.layout, axis.value));
const sizesPx = computed(() => gridBranchSizesPx(children.value, props.layout, axis.value));
const sashSizes = computed(() => {
    const id = branch.value?.id;
    return id === undefined ? [] : props.layout.sashSizes[id] ?? [];
});

function slotName(id: string): string {
    return "panel-" + id;
}
</script>

<template>
    <Splitter
        v-if="branch"
        :branch-id="branch.id"
        :direction="branch.orientation === 'horizontal' ? 'horizontal' : 'vertical'"
        :panels="panels"
        :sash-sizes="sashSizes"
        :sizes-px="sizesPx"
        :disabled="disabled"
        class="h-full w-full"
    >
        <template v-for="child in children" :key="child.id" #[slotName(child.id)]>
            <GridBranchRenderer v-if="child.kind === 'branch'" :node="child" :layout="layout" :disabled="disabled">
                <!-- 递归时把 leaf 插槽继续往下传：作用域插槽不会自动穿透到子组件 -->
                <template #leaf="scope">
                    <slot name="leaf" :node="scope.node"></slot>
                </template>
            </GridBranchRenderer>
            <div v-else class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" :data-leaf="child.id">
                <slot name="leaf" :node="child"></slot>
            </div>
        </template>
    </Splitter>
    <div v-else-if="leafNode" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" :data-leaf="leafNode.id">
        <slot name="leaf" :node="leafNode"></slot>
    </div>
    <slot v-else name="empty"></slot>
</template>
