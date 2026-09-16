<script setup lang="ts">
/**
 * 分区渲染：一个分支对应一个 nb-ui `Splitter`，叶子对应内容区域。
 * 当前容器的尺寸、约束与 sash 来自 grid `layout(container)`；树上的 `size` 只表示可持久化意图，不能直接渲染。
 * `layout` 事件只是 Reka 的呈现事实；`gesture-*` 是本组件向上转发的用户意图，保存由下游（宿主 / 记录会话）收口。
 */
import {computed, ref, watch} from "vue";
import {Splitter, axisOf, type GridAxis, type GridBranch, type GridLayoutResult, type GridNode, type SplitterGestureState, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import {buildWorkbenchBranchPanels} from "nbook/app/components/workbench/workbench-branch-layout";

const props = withDefaults(defineProps<{
    node: GridBranch<unknown>;
    layout: GridLayoutResult;
    /**
     * 手势开始：宿主捕获基线。
     *
     * 传递的是 Splitter 的原始手势状态（百分比 + `active`），不是转换后的 px：
     * 宿主与持久化记录都对「哪些面板被主动改变」有各自的口径，转换只做一次、且只在下游做。
     */
    onGestureStart: (branchId: string, state: SplitterGestureState) => void;
    /** 手势正常结束且尺寸确实变了：这是唯一需要保存的最终意图。 */
    onGestureEnd: (branchId: string, state: SplitterGestureState) => void;
    /** 手势被放弃或没有变化：不产生保存意图。 */
    onGestureCancel: (branchId: string) => void;
    /** 已隐藏的叶子：从本分支的 children 里过滤掉（树与尺寸模型不变，展开即重新插入）。 */
    hidden?: string[];
    /** 整棵树被换掉的次数；只有它变时才重挂 splitter。 */
    epoch?: number;
}>(), {hidden: () => [], epoch: 0});

defineSlots<{
    leaf(props: {leafId: string}): unknown;
}>();


/** 本分支的分配轴：子节点只有这根轴上的意图参与比例。 */
const mainAxis = computed<GridAxis>(() => axisOf(props.node.orientation));

/** 子项全部触顶时原语会保留留白；百分比面板的容器必须采用同一份实际宽高。 */
const branchStyle = computed(() => {
    const size = props.layout.sizes[props.node.id];
    return {width: `${size?.width ?? 0}px`, height: `${size?.height ?? 0}px`, flexShrink: 0};
});

const children = computed<GridNode<unknown>[]>(() => props.node.children.filter((child) => !props.hidden.includes(child.id)));

/** 面板配置只读原语在当前容器算出的呈现与有效交互约束。 */
function buildPanels(): SplitterPanelConfig[] {
    return buildWorkbenchBranchPanels(children.value, props.layout, mainAxis.value);
}

const panels = ref<SplitterPanelConfig[]>(buildPanels());
const sashSizes = computed(() => {
    const all = props.layout.sashSizes[props.node.id] ?? [];
    const visible = props.node.children
        .map((child, index) => ({child, index}))
        .filter(({child}) => !props.hidden.includes(child.id));
    return visible.slice(0, -1).map(({index}) => all[index] ?? 0);
});

/**
 * splitter 的重挂只在「子节点集合变了」或「整棵树换了」时发生：
 * 拖动期间尺寸每帧都在变，若跟着重挂就会把 reka 正在进行的拖拽会话打断（手柄一松就没了）。
 */
const splitterKey = computed(() => [props.epoch, ...children.value.map((child) => child.id)].join("|"));

function slotName(id: string): string {
    return "panel-" + id;
}


/** 一次 gesture 由下游（宿主 / 记录会话）结算；本组件只转发原始状态。 */
function onGestureStart(state: SplitterGestureState): void {
    props.onGestureStart(props.node.id, state);
}

function onGestureEnd(state: SplitterGestureState): void {
    props.onGestureEnd(props.node.id, state);
}

function onGestureCancel(): void {
    props.onGestureCancel(props.node.id);
}

/** 重挂或容器布局变化时重新读取当前呈现。 */
function resyncSplitter(): void {
    panels.value = buildPanels();
}

watch(splitterKey, resyncSplitter);
watch(() => props.layout, resyncSplitter);
</script>

<template>
    <div class="min-h-0 min-w-0" :style="branchStyle" :data-branch="node.id">
        <Splitter
            :key="splitterKey"
            :direction="node.orientation === 'horizontal' ? 'horizontal' : 'vertical'"
            :panels="panels"
            :sash-sizes="sashSizes"
            class="h-full"
            @gesture-start="onGestureStart"
            @gesture-end="onGestureEnd"
            @gesture-cancel="onGestureCancel"
        >
            <template v-for="child in children" :key="child.id" #[slotName(child.id)]>
                <WorkbenchBranch
                    v-if="child.kind === 'branch'"
                    :node="child"
                    :layout="layout"
                    :on-gesture-start="props.onGestureStart"
                    :on-gesture-end="props.onGestureEnd"
                    :on-gesture-cancel="props.onGestureCancel"
                    :hidden="hidden"
                    :epoch="epoch"
                >
                    <!-- 递归时必须把 leaf 插槽继续往下传：作用域插槽不会自动穿透到子组件 -->
                    <template #leaf="scope">
                        <slot name="leaf" :leafId="scope.leafId"></slot>
                    </template>
                </WorkbenchBranch>
                <div v-else class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" :data-leaf="child.id">
                    <slot name="leaf" :leafId="child.id"></slot>
                </div>
            </template>
        </Splitter>
    </div>
</template>
