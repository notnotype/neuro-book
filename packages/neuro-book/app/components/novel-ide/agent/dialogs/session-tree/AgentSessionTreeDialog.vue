<script setup lang="ts">
import {Dialog} from "@notnotype/nb-ui/components";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";
import {
    deriveAgentSessionTreeRows,
    deriveAgentTreeState,
    type AgentSessionTreeFilterMode,
    type AgentSessionTreeRow,
    type TreeGuidePart,
} from "nbook/app/components/novel-ide/agent/session-tree";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    tree: SessionTreeNode[];
    activeLeafId: string | null;
    running: boolean;
    canActivate: boolean;
    teleportTarget?: string | boolean;
}>(), {
    teleportTarget: ".novel-ide-theme",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select", entryId: string): void;
}>();

const search = ref("");
const filterMode = ref<AgentSessionTreeFilterMode>("default");
const selectedEntryId = ref<string | null>(null);
const collapsedBranchIds = ref<Set<string>>(new Set());
const listContainerRef = ref<HTMLElement | null>(null);
const {t} = useI18n();
const filterOptions = computed<{value: AgentSessionTreeFilterMode; label: string; title: string}[]>(() => [
    {value: "default", label: "Default", title: t("agent.sessionTree.filterDefaultTitle")},
    {value: "no-tools", label: "No-tools", title: t("agent.sessionTree.filterNoToolsTitle")},
    {value: "user", label: "User", title: t("agent.sessionTree.filterUserTitle")},
    {value: "labeled", label: "Labeled", title: t("agent.sessionTree.filterLabeledTitle")},
    {value: "all", label: "All", title: t("agent.sessionTree.filterAllTitle")},
]);

const treeState = computed(() => deriveAgentTreeState(props.tree));
const hasSearchQuery = computed(() => Boolean(search.value.trim()));
const treeRows = computed(() => deriveAgentSessionTreeRows({
    tree: props.tree,
    filterMode: filterMode.value,
    query: search.value,
    collapsedBranchIds: collapsedBranchIds.value,
}));
const activeLeafLabel = computed(() => props.activeLeafId ? shortEntryId(props.activeLeafId) : "-");
const selectedNode = computed(() => {
    if (selectedEntryId.value) {
        return treeState.value.nodeById.get(selectedEntryId.value) ?? null;
    }
    return props.activeLeafId ? treeState.value.nodeById.get(props.activeLeafId) ?? null : props.tree.find((node) => node.active) ?? null;
});
const selectedEntryLabel = computed(() => selectedNode.value ? shortEntryId(selectedNode.value.id) : "-");

watch(() => props.modelValue, (visible) => {
    if (visible) {
        collapsedBranchIds.value = new Set();
        selectedEntryId.value = props.activeLeafId ?? props.tree.find((node) => node.active)?.id ?? props.tree[0]?.id ?? null;
        nextTick(() => {
            listContainerRef.value?.focus();
            if (selectedEntryId.value) {
                const el = listContainerRef.value?.querySelector(`[data-node-id="${selectedEntryId.value}"]`);
                if (el) el.scrollIntoView({ block: "nearest" });
            }
        });
    }
});

watch(treeRows, () => {
    reconcileSelectedNode();
});

/**
 * 节点角色色彩。
 */
function roleToneClass(node: SessionTreeNode): string {
    if (node.role === "user") {
        return "bg-[var(--status-info-bg)] text-[var(--status-info)]";
    }
    if (node.role === "assistant") {
        return "bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
    if (node.role === "toolResult") {
        return "bg-[var(--bg-input)] text-[var(--text-secondary)]";
    }
    if (node.type === "invocation_lifecycle") {
        return "bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
    }
    return "bg-[var(--bg-input)] text-[var(--text-secondary)]";
}

/**
 * 节点圆点色彩。
 */
function nodeDotClass(node: SessionTreeNode): string {
    if (node.id === props.activeLeafId) {
        return "border-[var(--accent-main)] bg-[var(--accent-main)] shadow-[0_0_0_3px_var(--accent-bg)]";
    }
    if (node.active) {
        return "border-[var(--accent-main)] bg-[var(--accent-main)]/70";
    }
    if (!node.terminal) {
        return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]";
    }
    return "border-[var(--border-strong)] bg-[var(--bg-panel)]";
}

/**
 * 列表行状态色彩。
 */
function rowStateClass(row: AgentSessionTreeRow): string[] {
    const classes = ["border-l-transparent", "hover:bg-[var(--bg-hover)]/60"];
    if (row.node.id === selectedNode.value?.id) {
        classes.push("!border-l-[var(--accent-main)]", "!bg-[var(--accent-bg)]/60");
    } else if (row.node.id === props.activeLeafId) {
        classes.push("!border-l-[var(--accent-main)]/70", "!bg-[var(--accent-bg)]/30");
    }
    return classes;
}

/**
 * 列表行完整标题，用于长内容 hover 检查。
 */
function rowTitle(row: AgentSessionTreeRow): string {
    return `${roleTitle(row.node)} · ${row.node.id} · ${nodePreview(row.node)}`;
}

/**
 * 节点摘要的强调程度。
 */
function previewToneClass(row: AgentSessionTreeRow): string {
    if (row.node.id === selectedNode.value?.id || row.node.id === props.activeLeafId) {
        return "font-medium text-[var(--text-main)]";
    }
    if (row.isBranchPoint) {
        return "font-medium text-[var(--text-main)]/95";
    }
    return "font-normal text-[var(--text-main)]";
}

/**
 * 将 lane 语义转换成实际渲染缩进；非 root 行需要先空出主线列。
 */
function renderedGuideParts(row: AgentSessionTreeRow): TreeGuidePart[] {
    if (row.guideParts[0] === "root") {
        return row.guideParts;
    }
    return ["space", ...row.guideParts];
}

/**
 * 前置 space cell 承担 parent lane 到 child lane 的桥接线。
 */
function guideBridgePart(row: AgentSessionTreeRow, guideIndex: number): TreeGuidePart | null {
    const firstPart = row.guideParts[0];
    if (guideIndex !== 0 || !firstPart || firstPart === "root") {
        return null;
    }
    return firstPart;
}

/**
 * 树线单元格基础色彩。
 */
function guideCellClass(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): string {
    return guideCellHasTopLine(row, part, guideIndex)
        || guideCellHasBottomLine(row, part, guideIndex)
        || guideCellHasLeftHorizontalLine(row, part, guideIndex)
        || guideCellHasRightHorizontalLine(row, part, guideIndex)
        || guideCellHasDot(row, part, guideIndex)
        ? "text-[var(--border-strong)]"
        : "";
}

/**
 * 当前 guide cell 是否绘制上半竖线。
 */
function guideCellHasTopLine(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): boolean {
    const bridgePart = guideBridgePart(row, guideIndex);
    const effectivePart = bridgePart ?? part;
    return effectivePart === "line" || effectivePart === "branch" || effectivePart === "end";
}

/**
 * 当前 guide cell 是否绘制下半竖线。
 */
function guideCellHasBottomLine(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): boolean {
    const bridgePart = guideBridgePart(row, guideIndex);
    const effectivePart = bridgePart ?? part;
    if (effectivePart === "line" || effectivePart === "branch") {
        return true;
    }
    const isLastGuideCell = guideIndex === renderedGuideParts(row).length - 1;
    return isLastGuideCell && row.isBranchPoint && !row.collapsed;
}

/**
 * 当前 guide cell 是否绘制左半横向连接线。
 */
function guideCellHasLeftHorizontalLine(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): boolean {
    if (guideBridgePart(row, guideIndex)) {
        return false;
    }
    return part === "branch" || part === "end";
}

/**
 * 当前 guide cell 是否绘制右半横向连接线。
 */
function guideCellHasRightHorizontalLine(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): boolean {
    const bridgePart = guideBridgePart(row, guideIndex);
    const effectivePart = bridgePart ?? part;
    return effectivePart === "branch" || effectivePart === "end";
}

/**
 * 当前 guide cell 是否需要绘制节点锚点。
 */
function guideCellHasDot(row: AgentSessionTreeRow, part: TreeGuidePart, guideIndex: number): boolean {
    if (part === "root" || part === "branch" || part === "end") {
        return true;
    }
    const isLastGuideCell = guideIndex === renderedGuideParts(row).length - 1;
    return isLastGuideCell && (row.node.id === props.activeLeafId || row.isBranchPoint);
}

/**
 * 节点角色展示标签。
 */
function roleLabel(node: SessionTreeNode): string {
    if (node.role === "assistant") {
        return "assistant";
    }
    if (node.role === "toolResult") {
        return node.toolName ? compactToolLabel(node.toolName) : "tool";
    }
    if (node.type === "invocation_lifecycle") {
        return "lifecycle";
    }
    return node.role ?? node.type;
}

/**
 * 节点角色完整标题。
 */
function roleTitle(node: SessionTreeNode): string {
    if (node.role === "toolResult" && node.toolName) {
        return `tool:${node.toolName}`;
    }
    if (node.type === "invocation_lifecycle") {
        return "invocation_lifecycle";
    }
    return roleLabel(node);
}

/**
 * 压缩常见工具名，避免树列表被工具标签挤占。
 */
function compactToolLabel(toolName: string): string {
    if (toolName === "report_result") {
        return "report";
    }
    if (toolName === "subject_rag_search") {
        return "rag";
    }
    if (toolName === "subject_event_append") {
        return "event";
    }
    if (toolName === "subject_memory_update") {
        return "memory";
    }
    return toolName.length > 16 ? `${toolName.slice(0, 14)}...` : toolName;
}

/**
 * 节点图标。
 */
function nodeIcon(node: SessionTreeNode): string {
    if (node.role === "user") {
        return "i-lucide-user";
    }
    if (node.role === "assistant") {
        return "i-lucide-sparkles";
    }
    if (node.role === "toolResult") {
        return "i-lucide-wrench";
    }
    if (node.type === "compaction") {
        return "i-lucide-archive";
    }
    if (node.type === "branch_summary") {
        return "i-lucide-git-branch";
    }
    return "i-lucide-circle";
}

/**
 * 节点摘要文案。
 */
function nodePreview(node: SessionTreeNode): string {
    const rawPreview = node.preview || node.label || node.type;
    if (node.role === "assistant" && /^(?:\[tool:[^\]]+\]\s*)+$/.test(rawPreview.trim())) {
        const matches = rawPreview.match(/\[tool:([^\]]+)\]/g);
        if (matches) {
            const names = matches.map(m => m.replace(/\[tool:|\]/g, ""));
            const uniqueNames = Array.from(new Set(names));
            return t("agent.sessionTree.toolCallsSummary", {names: uniqueNames.join(", "), count: matches.length});
        }
    }
    if (rawPreview.startsWith("---") && rawPreview.includes("profile:")) {
        return t("agent.sessionTree.profileInjection");
    }
    if (rawPreview.startsWith("{") && rawPreview.endsWith("}")) {
        return `[JSON Payload]`;
    }
    if (node.type === "invocation_lifecycle") {
        const parts = rawPreview.split(" ");
        const status = parts[1];
        if (status) {
            return t("agent.sessionTree.invocationStatus", {status: status.toUpperCase()});
        }
    }
    return rawPreview;
}

/**
 * 缩短长 entry id，用于标题和局部元数据展示。
 */
function shortEntryId(value: string): string {
    return value.length > 13 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

/**
 * 选中节点。
 */
function selectNode(node: SessionTreeNode): void {
    selectedEntryId.value = node.id;
}

/**
 * 按行号选中节点；严格索引检查下需要显式处理空行。
 */
function selectRowAt(index: number): void {
    const row = treeRows.value[index];
    if (row) {
        selectNode(row.node);
    }
}

/**
 * 展开或收起 branch point 的整段可见子树。
 */
function toggleBranch(row: AgentSessionTreeRow): void {
    if (!row.collapsible || hasSearchQuery.value) {
        return;
    }
    const nextCollapsedIds = new Set(collapsedBranchIds.value);
    if (nextCollapsedIds.has(row.node.id)) {
        nextCollapsedIds.delete(row.node.id);
    } else {
        nextCollapsedIds.add(row.node.id);
    }
    collapsedBranchIds.value = nextCollapsedIds;
}

/**
 * 分支展开按钮标题。
 */
function branchToggleTitle(row: AgentSessionTreeRow): string {
    if (hasSearchQuery.value) {
        return t("agent.sessionTree.searchExpandedBranch");
    }
    return row.collapsed ? t("agent.sessionTree.expandBranch") : t("agent.sessionTree.collapseBranch");
}

/**
 * 分支徽标标题。
 */
function branchBadgeTitle(row: AgentSessionTreeRow): string {
    if (row.isBranchPoint) {
        return row.collapsed ? t("agent.sessionTree.hiddenRows", {count: row.hiddenDescendantCount}) : t("agent.sessionTree.branchCount");
    }
    return t("agent.sessionTree.branchPosition");
}

/**
 * 详情面板中的节点状态标签。
 */
function detailStatusLabel(node: SessionTreeNode): string {
    const pathState = node.active ? "active path" : "inactive";
    const branchState = node.terminal ? "terminal" : "branch";
    return `${pathState} · ${branchState}`;
}

/**
 * 当前选中节点被折叠隐藏时，回退到最近的折叠祖先。
 */
function reconcileSelectedNode(): void {
    const selectedId = selectedEntryId.value;
    if (!selectedId || treeRows.value.some((row) => row.node.id === selectedId)) {
        return;
    }
    selectedEntryId.value = nearestCollapsedBranchId(selectedId) ?? treeRows.value[0]?.node.id ?? null;
}

/**
 * 查找一个 entry 最近的已折叠 branch point 祖先。
 */
function nearestCollapsedBranchId(entryId: string): string | null {
    let cursor = treeState.value.nodeById.get(entryId)?.parentId ?? null;
    while (cursor) {
        const node = treeState.value.nodeById.get(cursor);
        if (!node) {
            return null;
        }
        if (node.childCount > 1 && collapsedBranchIds.value.has(node.id)) {
            return node.id;
        }
        cursor = node.parentId;
    }
    return null;
}

/**
 * 切换当前 session leaf 到选中节点。
 */
function activateSelected(): void {
    if (!selectedNode.value || props.running || !props.canActivate) {
        return;
    }
    emit("select", selectedNode.value.id);
}

/**
 * 复制 entry id。
 */
async function copyId(value: string | null | undefined): Promise<void> {
    if (!value || !import.meta.client) {
        return;
    }
    await navigator.clipboard.writeText(value);
}
/**
 * 键盘导航事件处理器
 */
function handleKeyDown(e: KeyboardEvent): void {
    if (hasSearchQuery.value) return;
    const currentIndex = treeRows.value.findIndex(row => row.node.id === selectedEntryId.value);
    const currentRow = currentIndex >= 0 ? treeRows.value[currentIndex] : null;

    if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = Math.min(treeRows.value.length - 1, currentIndex + 1);
        if (nextIndex >= 0) selectRowAt(nextIndex);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = Math.max(0, currentIndex - 1);
        if (prevIndex >= 0) selectRowAt(prevIndex);
    } else if (e.key === "ArrowRight") {
        if (currentRow?.collapsible && currentRow.collapsed) {
            e.preventDefault();
            toggleBranch(currentRow);
        } else if (currentRow?.collapsible) {
            e.preventDefault();
            const nextIndex = Math.min(treeRows.value.length - 1, currentIndex + 1);
            if (nextIndex >= 0) selectRowAt(nextIndex);
        }
    } else if (e.key === "ArrowLeft") {
        if (currentRow?.collapsible && !currentRow.collapsed) {
            e.preventDefault();
            toggleBranch(currentRow);
        } else if (currentRow?.node.parentId) {
            e.preventDefault();
            const parentNode = treeState.value.nodeById.get(currentRow.node.parentId);
            if (parentNode) selectNode(parentNode);
        }
    } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activateSelected();
    }
}
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        :title="t('agent.sessionTree.title')"
        :teleport-target="props.teleportTarget"
        width="min(1560px, calc(100vw - 16px))"
        height="min(920px, calc(100vh - 16px))"
        body-class="!p-0 !gap-0 !overflow-hidden !bg-[var(--bg-main)]"
        header-class="!px-4 !py-3 !bg-[var(--bg-main)]"
        :show-footer="false"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <div class="flex min-w-0 flex-1 items-center justify-between gap-4">
                <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--accent-text)]">
                        <span class="i-lucide-git-branch h-4.5 w-4.5"></span>
                    </span>
                    <div class="min-w-0">
                        <div class="text-base font-semibold leading-snug text-[var(--text-main)]">{{ t("agent.sessionTree.title") }}</div>
                        <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                            <span>{{ t("agent.sessionTree.nodeCount", {count: props.tree.length}) }}</span>
                            <span class="h-1 w-1 rounded-full bg-[var(--border-strong)]"></span>
                            <span class="truncate font-mono">{{ t("agent.sessionTree.leaf", {leaf: activeLeafLabel}) }}</span>
                        </div>
                    </div>
                </div>
                <button type="button" class="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :aria-label="t('agent.sessionTree.close')" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <div class="flex min-h-0 flex-1 bg-[var(--bg-main)]">
            <!-- Tree 主列表 -->
            <div class="flex min-w-0 flex-1 flex-col border-r border-[var(--border-color)] bg-[var(--bg-main)]">
                <div class="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] bg-[var(--toolbar-surface)]/95 px-3 py-2 backdrop-blur">
                    <div class="flex h-8 min-w-[280px] flex-1 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 shadow-sm">
                        <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
                        <input v-model="search" class="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" :placeholder="t('agent.sessionTree.searchPlaceholder')" />
                    </div>
                    <div class="flex h-8 overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 shadow-sm">
                        <button
                            v-for="option in filterOptions"
                            :key="option.value"
                            type="button"
                            class="min-w-[74px] rounded px-2.5 text-xs font-medium transition-colors"
                            :class="filterMode === option.value ? 'bg-[var(--accent-main)] text-[var(--text-inverse)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                            :title="option.title"
                            @click="filterMode = option.value"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                </div>

                <div
                    ref="listContainerRef"
                    class="min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-main)]"
                    tabindex="0"
                    @keydown="handleKeyDown"
                >
                    <div v-if="treeRows.length > 0" class="overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                        <div
                            v-for="row in treeRows"
                            :key="row.node.id"
                            :data-node-id="row.node.id"
                            class="group/node grid min-h-9 w-full min-w-0 grid-cols-[auto_24px_minmax(0,1fr)] items-stretch gap-1 border-b border-l-2 border-[var(--border-color)]/55 px-2 text-left transition-colors last:border-b-0"
                            :class="rowStateClass(row)"
                            @click="selectNode(row.node)"
                            @dblclick="activateSelected"
                        >
                            <span class="mr-0.5 flex shrink-0 self-stretch" aria-hidden="true">
                                <span v-for="(part, guideIndex) in renderedGuideParts(row)" :key="`${row.node.id}-guide-${guideIndex}`" class="relative w-4 shrink-0" :class="guideCellClass(row, part, guideIndex)">
                                    <span v-if="guideCellHasTopLine(row, part, guideIndex)" class="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-current opacity-75"></span>
                                    <span v-if="guideCellHasBottomLine(row, part, guideIndex)" class="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-current opacity-75"></span>
                                    <span v-if="guideCellHasLeftHorizontalLine(row, part, guideIndex)" class="absolute left-0 right-1/2 top-1/2 h-px bg-current opacity-80"></span>
                                    <span v-if="guideCellHasRightHorizontalLine(row, part, guideIndex)" class="absolute left-1/2 right-0 top-1/2 h-px bg-current opacity-80"></span>
                                    <span v-if="guideCellHasDot(row, part, guideIndex)" class="absolute left-1/2 top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border" :class="nodeDotClass(row.node)"></span>
                                </span>
                            </span>
                            <button
                                v-if="row.collapsible"
                                type="button"
                                class="flex h-6 w-6 shrink-0 items-center justify-center self-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
                                :title="branchToggleTitle(row)"
                                :aria-label="branchToggleTitle(row)"
                                :disabled="hasSearchQuery"
                                @click.stop="toggleBranch(row)"
                            >
                                <span :class="row.collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                            </button>
                            <span v-else class="h-6 w-6 shrink-0" aria-hidden="true"></span>
                            <button type="button" class="grid min-w-0 flex-1 grid-cols-[16px_auto_minmax(0,1fr)_minmax(46px,auto)_52px] items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-main)]" :title="rowTitle(row)" @click="selectNode(row.node)" @dblclick="activateSelected">
                                <span :class="nodeIcon(row.node)" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                                <span class="inline-flex h-5 max-w-[80px] shrink-0 items-center justify-center truncate rounded px-1.5 text-[10px] font-medium leading-none" :class="roleToneClass(row.node)" :title="roleTitle(row.node)">{{ roleLabel(row.node) }}</span>
                                <span class="min-w-0 truncate text-[13px] leading-5" :class="previewToneClass(row)">{{ nodePreview(row.node) }}</span>
                                <span class="flex min-w-[46px] justify-end">
                                    <span v-if="row.isBranchPoint" class="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 text-[10px] font-medium text-[var(--text-secondary)]" :title="branchBadgeTitle(row)">
                                        <span class="i-lucide-git-fork h-3 w-3 text-[var(--text-muted)]"></span>
                                        {{ row.node.childCount }}
                                        <span v-if="row.collapsed && row.hiddenDescendantCount > 0" class="text-[var(--accent-text)]">+{{ row.hiddenDescendantCount }}</span>
                                    </span>
                                    <span v-else-if="row.branchSiblingCount > 1 && row.branchIndex !== null" class="inline-flex h-5 shrink-0 items-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 text-[10px] font-medium text-[var(--text-muted)]" :title="branchBadgeTitle(row)">
                                        {{ row.branchIndex + 1 }}/{{ row.branchSiblingCount }}
                                    </span>
                                </span>
                                <span class="justify-self-end truncate whitespace-nowrap font-mono text-[10px] leading-4 text-[var(--text-muted)] opacity-60" :title="formatTimestamp(row.node.timestamp)">{{ formatTimestamp(row.node.timestamp).split(' ')[1] || formatTimestamp(row.node.timestamp) }}</span>
                            </button>
                        </div>
                    </div>
                    <div v-else class="rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                        {{ t("agent.sessionTree.noMatchingNode") }}
                    </div>
                </div>
            </div>

            <!-- 节点详情 -->
            <aside class="flex w-[440px] shrink-0 flex-col bg-[var(--bg-panel)]">
                <div class="border-b border-[var(--border-color)] bg-[var(--bg-main)] px-4 py-3">
                    <div class="flex min-w-0 items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-[var(--text-main)]">{{ t("agent.sessionTree.details") }}</div>
                            <div class="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{{ selectedEntryLabel }}</div>
                        </div>
                        <button v-if="selectedNode" type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.sessionTree.copyEntryId')" @click="void copyId(selectedNode.id)">
                            <span class="i-lucide-copy h-3.5 w-3.5"></span>
                        </button>
                    </div>
                </div>
                <div v-if="selectedNode" class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <div class="mb-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
                        <div class="flex min-w-0 items-center gap-2">
                            <span :class="nodeIcon(selectedNode)" class="h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                            <span class="min-w-0 truncate rounded border px-2 py-1 text-xs font-medium" :class="roleToneClass(selectedNode)" :title="roleTitle(selectedNode)">{{ roleLabel(selectedNode) }}</span>
                            <span v-if="selectedNode.id === props.activeLeafId" class="rounded bg-[var(--accent-bg)] px-2 py-1 text-[10px] font-medium text-[var(--accent-text)]">LEAF</span>
                        </div>
                        <div class="mt-3 min-w-0 truncate text-sm font-medium text-[var(--text-main)]">{{ nodePreview(selectedNode) }}</div>
                        <div class="mt-1 text-xs text-[var(--text-muted)]">{{ detailStatusLabel(selectedNode) }}</div>
                    </div>

                    <!-- Tree 只展示 lightweight 结构元数据，不读取 raw SessionEntry 正文。 -->
                    <div class="rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-3 text-xs leading-relaxed text-[var(--status-info)]">
                        {{ t("agent.sessionTree.structureOnly") }}
                    </div>

                    <div class="mt-4 space-y-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] p-3 text-xs">
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Entry ID</span>
                            <button class="min-w-0 truncate font-mono text-[var(--accent-text)]" :title="selectedNode.id" @click="void copyId(selectedNode.id)">{{ shortEntryId(selectedNode.id) }}</button>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Parent</span>
                            <button class="min-w-0 truncate font-mono text-[var(--text-secondary)]" :title="selectedNode.parentId ?? '-'" @click="void copyId(selectedNode.parentId)">{{ selectedNode.parentId ? shortEntryId(selectedNode.parentId) : "-" }}</button>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Type</span>
                            <span class="font-mono text-[var(--text-secondary)]">{{ selectedNode.type }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Children</span>
                            <span class="font-mono text-[var(--text-secondary)]">{{ selectedNode.childCount }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-3">
                            <span class="text-[var(--text-muted)]">Status</span>
                            <span class="text-[var(--text-secondary)]">{{ detailStatusLabel(selectedNode) }}</span>
                        </div>
                    </div>
                </div>
                <div v-else class="flex flex-1 items-center justify-center px-4 text-sm text-[var(--text-muted)]">
                    {{ t("agent.sessionTree.selectNodeHint") }}
                </div>
                <div class="border-t border-[var(--border-color)] bg-[var(--bg-main)] px-4 py-3">
                    <button type="button" class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-main)] text-sm font-medium text-[var(--text-inverse)] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.running || !props.canActivate || !selectedNode" @click="activateSelected">
                        <span class="i-lucide-git-branch h-4 w-4"></span>
                        {{ t("agent.sessionTree.activateNode") }}
                    </button>
                </div>
            </aside>
        </div>
    </Dialog>
</template>
