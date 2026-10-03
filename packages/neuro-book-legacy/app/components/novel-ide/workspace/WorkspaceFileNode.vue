<script setup lang="ts">
import {
    getWorkspaceFileIcon,
    resolveWorkspaceNodeRepresentedPath,
    type WorkspaceTreeNode,
    workspaceFileTreeContextKey,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const props = withDefaults(defineProps<{
    node: WorkspaceTreeNode;
    depth: number;
    indent: number;
}>(), {
    depth: 0,
    indent: 18,
});

const treeContext = inject(workspaceFileTreeContextKey);
if (!treeContext) {
    throw new Error("WorkspaceFileNode must be used inside WorkspaceFileTree");
}
const isBranch = computed(() => props.node.isDirectory && props.node.children.length > 0);
const isForcedOpen = computed(() => treeContext.forcedExpandedPathSet.value.has(props.node.path));
const isOpen = computed(() => props.node.isDirectory && (isForcedOpen.value || treeContext.expandedPathSet.value.has(props.node.path)));
const representedPath = computed(() => treeContext.mode.value === "content" ? resolveWorkspaceNodeRepresentedPath(props.node) : props.node.path);
const isSelected = computed(() => treeContext.selectedPaths.value.includes(props.node.path) || treeContext.selectedPath.value === representedPath.value);
const isDragging = computed(() => treeContext.draggedPath.value === props.node.path);
const isDropTarget = computed(() => treeContext.dropState.value.targetPath === props.node.path);
const dropVisualKind = computed(() => treeContext.dropState.value.visualKind);
const isInsideNodeDropTarget = computed(() => isDropTarget.value && dropVisualKind.value === "inside-node");
const iconClass = computed(() => getWorkspaceFileIcon(props.node, isOpen.value));
const nodeName = computed(() => basename(props.node.path));
const nodeTitle = computed(() => treeContext.mode.value === "ordinary" ? nodeName.value : props.node.title || nodeName.value || props.node.path);
const canOpen = computed(() => !props.node.isDirectory || (treeContext.mode.value === "content" && props.node.contentNode));
const rowTitle = computed(() => `${nodeTitle.value} · ${props.node.path}`);
let selectTimer: number | null = null;

/**
 * 清理单击延迟，避免双击时预览打开和常驻打开并发。
 */
const clearSelectTimer = (): void => {
    if (selectTimer === null) {
        return;
    }
    window.clearTimeout(selectTimer);
    selectTimer = null;
};

/**
 * 延迟选中当前文件节点，让双击可以取消预览打开。
 */
const scheduleSelectNode = (event: MouseEvent): void => {
    clearSelectTimer();
    treeContext.selectNode(props.node, event, false);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
    }
    if (!canOpen.value) {
        if (treeContext.mode.value === "ordinary") treeContext.toggleExpanded(props.node);
        return;
    }
    selectTimer = window.setTimeout(() => {
        treeContext.previewNode(props.node);
        selectTimer = null;
    }, 180);
};

const handleSpace = (event: KeyboardEvent): void => {
    treeContext.selectNode(props.node, event, false);
};

/**
 * 双击保留当前节点标签。
 */
const openNode = (): void => {
    clearSelectTimer();
    if (canOpen.value) treeContext.openNode(props.node);
};

/**
 * 切换当前目录展开状态。
 */
const toggleExpanded = (): void => {
    treeContext.toggleExpanded(props.node);
};

/**
 * 子树收起前固定高度。
 */
const handleBeforeLeave = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.height = `${htmlElement.offsetHeight}px`;
    htmlElement.style.opacity = "1";
};

/**
 * 子树收起动画。
 */
const handleLeave = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.offsetHeight;
    htmlElement.style.height = "0px";
    htmlElement.style.opacity = "0";
};

/**
 * 清理子树收起动画样式。
 */
const handleAfterLeave = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.height = "";
    htmlElement.style.opacity = "";
};

/**
 * 子树展开前设置起点。
 */
const handleBeforeEnter = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.height = "0px";
    htmlElement.style.opacity = "0";
};

/**
 * 子树展开动画。
 */
const handleEnter = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.offsetHeight;
    htmlElement.style.height = `${htmlElement.scrollHeight}px`;
    htmlElement.style.opacity = "1";
};

/**
 * 清理子树展开动画样式。
 */
const handleAfterEnter = (element: Element): void => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.height = "auto";
    htmlElement.style.opacity = "";
};

/**
 * 返回路径最后一段名称。
 */
function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}


onUnmounted(() => {
    clearSelectTimer();
});
</script>

<template>
    <div data-role="workspace-file-node" @dragover.stop>
        <!-- 工作区文件树节点 -->
        <div
            class="group relative flex items-center gap-1 rounded-md py-1 pr-2 text-left transition-colors duration-150"
            :class="[
                isDropTarget ? 'z-10' : '',
                isInsideNodeDropTarget ? 'bg-[var(--accent-bg)] ring-1 ring-[var(--accent-main)]/50 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]' : '',
                isSelected ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]',
                isDragging ? 'opacity-45' : '',
                !node.editable && !node.isDirectory ? 'opacity-70' : ''
            ]"
            :style="{paddingLeft: `${props.depth * props.indent + 4}px`}"
            :data-path="node.path"
            :data-directory="node.isDirectory ? 'true' : 'false'"
            data-role="workspace-file-row"
            role="treeitem"
            tabindex="0"
            draggable="true"
            :aria-selected="isSelected"
            :aria-expanded="node.isDirectory ? isOpen : undefined"
            @click="scheduleSelectNode"
            @dblclick.stop="openNode"
            @keydown.enter.stop.prevent="canOpen ? openNode() : toggleExpanded()"
            @keydown.space.stop.prevent="handleSpace"
            @keydown.right.stop.prevent="node.isDirectory && !isOpen && toggleExpanded()"
            @keydown.left.stop.prevent="node.isDirectory && isOpen && toggleExpanded()"
            @dragstart.stop="treeContext.startDrag(node, $event)"
            @dragover.stop="treeContext.updateDropState(node, $event)"
            @drop.stop="treeContext.commitDrop"
            @dragend.stop="treeContext.clearDragState"
            @contextmenu.prevent.stop="treeContext.emitNodeContextMenu(node, $event)"
        >
            <div
                v-if="isDropTarget && dropVisualKind === 'before-line'"
                class="pointer-events-none absolute left-0 right-0 top-[-1px] z-10 h-[2px] rounded-full bg-[var(--accent-main)]"
            ></div>
            <div
                v-if="isDropTarget && dropVisualKind === 'after-line'"
                class="pointer-events-none absolute bottom-[-1px] left-0 right-0 z-10 h-[2px] rounded-full bg-[var(--accent-main)]"
            ></div>
            <div
                v-if="isDropTarget && dropVisualKind === 'inside-start'"
                class="pointer-events-none absolute bottom-[-1px] left-0 right-0 z-10 h-[2px] rounded-full bg-[var(--accent-main)]"
            ></div>
            <div
                v-if="isInsideNodeDropTarget"
                class="pointer-events-none absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent-main)]"
            ></div>

            <button
                type="button"
                class="flex h-4 w-4 shrink-0 items-center justify-center opacity-50 transition-all hover:opacity-100"
                :class="isBranch ? '' : 'invisible'"
                :aria-label="isOpen ? '收起目录' : '展开目录'"
                @click.stop="toggleExpanded"
            >
                <span :class="isOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5"></span>
            </button>

            <span class="flex h-4 w-4 shrink-0 items-center justify-center opacity-80 group-hover:opacity-100">
                <span :class="iconClass" class="h-3.5 w-3.5"></span>
            </span>

            <div class="min-w-0 flex flex-1 items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate pr-0.5 text-[13px] transition-colors">
                    {{ nodeTitle }}
                </span>
                <span v-if="treeContext.mode.value === 'content' && nodeTitle !== nodeName" class="max-w-[84px] shrink-0 truncate text-right text-[10px] opacity-60">
                    {{ nodeName }}
                </span>
                <span v-if="treeContext.mode.value === 'content' && node.status" class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full" :class="node.status === 'active' ? 'bg-[var(--status-success)]' : node.status === 'pending' ? 'bg-[var(--status-info)]' : node.status === 'draft' ? 'bg-[var(--status-warning)]' : 'bg-[var(--text-muted)]'" :title="node.status"></span>
            </div>
        </div>

        <!-- 子节点容器 -->
        <transition
            name="expand"
            @before-enter="handleBeforeEnter"
            @enter="handleEnter"
            @after-enter="handleAfterEnter"
            @before-leave="handleBeforeLeave"
            @leave="handleLeave"
            @after-leave="handleAfterLeave"
        >
            <div v-if="isOpen" class="relative -my-px overflow-hidden py-px">
                <WorkspaceFileNode
                    v-for="child in node.children"
                    :key="child.path"
                    :node="child"
                    :depth="depth + 1"
                    :indent="indent"
                />

                <div v-if="node.children.length > 0" class="relative h-0 w-full">
                    <div
                        class="absolute left-0 right-0 top-[-3px] h-[6px]"
                        @dragover.stop="treeContext.updateTailDropState(node, $event)"
                        @drop.stop="treeContext.commitDrop"
                    ></div>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.expand-enter-active,
.expand-leave-active {
    transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: height, opacity;
}
</style>
