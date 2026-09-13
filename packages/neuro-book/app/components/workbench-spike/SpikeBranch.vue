<script setup lang="ts">
/**
 * 分区渲染：一个分支 = 一个 nb-ui Splitter（它提供 sash handle），叶子 = 一个区域。
 * 尺寸夹取与传播归原语；本组件只把 splitter 的尺寸事件换算成像素增量后调 onResize。
 */
import {computed, onMounted, ref, watch} from "vue";
import {Splitter, type SplitterPanelConfig} from "@notnotype/nb-ui/components";
import type {GridBranch, GridNode} from "@notnotype/nb-ui/components";
import SpikeBranch from "./SpikeBranch.vue";

const props = withDefaults(defineProps<{
    node: GridBranch<unknown>;
    sizes: Record<string, number>;
    onResize: (id: string, deltaPx: number) => void;
    /** 已收起的叶子：从本分支的 children 里过滤掉（树与快照不变，展开即重新插入）。 */
    collapsed?: string[];
    /** 整棵树被换掉的次数（重置 / 恢复快照）：只有它变时才重挂 splitter 去重新读默认尺寸。 */
    epoch?: number;
}>(), {collapsed: () => [], epoch: 0});

defineSlots<{
    leaf(props: {leafId: string}): unknown;
}>();

const el = ref<HTMLElement | null>(null);
const lastPercent = ref<number[] | null>(null);

const children = computed<GridNode<unknown>[]>(() => props.node.children.filter((child) => !props.collapsed.includes(child.id)));

/**
 * 面板配置**只在挂载 / 重挂时算一次**：
 * reka 会 watch 每个 panel 的 min/max 约束，中途改它等于把 reka 的内部布局也拽着改，
 * 于是「它派发 layout → 我们改 grid → 我们又算新的 min/max → 它再派发」形成递归更新。
 * 拖拽期间的尺寸真相在 reka 手里，我们只在事件里收增量。
 */
function buildPanels(): SplitterPanelConfig[] {
    const sum = children.value.reduce((total, child) => total + (props.sizes[child.id] ?? 0), 0);
    const percent = (size: number) => (sum > 0 ? Math.max(0, Math.min(100, (size / sum) * 100)) : 0);
    return children.value.map((child) => ({
        id: child.id,
        defaultSize: sum > 0 ? percent(props.sizes[child.id] ?? 0) : 100 / Math.max(1, children.value.length),
        minSize: child.kind === "leaf" ? percent(child.minimumSize) : 0,
        maxSize: child.kind === "leaf" ? percent(child.maximumSize) : 100,
    }));
}

const panels = ref<SplitterPanelConfig[]>(buildPanels());

/**
 * splitter 的重挂只在「子节点集合变了」或「整棵树换了」时发生：
 * 拖动期间尺寸每帧都在变，若跟着重挂就会把 reka 正在进行的拖拽会话打断（手柄一松就没了）。
 */
const splitterKey = computed(() => [props.epoch, ...children.value.map((child) => child.id)].join("|"));

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

/**
 * 重挂时同步两件事：面板配置重新读一次当前逻辑尺寸；reka 随后报的第一次尺寸只作基线（不当成用户拖动）。
 */
function resyncSplitter() {
    panels.value = buildPanels();
    lastPercent.value = null;
}

watch(splitterKey, resyncSplitter);

onMounted(resyncSplitter);
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
                    :collapsed="collapsed"
                    :epoch="epoch"
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

<style scoped>
/*
 * sash：细线负责「看得见」，命中区负责「拖得动」。
 * 视觉细线仍是 1px（--border-w），但 handle 本体占 8px；悬停/拖动时细线加宽到 4px。
 * 选择器只作用于本分支的 splitter handle（reka 的 SplitterResizeHandle 带 role="separator" 与 data-orientation）。
 */
:deep([role="separator"]) {
    position: relative;
    min-width: 8px;
    min-height: 8px;
    background: transparent;
}

:deep([role="separator"])::before {
    content: "";
    position: absolute;
    inset: 0;
    margin: auto;
    background: var(--divider);
}

:deep([role="separator"][data-orientation="horizontal"]) {
    cursor: col-resize;
}

:deep([role="separator"][data-orientation="vertical"]) {
    cursor: row-resize;
}

:deep([role="separator"][data-orientation="horizontal"])::before {
    width: var(--border-w);
    height: 100%;
}

:deep([role="separator"][data-orientation="vertical"])::before {
    height: var(--border-w);
    width: 100%;
}

/* 拖动中 reka 会写 data-state="drag"（指针可能已离开 handle，所以不能只靠 :active） */
:deep([role="separator"][data-orientation="horizontal"]:hover)::before,
:deep([role="separator"][data-orientation="horizontal"][data-state="drag"])::before {
    width: 4px;
    background: var(--bg-hover);
}

:deep([role="separator"][data-orientation="vertical"]:hover)::before,
:deep([role="separator"][data-orientation="vertical"][data-state="drag"])::before {
    height: 4px;
    background: var(--bg-hover);
}
</style>
