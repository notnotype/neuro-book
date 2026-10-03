<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {useI18n} from "vue-i18n";
import {storeToRefs} from "pinia";
import ContextMenu, {type ContextMenuItem} from "nbook/app/components/common/ContextMenu.vue";
import WorkspaceCreateFileDialog, {type WorkspaceCreateKind, type WorkspaceCreatePayload} from "nbook/app/components/novel-ide/workspace/WorkspaceCreateFileDialog.vue";
import FilesExplorerView from "nbook/app/components/novel-ide/workspace/FilesExplorerView.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import {useWorkbenchFileTreeExpandedPaths, useWorkbenchFilesViewMode} from "nbook/app/utils/workbench/files-view-session";
import type {CommandResult} from "nbook/app/utils/workbench/commands";
import type {ViewTitleActionState, WorkbenchViewActionHandle} from "nbook/app/utils/workbench/view-title-actions";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {buildDefaultWorkspaceCreatePath} from "nbook/app/utils/workspace-create-path";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFilesViewMode} from "nbook/shared/storage/workbench-files";
import {normalizeWorkspacePath, outermostWorkspacePaths, resolveMovedPath, type WorkspaceFileClipboardIntent, type WorkspaceFileMovePayload} from "nbook/app/components/novel-ide/workspace/workspace-file-tree";

const store = useNovelIdeStore();
const {confirm, prompt, choose} = useDialog();
const {error: notifyError, success: notifySuccess} = useNotification();
const {t} = useI18n();
const {canAccessWorkspace, loadingWorkspaceTree, selectedFilePath, workspaceTree} = storeToRefs(store);
const treeError = ref<string | null>(null);

const modeRecord = useWorkbenchFilesViewMode();
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
/** 首读完成前不挂载树，防止默认展开项覆盖已确认记录。 */
const expandedPathsLoading = computed(() => expandedPathsRecord.loading.value);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuItems = ref<ContextMenuItem[]>([]);
const createDialogVisible = ref(false);
const createDialogKind = ref<WorkspaceCreateKind>("file");
const createDialogDefaultPath = ref("");
const creatingWorkspaceNode = ref(false);
const modeLoading = computed(() => modeRecord.loading.value);
const modeNotice = computed(() => modeRecord.notice.value);
const existingPathSet = computed(() => new Set(workspaceTree.value.map((node) => normalizeWorkspacePath(node.path))));
const selectedPaths = ref<string[]>([]);
type FileResult = {source: string; target: string; status: "success" | "failed" | "skipped" | "not-executed" | "cancelled" | "unknown"; reason?: string; residualPaths?: readonly string[]};
type FrozenSource = {path: string; identity: NonNullable<WorkspaceFileNode["sourceIdentity"]>};
type Clipboard = {kind: "copy" | "cut"; sources: FrozenSource[]; generation: number};
const clipboard = ref<Clipboard | null>(null);
const clipboardPending = ref(false);
const clipboardUnknown = ref(false);
const unknownChecks = ref<Array<{source: string; target: string; sourceState: string; targetState: string}>>([]);
const checkingUnknown = ref(false);
const batchItems = ref<FileResult[]>([]);
const batchBusy = ref(false);
const cancelBatch = ref(false);
const pastePending = ref(false);

watch(() => store.workspaceGeneration, () => {
    selectedPaths.value = [];
    clipboard.value = null;
    clipboardUnknown.value = false;
    unknownChecks.value = [];
    createDialogVisible.value = false;
    batchItems.value = [];
});

function changeSelectedPaths(paths: string[]): void {
    selectedPaths.value = [...paths];
}

async function handleClipboardIntent(intent: WorkspaceFileClipboardIntent): Promise<void> {
    if (intent.kind === "clear") {
        if (!batchBusy.value && !clipboardUnknown.value && !clipboardPending.value) clipboard.value = null;
        return;
    }
    if (intent.kind === "paste") {
        await pasteWorkspacePaths(intent.destination);
        return;
    }
    if (batchBusy.value || clipboardPending.value || clipboardUnknown.value || checkingUnknown.value || !intent.sources.length) return;
    const generation = store.workspaceGeneration;
    const paths = outermostWorkspacePaths(intent.sources);
    clipboard.value = null;
    clipboardPending.value = true;
    try {
        const sources: FrozenSource[] = [];
        for (const path of paths) {
            const stat = await store.statWorkspacePath(path);
            if (generation !== store.workspaceGeneration) return;
            if (!stat.sourceIdentity) throw new Error("无法确认来源身份，请重新选择");
            sources.push({path, identity: stat.sourceIdentity});
        }
        if (generation === store.workspaceGeneration && store.canAccessWorkspace) clipboard.value = {kind: intent.kind, sources, generation};
    } catch (error) {
        if (generation === store.workspaceGeneration) notifyError(resolveApiErrorMessage(error, "无法确认来源身份"), {title: "未复制文件"});
    } finally {
        clipboardPending.value = false;
    }
}

function affectedDirtyPaths(sources: readonly string[]): string[] {
    const normalized = sources.map(source => normalizeWorkspacePath(source).replace(/\/$/, ""));
    return Object.entries(store.workspaceBuffers)
        .filter(([path, buffer]) => buffer.content !== buffer.lastSyncedContent
            && normalized.some(source => path === source || path.startsWith(`${source}/`)))
        .map(([path]) => path);
}

function sameSourceIdentity(a: FrozenSource["identity"], b: FrozenSource["identity"]): boolean {
    return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}

function activeGeneration(generation: number): boolean {
    return generation === store.workspaceGeneration && store.canAccessWorkspace;
}

function validTargetName(name: string): boolean {
    return name.length > 0 && name !== "." && name !== ".." && !/[\\/]/.test(name);
}

async function negotiateTargets(kind: "copy" | "move", sources: readonly FrozenSource[], destination: string, generation: number): Promise<{names: Record<string, string>; skipped: FileResult[]} | null> {
    const names: Record<string, string> = {};
    const skipped: FileResult[] = [];
    const reserved = new Set(existingPathSet.value);
    for (const source of sources) {
        if (!activeGeneration(generation)) return null;
        const path = source.path;
        let target = resolveMovedPath(path, destination);
        if (kind === "move" && normalizeWorkspacePath(target) === normalizeWorkspacePath(path)) {
            skipped.push({source: path, target, status: "skipped", reason: "已经在目标目录"});
            continue;
        }
        if (reserved.has(normalizeWorkspacePath(target))) {
            const suggestion = suggestAvailableMovePath({path}, destination, reserved);
            const choice = await choose(`${target} 已存在，如何处理 ${path}？`, [
                {label: `改名为 ${basename(suggestion)}`, value: "rename", tone: "primary"},
                {label: "跳过这一项", value: "skip"},
                {label: "取消后续操作", value: "cancel"},
            ]);
            if (!activeGeneration(generation)) return null;
            if (choice === "cancel" || choice === null) {
                skipped.push({source: path, target, status: "cancelled", reason: "用户取消"});
                return {names, skipped};
            }
            if (choice === "skip") {
                skipped.push({source: path, target, status: "skipped", reason: "用户跳过"});
                continue;
            }
            if (choice !== "rename") return {names, skipped: [...skipped, {source: path, target, status: "cancelled", reason: "用户取消"}]};
            const input = await prompt("输入新的文件名", basename(suggestion));
            if (!activeGeneration(generation)) return null;
            const newName = typeof input === "string" ? input.trim() : "";
            if (!validTargetName(newName) || reserved.has(normalizeWorkspacePath(resolveMovedPath(newName, destination)))) {
                skipped.push({source: path, target, status: "skipped", reason: "目标名无效或已存在"});
                continue;
            }
            names[normalizeWorkspacePath(path)] = newName;
            target = resolveMovedPath(newName, destination);
        }
        reserved.add(normalizeWorkspacePath(target));
    }
    return {names, skipped};
}

async function runBatch(kind: "copy" | "move", sources: readonly FrozenSource[], destination: string, generation: number, intent?: Clipboard): Promise<void> {
    if (batchBusy.value || !activeGeneration(generation)) return;
    batchBusy.value = true;
    cancelBatch.value = false;
    const items: FileResult[] = [];
    try {
        const plan = await negotiateTargets(kind, sources, destination, generation);
        if (!plan) return;
        items.push(...plan.skipped);
        batchItems.value = [...items];
        const stopped = plan.skipped.some(item => item.status === "cancelled");
        for (const source of sources) {
            if (plan.skipped.some(item => item.source === source.path)) continue;
            const target = resolveMovedPath(plan.names[normalizeWorkspacePath(source.path)] ?? source.path, destination);
            if (stopped || cancelBatch.value || !activeGeneration(generation)) {
                items.push({source: source.path, target, status: "not-executed", reason: "操作已停止"});
                if (activeGeneration(generation)) batchItems.value = [...items];
                continue;
            }
            if (store.flushEditorPending() === "conflict" || store.hasUnresolvedEditorChanges) {
                items.push({source: source.path, target, status: "failed", reason: "编辑输入尚未结算"});
                cancelBatch.value = true;
                batchItems.value = [...items];
                continue;
            }
            let stat: WorkspaceFileNode;
            try {
                stat = await store.statWorkspacePath(source.path);
            } catch (error) {
                if (!activeGeneration(generation)) break;
                items.push({source: source.path, target, status: "failed", reason: resolveApiErrorMessage(error, "无法确认来源，请重新选择")});
                if (mutationStopReason(error)) cancelBatch.value = true;
                batchItems.value = [...items];
                continue;
            }
            if (!activeGeneration(generation)) break;
            if (!stat.sourceIdentity || !sameSourceIdentity(stat.sourceIdentity, source.identity)) {
                items.push({source: source.path, target, status: "failed", reason: "来源已被替换，请重新选择"});
                batchItems.value = [...items];
                continue;
            }
            try {
                const targetName = plan.names[normalizeWorkspacePath(source.path)];
                const response = await store.batchWorkspacePaths(kind, [source.path], destination, {
                    targetNames: targetName ? {[normalizeWorkspacePath(source.path)]: targetName} : undefined,
                    expectedSources: {[normalizeWorkspacePath(source.path)]: source.identity},
                });
                if (!activeGeneration(generation)) break;
                if (response.refreshError) notifyError(`文件操作已结算，但文件树刷新失败：${response.refreshError}`, {title: "文件树未刷新"});
                const result = response.items[0];
                items.push(result ?? {source: source.path, target, status: "unknown", reason: "服务端未返回逐项结果，请核对实际源和目标"});
                if (!result || result.status === "unknown") { clipboardUnknown.value = true; cancelBatch.value = true; }
                if (result?.stopReason) cancelBatch.value = true;
            } catch (error) {
                if (!activeGeneration(generation)) break;
                const known = isKnownMutationFailure(error);
                const message = resolveApiErrorMessage(error, "结果未知，请核对实际源和目标");
                const bindingFailure = message.includes("绑定") || message.includes("工作区已切换") || message.includes("未解决的编辑输入");
                items.push({source: source.path, target, status: known || bindingFailure ? "failed" : "unknown", reason: message});
                if (!known && !bindingFailure) { clipboardUnknown.value = true; cancelBatch.value = true; }
                if (bindingFailure || mutationStopReason(error)) cancelBatch.value = true;
            }
            if (!activeGeneration(generation)) break;
            if (activeGeneration(generation)) batchItems.value = [...items];
        }
        if (!activeGeneration(generation)) return;
        batchItems.value = items;
        if (kind === "move" && intent && clipboard.value === intent) {
            const succeeded = new Set(items.filter(item => item.status === "success").map(item => normalizeWorkspacePath(item.source)));
            clipboard.value = {...intent, sources: intent.sources.filter(source => !succeeded.has(normalizeWorkspacePath(source.path)))};
        }
        const unfinished = items.filter(item => item.status !== "success");
        if (unfinished.length) notifyError(`${unfinished.length} 项未完成，请检查逐项结果`, {title: "文件操作部分完成"});
        else notifySuccess(`${items.length} 项已完成`, {title: "文件操作完成"});
    } finally {
        batchBusy.value = false;
        cancelBatch.value = false;
    }
}

async function pasteWorkspacePaths(destination: string): Promise<void> {
    const intent = clipboard.value;
    if (!intent || pastePending.value || clipboardUnknown.value || clipboardPending.value || batchBusy.value || !activeGeneration(intent.generation) || !intent.sources.length) return;
    pastePending.value = true;
    try {
        const sources = [...intent.sources];
        const paths = sources.map(source => source.path);
        const generation = intent.generation;
        if (store.flushEditorPending() === "conflict" || store.hasUnresolvedEditorChanges) return;
        const dirty = affectedDirtyPaths(paths);
        if (intent.kind === "copy" && dirty.length) {
            const decision = await choose(`复制 ${paths.join("、")} 到 ${destination || "根目录"}；以下文件有未保存内容：${dirty.join("、")}`, [
                {label: "先保存再复制", value: "save", tone: "primary"},
                {label: "复制已保存的磁盘版本", value: "disk"},
                {label: "取消", value: "cancel"},
            ]);
            if ((decision !== "save" && decision !== "disk") || !activeGeneration(generation) || clipboard.value !== intent) return;
            if (decision === "save" && !await store.saveDirtyWorkspaceFiles()) {
                notifyError("未保存内容尚未结算，复制已取消", {title: "文件操作已取消"});
                return;
            }
            if (!activeGeneration(generation) || clipboard.value !== intent) return;
        } else if (!await confirm(`${intent.kind === "copy" ? "复制" : "移动"} ${paths.join("、")} 到 ${destination || "根目录"}？`)) return;
        if (!activeGeneration(generation) || clipboard.value !== intent) return;
        await runBatch(intent.kind === "cut" ? "move" : "copy", sources, destination, generation, intent);
    } finally {
        pastePending.value = false;
    }
}

async function checkUnknownPaths(): Promise<void> {
    if (!clipboardUnknown.value || checkingUnknown.value || batchBusy.value) return;
    const generation = store.workspaceGeneration;
    checkingUnknown.value = true;
    const checks: typeof unknownChecks.value = [];
    try {
        for (const item of batchItems.value.filter(entry => entry.status === "unknown")) {
            const check = async (path: string): Promise<string> => {
                try {
                    const stat = await store.statWorkspacePath(path);
                    return stat.sourceIdentity ? "存在" : "存在（身份未确认）";
                } catch (error) {
                    if (isMissingFile(error)) return "不存在";
                    return `无法核对：${resolveApiErrorMessage(error, "读取失败")}`;
                }
            };
            const sourceState = await check(item.source);
            if (!activeGeneration(generation)) return;
            const targetState = await check(item.target);
            if (!activeGeneration(generation)) return;
            checks.push({source: item.source, target: item.target, sourceState, targetState});
        }
        unknownChecks.value = checks;
    } finally {
        checkingUnknown.value = false;
    }
}

function isMissingFile(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const value = error as {statusCode?: number; status?: number; data?: {code?: string}};
    return value.statusCode === 404 || value.status === 404 || value.data?.code === "ENOENT";
}

async function clearUnknownClipboard(): Promise<void> {
    if (!clipboardUnknown.value || batchBusy.value || checkingUnknown.value || !unknownChecks.value.length) return;
    const generation = store.workspaceGeneration;
    if (!await confirm("请根据核对结果自行检查实际文件内容。此处仍不能确定写入是否完成；放弃旧剪贴意图后可重新选择文件，确定继续？")) return;
    if (!activeGeneration(generation)) return;
    clipboard.value = null;
    clipboardUnknown.value = false;
    unknownChecks.value = [];
}



function changeMode(mode: WorkspaceFilesViewMode): void {
    if (modeLoading.value) return;
    contextMenuVisible.value = false;
    void modeRecord.commit(mode);
}

/**
 * 打开右键菜单。
 */
function openContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuItems.value = items;
    contextMenuVisible.value = true;
}

/** 树选择只负责打开，失败不把旧正文冒充新文档。 */
async function activateNode(node: WorkspaceFileNode, mode: "preview" | "permanent"): Promise<void> {
    try {
        const opened = await store.openWorkspaceNode(node, mode);
        if (!opened) notifyError("当前编辑内容尚未结算，请先处理冲突", {title: "未打开文件"});
    } catch (error) {
        notifyError(resolveApiErrorMessage(error, "打开文件失败"), {title: "打开文件失败"});
    }
}
const selectNode = (node: WorkspaceFileNode): Promise<void> => activateNode(node, "preview");
const openNode = (node: WorkspaceFileNode): Promise<void> => activateNode(node, "permanent");

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
 *
 * 它同时是**标题动作** `refresh` 的实现：动作的声明在 `SHELL_FILES_VIEW.titleActions`（descriptor），
 * 这里只把状态与句柄报给宿主（`WorkbenchViewInstances` 转发，`useWorkbenchViewActions` 收）。
 * 内容头不再有第二个刷新入口——同一个动作只有一条路径。
 */
async function refreshTree(): Promise<void> {
    treeError.value = null;
    try {
        await store.loadWorkspaceTree();
    } catch (error) {
        treeError.value = resolveApiErrorMessage(error, "读取文件树失败");
        throw error;
    }
}

/** 本视图在 descriptor 里声明的标题动作 id（`SHELL_FILES_VIEW.titleActions[].id`）。 */
const TITLE_ACTION_REFRESH = "refresh";

const emitViewAction = defineEmits<{
    (e: "actions-change", states: readonly ViewTitleActionState[]): void;
    (e: "action-handle-ready", handle: WorkbenchViewActionHandle | null): void;
}>();

/** 运行时状态：加载中就是 busy，同时也给出禁用原因（按钮照常渲染，看得见但不能点）。 */
const titleActionStates = computed<readonly ViewTitleActionState[]>(() => [{
    id: TITLE_ACTION_REFRESH,
    enabled: !loadingWorkspaceTree.value,
    ...(loadingWorkspaceTree.value ? {reason: "文件树正在加载"} : {}),
    busy: loadingWorkspaceTree.value,
}]);

/**
 * 执行句柄：宿主点击标题按钮时经命令路由到这里。
 * 结果一律结构化——失败不是抛出去，而是带回原因（宿主只负责展示一次）。
 */
async function runTitleAction(actionId: string): Promise<CommandResult<unknown>> {
    if (actionId !== TITLE_ACTION_REFRESH) {
        return {ok: false, code: "unknown-command", reason: `未登记的视图动作：${actionId}`};
    }
    if (loadingWorkspaceTree.value) {
        return {ok: false, code: "unavailable", reason: "文件树正在加载"};
    }
    try {
        await refreshTree();
        return {ok: true, value: null};
    } catch (error) {
        return {
            ok: false,
            code: "execution-error",
            reason: resolveApiErrorMessage(error, t("ide.workspace.filePanel.refreshFailedFallback")),
        };
    }
}

const titleActionHandle: WorkbenchViewActionHandle = {runAction: runTitleAction};

watch(titleActionStates, (states) => emitViewAction("actions-change", states), {immediate: true});


/**
 * 打开新建 Dialog。
 */
let createDialogGeneration = -1;
function openCreateDialog(kind: WorkspaceCreateKind, defaultPath: string): void {
    createDialogGeneration = store.workspaceGeneration;
    createDialogKind.value = kind;
    createDialogDefaultPath.value = defaultPath;
    createDialogVisible.value = true;
}

/**
 * 处理新建 Dialog 提交。
 */
async function submitCreateDialog(payload: WorkspaceCreatePayload): Promise<void> {
    const generation = createDialogGeneration;
    const path = payload.path;
    if (creatingWorkspaceNode.value || !createDialogVisible.value || !activeGeneration(generation)) return;
    creatingWorkspaceNode.value = true;
    try {
        const node = payload.kind === "directory"
            ? await store.createWorkspaceDirectory(path)
            : await store.createWorkspaceFile(path, "");
        if (!activeGeneration(generation) || createDialogGeneration !== generation || !createDialogVisible.value) return;
        expandedPaths.value = [...new Set([...expandedPaths.value, payload.kind === "directory" ? node.path : resolveParentDirectory(node.path)])].filter(Boolean);
        await store.selectWorkspacePath(node.path);
        if (!activeGeneration(generation) || createDialogGeneration !== generation) return;
        notifySuccess(t("ide.workspace.filePanel.createSuccess", {path: node.path}), {title: t("ide.workspace.filePanel.createSuccessTitle")});
        createDialogVisible.value = false;
    } catch (error) {
        if (activeGeneration(generation)) notifyError(resolveApiErrorMessage(error, formatCreateError(error)), {title: createFailedTitle(payload.kind)});
    } finally {
        creatingWorkspaceNode.value = false;
    }
}

async function createDirectoryIndex(node: WorkspaceFileNode): Promise<void> {
    const generation = store.workspaceGeneration;
    if (!node.isDirectory || workspaceTree.value.some(item => normalizeWorkspacePath(item.path) === `${normalizeWorkspacePath(node.path)}/index.md`)) return;
    try {
        const indexNode = await store.createWorkspaceFile(`${normalizeWorkspacePath(node.path)}/index.md`, "");
        if (activeGeneration(generation)) await store.openWorkspaceNode(indexNode, "permanent");
    } catch (error) {
        if (activeGeneration(generation)) notifyError(resolveApiErrorMessage(error, "创建内容失败"), {title: "创建内容失败"});
    }
}

async function createRootContent(): Promise<void> {
    const generation = store.workspaceGeneration;
    try {
        const node = await store.createWorkspaceFile("index.md", "");
        if (activeGeneration(generation)) await store.openWorkspaceNode(node, "permanent");
    } catch (error) {
        if (activeGeneration(generation)) notifyError(resolveApiErrorMessage(error, "创建内容失败"), {title: "创建内容失败"});
    }
}

/**
 * 重命名或移动节点。
 */
async function renameNode(node: WorkspaceFileNode): Promise<void> {
    const generation = store.workspaceGeneration;
    const currentPath = node.isDirectory ? node.path.replace(/\/$/, "") : node.path;
    const input = await prompt(t("ide.workspace.filePanel.renamePathPrompt"), currentPath);
    if (!activeGeneration(generation)) return;
    const nextPath = typeof input === "string" ? input.trim() : "";
    if (!nextPath || nextPath === currentPath) return;
    const moved = await store.renameWorkspacePath(currentPath, nextPath);
    if (!activeGeneration(generation)) return;
    if (moved.refreshError) notifyError(`重命名已结算，但文件树刷新失败：${moved.refreshError}`, {title: "文件树未刷新"});
    expandedPaths.value = [...new Set([...expandedPaths.value, resolveParentDirectory(moved.path)])].filter(Boolean);
    await store.selectWorkspacePath(moved.path);
}

/** One confirmation covers the frozen outermost selection and its descendants. */
async function deleteNode(node: WorkspaceFileNode): Promise<void> {
    if (batchBusy.value || pastePending.value || clipboardUnknown.value) return;
    const generation = store.workspaceGeneration;
    const selected = selectedPaths.value.includes(node.path) ? selectedPaths.value : [node.path];
    const paths = outermostWorkspacePaths(selected);
    const nodes = paths.map(path => workspaceTree.value.find(entry => normalizeWorkspacePath(entry.path) === normalizeWorkspacePath(path)));
    if (nodes.some(entry => !entry) || store.flushEditorPending() === "conflict") return;
    const affected = workspaceTree.value.filter(entry => paths.some(path => normalizeWorkspacePath(entry.path) === normalizeWorkspacePath(path)
        || normalizeWorkspacePath(entry.path).startsWith(`${normalizeWorkspacePath(path)}/`))).map(entry => entry.path);
    const dirty = affectedDirtyPaths(paths);
    if (dirty.length || store.hasUnresolvedEditorChanges) {
        notifyError(`未保存或待裁决文件：${dirty.join("、") || "编辑器输入"}。请先保存或处理冲突`, {title: "删除已取消"});
        return;
    }
    if (!await confirm(`将删除 ${paths.join("、")}，涉及 ${affected.length} 个资源：${affected.join("、")}。此操作不可由编辑器撤销恢复，确定继续？`)) return;
    if (!activeGeneration(generation)) return;
    batchBusy.value = true;
    cancelBatch.value = false;
    const items: FileResult[] = [];
    try {
        for (const [index, path] of paths.entries()) {
            if (cancelBatch.value || !activeGeneration(generation)) {
                items.push({source: path, target: path, status: "not-executed", reason: "操作已停止"});
                continue;
            }
            const newDirty = affectedDirtyPaths([path]);
            if (store.flushEditorPending() === "conflict" || store.hasUnresolvedEditorChanges || newDirty.length) {
                items.push({source: path, target: path, status: "cancelled", reason: `未保存或待裁决输入：${newDirty.join("、") || "编辑器输入"}`});
                cancelBatch.value = true;
                continue;
            }
            try {
                const outcome = await store.deleteWorkspacePath(path, nodes[index]!.isDirectory);
                if (!activeGeneration(generation)) return;
                items.push({source: path, target: path, status: "success"});
                if (outcome.refreshError) notifyError(`删除已结算，但文件树刷新失败：${outcome.refreshError}`, {title: "文件树未刷新"});
            } catch (error) {
                const reason = resolveApiErrorMessage(error, "删除结果未知，请核对磁盘");
                const stopReason = mutationStopReason(error);
                const known = isKnownMutationFailure(error);
                items.push({source: path, target: path, status: known ? "failed" : "unknown", reason});
                if (!known) { clipboardUnknown.value = true; cancelBatch.value = true; }
                if (stopReason) cancelBatch.value = true;
            }
            if (activeGeneration(generation)) batchItems.value = [...items];
        }
        if (activeGeneration(generation)) {
            batchItems.value = items;
            if (items.some(item => item.status !== "success")) notifyError("部分文件未删除，请检查逐项结果", {title: "删除部分完成"});
            else notifySuccess(`${items.length} 项已删除`, {title: "删除完成"});
        }
    } finally {
        batchBusy.value = false;
        cancelBatch.value = false;
    }
}
function mutationStopReason(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const value = error as {statusCode?: number; status?: number; data?: {code?: string}};
    const status = value.statusCode ?? value.status;
    return status === 401 || status === 403 || (status === 409 && ["PROJECT_NOT_OPEN", "ROOT_REPLACED", "PROJECT_BINDING_INVALID"].includes(value.data?.code ?? ""));
}

function isKnownMutationFailure(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    const value = error as {statusCode?: number; status?: number};
    const status = value.statusCode ?? value.status;
    return typeof status === "number" && status >= 400 && status < 500;
}
/** Dragging a selected row moves the frozen outermost selection through the same collision flow. */
async function moveNode(payload: WorkspaceFileMovePayload): Promise<void> {
    if (batchBusy.value || pastePending.value) return;
    const generation = store.workspaceGeneration;
    const paths = outermostWorkspacePaths(payload.sourcePaths ?? [payload.sourcePath]);
    const targetDir = resolveDropTargetDirectory(payload);
    if (paths.some(path => {
        const target = normalizeWorkspacePath(targetDir);
        const source = normalizeWorkspacePath(path);
        return target === source || target.startsWith(`${source}/`);
    })) return;
    const sources: FrozenSource[] = [];
    try {
        for (const path of paths) {
            const stat = await store.statWorkspacePath(path);
            if (!activeGeneration(generation)) return;
            if (!stat.sourceIdentity) throw new Error("无法确认来源身份，请重新拖动");
            sources.push({path, identity: stat.sourceIdentity});
        }
        if (store.flushEditorPending() === "conflict" || store.hasUnresolvedEditorChanges) return;
        await runBatch("move", sources, targetDir, generation);
    } catch (error) {
        if (activeGeneration(generation)) notifyError(resolveApiErrorMessage(error, "移动文件失败"), {title: t("ide.workspace.filePanel.moveFailedTitle")});
    }
}

/**
 * 构造节点右键的新建子菜单。
 */
function buildNodeCreateMenu(node: WorkspaceFileNode, baseDir: string, siblingDir: string): ContextMenuItem {
    return {
        label: t("ide.workspace.filePanel.create"),
        iconClass: "i-lucide-plus",
        children: [
            {label: t("ide.workspace.filePanel.newChildFile"), iconClass: "i-lucide-file-plus", disabled: !node.isDirectory, action: () => openCreateDialog("file", defaultFilePath(baseDir))},
            {label: t("ide.workspace.filePanel.newChildDirectory"), iconClass: "i-lucide-folder-plus", disabled: !node.isDirectory, action: () => openCreateDialog("directory", defaultDirectoryPath(baseDir))},
            {separator: true},
            {label: t("ide.workspace.filePanel.newSiblingFile"), iconClass: "i-lucide-file-plus-2", action: () => openCreateDialog("file", defaultFilePath(siblingDir))},
            {label: t("ide.workspace.filePanel.newSiblingDirectory"), iconClass: "i-lucide-folder-plus", action: () => openCreateDialog("directory", defaultDirectoryPath(siblingDir))},
        ],
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
        ...(!node.isDirectory || (modeRecord.mode.value === "content" && node.contentNode)
            ? [{label: node.isDirectory ? t("ide.workspace.filePanel.openIndex") : t("ide.workspace.common.open"), iconClass: "i-lucide-folder-open", action: () => void openNode(node)}]
            : []),
        {label: node.isDirectory && expandedPaths.value.includes(node.path) ? t("ide.workspace.common.collapse") : t("ide.workspace.common.expand"), iconClass: "i-lucide-chevron-down", disabled: !node.isDirectory, action: () => toggleExpanded(node.path)},
        {separator: true},
        buildNodeCreateMenu(node, baseDir, siblingDir),
        {label: "复制", iconClass: "i-lucide-copy", disabled: clipboardUnknown.value || clipboardPending.value, action: () => void handleClipboardIntent({kind: "copy", sources: selectedPaths.value.includes(node.path) ? selectedPaths.value : [node.path]})},
        {label: "剪切", iconClass: "i-lucide-scissors", disabled: clipboardUnknown.value || clipboardPending.value, action: () => void handleClipboardIntent({kind: "cut", sources: selectedPaths.value.includes(node.path) ? selectedPaths.value : [node.path]})},
        {label: "粘贴", iconClass: "i-lucide-clipboard-paste", disabled: !clipboard.value || clipboardUnknown.value || clipboardPending.value || batchBusy.value, action: () => void pasteWorkspacePaths(node.isDirectory ? node.path : resolveParentDirectory(node.path))},
    ];
    if (modeRecord.mode.value === "content" && node.isDirectory && !node.contentNode) {
        items.push({label: "创建内容", iconClass: "i-lucide-file-plus", action: () => void createDirectoryIndex(node)});
    }
    items.push(
        {separator: true},
        {label: t("ide.workspace.common.rename"), iconClass: "i-lucide-pencil", action: () => void renameNode(node).catch(error => notifyError(resolveApiErrorMessage(error, "移动文件失败"), {title: "文件操作失败"}))},
        {label: t("ide.workspace.common.delete"), iconClass: "i-lucide-trash-2", danger: true, action: () => void deleteNode(node).catch(error => notifyError(resolveApiErrorMessage(error, "删除文件失败"), {title: "文件操作失败"}))},
    );
    openContextMenu(event, items);
}

/**
 * 打开根区域右键菜单。
 */
function openRootMenu(event: MouseEvent): void {
    openContextMenu(event, [
        buildRootCreateMenu(),
        {label: "粘贴到根目录", iconClass: "i-lucide-clipboard-paste", disabled: !clipboard.value || clipboardUnknown.value || clipboardPending.value || batchBusy.value, action: () => void pasteWorkspacePaths("")},
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
 * 返回创建失败通知标题。
 */
function createFailedTitle(kind: WorkspaceCreateKind): string {
    if (kind === "directory") {
        return t("ide.workspace.filePanel.createDirectoryFailed");
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


function suggestAvailableMovePath(sourceNode: Pick<WorkspaceFileNode, "path">, targetDir: string, reserved: ReadonlySet<string>): string {
    const sourceName = basename(sourceNode.path);
    const {stem, extension} = splitName(sourceName);
    let suffix = 1;
    let suggestedPath = joinWorkspacePath(targetDir, `${stem}-${suffix}${extension}`);
    while (reserved.has(normalizeWorkspacePath(suggestedPath))) {
        suffix++;
        suggestedPath = joinWorkspacePath(targetDir, `${stem}-${suffix}${extension}`);
    }
    return suggestedPath;
}


function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
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

onMounted(() => emitViewAction("action-handle-ready", titleActionHandle));

onBeforeUnmount(() => emitViewAction("action-handle-ready", null));

watch(canAccessWorkspace, canAccess => {
    treeError.value = null;
    contextMenuVisible.value = false;
    if (canAccess && workspaceTree.value.length === 0) void refreshTree().catch(() => undefined);
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <FilesExplorerView
            v-if="canAccessWorkspace && !expandedPathsLoading && !modeLoading"
            :nodes="workspaceTree"
            :mode="modeRecord.mode.value"
            :selected-path="selectedFilePath"
            :selected-paths="selectedPaths"
            :expanded-paths="expandedPaths"
            :loading="loadingWorkspaceTree"
            :error="treeError"
            @update:mode="changeMode"
            @update:expanded-paths="expandedPaths = $event"
            @update:selected-paths="changeSelectedPaths"
            @clipboard-intent="handleClipboardIntent"
            @select="selectNode"
            @open="openNode"
            @move="moveNode"
            @node-contextmenu="openNodeMenu"
            @root-contextmenu="openRootMenu"
            @create-root-content="void createRootContent()"
            @retry="void refreshTree().catch(() => undefined)"
        />
        <div v-else class="flex min-h-0 flex-1 items-center justify-center px-3 text-xs text-[var(--text-muted)]">
            {{ canAccessWorkspace ? t("ide.workspace.filePanel.loadingTree") : "尚未打开工作区" }}
        </div>

        <div v-if="batchBusy || clipboardUnknown" class="shrink-0 border-t border-[var(--border-color)] px-3 py-1 text-xs" role="status">
            <div class="flex items-center gap-2">
                <span v-if="batchBusy">正在处理文件；已开始的操作会等待实际结果</span>
                <span v-else>操作结果未知；存在不等于已成功写入，请核对实际内容</span>
                <button v-if="batchBusy" type="button" class="ml-auto underline" @click="cancelBatch = true">取消后续项</button>
                <button v-else type="button" class="ml-auto underline" :disabled="checkingUnknown" @click="void checkUnknownPaths()">核对源和目标</button>
                <button v-if="clipboardUnknown && unknownChecks.length" type="button" class="underline" @click="void clearUnknownClipboard()">放弃旧意图</button>
            </div>
            <div v-for="check in unknownChecks" :key="`${check.source}:${check.target}`" class="break-all" data-role="files-unknown-check">
                源 {{ check.source }}：{{ check.sourceState }}；目标 {{ check.target }}：{{ check.targetState }}
            </div>
        </div>

        <div v-if="batchItems.length" class="max-h-32 shrink-0 overflow-y-auto border-t border-[var(--border-color)] px-3 py-2 text-xs leading-5" role="status" data-role="files-batch-results">
            <div v-for="item in batchItems" :key="`${item.source}:${item.target}`" class="min-w-0 break-all text-[var(--text-main)]">
                <span class="font-medium">{{ {success: '完成', failed: '失败', skipped: '跳过', 'not-executed': '未执行', cancelled: '已取消', unknown: '结果未知'}[item.status] }}</span>
                {{ item.source }} → {{ item.target }}<span v-if="item.reason">：{{ item.reason }}</span>
                <span v-if="item.residualPaths?.length">；已留下：{{ item.residualPaths.join('、') }}</span>
            </div>
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

        <div v-if="modeNotice" class="shrink-0 border-t border-[var(--border-color)] bg-[var(--status-warning-bg)] px-3 py-2 text-[11px] text-[var(--status-warning)]" role="status">
            {{ modeNotice.diagnosis }}
            <button v-if="modeNotice.retryable" type="button" class="ml-2 underline" @click="void modeRecord.retry()">重试</button>
            <button v-if="modeNotice.abandonable" type="button" class="ml-2 underline" @click="modeRecord.abandon()">放弃</button>
        </div>

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
            @submit="void submitCreateDialog($event)"
        />
    </div>
</template>
