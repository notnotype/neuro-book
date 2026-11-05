<script setup lang="ts">
/**
 * 私有递归渲染：一个分支一个 `Splitter`，叶交给 `leaf` 插槽。
 *
 * 它不建自己的手势 scope——整棵 Grid 共享最外层 `NestedGrid` 的那一份，所以交汇处
 * 两根轴属于同一场会话。几何全部来自传入的 `layout`（手势期间是预览布局），
 * 面板盒就是布局 px，不需要「祖先拖动时按百分比跟随」的旁路。
 */
import {computed} from "vue";
import Splitter from "./Splitter.vue";
import {buildGridBranchPanels, gridBranchSizesPx} from "./grid-splitter";
import type {GridAxis, GridBranch, GridLeaf, GridLayoutResult, GridNode} from "../grid-types";

defineOptions({name: "GridBranchRenderer"});

/** 分支四边挨着的外层分隔线键（`<branchId>:<index>`）；挨着网格外缘时为 null。 */
type BranchEdges = {top: string | null; right: string | null; bottom: string | null; left: string | null};

const props = withDefaults(defineProps<{
    node: GridNode<unknown>;
    layout: GridLayoutResult;
    disabled: boolean;
    edges?: BranchEdges;
}>(), {edges: () => ({top: null, right: null, bottom: null, left: null})});

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

/**
 * 子节点的四边：沿本分支主轴，第一个以后的子节点前边挨着本分支的分隔线、最后一个以前的后边也是，其余边沿用本分支的。
 * 本分支自己的分隔线横穿交叉轴，两端就是本分支交叉轴上的两条边：悬停线据此判断一端是连着外层的线还是自由端。
 *
 * 0px 的边界没有线、也不会亮：它和它那一侧的兄弟都是 0 时，子节点这条边其实就是本分支的边，沿用外层的；那一侧的
 * 兄弟有尺寸时，挨着的是兄弟的内容，这一端是自由端。
 */
function childEdges(index: number): BranchEdges {
    const id = branch.value?.id;
    const sashes = id === undefined ? [] : props.layout.sashSizes[id] ?? [];
    const main = (child: GridNode<unknown>): number => {
        const size = props.layout.sizes[child.id];
        return size === undefined ? 0 : axis.value === "width" ? size.width : size.height;
    };
    const edge = (sash: number, siblings: GridNode<unknown>[], outer: string | null): string | null => {
        if ((sashes[sash] ?? 0) > 0) return `${id}:${sash}`;
        return siblings.every((sibling) => main(sibling) <= 0) ? outer : null;
    };
    const outerBefore = axis.value === "width" ? props.edges.left : props.edges.top;
    const outerAfter = axis.value === "width" ? props.edges.right : props.edges.bottom;
    const before = id !== undefined && index > 0 ? edge(index - 1, children.value.slice(0, index), outerBefore) : outerBefore;
    const after = id !== undefined && index < children.value.length - 1 ? edge(index, children.value.slice(index + 1), outerAfter) : outerAfter;
    return axis.value === "width" ? {...props.edges, left: before, right: after} : {...props.edges, top: before, bottom: after};
}

const sashLineEnds = computed(() => axis.value === "width"
    ? {start: props.edges.top, end: props.edges.bottom}
    : {start: props.edges.left, end: props.edges.right});
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
        :sash-line-ends="sashLineEnds"
    >
        <template v-for="(child, index) in children" :key="child.id" #[slotName(child.id)]>
            <GridBranchRenderer v-if="child.kind === 'branch'" :node="child" :layout="layout" :disabled="disabled" :edges="childEdges(index)">
                <!-- 递归时把 leaf 插槽继续往下传：作用域插槽不会自动穿透到子组件 -->
                <template #leaf="scope">
                    <slot name="leaf" :node="scope.node"></slot>
                </template>
            </GridBranchRenderer>
            <div v-else class="nb-grid-leaf" :data-leaf="child.id">
                <slot name="leaf" :node="child"></slot>
            </div>
        </template>
    </Splitter>
    <div v-else-if="leafNode" class="nb-grid-leaf" :data-leaf="leafNode.id">
        <slot name="leaf" :node="leafNode"></slot>
    </div>
    <slot v-else name="empty"></slot>
</template>

<style scoped>
.nb-grid-leaf {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
</style>
