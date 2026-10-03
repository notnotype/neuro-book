<script setup lang="ts">
import {computed, ref} from "vue";
import {SegmentedControl} from "@notnotype/nb-ui/components";
import type {SegmentedControlOption, SegmentedControlValue} from "@notnotype/nb-ui/components";
import WorkspaceFileTree from "nbook/app/components/novel-ide/workspace/WorkspaceFileTree.vue";
import {
    collectAncestorPaths,
    normalizeWorkspacePath,
    projectWorkspaceFileNodes,
    type WorkspaceFileMovePayload,
    type WorkspaceFileClipboardIntent,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFilesViewMode} from "nbook/shared/storage/workbench-files";

const props = withDefaults(defineProps<{
    /** 真实文件树（扁平节点列表）；组件只投影呈现，不改写它。 */
    nodes: WorkspaceFileNode[];
    /** 受控：当前呈现模式（`workbench.files`/`view-mode` 的值），组件只发事件。 */
    mode: WorkspaceFilesViewMode;
    /** 受控：当前选中路径（真实路径）。 */
    selectedPath: string;
    selectedPaths?: string[];
    /** 受控：树展开路径（真实目录路径）；宿主持有并持久化，组件只回传整份意图。 */
    expandedPaths: string[];
    /** 树读取中：呈现加载态，树与根入口都不挂载。 */
    loading: boolean;
    /** 树读取失败信息：非空时呈现错误态（优先于树），「重试」只发 retry。 */
    error?: string | null;
}>(), {
    error: null,
    selectedPaths: () => [],
});

const emit = defineEmits<{
    (e: "update:mode", mode: WorkspaceFilesViewMode): void;
    (e: "update:expandedPaths", paths: string[]): void;
    (e: "update:selectedPaths", paths: string[]): void;
    (e: "clipboard-intent", intent: WorkspaceFileClipboardIntent): void;
    (e: "select", node: WorkspaceFileNode): void;
    (e: "open", node: WorkspaceFileNode): void;
    (e: "move", payload: WorkspaceFileMovePayload): void;
    (e: "node-contextmenu", node: WorkspaceFileNode, event: MouseEvent): void;
    (e: "root-contextmenu", event: MouseEvent): void;
    (e: "create-root-content"): void;
    (e: "retry"): void;
}>();

/** 搜索词：纯客户端内存状态，不持久化、不进记录。 */
const searchQuery = ref("");
/**
 * 根内容展开是本视图的呈现状态：根不是真实节点，放进 expandedPaths 会被
 * 树侧 sanitize（只保留真实可展开目录）剥掉，所以留作本地状态。
 */
const rootExpanded = ref(true);

const searching = computed(() => searchQuery.value.trim().length > 0);
const searchDisplay = computed(() => searchQuery.value.trim());

/** 同一真实树的呈现投影：内容模式过滤全部 index.md（含根），普通模式显示真实文件名。 */
const projectedNodes = computed(() => projectWorkspaceFileNodes(props.nodes, props.mode));

/**
 * 搜索按真实路径与展示标题包含命中，连同祖先一起保留；真实树数据不变。
 */
const searchedNodes = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
        return projectedNodes.value;
    }
    const matched = projectedNodes.value.filter((node) =>
        node.path.toLocaleLowerCase("zh-CN").includes(query)
        || node.title.toLocaleLowerCase("zh-CN").includes(query));
    const ancestorPathSet = new Set(collectAncestorPaths(matched));
    const matchedPathSet = new Set(matched.map((node) => node.path));
    return projectedNodes.value.filter((node) => matchedPathSet.has(node.path) || ancestorPathSet.has(node.path));
});

/** 搜索时命中节点的祖先强制展开；清空搜索回到记录的展开集。 */
const forcedExpandedPaths = computed(() => (searching.value ? collectAncestorPaths(searchedNodes.value) : []));

/** 根入口从真实节点里找根 index.md，不虚构文件。 */
const rootIndexNode = computed(() => props.nodes.find((node) => !node.isDirectory && normalizeWorkspacePath(node.path) === "index.md") ?? null);
const rootTitle = computed(() => rootIndexNode.value && !rootIndexNode.value.frontmatterError && rootIndexNode.value.title.trim() ? rootIndexNode.value.title.trim() : "根目录");
const rootRowTitle = computed(() => (rootIndexNode.value ? `${rootTitle.value} · ${rootIndexNode.value.path}` : rootTitle.value));
const rootSelected = computed(() => rootIndexNode.value !== null && props.selectedPath === rootIndexNode.value.path);
const hasProjectedNodes = computed(() => projectedNodes.value.length > 0);
const effectiveRootExpanded = computed(() => rootExpanded.value || searching.value);

const modeOptions: SegmentedControlOption[] = [
    {value: "ordinary", label: "普通", iconClass: "i-lucide-list-tree", title: "普通模式：显示真实文件名，index.md 是普通文件"},
    {value: "content", label: "内容", iconClass: "i-lucide-notebook-tabs", title: "内容模式：目录承载正文，index.md 不单列"},
];

function handleModeChange(value: SegmentedControlValue): void {
    if (value === "ordinary" || value === "content") {
        if (value === "content") {
            emit("update:selectedPaths", props.selectedPaths.filter(path => normalizeWorkspacePath(path).split("/").at(-1)?.toLowerCase() !== "index.md"));
        }
        emit("update:mode", value);
    }
}

/** 根入口单击 = 预览；只对真实存在的根 index.md 发出。 */
function selectRoot(): void {
    if (rootIndexNode.value) {
        emit("select", rootIndexNode.value);
    }
}

/** 根入口双击 / Enter = 常驻打开。 */
function openRoot(): void {
    if (rootIndexNode.value) {
        emit("open", rootIndexNode.value);
    }
}

function toggleRootExpanded(): void {
    if (hasProjectedNodes.value) {
        rootExpanded.value = !rootExpanded.value;
    }
}

function expandRoot(): void {
    if (hasProjectedNodes.value) {
        rootExpanded.value = true;
    }
}

function collapseRoot(): void {
    rootExpanded.value = false;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col" data-role="files-explorer-view">
        <!-- 头部：搜索框 + 紧凑双模式切换 -->
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
            <div class="relative min-w-0 flex-1">
                <span class="i-lucide-search absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input
                    v-model="searchQuery"
                    type="text"
                    aria-label="搜索文件"
                    placeholder="搜索路径或标题..."
                    data-role="files-explorer-search"
                    class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]"
                />
            </div>
            <SegmentedControl
                aria-label="文件视图模式"
                data-role="files-explorer-mode-switch"
                :model-value="mode"
                :options="modeOptions"
                size="xs"
                @update:model-value="handleModeChange"
            />
        </div>

        <!-- 内容模式根入口行：根不是真实节点；有根 index 时单击预览、双击/Enter 常驻，缺失时给明确创建入口（只发意图，不写盘） -->
        <div v-if="!loading && mode === 'content'" class="shrink-0 px-2 pb-1 pt-2">
            <div
                class="nb-ui-focus-ring group flex items-center gap-1 rounded-md py-1 pl-1 pr-2 text-left transition-colors"
                :class="rootSelected ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]'"
                :aria-expanded="effectiveRootExpanded"
                :aria-selected="rootSelected"
                :title="rootRowTitle"
                role="treeitem"
                tabindex="0"
                data-role="files-explorer-root-row"
                @click="selectRoot"
                @contextmenu.prevent.stop="emit('root-contextmenu', $event)"
                @dblclick.stop="openRoot"
                @keydown.enter.stop.prevent="openRoot"
                @keydown.left.stop.prevent="collapseRoot"
                @keydown.right.stop.prevent="expandRoot"
                @keydown.space.stop.prevent="selectRoot"
            >
                <!-- 独立展开箭头：展开/收起根内容，与正文打开区域分开 -->
                <button
                    type="button"
                    class="flex h-4 w-4 shrink-0 items-center justify-center opacity-50 transition-all hover:opacity-100"
                    :class="hasProjectedNodes ? '' : 'invisible'"
                    :aria-label="effectiveRootExpanded ? '收起根目录' : '展开根目录'"
                    @click.stop="toggleRootExpanded"
                    @dblclick.stop
                    @keydown.stop
                >
                    <span :class="effectiveRootExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5"></span>
                </button>
                <span class="flex h-4 w-4 shrink-0 items-center justify-center opacity-80 transition-transform duration-150 group-hover:scale-[1.08]">
                    <span :class="rootIndexNode ? 'i-lucide-notebook-tabs' : 'i-lucide-folder'" class="h-3.5 w-3.5"></span>
                </span>
                <span class="min-w-0 flex-1 truncate text-[13px]">{{ rootTitle }}</span>
                <span v-if="rootIndexNode" class="shrink-0 text-[10px] text-[var(--text-muted)] opacity-60">index.md</span>
                <button
                    v-else
                    type="button"
                    class="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-main)] hover:text-[var(--accent-text)]"
                    data-role="files-explorer-create-root-content"
                    @click.stop="emit('create-root-content')"
                    @dblclick.stop
                    @keydown.stop
                >
                    <span class="i-lucide-file-plus-2 h-3 w-3"></span>
                    <span>创建内容</span>
                </button>
            </div>
        </div>

        <!-- 树容器：加载 / 错误 / 空与无命中 / 树，互斥呈现 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            <div
                v-if="loading"
                class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]"
                data-role="files-explorer-state-loading"
            >
                正在加载文件树...
            </div>
            <div
                v-else-if="error"
                class="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-6 text-xs text-[var(--status-danger)]"
                role="alert"
                data-role="files-explorer-state-error"
            >
                <span class="i-lucide-triangle-alert h-4 w-4 shrink-0" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 break-words text-center">{{ error }}</span>
                <button
                    type="button"
                    class="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--bg-panel)] px-2 text-[11px] text-[var(--status-danger)] transition-colors hover:bg-[var(--bg-hover)]"
                    data-role="files-explorer-retry"
                    @click="emit('retry')"
                >
                    <span class="i-lucide-refresh-cw h-3 w-3"></span>
                    <span>重试</span>
                </button>
            </div>
            <div
                v-else-if="searchedNodes.length === 0"
                class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] px-4 text-center text-xs text-[var(--text-muted)]"
                :data-role="searching ? 'files-explorer-state-no-match' : 'files-explorer-state-empty'"
                @contextmenu.prevent.stop="emit('root-contextmenu', $event)"
            >
                {{ searching ? `没有匹配「${searchDisplay}」的文件` : "没有可显示的文件" }}
            </div>
            <!-- 普通模式整树常显；内容模式树收在根行下（缩进对齐树的 18 缩进常量），搜索时强制展开 -->
            <div v-else v-show="mode !== 'content' || effectiveRootExpanded" :class="mode === 'content' ? 'pl-[18px]' : ''">
                <WorkspaceFileTree
                    :nodes="searchedNodes"
                    :selected-path="selectedPath"
                    :selected-paths="selectedPaths"
                    :expanded-paths="expandedPaths"
                    :forced-expanded-paths="forcedExpandedPaths"
                    :mode="mode"
                    @update:expanded-paths="(paths: string[]) => emit('update:expandedPaths', paths)"
                    @update:selected-paths="(paths: string[]) => emit('update:selectedPaths', paths)"
                    @clipboard-intent="(intent: WorkspaceFileClipboardIntent) => emit('clipboard-intent', intent)"
                    @select="(node: WorkspaceFileNode) => emit('select', node)"
                    @open="(node: WorkspaceFileNode) => emit('open', node)"
                    @move="(payload: WorkspaceFileMovePayload) => emit('move', payload)"
                    @node-contextmenu="(node: WorkspaceFileNode, event: MouseEvent) => emit('node-contextmenu', node, event)"
                    @root-contextmenu="(event: MouseEvent) => emit('root-contextmenu', event)"
                />
            </div>
        </div>
    </div>
</template>
