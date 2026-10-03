<script setup lang="ts">
import WorkspaceFileNode from "nbook/app/components/novel-ide/workspace/WorkspaceFileNode.vue";
import type {WorkspaceFileNode as WorkspaceFileNodeDto} from "nbook/app/stores/novel-ide";
import type {WorkspaceFilesViewMode} from "nbook/shared/storage/workbench-files";
import {
    buildWorkspaceFileTreeIndexMaps,
    buildWorkspaceFileTree,
    buildWorkspaceNodeDropContextMap,
    canDropOnWorkspaceNode,
    flattenVisibleWorkspaceNodes,
    resolveWorkspaceNodeDropPosition,
    resolveWorkspaceTailDrop,
    sanitizeExpandedPaths,
    type WorkspaceFileClipboardIntent,
    type WorkspaceFileDropState,
    type WorkspaceFileMovePayload,
    type WorkspaceFileSelectionEvent,
    workspaceFileTreeContextKey,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const props = withDefaults(defineProps<{
    nodes: WorkspaceFileNodeDto[];
    selectedPath?: string;
    selectedPaths?: string[];
    expandedPaths: string[];
    forcedExpandedPaths?: string[];
    mode?: WorkspaceFilesViewMode;
}>(), {
    selectedPath: "",
    selectedPaths: () => [],
    forcedExpandedPaths: () => [],
    mode: "ordinary",
});

const emit = defineEmits<{
    (e: "update:expandedPaths", value: string[]): void;
    (e: "update:selectedPaths", value: string[]): void;
    (e: "select", node: WorkspaceFileNodeDto): void;
    (e: "open", node: WorkspaceFileNodeDto): void;
    (e: "move", payload: WorkspaceFileMovePayload): void;
    (e: "node-contextmenu", node: WorkspaceFileNodeDto, event: MouseEvent): void;
    (e: "root-contextmenu", event: MouseEvent): void;
    (e: "clipboard-intent", intent: WorkspaceFileClipboardIntent): void;
}>();

const draggedPath = ref<string | null>(null);
let draggedPaths: string[] = [];
const dropState = ref<WorkspaceFileDropState>({targetPath: null, position: null, visualKind: null});
const roots = computed(() => buildWorkspaceFileTree(props.nodes));
const selectedPaths = computed(() => props.selectedPaths);
const selectedPath = computed(() => props.selectedPath || "");
const expandedPathSet = computed(() => new Set(props.expandedPaths));
const forcedExpandedPathSet = computed(() => new Set(props.forcedExpandedPaths));
const visibleExpandedPathSet = computed(() => new Set([...props.expandedPaths, ...props.forcedExpandedPaths]));
const indexMaps = computed(() => buildWorkspaceFileTreeIndexMaps(roots.value));
const dropContextMap = computed(() => buildWorkspaceNodeDropContextMap(roots.value, visibleExpandedPathSet.value));
const visibleNodes = computed(() => flattenVisibleWorkspaceNodes(roots.value, visibleExpandedPathSet.value));
let selectionAnchorPath = "";

const emitSelection = (paths: string[]): void => emit("update:selectedPaths", [...new Set(paths)]);
const selectNode = (node: WorkspaceFileNodeDto, event: WorkspaceFileSelectionEvent = {}, preview = true): void => {
    const path = node.path;
    const current = selectedPaths.value;
    let next: string[];
    if (event.shiftKey && selectionAnchorPath) {
        const rows = visibleNodes.value.map(item => item.path);
        const anchor = rows.indexOf(selectionAnchorPath);
        const target = rows.indexOf(path);
        if (anchor >= 0 && target >= 0) {
            const [start, end] = anchor < target ? [anchor, target] : [target, anchor];
            next = event.ctrlKey || event.metaKey ? [...current, ...rows.slice(start, end + 1)] : rows.slice(start, end + 1);
        } else next = [path];
    } else if (event.ctrlKey || event.metaKey) {
        next = current.includes(path) ? current.filter(item => item !== path) : [...current, path];
    } else next = [path];
    if (!event.shiftKey) selectionAnchorPath = path;
    emitSelection(next);
    if (preview && !(event.ctrlKey || event.metaKey || event.shiftKey)) emit("select", node);
};
const toggleSelection = (node: WorkspaceFileNodeDto): void => selectNode(node, {ctrlKey: true});
const selectAllVisible = (): void => {
    const paths = visibleNodes.value.map(item => item.path);
    selectionAnchorPath = paths[0] ?? "";
    emitSelection(paths);
};
const emitClipboardIntent = (intent: WorkspaceFileClipboardIntent): void => emit("clipboard-intent", intent);

/**
 * 清空拖拽态。
 */
const clearDragState = (): void => {
    draggedPath.value = null;
    draggedPaths = [];
    dropState.value = {
        targetPath: null,
        position: null,
        visualKind: null,
    };
};

/**
 * 仅清空落点高亮，不中断当前拖拽。
 */
const clearDropState = (): void => {
    dropState.value = {
        targetPath: null,
        position: null,
        visualKind: null,
    };
};



/**
 * 双击打开节点并保留标签。
 */
const openNode = (node: WorkspaceFileNodeDto): void => {
    emit("open", node);
};

/**
 * 切换目录展开态。
 */
const toggleExpanded = (node: WorkspaceFileNodeDto): void => {
    if (!node.isDirectory) {
        return;
    }

    const nextExpandedPaths = new Set(props.expandedPaths);
    if (nextExpandedPaths.has(node.path)) {
        nextExpandedPaths.delete(node.path);
    } else {
        nextExpandedPaths.add(node.path);
    }
    emit("update:expandedPaths", [...nextExpandedPaths]);
};

/**
 * 开始拖拽一个真实路径。
 */
const startDrag = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    draggedPath.value = node.path;
    draggedPaths = props.selectedPaths.includes(node.path) ? [...props.selectedPaths] : [node.path];
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.path);
    }
};

/**
 * 按当前节点和鼠标位置刷新落点。
 */
const updateDropState = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null) {
        return;
    }
    if (draggedPaths.some(path => !canDropOnWorkspaceNode(path, node.path, indexMaps.value.parentByPath))) {
        clearDropState();
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = resolveWorkspaceNodeDropPosition(node, event, dropContextMap.value.get(node.path) ?? null);
};

/**
 * 刷新子节点尾部落点。
 */
const updateTailDropState = (node: WorkspaceFileNodeDto, event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null) {
        return;
    }
    if (draggedPaths.some(path => !canDropOnWorkspaceNode(path, node.path, indexMaps.value.parentByPath))) {
        clearDropState();
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = resolveWorkspaceTailDrop(node, dropContextMap.value.get(node.path) ?? null);
};

/**
 * 提交拖拽移动。
 */
const commitDrop = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedPath.value === null || dropState.value.position === null || dropState.value.visualKind === null) {
        clearDragState();
        return;
    }

    emit("move", {
        sourcePath: draggedPath.value,
        sourcePaths: draggedPaths,
        targetPath: dropState.value.targetPath,
        position: dropState.value.position,
        visualKind: dropState.value.visualKind,
    });
    clearDragState();
};

/**
 * 空白根区域可以作为移动到根的目标。
 */
const handleRootDragOver = (event: DragEvent): void => {
    event.preventDefault();
    if (draggedPath.value === null) {
        return;
    }

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]')) {
        return;
    }
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
    }
    dropState.value = {
        targetPath: null,
        position: "root",
        visualKind: "root-line",
    };
};

/**
 * 提交根级 drop。
 */
const handleRootDrop = (event: DragEvent): void => {
    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]') && dropState.value.position !== "root") {
        return;
    }
    commitDrop(event);
};

/** 根区域右键仅在空白区触发。 */
const handleRootContextMenu = (event: MouseEvent): void => {
    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest('[data-role="workspace-file-node"]')) return;
    emit("root-contextmenu", event);
};

const resolvePasteDestination = (row: HTMLElement | null): string => {
    const path = row?.dataset.path ?? "";
    if (!path || row?.dataset.directory === "true") return path;
    const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
    const slash = normalized.lastIndexOf("/");
    return slash < 0 ? "" : `${normalized.slice(0, slash)}/`;
};

const handleTreeKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, [contenteditable='true']")) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
        emitClipboardIntent({kind: "clear"});
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "a") {
        event.preventDefault();
        selectAllVisible();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === "c" || key === "x")) {
        event.preventDefault();
        emitClipboardIntent({kind: key === "c" ? "copy" : "cut", sources: [...selectedPaths.value]});
        return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "v") {
        event.preventDefault();
        const row = target?.closest<HTMLElement>("[data-role='workspace-file-row']") ?? null;
        emitClipboardIntent({kind: "paste", destination: resolvePasteDestination(row)});
    }
};

const moveFocus = (event: KeyboardEvent, direction: -1 | 1): void => {
    const current = event.target as HTMLElement;
    const rows = Array.from(current.closest('[data-role="workspace-file-tree-root"]')?.querySelectorAll<HTMLElement>('[data-role="workspace-file-row"]') ?? []);
    const next = rows[rows.indexOf(current) + direction];
    if (next) next.focus();
};

watch(roots, () => {
    const nextExpandedPaths = sanitizeExpandedPaths(roots.value, props.expandedPaths);
    if (nextExpandedPaths.length !== props.expandedPaths.length) emit("update:expandedPaths", nextExpandedPaths);
}, {immediate: true});

provide(workspaceFileTreeContextKey, {
    selectedPaths,
    selectedPath,
    mode: computed(() => props.mode),
    expandedPathSet,
    forcedExpandedPathSet,
    dropState,
    draggedPath,
    selectNode,
    previewNode: (node) => emit("select", node),
    toggleSelection,
    openNode,
    toggleExpanded,
    startDrag,
    updateDropState,
    updateTailDropState,
    commitDrop,
    clearDragState,
    emitNodeContextMenu: (node, event) => {
        const path = node.path;
        if (!selectedPaths.value.includes(path)) emitSelection([path]);
        selectionAnchorPath = path;
        emit("node-contextmenu", node, event);
    },
    emitClipboardIntent,
});
</script>

<template>
    <!-- 工作区文件树 -->
    <div
        class="relative h-full min-h-[120px] select-none pb-6"
        data-role="workspace-file-tree-root"
        role="tree"
        @keydown.down.stop.prevent="moveFocus($event, 1)"
        @keydown.up.stop.prevent="moveFocus($event, -1)"
        @keydown="handleTreeKeydown"
        @dragover="handleRootDragOver"
        @drop="handleRootDrop"
        @contextmenu.prevent.stop="handleRootContextMenu"
    >
        <WorkspaceFileNode
            v-for="node in roots"
            :key="node.path"
            :node="node"
            :depth="0"
            :indent="18"
        />

        <div v-if="dropState.visualKind === 'root-line'" class="mt-1 h-[2px] rounded-full bg-[var(--accent-main)]"></div>
    </div>
</template>
