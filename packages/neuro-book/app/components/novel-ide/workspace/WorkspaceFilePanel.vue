<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {useI18n} from "vue-i18n";
import {storeToRefs} from "pinia";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import WorkspaceCreateFileDialog, {
    type WorkspaceCreateKind,
    type WorkspaceCreatePayload,
} from "nbook/app/components/novel-ide/workspace/WorkspaceCreateFileDialog.vue";
import WorkspaceFileTree from "nbook/app/components/novel-ide/workspace/WorkspaceFileTree.vue";
import WorkspaceFileDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceFileDetailPanel.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceLorebookDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceLorebookDetailPanel.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useWorkbenchFileTreeExpandedPaths} from "nbook/app/utils/workbench/files-view-session";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {buildDefaultWorkspaceCreatePath} from "nbook/app/utils/workspace-create-path";
import {buildWorkspacePathCopyText, type WorkspacePathCopyMode} from "nbook/app/utils/workspace-path-copy";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    canMovePath,
    collectAncestorPaths,
    isWorkspaceContentScopePath,
    isWorkspaceContentDirectoryNode,
    isWorkspaceLorebookScopePath,
    isWorkspaceLorebookEntry,
    normalizeWorkspacePath,
    resolveMovedPath,
    type WorkspaceFileMovePayload,
} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const store = useNovelIdeStore();
const {confirm, prompt} = useDialog();
const {error: notifyError, success: notifySuccess} = useNotification();
const {t} = useI18n();
const {
    canAccessWorkspace,
    loadingWorkspaceTree,
    selectedFileNode,
    selectedFilePath,
    workspaceIssues,
    workspaceTree,
} = storeToRefs(store);

const searchQuery = ref("");
/**
 * 展开项归 `workbench.files`/`expanded-paths` 的 user/local 记录（`persistence.md:98`）：
 * 本组件不再直接读写 `localStorage`（`boundaries.md:103`），旧裸键由会话一次性迁入。
 */
const expandedPathsRecord = useWorkbenchFileTreeExpandedPaths();
const expandedPaths = computed({
    get: () => [...expandedPathsRecord.expandedPaths.value],
    set: (paths: string[]) => void expandedPathsRecord.commit(paths),
});
const expandedPathsNotice = computed(() => expandedPathsRecord.notice.value);
/**
 * 读取就绪前不渲染树（`persistence.md`：「调整控件在读取就绪前不可用」）。
 *
 * 这条门禁是必须的，不是保险：树在挂载与节点变化时会把**整份** `expandedPaths` 当作意图 emit
 * （`WorkspaceFileTree` 的 `sanitizeExpandedPaths` 看护），而读取完成前这份值是产品默认——
 * 让它提交就是用默认值覆盖记录里已确认的展开项。读取中这里渲染加载态，树根本不挂载。
 */
const expandedPathsLoading = computed(() => expandedPathsRecord.loading.value);
/** 打开文件后的可见反馈：编辑器叶迁入前正文无处呈现，不静默失败。 */
const openedFilePath = ref("");
const detailHeight = ref(260);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const createDialogVisible = ref(false);
const createDialogKind = ref<WorkspaceCreateKind>("file");
const createDialogDefaultPath = ref("");
const creatingWorkspaceNode = ref(false);
const LOREBOOK_ENTRY_TYPES = ["location", "character", "item", "rule", "note"] as const;

type LorebookEntryType = typeof LOREBOOK_ENTRY_TYPES[number];

const filteredNodes = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
        return workspaceTree.value;
    }

    const matched = workspaceTree.value.filter((node) => [
        node.path,
        node.title,
        node.summary,
        node.entryType ?? "",
        node.status ?? "",
    ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query)));
    const ancestorPathSet = new Set(collectAncestorPaths(matched));
    return workspaceTree.value.filter((node) => matched.includes(node) || ancestorPathSet.has(node.path));
});
const forcedExpandedPaths = computed(() => searchQuery.value.trim() ? collectAncestorPaths(filteredNodes.value) : []);
const existingPathSet = computed(() => new Set(workspaceTree.value.map((node) => normalizeWorkspacePath(node.path))));
const showCharacterDetail = computed(() => isWorkspaceLorebookEntry(selectedFileNode.value) && selectedFileNode.value?.entryType === "character");
const showLorebookDetail = computed(() => isWorkspaceLorebookEntry(selectedFileNode.value) && selectedFileNode.value?.entryType !== "character");

/**
 * 打开右键菜单。
 */
function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = items;
    contextMenuVisible.value = true;
}

/**
 * 选择文件树节点。
 */
async function selectNode(node: WorkspaceFileNode): Promise<void> {
    await store.openWorkspaceNode(node, "preview");
}

/**
 * 双击打开节点并保留标签。
 *
 * 编辑器叶（Markdown Studio）还没迁入，正文暂时无处呈现：把这次打开如实说出来，
 * 不让链路看起来"什么都没发生"。
 */
async function openNode(node: WorkspaceFileNode): Promise<void> {
    const opened = await store.openWorkspaceNode(node, "permanent");
    if (opened !== null) {
        openedFilePath.value = opened.path;
    }
}

/** 重试未确认的展开项提交（旧键迁移失败也走这里重试）。 */
function retryExpandedPathsRecord(): void {
    void expandedPathsRecord.retry();
}

/** 放弃未确认的展开项调整，回到已确认值。 */
function abandonExpandedPathsRecord(): void {
    expandedPathsRecord.abandon();
}

/**
 * 刷新文件树。
 */
async function refreshTree(): Promise<void> {
    await store.loadWorkspaceTree();
}

/**
 * 复制当前文件路径或引用。
 */
async function copyPathText(node: WorkspaceFileNode, mode: WorkspacePathCopyMode): Promise<void> {
    if (!import.meta.client) {
        return;
    }
    await navigator.clipboard.writeText(buildWorkspacePathCopyText(node, mode));
}

/**
 * 打开新建 Dialog。
 */
function openCreateDialog(kind: WorkspaceCreateKind, defaultPath: string): void {
    createDialogKind.value = kind;
    createDialogDefaultPath.value = defaultPath;
    createDialogVisible.value = true;
}

/**
 * 处理新建 Dialog 提交。
 */
async function submitCreateDialog(payload: WorkspaceCreatePayload): Promise<void> {
    if (creatingWorkspaceNode.value) {
        return;
    }

    creatingWorkspaceNode.value = true;
    try {
        if (payload.kind === "directory") {
            const node = await store.createWorkspaceDirectory(payload.path);
            expandedPaths.value = [...new Set([...expandedPaths.value, node.path])];
            await store.selectWorkspacePath(node.path);
            notifySuccess(t("ide.workspace.filePanel.createSuccess", {path: node.path}), {title: t("ide.workspace.filePanel.createSuccessTitle")});
            createDialogVisible.value = false;
            return;
        }

        if (payload.kind === "lorebook") {
            const selectedType = payload.lorebookType;
            if (!selectedType) {
                return;
            }

            const filePath = normalizeLorebookEntryIndexPath(payload.path);
            if (!isWorkspaceLorebookScopePath(filePath)) {
                notifyError(t("ide.workspace.filePanel.newLorebookScopeError"), {title: t("ide.workspace.filePanel.createLorebookFailed")});
                return;
            }

            const node = await store.createWorkspaceFile(filePath, buildLorebookEntryContent(filePath, selectedType));
            expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(node.path)])].filter(Boolean);
            await store.selectWorkspacePath(node.path);
            notifySuccess(t("ide.workspace.filePanel.createSuccess", {path: node.path}), {title: t("ide.workspace.filePanel.createSuccessTitle")});
            createDialogVisible.value = false;
            return;
        }

        const node = await store.createWorkspaceFile(payload.path, "");
        expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(node.path)])].filter(Boolean);
        await store.selectWorkspacePath(node.path);
        notifySuccess(t("ide.workspace.filePanel.createSuccess", {path: node.path}), {title: t("ide.workspace.filePanel.createSuccessTitle")});
        createDialogVisible.value = false;
    } catch (error) {
        notifyError(resolveApiErrorMessage(error, formatCreateError(error)), {title: createFailedTitle(payload.kind)});
    } finally {
        creatingWorkspaceNode.value = false;
    }
}

/**
 * 为现有目录创建 index.md，使其成为可编辑目录节点。
 */
async function createDirectoryIndex(node: WorkspaceFileNode | null = selectedFileNode.value): Promise<void> {
    if (!node || !canCreateDirectoryIndex(node)) {
        return;
    }

    try {
        const dirPath = node.path.replace(/\/$/, "");
        const indexPath = `${dirPath}/index.md`;
        const indexNode = await store.createWorkspaceFile(indexPath, buildDirectoryIndexContent(node));
        expandedPaths.value = [...new Set([...expandedPaths.value, node.path])];
        await store.selectWorkspacePath(indexNode.path);
    } catch (error) {
        notifyError(formatCreateError(error), {title: t("ide.workspace.filePanel.convertDirectoryFailed")});
    }
}

/**
 * 将文件转换为同名目录下的 index.md。
 */
async function convertFileToDirectory(node: WorkspaceFileNode | null = selectedFileNode.value): Promise<void> {
    if (!node || !canConvertFileToDirectory(node)) {
        return;
    }

    try {
        const converted = await store.convertWorkspaceFileToDirectory(node.path);
        expandedPaths.value = [...new Set([...expandedPaths.value, converted.path])];
        await store.selectWorkspacePath(converted.path);
    } catch (error) {
        notifyError(formatCreateError(error), {title: t("ide.workspace.filePanel.convertFileFailed")});
    }
}

/**
 * 重命名或移动节点。
 */
async function renameNode(node: WorkspaceFileNode): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const currentPath = node.isDirectory ? node.path.replace(/\/$/, "") : node.path;
    const input = await prompt(t("ide.workspace.filePanel.renamePathPrompt"), currentPath);
    const nextPath = typeof input === "string" ? input.trim() : "";
    if (!nextPath || nextPath === currentPath) {
        return;
    }

    const moved = await store.renameWorkspacePath(currentPath, nextPath);
    expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(moved.path)])].filter(Boolean);
    await store.selectWorkspacePath(moved.path);
}

/**
 * 删除节点，目录失败后允许用户确认递归删除。
 */
async function deleteNode(node: WorkspaceFileNode): Promise<void> {
    if (!import.meta.client) {
        return;
    }

    const label = node.title || node.path;
    if (!await confirm(t("ide.workspace.filePanel.deleteConfirm", {label}))) {
        return;
    }

    try {
        await store.deleteWorkspacePath(node.path, false);
    } catch (error) {
        if (!node.isDirectory || !await confirm(t("ide.workspace.filePanel.deleteDirectoryRecursiveConfirm"))) {
            throw error;
        }
        await store.deleteWorkspacePath(node.path, true);
    }
}

/**
 * 执行拖拽移动。
 */
async function moveNode(payload: WorkspaceFileMovePayload): Promise<void> {
    const sourceNode = workspaceTree.value.find((node) => node.path === payload.sourcePath);
    if (!sourceNode) {
        return;
    }

    const targetDir = resolveDropTargetDirectory(payload);
    let nextPath = resolveMovedPath(sourceNode.path, targetDir);
    const currentExistingPathSet = new Set(existingPathSet.value);

    if (!canMovePath(sourceNode, targetDir, currentExistingPathSet)) {
        const resolvedPath = await resolveMoveConflictPath(sourceNode, targetDir, nextPath);
        if (!resolvedPath) {
            return;
        }
        nextPath = resolvedPath;
    }

    const currentSelection = selectedFilePath.value;
    try {
        await store.optimisticRenameWorkspacePath(sourceNode.path, nextPath);
        const nextSelection = resolveSelectionAfterMove(sourceNode.path, nextPath, currentSelection);
        await store.selectWorkspacePath(nextSelection);
    } catch (error) {
        notifyError(formatMoveError(error), {title: t("ide.workspace.filePanel.moveFailedTitle")});
    }
}

/**
 * 构造节点右键的新建子菜单。
 */
function buildNodeCreateMenu(node: WorkspaceFileNode, baseDir: string, siblingDir: string): ContextMenuItem {
    const children: ContextMenuItem[] = [
        {label: t("ide.workspace.filePanel.newChildFile"), iconClass: "i-lucide-file-plus", disabled: !node.isDirectory, action: () => openCreateDialog("file", defaultFilePath(baseDir))},
        {label: t("ide.workspace.filePanel.newChildDirectory"), iconClass: "i-lucide-folder-plus", disabled: !node.isDirectory, action: () => openCreateDialog("directory", defaultDirectoryPath(baseDir))},
    ];

    if (node.isDirectory && isWorkspaceLorebookScopePath(baseDir)) {
        children.push({label: t("ide.workspace.filePanel.newChildLorebook"), iconClass: "i-lucide-book-plus", action: () => openCreateDialog("lorebook", defaultLorebookPath(baseDir))});
    }

    children.push(
        {separator: true},
        {label: t("ide.workspace.filePanel.newSiblingFile"), iconClass: "i-lucide-file-plus-2", action: () => openCreateDialog("file", defaultFilePath(siblingDir))},
        {label: t("ide.workspace.filePanel.newSiblingDirectory"), iconClass: "i-lucide-folder-plus", action: () => openCreateDialog("directory", defaultDirectoryPath(siblingDir))},
    );

    if (isWorkspaceLorebookScopePath(siblingDir)) {
        children.push({label: t("ide.workspace.filePanel.newSiblingLorebook"), iconClass: "i-lucide-book-plus", action: () => openCreateDialog("lorebook", defaultLorebookPath(siblingDir))});
    }

    return {
        label: t("ide.workspace.filePanel.create"),
        iconClass: "i-lucide-plus",
        children,
    };
}

/**
 * 构造根区域右键的新建子菜单。
 */
function buildRootCreateMenu(): ContextMenuItem {
    return {
        label: t("ide.workspace.filePanel.create"),
        iconClass: "i-lucide-plus",
        children: [
            {label: t("ide.workspace.filePanel.newFile"), iconClass: "i-lucide-file-plus", action: () => openCreateDialog("file", defaultFilePath(""))},
            {label: t("ide.workspace.filePanel.newDirectory"), iconClass: "i-lucide-folder-plus", action: () => openCreateDialog("directory", defaultDirectoryPath(""))},
            {label: t("ide.workspace.filePanel.newLorebook"), iconClass: "i-lucide-book-plus", action: () => openCreateDialog("lorebook", defaultLorebookPath(null))},
        ],
    };
}

/**
 * 构造复制路径/引用子菜单。
 */
function buildCopyMenu(node: WorkspaceFileNode): ContextMenuItem {
    return {
        label: t("ide.workspace.common.copyReference"),
        iconClass: "i-lucide-copy",
        children: [
            {label: t("ide.workspace.filePanel.copyRelativePath"), iconClass: "i-lucide-link", action: () => void copyPathText(node, "relative-path")},
            {label: t("ide.workspace.filePanel.copyAbsolutePath"), iconClass: "i-lucide-hard-drive", action: () => void copyPathText(node, "absolute-path")},
            {separator: true},
            {label: t("ide.workspace.filePanel.copyRelativeReference"), iconClass: "i-lucide-brackets", action: () => void copyPathText(node, "relative-reference")},
            {label: t("ide.workspace.filePanel.copyAbsoluteReference"), iconClass: "i-lucide-brackets", action: () => void copyPathText(node, "absolute-reference")},
        ],
    };
}

/**
 * 打开节点右键菜单。
 */
function openNodeMenu(node: WorkspaceFileNode, event: MouseEvent): void {
    const baseDir = node.isDirectory ? node.path : resolveParentDirectory(node.path);
    const siblingDir = resolveParentDirectory(node.path);
    const items: ContextMenuItem[] = [
        {label: isWorkspaceContentDirectoryNode(node) ? t("ide.workspace.filePanel.openIndex") : t("ide.workspace.common.open"), iconClass: "i-lucide-folder-open", action: () => void openNode(node)},
        {
            label: node.isDirectory && expandedPaths.value.includes(node.path) ? t("ide.workspace.common.collapse") : t("ide.workspace.common.expand"),
            iconClass: "i-lucide-chevron-down",
            disabled: !node.isDirectory,
            action: () => toggleExpanded(node.path),
        },
        {separator: true},
        buildNodeCreateMenu(node, baseDir, siblingDir),
    ];
    if (canCreateDirectoryIndex(node)) {
        items.push({label: t("ide.workspace.filePanel.convertDirectoryNode"), iconClass: "i-lucide-file-symlink", action: () => void createDirectoryIndex(node)});
    }
    if (canConvertFileToDirectory(node)) {
        items.push({label: t("ide.workspace.filePanel.convertFileToDirectoryNode"), iconClass: "i-lucide-folder-input", action: () => void convertFileToDirectory(node)});
    }

    items.push(
        {separator: true},
        buildCopyMenu(node),
        {label: t("ide.workspace.common.rename"), iconClass: "i-lucide-pencil", action: () => void renameNode(node)},
        {label: t("ide.workspace.common.delete"), iconClass: "i-lucide-trash-2", danger: true, action: () => void deleteNode(node)},
    );
    openContextMenu(event, items);
}

/**
 * 打开根区域右键菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        buildRootCreateMenu(),
        {separator: true},
        {label: t("ide.workspace.common.refresh"), iconClass: "i-lucide-refresh-cw", action: () => void refreshTree()},
    ]);
}

/**
 * 切换目录展开。
 */
function toggleExpanded(path: string): void {
    const nextExpandedPaths = new Set(expandedPaths.value);
    if (nextExpandedPaths.has(path)) {
        nextExpandedPaths.delete(path);
    } else {
        nextExpandedPaths.add(path);
    }
    expandedPaths.value = [...nextExpandedPaths];
}

/**
 * 生成默认新文件路径。
 */
function defaultFilePath(baseDir: string): string {
    return buildDefaultWorkspaceCreatePath("file", baseDir);
}

/**
 * 生成默认新目录路径。
 */
function defaultDirectoryPath(baseDir: string): string {
    return buildDefaultWorkspaceCreatePath("directory", baseDir);
}

/**
 * 生成默认 Lorebook 条目路径。
 */
function defaultLorebookPath(baseDir: string | null): string {
    return buildDefaultWorkspaceCreatePath("lorebook", baseDir);
}

/**
 * 返回创建失败通知标题。
 */
function createFailedTitle(kind: WorkspaceCreateKind): string {
    if (kind === "directory") {
        return t("ide.workspace.filePanel.createDirectoryFailed");
    }
    if (kind === "lorebook") {
        return t("ide.workspace.filePanel.createLorebookFailed");
    }
    return t("ide.workspace.filePanel.createFileFailed");
}

function resolveParentDirectory(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    if (!normalizedPath.includes("/")) {
        return "";
    }
    return `${normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))}/`;
}

function resolveDropTargetDirectory(payload: WorkspaceFileMovePayload): string {
    if (payload.position === "root" || !payload.targetPath) {
        return "";
    }

    const targetNode = workspaceTree.value.find((node) => node.path === payload.targetPath);
    if (payload.position === "inside" && targetNode) {
        if (targetNode.isDirectory) {
            return targetNode.path;
        }
    }
    return resolveParentDirectory(payload.targetPath);
}

async function resolveMoveConflictPath(sourceNode: WorkspaceFileNode, targetDir: string, conflictedPath: string): Promise<string | null> {
    const normalizedSourcePath = normalizeWorkspacePath(sourceNode.path);
    const normalizedTargetDir = normalizeWorkspacePath(targetDir);
    if (normalizedTargetDir === normalizedSourcePath || normalizedTargetDir.startsWith(`${normalizedSourcePath}/`)) {
        return null;
    }
    if (normalizeWorkspacePath(conflictedPath) === normalizedSourcePath) {
        return null;
    }

    const suggestedPath = suggestAvailableMovePath(sourceNode, targetDir);
    const input = await prompt(t("ide.workspace.filePanel.moveConflictPrompt", {path: conflictedPath}), suggestedPath, t("ide.workspace.filePanel.moveConflictTitle"));
    const nextPath = typeof input === "string" ? input.trim() : "";
    if (!nextPath || nextPath === normalizeWorkspacePath(sourceNode.path) || existingPathSet.value.has(normalizeWorkspacePath(nextPath))) {
        return null;
    }
    return nextPath;
}

function suggestAvailableMovePath(sourceNode: WorkspaceFileNode, targetDir: string): string {
    const sourceName = basename(sourceNode.path);
    const {stem, extension} = splitName(sourceName);
    let renameSuffix = 1;
    let suggestedName = `${stem}-${renameSuffix}${extension}`;
    let suggestedPath = joinWorkspacePath(targetDir, suggestedName);
    while (existingPathSet.value.has(normalizeWorkspacePath(suggestedPath))) {
        renameSuffix++;
        suggestedName = `${stem}-${renameSuffix}${extension}`;
        suggestedPath = joinWorkspacePath(targetDir, suggestedName);
    }
    return suggestedPath;
}

function resolveSelectionAfterMove(sourcePath: string, nextPath: string, selectedPath: string): string {
    const normalizedSource = sourcePath.replace(/\/$/, "");
    const normalizedNext = nextPath.replace(/\/$/, "");
    if (selectedPath === sourcePath) {
        return nextPath;
    }
    if (selectedPath.startsWith(`${normalizedSource}/`)) {
        return `${normalizedNext}${selectedPath.slice(normalizedSource.length)}`;
    }
    return nextPath;
}

function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 将 Lorebook 条目路径归一化为目录节点的 index.md。
 */
function normalizeLorebookEntryIndexPath(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    if (normalizedPath.toLowerCase().endsWith("/index.md")) {
        return normalizedPath;
    }
    if (/\.md$/i.test(normalizedPath)) {
        return `${normalizedPath.replace(/\.md$/i, "")}/index.md`;
    }
    return `${normalizedPath}/index.md`;
}

/**
 * 生成文件化 Lorebook 条目的初始 Markdown 内容。
 */
function buildLorebookEntryContent(filePath: string, entryType: LorebookEntryType): string {
    const title = basename(resolveParentDirectory(filePath)).replace(/\.md$/i, "") || "new-entry";
    const characterBlock = entryType === "character"
        ? `character:\n    logline: ""\n    profile: {}\n    story: {}\n    meta:\n        pinned: false\n        primaryContext: null\n`
        : "";
    const subtypeBlock = entryType === "character" ? "subtype: person\n" : "";
    return `---\ntitle: ${JSON.stringify(title)}\ntype: ${entryType}\n${subtypeBlock}status: draft\naliases: []\ntags: []\nsummary: \"\"\nrefs: []\nretrieval:\n    enabled: true\n    trigger: null\ngovernance:\n    source: manual\n    review: proposed\n${characterBlock}---\n\n`;
}

function splitName(fileName: string): {stem: string; extension: string} {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) {
        return {stem: fileName, extension: ""};
    }
    return {
        stem: fileName.slice(0, dotIndex),
        extension: fileName.slice(dotIndex),
    };
}

function joinWorkspacePath(dirPath: string, fileName: string): string {
    return dirPath ? `${dirPath.replace(/\/$/, "")}/${fileName}` : fileName;
}

function canConvertFileToDirectory(node: WorkspaceFileNode): boolean {
    return !node.isDirectory && node.editable && isWorkspaceContentScopePath(node.path) && !node.path.toLowerCase().endsWith("/index.md");
}

function canCreateDirectoryIndex(node: WorkspaceFileNode): boolean {
    return node.isDirectory && !node.hasIndex && isWorkspaceContentScopePath(node.path);
}

function buildDirectoryIndexContent(node: WorkspaceFileNode): string {
    const title = node.title || basename(node.path) || "index";
    return `---\ntitle: ${JSON.stringify(title)}\nstatus: draft\n---\n\n`;
}

function formatMoveError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return t("ide.workspace.filePanel.moveFailedFallback");
}

/**
 * 格式化创建失败提示。
 */
function formatCreateError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return t("ide.workspace.filePanel.createFailedFallback");
}

onMounted(() => {
    if (canAccessWorkspace.value && workspaceTree.value.length === 0) {
        void store.loadWorkspaceTree();
    }
});

watch(canAccessWorkspace, (canAccess) => {
    if (canAccess && workspaceTree.value.length === 0) {
        void store.loadWorkspaceTree();
    }
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <!-- 工作区文件面板头部 -->
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
            <div class="relative min-w-0 flex-1">
                <span class="i-lucide-search absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"></span>
                <input v-model="searchQuery" type="text" :placeholder="t('ide.workspace.filePanel.searchPlaceholder')" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]">
            </div>
            <button type="button" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="void refreshTree()">
                <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
            </button>
        </div>

        <!-- 展开记录诊断：未保存 / 不可写 / 旧键迁移未完成都不静默 -->
        <div
            v-if="expandedPathsNotice"
            class="flex shrink-0 items-start gap-2 border-b border-[var(--border-color)] bg-[var(--status-warning-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--status-warning)]"
            role="status"
            aria-live="polite"
            data-file-panel-record-notice
        >
            <span class="min-w-0 flex-1">{{ t("ide.workspace.filePanel.recordNotice", {diagnosis: expandedPathsNotice.diagnosis}) }}</span>
            <button v-if="expandedPathsNotice.retryable" type="button" class="shrink-0 underline" @click="retryExpandedPathsRecord()">
                {{ t("ide.workspace.filePanel.recordRetry") }}
            </button>
            <button v-if="expandedPathsNotice.abandonable" type="button" class="shrink-0 underline" @click="abandonExpandedPathsRecord()">
                {{ t("ide.workspace.filePanel.recordAbandon") }}
            </button>
        </div>

        <!-- 打开文件的可见结果：编辑器叶迁入前正文无处呈现，本次打开如实报出 -->
        <div
            v-if="openedFilePath"
            class="flex shrink-0 items-start gap-2 border-b border-[var(--border-color)] bg-[var(--bg-hover)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]"
            role="status"
            aria-live="polite"
            data-file-panel-open-notice
        >
            <span class="min-w-0 flex-1 break-all">{{ t("ide.workspace.filePanel.openedWithoutEditor", {path: openedFilePath}) }}</span>
            <button type="button" class="shrink-0 underline" @click="openedFilePath = ''">
                {{ t("ide.workspace.filePanel.openNoticeDismiss") }}
            </button>
        </div>

        <!-- 工作区文件树容器 -->
        <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
            <div v-if="expandedPathsLoading || (loadingWorkspaceTree && workspaceTree.length === 0)" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]">
                {{ t("ide.workspace.filePanel.loadingTree") }}
            </div>
            <div v-else-if="filteredNodes.length === 0" class="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[var(--border-color)] text-xs text-[var(--text-muted)]" @contextmenu.prevent.stop="openRootMenu">
                {{ t("ide.workspace.filePanel.emptyTree") }}
            </div>
            <WorkspaceFileTree
                v-else
                v-model:expanded-paths="expandedPaths"
                :nodes="filteredNodes"
                :selected-path="selectedFilePath"
                :forced-expanded-paths="forcedExpandedPaths"
                @select="selectNode"
                @open="openNode"
                @move="moveNode"
                @node-contextmenu="openNodeMenu"
                @root-contextmenu="openRootMenu"
            />
        </div>

        <WorkspaceCharacterDetailPanel
            v-if="showCharacterDetail"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @refresh="void refreshTree()"
        />
        <WorkspaceLorebookDetailPanel
            v-else-if="showLorebookDetail"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @refresh="void refreshTree()"
        />
        <WorkspaceFileDetailPanel
            v-else
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="detailHeight"
            @update:height="detailHeight = $event"
            @close="store.clearActiveFile()"
            @create-index="void createDirectoryIndex()"
            @convert-file-to-directory="void convertFileToDirectory()"
        />

        <ContextMenu
            :visible="contextMenuVisible"
            :x="contextMenuX"
            :y="contextMenuY"
            :items="contextMenuItems"
            @close="contextMenuVisible = false"
        />

        <WorkspaceCreateFileDialog
            v-model="createDialogVisible"
            :kind="createDialogKind"
            :default-path="createDialogDefaultPath"
            :busy="creatingWorkspaceNode"
            :restrict-lorebook-scope="createDialogKind === 'lorebook'"
            @submit="void submitCreateDialog($event)"
        />
    </div>
</template>
