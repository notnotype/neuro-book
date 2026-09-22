<script setup lang="ts">
/**
 * 编辑器工作台外壳：把宿主给的编辑组与布局树渲染成多组标签栏 + 内容区。
 *
 * 受控边界：布局树（nb-ui `Grid`）、组的渲染模型与活动组都由宿主持有，这里不复制第二份权威状态、
 * 不自己保存布局。内容区实测尺寸回报给宿主（`container-extent`）；分栏手势原样转发
 * （`gesture-*` 带 GridGestureCommit / GridGesturePreview），**落账只有一条路**：
 * 宿主通过 `onGestureCommit` 同步接纳返回 `{ok:false, reason}` 就回滚预览并诊断，
 * `gesture-end` 只是已结束的观察事件，不驱动落账。
 */
import {computed, onBeforeUnmount, onMounted, ref, useAttrs} from "vue";
import {GridRenderer} from "@notnotype/nb-ui/layout";
import type {
    GridExtent,
    GridGestureCommit,
    GridGesturePreview,
    GridLayoutResult,
    GridNode,
    GridSashRef,
    SplitterGestureCancelReason,
    SplitterGestureSource,
} from "@notnotype/nb-ui/layout";
import type {MenubarItemData} from "@notnotype/nb-ui/components";
import EditorGroup from "./EditorGroup.vue";
import type {BreadcrumbItem} from "./EditorBreadcrumbs.vue";
import type {EditorGroupState, EditorSplitDirection, EditorTabDropPosition} from "./editor-view.types";
import type {TabTransferPayload, EditorSplitPayload} from "./editor-intents";
import EditorDragProvider from "./EditorDragProvider.vue";

/** 手势开始：按下时冻结的外部事实（会话、工作面、来源、修订与命中的分隔线）。 */
export type EditorWorkbenchGestureStart = Readonly<{
    sessionId: string;
    contextKey: string;
    source: SplitterGestureSource;
    revision: number;
    sashes: readonly GridSashRef[];
}>;

/** 手势取消：Escape、外部事实变化或卸载；没有落账，宿主持有的尺寸保持开始前那份。 */
export type EditorWorkbenchGestureCancel = Readonly<{
    reason: SplitterGestureCancelReason;
    sashes: readonly GridSashRef[];
}>;

export interface EditorWorkbenchProps {
    /** 编辑组；布局树上叶的 id 就是组 id。 */
    groups: readonly EditorGroupState[];
    /** 布局树：单组是一个叶，分屏后是分支。 */
    tree: GridNode<string> | null;
    /** 与 `tree` 同源的呈现；宿主按内容区实测尺寸计算。 */
    layout: GridLayoutResult;
    /** 当前活动组（焦点与命令归属）。 */
    activeGroupId: string;
    /** 是否提供分屏入口（标签菜单与拖拽分屏）；默认关闭，宿主按产品能力打开。 */
    allowSplit?: boolean;
    /** 手势上下文（工作面 / fixture 场景代际）：与 `revision` 一起在有进行中手势时作废手势。 */
    contextKey?: string;
    /** 外部版本：树、约束或容器变化时递增；进行中的手势据此失效。 */
    revision?: number;
    /**
     * 同步接纳一场手势的提交（整批分支变化一次落账）：返回 `{ok:false, reason}` 即回滚预览并诊断。
     * 缺席时这次调整不落账。
     */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
}

const props = withDefaults(defineProps<EditorWorkbenchProps>(), {
    allowSplit: false,
    contextKey: "",
    revision: 0,
});

const emit = defineEmits<{
    (e: "select-tab", groupId: string, path: string): void;
    (e: "close-tab", groupId: string, path: string): void;
    (e: "set-pin", groupId: string, path: string, pinned: boolean): void;
    (e: "keep-tab", groupId: string, path: string): void;
    (e: "move-tab", groupId: string, path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "transfer-tab", payload: TabTransferPayload): void;
    (e: "select-menu", groupId: string, item: MenubarItemData): void;
    (e: "toolbar-action", groupId: string, actionId: string): void;
    (e: "retry", groupId: string): void;
    (e: "open-as-code", groupId: string): void;
    (e: "split-tab", payload: EditorSplitPayload): void;
    (e: "navigate-breadcrumb", groupId: string, item: BreadcrumbItem): void;
    (e: "empty-focus", groupId: string): void;
    (e: "focus-group", groupId: string): void;
    /** 内容区实测尺寸（程序布局，不产生保存意图）；宿主用它计算呈现。 */
    (e: "container-extent", extent: GridExtent): void;
    (e: "gesture-start", info: EditorWorkbenchGestureStart): void;
    /** 手势中的几何预览：布局与树是渲染层正在显示的即时几何，宿主无需参与。 */
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 已结束的手势提交（观察事件）：落账走 `onGestureCommit` 的同步回执。 */
    (e: "gesture-end", commit: GridGestureCommit): void;
    (e: "gesture-cancel", info: EditorWorkbenchGestureCancel): void;
    /** 会话诊断（容量不足、提交被拒绝、宿主没有提供接纳回调）。 */
    (e: "issues", issues: readonly string[]): void;
}>();

defineOptions({inheritAttrs: false});
const attrs = useAttrs();

/** 诊断出口：容量不足、提交被拒绝或宿主合同错误；外壳只转发，不自行处理几何。 */
function forwardIssues(issues: readonly string[]): void {
    emit("issues", issues);
}

const groupsById = computed(() => new Map(props.groups.map((group) => [group.id, group])));

/** 树上出现了还没有内容的叶（宿主正在组装新组）：按空组渲染，不丢整棵布局。 */
function groupOf(id: string): EditorGroupState {
    return groupsById.value.get(id) ?? {id, tabs: [], activePath: ""};
}

const contentEl = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
let reported: GridExtent = {width: -1, height: -1};

/** 只在实测尺寸真的变了时上报：避免挂载与容器抖动反复触发宿主重算。 */
function reportExtent(): void {
    const element = contentEl.value;
    if (!element) {
        return;
    }
    const next = {width: element.clientWidth, height: element.clientHeight};
    if (next.width === reported.width && next.height === reported.height) {
        return;
    }
    reported = next;
    emit("container-extent", next);
}

onMounted(() => {
    reportExtent();
    if (!contentEl.value) {
        return;
    }
    observer = new ResizeObserver(reportExtent);
    observer.observe(contentEl.value);
});

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
});
</script>

<template>
    <section
        v-bind="attrs"
        class="editor-workbench flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--panel-surface)] text-[var(--text-main)]"
    >
    <EditorDragProvider
        :groups="groups"
        :allow-split="allowSplit"
        :context-key="contextKey"
        :revision="revision"
        @move-tab="(groupId, path, targetPath, targetPinned, position) => emit('move-tab', groupId, path, targetPath, targetPinned, position)"
        @transfer-tab="(payload) => emit('transfer-tab', payload)"
        @split-tab="(payload) => emit('split-tab', payload)"
    >
        <div ref="contentEl" class="flex min-h-0 min-w-0 flex-1 flex-col">
            <GridRenderer
                :node="tree"
                :layout="layout"
                :context-key="contextKey"
                :revision="revision"
                :on-gesture-commit="onGestureCommit"
                :on-issues="forwardIssues"
                @gesture-start="(info) => emit('gesture-start', info)"
                @gesture-update="(preview) => emit('gesture-update', preview)"
                @gesture-end="(commit) => emit('gesture-end', commit)"
                @gesture-cancel="(info) => emit('gesture-cancel', info)"
            >
                <template #leaf="{node}">
                    <EditorGroup
                        :group="groupOf(node.id)"
                        class="h-full w-full min-h-0 min-w-0"
                        :active-group="node.id === activeGroupId"
                        :allow-split="allowSplit"
                        @select-tab="(path) => emit('select-tab', node.id, path)"
                        @close-tab="(path) => emit('close-tab', node.id, path)"
                        @set-pin="(path, pinned) => emit('set-pin', node.id, path, pinned)"
                        @keep-tab="(path) => emit('keep-tab', node.id, path)"
                        @move-tab="(path, targetPath, targetPinned, position) => emit('move-tab', node.id, path, targetPath, targetPinned, position)"
                        @select-menu="(item) => emit('select-menu', node.id, item)"
                        @toolbar-action="(actionId) => emit('toolbar-action', node.id, actionId)"
                        @retry="() => emit('retry', node.id)"
                        @open-as-code="() => emit('open-as-code', node.id)"
                        @split-tab="(payload) => emit('split-tab', payload)"
                        @navigate-breadcrumb="(item) => emit('navigate-breadcrumb', node.id, item)"
                        @empty-focus="() => emit('empty-focus', node.id)"
                        @focus-group="() => emit('focus-group', node.id)"
                    >
                        <slot name="content" :group="groupOf(node.id)" :group-id="node.id" :active-path="groupOf(node.id).activePath">
                            <slot :group="groupOf(node.id)" :group-id="node.id" :active-path="groupOf(node.id).activePath" />
                        </slot>
                        <template #empty>
                            <slot name="empty" :group="groupOf(node.id)" :group-id="node.id" />
                        </template>
                        <template #status>
                            <slot name="status" />
                        </template>
                        <template #toolbar-actions>
                            <slot name="toolbar-actions" />
                        </template>
                        <template #breadcrumbs-trailing>
                            <slot name="breadcrumbs-trailing" />
                        </template>
                    </EditorGroup>
                </template>
                <template #empty>
                    <slot name="empty" :group="groupOf(activeGroupId)" :group-id="activeGroupId" />
                </template>
            </GridRenderer>
        </div>
    </EditorDragProvider>
    </section>
</template>
