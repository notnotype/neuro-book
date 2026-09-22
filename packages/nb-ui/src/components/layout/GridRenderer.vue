<script setup lang="ts">
/**
 * 一个公开 Grid：树与几何由宿主给出（`node` + 同一容器下的 `layout`），手势由本组件独占一份会话。
 *
 * - 递归渲染交给私有 `GridBranchRenderer`，只有本组件持有 `useSashGesture` scope，
 *   因此一次按下命中的**最多两根轴**（一根 width + 一根 height）属于同一场手势、只提交一次；
 *   叶槽里再嵌一个公开 `GridRenderer` 会得到自己的 scope，不会继承外层拖动成员。
 * - 手势期间发布预览布局给整棵子树（编辑器等内容随父盒实时变化），松手时才把冻结的
 *   `GridGestureCommit` 交给宿主的 `onGestureCommit`；宿主拒绝就地回滚并给出诊断。
 * - 这里没有百分比往返、不读存储、不写意图：几何算法全在 `grid-geometry` / `sash-drag`。
 */
import {computed, nextTick, onBeforeUnmount, provide, ref, shallowRef, useId, watch} from "vue";
import GridBranchRenderer from "./GridBranchRenderer.vue";
import {createGridGestureSession, type GridBranchChange, type GridGestureCommit, type GridGesturePreview} from "./grid-gesture";
import {SASH_GESTURE_SCOPE_KEY} from "./sash-scope";
import {useLayoutExtent} from "../../composables/useLayoutExtent";
import {useSashGesture} from "../../composables/useSashGesture";
import type {GridExtent, GridLayoutResult, GridLeaf, GridNode} from "./grid-types";
import type {GridBranchChange as GridBranchChangeType} from "./grid-gesture";
import type {GridSashRef, SashGestureBinding, SashGestureHost} from "./sash-gesture";
import type {SplitterGestureCancelReason, SplitterGestureSource} from "./splitter-gesture";

defineOptions({name: "GridRenderer"});

const props = withDefaults(defineProps<{
    /** 当前树上这一层：分支递归渲染、叶交给插槽、`null` 交给 `empty` 插槽。 */
    node: GridNode<unknown> | null;
    /** 与 `node` 同源的呈现结果；约束按「能够承载的语法」直接消费，不再夹取。 */
    layout: GridLayoutResult;
    disabled?: boolean;
    /** 副作用上下文（工作面 / 布局键）：与 `revision` 一起构成手势开始时冻结的外部事实。 */
    contextKey?: string;
    /** 外部版本：树、约束或容器尺寸变化时递增；进行中的手势据此失效。 */
    revision?: number;
    /** 同步接纳一次手势提交：`{ok:false}` 时本组件回滚预览并给出诊断。 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
    /** 会话诊断出口（容量不足、提交被拒绝等）。 */
    onIssues?: (issues: readonly string[]) => void;
}>(), {
    disabled: false,
    contextKey: "",
    revision: 0,
    onGestureCommit: undefined,
    onIssues: undefined,
});

const emit = defineEmits<{
    (e: "gesture-start", info: {sessionId: string; contextKey: string; source: SplitterGestureSource; revision: number; sashes: readonly GridSashRef[]}): void;
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    (e: "gesture-end", commit: GridGestureCommit): void;
    (e: "gesture-cancel", info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
    (e: "issues", issues: readonly string[]): void;
}>();

defineSlots<{
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    empty(): unknown;
}>();

const instanceId = useId();
const rootEl = ref<HTMLElement | null>(null);
const preview = shallowRef<GridGesturePreview<unknown> | null>(null);
/** 会话根盒来自共享的布局盒测量：未挂载是 `null`，与「真实零尺寸」区分。 */
const measuredExtent = useLayoutExtent(rootEl);
let sessionCounter = 0;

/** 手势期间渲染预览；提交被拒绝、取消或宿主发布新布局后回到受控事实。 */
const renderTree = computed(() => preview.value?.tree ?? props.node);
const renderLayout = computed(() => preview.value?.layout ?? props.layout);

/**
 * 会话的根盒：优先用本组件实测盒（宿主正是按这个盒算布局），拿不到测量时退回布局发布的根节点尺寸。
 * 两者都拿不到（未挂载 / 无布局）时不开始手势。
 */
function sessionExtent(): GridExtent | null {
    if (measuredExtent.value !== null) {
        return measuredExtent.value;
    }
    const root = renderTree.value;
    if (root === null) {
        return null;
    }
    const size = renderLayout.value.sizes[root.id];
    if (size === undefined) {
        return null;
    }
    return {width: size.width, height: size.height};
}

/** 预览重投影沿用本次呈现的真实 sash 占用（含宿主按容器压缩的结果）。 */
function sashResolver(): (branchId: string, sashIndex: number) => number {
    return (branchId, sashIndex) => Math.max(0, renderLayout.value.sashSizes[branchId]?.[sashIndex] ?? 0);
}

/** 宿主发布的新布局是否已经反映本次提交（只核对真正改变的叶）。 */
function publishedMatches(previewLayout: GridLayoutResult, published: GridLayoutResult, changes: readonly GridBranchChangeType[]): boolean {
    for (const change of changes) {
        for (const id of [...change.active, ...change.compensated]) {
            const before = previewLayout.sizes[id];
            const after = published.sizes[id];
            if (before === undefined || after === undefined) {
                continue;
            }
            if (Math.abs(before.width - after.width) > 1 || Math.abs(before.height - after.height) > 1) {
                return false;
            }
        }
    }
    return true;
}

function onPreview(next: GridGesturePreview<unknown> | null): void {
    if (next === null) {
        preview.value = null;
        return;
    }
    preview.value = next;
    emit("gesture-update", next);
}

const host: SashGestureHost<GridGesturePreview<unknown>, GridBranchChange> = {
    begin(input) {
        const root = renderTree.value;
        const extent = sessionExtent();
        if (root === null || extent === null) {
            return null;
        }
        sessionCounter += 1;
        const sessionId = `${instanceId}-${sessionCounter}`;
        const session = createGridGestureSession<unknown>({
            sessionId,
            contextKey: props.contextKey,
            source: input.source,
            revision: props.revision,
            root,
            extent,
            layout: renderLayout.value,
            sashSize: sashResolver(),
            sashes: input.sashes,
        });
        emit("gesture-start", {sessionId, contextKey: props.contextKey, source: input.source, revision: props.revision, sashes: session.sashes});
        return {
            session,
            onPreview,
            onCommit(commit) {
                emit("gesture-end", commit);
                const outcome = props.onGestureCommit?.(commit);
                if (outcome === undefined) {
                    preview.value = null;
                    emit("issues", ["宿主没有提供 onGestureCommit，本次调整没有落账"]);
                    return {ok: false, reason: "宿主没有提供 onGestureCommit"};
                }
                if (!outcome.ok) {
                    preview.value = null;
                    return outcome;
                }
                /**
                 * 接纳成功：保持最后一帧预览，等宿主把匹配布局发布出来再释放（避免闪回旧尺寸）。
                 * 一个 tick 之后仍没有匹配发布就按宿主机合同错误处理：释放预览并给出诊断。
                 */
                const held = preview.value;
                if (held !== null) {
                    void nextTick(() => {
                        if (preview.value === held && !publishedMatches(held.layout, props.layout, commit.changes)) {
                            preview.value = null;
                            emit("issues", ["宿主接纳了这次调整但没有发布匹配布局，已回到原布局"]);
                        }
                    });
                }
                return outcome;
            },
            onCancel(info) {
                emit("gesture-cancel", info);
            },
        } satisfies SashGestureBinding<GridGesturePreview<unknown>, GridBranchChange>;
    },
};

const scope = useSashGesture<GridGesturePreview<unknown>, GridBranchChange>({
    host: () => host,
    root: rootEl,
    disabled: () => props.disabled,
});
provide(SASH_GESTURE_SCOPE_KEY, scope);

watch(() => scope.issues, (issues) => {
    if (issues.length > 0) {
        emit("issues", issues);
        props.onIssues?.(issues);
    }
});

/** 外部事实变化（上下文、版本、结构、禁用）取消进行中的手势：不沿旧基线写新上下文。 */
watch([() => props.contextKey, () => props.revision, () => props.disabled, () => props.node], () => {
    scope.invalidate();
});

/** 宿主发布新布局即视为几何事实已更新，释放最后一帧预览（避免重复渲染到下一 tick 之后）。 */
watch(() => props.layout, () => {
    if (preview.value !== null) {
        preview.value = null;
    }
});

onBeforeUnmount(() => {
    scope.dispose();
});
</script>

<template>
    <div ref="rootEl" class="min-h-0 min-w-0 h-full w-full" :data-grid-scope="instanceId">
        <GridBranchRenderer
            v-if="node"
            :node="renderTree ?? node"
            :layout="renderLayout"
            :disabled="disabled"
        >
            <template #leaf="leafScope">
                <slot name="leaf" :node="leafScope.node"></slot>
            </template>
            <template #empty>
                <slot name="empty"></slot>
            </template>
        </GridBranchRenderer>
        <slot v-else name="empty"></slot>
    </div>
</template>
