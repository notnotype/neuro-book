<script setup lang="ts">
/**
 * 分区渲染：一个分支 = 一个 nb-ui Splitter（它提供 sash handle），叶子 = 一个区域。
 * 尺寸夹取与传播归原语；本组件只把 splitter 的尺寸事件换算成像素增量后调 onResize。
 */
import {computed, onMounted, ref} from "vue";
import {Splitter, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import type {GridBranch, GridNode} from "@notnotype/nb-ui/components";
import SpikeBranch from "./SpikeBranch.vue";

const props = defineProps<{
    node: GridBranch<unknown>;
    sizes: Record<string, number>;
    onResize: (id: string, deltaPx: number) => void;
}>();

defineSlots<{
    leaf(props: {leafId: string}): unknown;
}>();

const el = ref<HTMLElement | null>(null);
const lastPercent = ref<number[] | null>(null);

const children = computed<GridNode<unknown>[]>(() => props.node.children);
const total = computed(() => children.value.reduce((sum, child) => sum + (props.sizes[child.id] ?? 0), 0));

function percentage(size: number): number {
    return total.value > 0 ? Math.max(0, Math.min(100, (size / total.value) * 100)) : 0;
}

const panels = computed<SplitterPanelConfig[]>(() => children.value.map((child) => ({
    id: child.id,
    defaultSize: total.value > 0 ? percentage(props.sizes[child.id] ?? 0) : 100 / Math.max(1, children.value.length),
    minSize: child.kind === "leaf" ? percentage(child.minimumSize) : 0,
    maxSize: child.kind === "leaf" ? percentage(child.maximumSize) : 100,
})));

/** 逻辑尺寸变化时重挂 splitter，避免它的内部状态与快照脱节。 */
const splitterKey = computed(() => children.value.map((child) => child.id + ":" + String(Math.round(props.sizes[child.id] ?? 0))).join("|"));

function slotName(id: string): string {
    return "panel-" + id;
}

function onLayout(sizes: number[]) {
    const previous = lastPercent.value;
    lastPercent.value = [...sizes];
    if (!previous || previous.length !== sizes.length) {
        return;
    }
    const extent = props.node.orientation === "horizontal"
        ? (el.value?.clientWidth ?? 0)
        : (el.value?.clientHeight ?? 0);
    if (extent <= 0) {
        return;
    }
    for (const [index, child] of children.value.entries()) {
        const deltaPercent = sizes[index]! - previous[index]!;
        if (Math.abs(deltaPercent) < 0.01) {
            continue;
        }
        props.onResize(child.id, (deltaPercent / 100) * extent);
    }
}

onMounted(() => {
    lastPercent.value = panels.value.map((panel) => panel.defaultSize ?? 0);
});
</script>

<template>
    <div ref="el" class="h-full w-full min-h-0 min-w-0" :data-branch="node.id">
        <Splitter
            :key="splitterKey"
            :direction="node.orientation === 'horizontal' ? 'horizontal' : 'vertical'"
            :panels="panels"
            class="h-full"
            @layout="onLayout"
        >
            <template v-for="child in children" :key="child.id" #[slotName(child.id)]>
                <SpikeBranch
                    v-if="child.kind === 'branch'"
                    :node="child"
                    :sizes="sizes"
                    :on-resize="onResize"
                >
                    <!-- 递归时必须把 leaf 插槽继续往下传：作用域插槽不会自动穿透到子组件 -->
                    <template #leaf="scope">
                        <slot name="leaf" :leafId="scope.leafId"></slot>
                    </template>
                </SpikeBranch>
                <div v-else class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" :data-leaf="child.id">
                    <slot name="leaf" :leafId="child.id"></slot>
                </div>
            </template>
        </Splitter>
    </div>
</template>
