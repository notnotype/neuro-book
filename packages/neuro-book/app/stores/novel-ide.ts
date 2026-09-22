import {matchesEditorDocument, type EditorChangeRequest, type EditorDocumentTarget, type EditorFlushResult} from "nbook/app/components/editor-workbench/editor-view.types";
import type {Grid, GridExtent, GridGestureCommit, GridLayoutResult, GridNode, GridSnapshot} from "@notnotype/nb-ui/layout";
import {applyEditorGesture, createEditorGrid} from "nbook/app/utils/editor-workbench/editor-groups";
import {
    createEditorSession,
    findEditorSessionGroup,
    findEditorSessionTab,
    openTabInGroup,
    removeTab,
    reorderTab,
    selectActiveGroup,
    serializeEditorSession,
    splitTabToNewGroup,
    transferTab,
    updateTabInstance,
    type EditorSessionOutcome,
    type EditorSessionState,
    type EditorSessionTab,
} from "nbook/app/utils/editor-workbench/editor-session";
import type {EditorSplitDirection} from "nbook/app/components/editor-workbench/editor-view.types";
import type {
    ProjectCreateResponseDto,
    ProjectDeleteResponseDto,
    ProjectListResponseDto,
    ProjectMetadataDto,
    ProjectMutationResponseDto,
} from "nbook/shared/dto/project.dto";
import {ProjectCatalogRefreshError} from "nbook/app/utils/project-mutation-error";
import {triggerBrowserDownload} from "nbook/app/utils/browser-download";
import type { WorkbenchToolViewFocus } from "nbook/app/utils/workbench/tool-context";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    resolveWorkspaceFileExtension,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
import type {WorkspaceFileChangeEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import type {
    WorkspaceIssueSummaryDto,
    WorkspaceTreeSnapshotDto,
} from "nbook/shared/dto/workspace-tree.dto";
import {
    WorkspaceWriteConflictDtoSchema,
    type WorkspaceWriteConflictDto,
} from "nbook/shared/dto/workspace-file-conflict.dto";
import type {
    UserAssetsSyncConflictDetailDto,
    UserAssetsSyncConflictKindDto,
    UserAssetsSyncResultDto,
} from "nbook/shared/dto/user-assets-sync.dto";

import {
    legacyBucketSerializer,
    legacyBucketStorage,
} from "nbook/app/utils/workbench/storage-migration-legacy-bucket";

type ProjectCatalogSnapshot = Readonly<{
    revision: number;
    projects: readonly Readonly<ProjectMetadataDto>[];
}>;

/** 默认编辑组 id：布局树叶 id 与组集合一一对应（分屏出的新组 id 由宿主分配）。 */
export const PRIMARY_EDITOR_GROUP_ID = "main";

/**
 * 视图实例提交的内容回执（Store 侧形状）。
 *
 * 不含 `languageId`/`readonly`：那是视图层根据注册表与加载状态补的事实，由页面适配层
 * 在转交贡献之前合成为完整的 `EditorChangeResult`。
 */
export type EditorContentSnapshot = Readonly<{target: EditorDocumentTarget; content: string; contentRevision: number}>;
export type EditorContentChangeResult =
    | {status: "accepted"; snapshot: EditorContentSnapshot}
    | {status: "conflict"; snapshot: EditorContentSnapshot}
    | {status: "stale"};

export type WorkspaceFileNode = {
    mode: string;
    entryType: string | null;
    icon: string | null;
    status: string | null;
    words: number;
    refs: string[];
    path: string;
    absolutePath: string;
    isDirectory: boolean;
    hasIndex: boolean;
    contentNode: boolean;
    summary: string;
    title: string;
    frontmatter: Record<string, unknown>;
    frontmatterError: string | null;
    state: {
        path: string;
        absolutePath: string;
        exists: boolean;
        frontmatter: Record<string, unknown>;
        frontmatterError: string | null;
        body: string;
        words: number;
    } | null;
    size: number;
    mtimeMs: number;
    editable: boolean;
    issueSummary?: WorkspaceIssueSummaryDto;
};

export type WorkspaceFileIssue = {
    level: "P1" | "P2" | "P3" | "WARN";
    code: string;
    path: string;
    message: string;
    line?: number;
};

export type WorkspaceEditorTab = {
    path: string;
    title: string;
    /** 标签实例所属编辑组；同路径可以在不同组各有一个实例。 */
    editorGroupId: string;
    editorId: string | null;
    pinned: boolean;
    preview: boolean;
    dirty: boolean;
};

export type WorkspaceOpenMode = "preview" | "permanent";
export type NovelIdeLayoutMode = "ide" | "agent";

/**
 * 一条路径的**唯一**正文权威：内容、磁盘基线与单调修订都在这里。
 *
 * 视图侧（Monaco/TipTap）不持有权威副本：它们提交 `baseRevision`，由 Store 判定接受/冲突；
 * 活动文件与标签 dirty 都从这份缓冲投影，因此不再有"活动副本 + 缓冲副本"两个写者。
 */
type WorkspaceFileBuffer = {
    node: WorkspaceFileNode;
    content: string;
    lastSyncedContent: string;
    lastSyncedMtimeMs: number | null;
    /** 每次受理过内容写入后 +1；视图用它判断自己的基线是否仍然有效。 */
    contentRevision: number;
};

type WorkspaceActiveFile = WorkspaceFileBuffer;

type WorkspaceReadResponse = {
    path: string;
    absolutePath: string;
    entryType: string | null;
    editable: boolean;
    mtimeMs: number;
    content: string;
};

type WorkspaceLoadOptions = {
    forceDisk?: boolean;
};

type WorkspaceTreeLoadOptions = {
    bypassPendingRequest?: boolean;
};

type WorkspaceSaveOptions = {
    content?: string;
    expectedMtimeMs?: number | null;
    force?: boolean;
};

export type WorkspaceUploadResult = {
    written: number;
    skipped: number;
    totalBytes: number;
    files: Array<{
        path: string;
        size: number;
        action: "written" | "skipped";
    }>;
};

export type WorkspaceKind = "novel" | "user-assets";
type WorkspaceQueryInput = {projectRoot: string} | {workspaceKind: "user-assets"};
type ProjectCatalogMutation = "create" | "delete" | "cover-update";

type WorkspaceSessionState = {
    activeWorkspaceTabPath: string;
    workspaceTabs: WorkspaceEditorTab[];
    workspaceBuffers: Record<string, WorkspaceFileBuffer>;
    monacoFontSizeOverridesByPath: Record<string, number>;
};

export type WorkspaceFileConflictResolution =
    | {action: "reload-remote"}
    | {action: "overwrite-local"}
    | {action: "save-merged"; content: string}
    | {action: "cancel"};

export type WorkspaceDiskSyncResult = {
    activeFile: "unchanged" | "reloaded" | "dirty" | "deleted";
    dirtyPaths: string[];
    deletedPaths: string[];
};

/**
 * 从请求错误中读取 workspace 写入冲突 payload。
 */
export function readWorkspaceWriteConflict(error: unknown): WorkspaceWriteConflictDto | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const record = error as Record<string, unknown>;
    const data = record.data;
    const candidates = [
        data,
        data && typeof data === "object" ? (data as Record<string, unknown>).data : null,
    ];
    for (const candidate of candidates) {
        const parsed = WorkspaceWriteConflictDtoSchema.safeParse(candidate);
        if (parsed.success) {
            return parsed.data;
        }
    }
    return null;
}

const REASONING_OPTIONS = ["超高", "高", "中", "低"] as const;
const DETAIL_UNDO_LIMIT = 20;
const DEFAULT_MODEL_LABEL = "未配置模型";

/**
 * 统一管理小说 IDE 的业务状态与核心数据动作。
 */
export const useNovelIdeStore = defineStore("novelIde", () => {
    const projectSnapshot = ref<ProjectCatalogSnapshot | null>(null);
    const novels = computed<readonly Readonly<ProjectMetadataDto>[]>(() => projectSnapshot.value?.projects ?? []);
    const currentProjectRoot = ref("");
    const selectedStoryThreadId = ref<string | null>(null);
    const selectedStorySceneId = ref<string | null>(null);
    const selectedLorebookEntryId = ref<string | null>(null);
    const selectedCharacterId = ref<string | null>(null);
    const plotRefreshVersion = ref(0);
    const workspaceTree = ref<WorkspaceFileNode[]>([]);
    const workspaceBuffers = ref<Record<string, WorkspaceFileBuffer>>({});
    const workspaceSessions = ref<Record<string, WorkspaceSessionState>>({});
    const workspaceKind = ref<WorkspaceKind>("novel");
    const configRevision = ref(0);
    const workspaceGeneration = ref(0);
    let documentSequence = 0;
    const documentIds = new Map<string, string>();
    /** 在途保存按路径登记：同一文档合并在途保存，不同文档的确认互不覆盖。 */
    const savingPaths = ref<string[]>([]);
    const inflightSaves = new Map<string, Promise<WorkspaceFileNode | null>>();

    /**
     * 编辑会话（组集合、标签实例、活动组）与布局树：**唯一 authority**。
     *
     * 树是不可变的对话实例（nb-ui 原语的合同），结构操作只经 `editor-session` 的事务；
     * 会话 ref 与树同步发布（一次事务 = 一次 ref 写入），因此不存在"组已发布、树还没变"的中间态。
     */
    let editorGrid = createEditorGrid(PRIMARY_EDITOR_GROUP_ID);
    const editorSession = ref<EditorSessionState>(createEditorSession(editorGrid));
    const editorExtent = ref<GridExtent>({width: 0, height: 0});
    /**
     * 会话修订：**每一次**会话内容或拓扑提交 +1。
     *
     * 它是"该保存编辑会话了"的唯一信号——尺寸测量（`setEditorExtent`）与内容输入都不推进它，
     * 因此存储会话不会因为窗口 resize 或打字而写记录。
     */
    const editorSessionRevision = ref(0);
    const editorTree = ref<GridNode<string> | null>(editorGrid.root());
    const editorLayout = ref<GridLayoutResult>(editorGrid.layout(editorExtent.value));

    /** 逐组激活状态：一个组的读取/失败不影响另一个组。 */
    const editorGroupLoading = ref<Record<string, boolean>>({});
    const editorGroupErrors = ref<Record<string, string | null>>({});
    const activationSequences = new Map<string, number>();

    /** 未解决输入：视图候选与权威正文冲突，保存/关闭/重挂/切工作面都必须先处理它。 */
    const unresolvedEditorChanges = ref<EditorChangeRequest[]>([]);
    /** 写入冲突归属的文档身份：多组下不能再假设"冲突就是当前活动文件"。 */
    const workspaceConflictTarget = ref<EditorDocumentTarget | null>(null);
    const workspaceIssues = ref<WorkspaceFileIssue[]>([]);
    const workspaceWriteConflict = ref<WorkspaceWriteConflictDto | null>(null);
    const workspaceConflictDialogOpen = ref(false);
    const detailUndoStacks = ref<Record<string, string[]>>({});

    const loadingWorkspace = ref(false);
    const loadingWorkspaceTree = ref(false);
    const restoringWorkspaceFile = ref(false);

    /** 有任何文档在途保存即"保存中"；逐文档的确认互不覆盖（不再有单例 saveOwner）。 */
    const savingFile = computed(() => savingPaths.value.length > 0);

    /**
     * 工具视图焦点（**非持久**）：对 Agent 说明"当前哪个 Part 的哪个工具 View 真实可见"。
     *
     * 只有页面能回答这个问题，因此由页面按真实呈现发布（`resolveActiveToolView`），
     * 卸载或切工作面时清空。它不进 `pick`：这不是用户偏好，也不承载旧的「活动左侧页签」。
     */
    const activeToolView = ref<WorkbenchToolViewFocus>(null);
    const layoutMode = ref<NovelIdeLayoutMode>("ide");
    const agentSessionPanelOpen = ref(true);
    const agentSessionPanelWidth = ref(280);
    const agentStudioPanelOpen = ref(true);
    const agentStudioPanelWidth = ref(460);
    const agentStudioFileTreeWidth = ref(200);
    const plotWorkbenchOpen = ref(false);
    // 剧本工作台当前 tab:线程规划 / 承诺账本 / 决策记录;侧栏计数入口与账本跳转联动直接写它。
    const plotWorkbenchTab = ref<"thread" | "promises" | "decisions">("thread");
    // 跳账本时要聚焦的 promise/decision id;为空表示无待消费的聚焦请求,对应 tab 消费一次后置回 null。
    const plotPlanningFocusId = ref<string | null>(null);
    const selectedModel = ref<string>(DEFAULT_MODEL_LABEL);
    const selectedReasoning = ref<string>(REASONING_OPTIONS[2] ?? "中");
    const markdownEditorPreferences = ref<MarkdownEditorPreferences>({
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    });
    const monacoEditorPreferences = ref<MonacoEditorPreferences>({
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
    });
    const monacoFontSizeOverridesByPath = ref<Record<string, number>>({});

    let workspaceTreeRequest: {
        key: string;
        promise: Promise<WorkspaceFileNode[]>;
    } | null = null;
    let projectCatalogGeneration = 0;
    let projectCatalogRequest: {
        generation: number;
        promise: Promise<ProjectCatalogSnapshot>;
    } | null = null;
    const workspaceTreeRevision = ref(0);

    const reasoningOptions = [...REASONING_OPTIONS];

    /**
     * 同步当前默认模型展示名。
     */
    const setSelectedModelLabel = (label: string | null | undefined): void => {
        const normalizedLabel = label?.trim() ?? "";
        selectedModel.value = normalizedLabel || DEFAULT_MODEL_LABEL;
    };

    /**
     * 标记配置文件已经被保存型设置面板更新。
     */
    const bumpConfigRevision = (): void => {
        configRevision.value += 1;
    };

    /**
     * 当前选中的小说详情
     */
    const currentNovel = computed<Readonly<ProjectMetadataDto> | null>(() => {
        return novels.value.find((novel) => novel.projectRoot === currentProjectRoot.value) ?? null;
    });
    const currentWorkspaceRoot = computed(() => workspaceKind.value === "user-assets"
        ? "workspace/.nbook"
        // Composer/变量层仍用跨 Project File Address；Session Project identity 已独立使用 currentProjectRoot。
        : currentProjectRoot.value ? `workspace/${currentProjectRoot.value}` : "");
    const workspaceSessionKey = computed(() => workspaceKind.value === "user-assets" ? "user-assets" : `novel:${currentProjectRoot.value}`);
    const isUserAssetsWorkspace = computed(() => workspaceKind.value === "user-assets");
    const canAccessWorkspace = computed(() => workspaceKind.value === "user-assets" || Boolean(currentProjectRoot.value));

    const documentTarget = (path: string): EditorDocumentTarget => {
        let documentId = documentIds.get(path);
        if (!documentId) {
            documentId = String(++documentSequence);
            documentIds.set(path, documentId);
        }
        return {workspaceKey: workspaceSessionKey.value, generation: workspaceGeneration.value, documentId, path};
    };
    const acceptsDocument = (target: EditorDocumentTarget): boolean => target.workspaceKey === workspaceSessionKey.value
        && target.generation === workspaceGeneration.value && documentIds.get(target.path) === target.documentId;

    /** 一次编辑组事务的发布口：会话与呈现树一起落账，失败不改任何一方。 */
    const publishEditorSession = (state: EditorSessionState): void => {
        editorSession.value = state;
        editorSessionRevision.value += 1;
        editorTree.value = editorGrid.root();
        editorLayout.value = editorGrid.layout(editorExtent.value);
    };
    const publishEditorLayout = (): void => {
        editorTree.value = editorGrid.root();
        editorLayout.value = editorGrid.layout(editorExtent.value);
    };

    const resetDocumentLifecycle = (): void => {
        workspaceGeneration.value += 1;
        activationSequences.clear();
        documentIds.clear();
        editorFlushRegistrations.clear();
        restoringWorkspaceFile.value = false;
        editorGroupLoading.value = {};
        editorGroupErrors.value = {};
        editorGrid = createEditorGrid(PRIMARY_EDITOR_GROUP_ID);
        editorSession.value = createEditorSession(editorGrid);
        editorGroupLoading.value = {};
        editorGroupErrors.value = {};
        savingPaths.value = [];
        inflightSaves.clear();
        unresolvedEditorChanges.value = [];
        workspaceConflictTarget.value = null;
        workspaceTreeRequest = null;
        publishEditorLayout();
    };

    /** 活动组的 id；没有组时为空串（未进入 workspace）。 */
    const activeEditorGroupId = computed(() => editorSession.value.activeGroupId);

    const activeEditorGroup = computed(() => findEditorSessionGroup(editorSession.value, editorSession.value.activeGroupId));

    /** 活动组当前活动的文档路径。 */
    const activeWorkspaceTabPath = computed(() => activeEditorGroup.value?.activePath ?? "");

    /** 投影的标签列表：dirty 从共用缓冲算出，不在标签实例里另存一份。 */
    const workspaceTabs = computed<WorkspaceEditorTab[]>(() => editorSession.value.groups.flatMap((group) => group.tabs.map((tab) => {
        const buffer = workspaceBuffers.value[tab.path];
        return {
            path: tab.path,
            title: buffer?.node.title?.trim() || tab.title,
            editorGroupId: group.id,
            editorId: tab.editorId,
            pinned: tab.pinned,
            preview: tab.preview,
            dirty: Boolean(buffer && buffer.content !== buffer.lastSyncedContent),
        };
    })));

    const activeWorkspaceFile = computed<WorkspaceActiveFile | null>(() => {
        const path = activeWorkspaceTabPath.value;
        return path ? workspaceBuffers.value[path] ?? null : null;
    });

    const activeWorkspaceDocumentTarget = computed(() => {
        const path = activeWorkspaceTabPath.value;
        return path && workspaceBuffers.value[path] ? documentTarget(path) : null;
    });

    /** 当前活动文件路径。对外保留 selected 命名，内部是活动组的投影。 */
    const selectedFilePath = computed(() => activeWorkspaceFile.value?.node.path ?? "");

    /** 当前活动文件节点。目录或不可编辑文件也通过同一个活动文件模型表达。 */
    const selectedFileNode = computed(() => activeWorkspaceFile.value?.node ?? null);

    /** 当前活动文件正文；写入直接落到该路径的唯一缓冲（不再有活动副本）。 */
    const selectedFileContent = computed({
        get: () => activeWorkspaceFile.value?.content ?? "",
        set: (content: string) => {
            const path = activeWorkspaceTabPath.value;
            if (!path || !workspaceBuffers.value[path]) {
                return;
            }
            writeBufferContent(path, content);
        },
    });

    const lastSyncedFileContent = computed(() => activeWorkspaceFile.value?.lastSyncedContent ?? "");

    /** 工作区文件是否已完成初始化恢复，可用于页面首帧渲染 gating。 */
    const workspaceReady = computed(() => !loadingWorkspace.value && !restoringWorkspaceFile.value);

    /** 当前文件是否有未保存改动。 */
    const hasUnsavedFileChanges = computed(() => selectedFileContent.value !== lastSyncedFileContent.value);

    /** 任意已打开文档是否有未保存改动。 */
    const hasUnsavedWorkspaceChanges = computed(() => Object.values(workspaceBuffers.value)
        .some((buffer) => buffer.content !== buffer.lastSyncedContent));

    /** 活动组是否正在读取文档 / 有诊断；组相关只影响该组的呈现。 */
    const loadingWorkspaceDocument = computed(() => Boolean(editorGroupLoading.value[editorSession.value.activeGroupId]));
    const workspaceDocumentError = computed(() => editorGroupErrors.value[editorSession.value.activeGroupId] ?? null);

    /** 有未解决输入时保存/关闭/拓扑调整都必须先处理它。 */
    const hasUnresolvedEditorChanges = computed(() => unresolvedEditorChanges.value.length > 0);

    /**
     * 是否已经选中了一个可编辑章节。
     */
    const showEditorWorkspace = computed(() => selectedFileNode.value?.editable === true);

    /** 清空当前 Project 内的业务选择。 */
    const clearWorkspaceSelection = (): void => {
        selectedStoryThreadId.value = null;
        selectedStorySceneId.value = null;
        selectedLorebookEntryId.value = null;
        selectedCharacterId.value = null;
    };

    /**
     * 清空活动组的活动标签（缓冲留在原地，由工作会话的持久化决定去留）。
     */
    const clearActiveFile = (): void => {
        const groupId = editorSession.value.activeGroupId;
        publishEditorSession({
            groups: editorSession.value.groups.map((group) => group.id === groupId ? {...group, activePath: ""} : group),
            activeGroupId: groupId,
        });
    };

    /**
     * 清空当前小说的文件工作区状态，避免跨 novel 复用标签页和缓存。
     * 编辑会话本身由 `resetDocumentLifecycle` 收口，这里只清与文件树/缓冲共生的状态。
     */
    const clearWorkspaceState = (): void => {
        workspaceTree.value = [];
        workspaceBuffers.value = {};
        workspaceIssues.value = [];
        workspaceTreeRevision.value = 0;
        workspaceWriteConflict.value = null;
        workspaceConflictDialogOpen.value = false;
        monacoFontSizeOverridesByPath.value = {};
        unresolvedEditorChanges.value = [];
        workspaceConflictTarget.value = null;
    };

    /**
     * 持久化当前 workspace 会话（sessionStorage 的刷新草稿记忆）。
     *
     * 这里只记**单组**的标签与缓冲：分组拓扑属于编辑会话记录（`workbench.editor`），
     * 由 `editor-session-storage` 负责；两条通道各自完整，不互相兜底。
     */
    const persistWorkspaceSession = (): void => {
        const key = workspaceSessionKey.value;
        if (!key || key === "novel:") {
            return;
        }
        const tabs = workspaceTabs.value.filter((tab) => tab.editorGroupId === PRIMARY_EDITOR_GROUP_ID)
            .map(({path, title, editorId, pinned, preview}) => ({path, title, editorId, pinned, preview}));
        const buffers: Record<string, WorkspaceFileBuffer> = {};
        for (const tab of tabs) {
            const buffer = workspaceBuffers.value[tab.path];
            if (buffer) {
                buffers[tab.path] = buffer;
            }
        }
        workspaceSessions.value = {
            ...workspaceSessions.value,
            [key]: {
                activeWorkspaceTabPath: activeWorkspaceTabPath.value,
                workspaceTabs: tabs.map((tab) => ({...tab, editorGroupId: PRIMARY_EDITOR_GROUP_ID, dirty: false})),
                workspaceBuffers: buffers,
                monacoFontSizeOverridesByPath: monacoFontSizeOverridesByPath.value,
            },
        };
    };

    /**
     * 恢复指定 workspace 会话的编辑状态。
     *
     * 旧快照只有扁平标签：全部迁进 main 组（单组是合法默认）；多组拓扑由编辑会话记录恢复。
     */
    const restoreWorkspaceSession = (): void => {
        resetDocumentLifecycle();
        const snapshot = workspaceSessions.value[workspaceSessionKey.value];
        const buffers: Record<string, WorkspaceFileBuffer> = {};
        for (const [path, buffer] of Object.entries(snapshot?.workspaceBuffers ?? {})) {
            buffers[path] = {...buffer, contentRevision: buffer.contentRevision ?? 0};
        }
        workspaceBuffers.value = buffers;
        const tabs: EditorSessionTab[] = (snapshot?.workspaceTabs ?? [])
            .filter((tab) => Boolean(buffers[tab.path]))
            .map((tab) => {
                const legacy = tab as WorkspaceEditorTab & {viewMode?: string; editorKind?: string};
                const markdown = [".md", ".markdown"].includes(resolveWorkspaceFileExtension(tab.path));
                const editorId = "editorId" in tab ? tab.editorId
                    : markdown && legacy.viewMode === "source" ? "code"
                    : markdown && ["rich", "split", "mixed"].includes(legacy.viewMode ?? "") ? "markdown"
                    : legacy.editorKind === "monaco" ? "code" : null;
                return {path: tab.path, title: tab.title, editorId, pinned: Boolean(tab.pinned), preview: Boolean(tab.preview)};
            });
        const preferred = snapshot?.activeWorkspaceTabPath ?? "";
        const activePath = tabs.some((tab) => tab.path === preferred) ? preferred : tabs[0]?.path ?? "";
        editorSession.value = {
            groups: [{id: PRIMARY_EDITOR_GROUP_ID, activePath, tabs}],
            activeGroupId: PRIMARY_EDITOR_GROUP_ID,
        };
        monacoFontSizeOverridesByPath.value = snapshot?.monacoFontSizeOverridesByPath ?? {};
        workspaceTree.value = [];
        workspaceIssues.value = [];
        workspaceTreeRevision.value = 0;
        workspaceWriteConflict.value = null;
        workspaceConflictDialogOpen.value = false;
        publishEditorLayout();
    };

    /**
     * 清理指定 Project Workspace 的本地编辑会话，避免同名重建后复用旧标签和 buffer。
     */
    const clearNovelWorkspaceSession = (projectRoot: string): void => {
        const key = `novel:${projectRoot}`;
        if (!(key in workspaceSessions.value)) {
            return;
        }
        const nextSessions = {...workspaceSessions.value};
        delete nextSessions[key];
        workspaceSessions.value = nextSessions;
    };

    /**
     * 构造当前 workspace 查询参数。
     */
    const workspaceQuery = (): WorkspaceQueryInput => {
        if (workspaceKind.value === "user-assets") {
            return {workspaceKind: "user-assets"};
        }
        if (!currentProjectRoot.value) {
            throw new Error("当前未选择小说，无法访问 workspace");
        }
        return {projectRoot: currentProjectRoot.value};
    };

    /**
     * 当前 tree 请求的去重键。Project Workspace 与 user-assets 必须隔离。
     */
    const workspaceTreeRequestKey = (): string => workspaceSessionKey.value;

    /**
     * 视图实例的 flush 登记表：同文档可以在两个组各有一个实例，不能只有一条记录。
     * 键是 `documentId:token`；清理只撤销"自己这次"登记，旧实例卸载不能抹掉新实例的输入结算入口。
     */
    const editorFlushRegistrations = new Map<string, {target: EditorDocumentTarget; flush: () => EditorFlushResult}>();
    const registerEditorFlush = (target: EditorDocumentTarget, token: string, flush: () => EditorFlushResult): (() => void) => {
        const key = `${target.documentId}:${token}`;
        const registration = {target, flush};
        editorFlushRegistrations.set(key, registration);
        return () => {
            if (editorFlushRegistrations.get(key) === registration) {
                editorFlushRegistrations.delete(key);
            }
        };
    };

    /**
     * flush 指定组（不传即全部）实例的待结算输入。任一实例报 conflict 时整体返回 conflict——
     * 调用方（切标签、关闭、拓扑调整、切工作面）必须据此停手，不能把"timer 已清"当输入已入 Store。
     */
    const flushEditorPending = (groupId?: string): EditorFlushResult => {
        let result: EditorFlushResult = "settled";
        const paths = groupId === undefined ? null : new Set(findEditorSessionGroup(editorSession.value, groupId)?.tabs.map((tab) => tab.path) ?? []);
        for (const [key, registration] of [...editorFlushRegistrations]) {
            if (!acceptsDocument(registration.target)) {
                editorFlushRegistrations.delete(key);
                continue;
            }
            if (paths && !paths.has(registration.target.path)) {
                continue;
            }
            if (registration.flush() === "conflict") {
                result = "conflict";
            }
        }
        return result;
    };

    /** 未解决输入的登记与查询：保存/关闭/重挂/切工作面都要先看待它。 */
    const registerUnresolvedEditorChange = (request: EditorChangeRequest): void => {
        unresolvedEditorChanges.value = [...unresolvedEditorChanges.value.filter((item) => item.token !== request.token), request];
    };
    const clearUnresolvedEditorChange = (token: string): void => {
        unresolvedEditorChanges.value = unresolvedEditorChanges.value.filter((item) => item.token !== token);
    };
    const hasUnresolvedEditorChangeForPath = (path: string): boolean =>
        unresolvedEditorChanges.value.some((item) => item.target.path === path);
    const readUnresolvedEditorChange = (token: string): EditorChangeRequest | null =>
        unresolvedEditorChanges.value.find((item) => item.token === token) ?? null;

    /** **唯一**正文写入口：写入即推进单调修订，视图据此判断自己的基线是否仍有效。 */
    const writeBufferContent = (path: string, content: string): void => {
        const buffer = workspaceBuffers.value[path];
        if (!buffer) {
            return;
        }
        workspaceBuffers.value = {
            ...workspaceBuffers.value,
            [path]: {...buffer, content, contentRevision: buffer.contentRevision + 1},
        };
    };

    /** 程序化写入（夹具、测试、非视图来源）：文档身份有效即接受，同样推进修订。 */
    const updateWorkspaceDocument = (target: EditorDocumentTarget, content: string): boolean => {
        if (!acceptsDocument(target) || !workspaceBuffers.value[target.path]) {
            return false;
        }
        writeBufferContent(target.path, content);
        return true;
    };

    const editorContentSnapshot = (target: EditorDocumentTarget): EditorContentSnapshot | null => {
        const buffer = workspaceBuffers.value[target.path];
        return buffer ? {target, content: buffer.content, contentRevision: buffer.contentRevision} : null;
    };

    /**
     * 视图实例的内容提交（有回执，不再是 fire-and-forget）：
     * - 基线一致、或内容与权威相同（自己的回声）⇒ 受理，并清除该 token 的未解决登记；
     * - 基线落后且内容不同 ⇒ 冲突：保留候选、登记未解决输入，权威正文不动。
     */
    const commitEditorChange = (request: EditorChangeRequest): EditorContentChangeResult => {
        if (!acceptsDocument(request.target)) {
            return {status: "stale"};
        }
        const buffer = workspaceBuffers.value[request.target.path];
        if (!buffer) {
            return {status: "stale"};
        }
        if (request.baseRevision === buffer.contentRevision) {
            if (request.content !== buffer.content) {
                writeBufferContent(request.target.path, request.content);
            }
            clearUnresolvedEditorChange(request.token);
            return {status: "accepted", snapshot: editorContentSnapshot(request.target)!};
        }
        if (request.content === buffer.content) {
            clearUnresolvedEditorChange(request.token);
            return {status: "accepted", snapshot: editorContentSnapshot(request.target)!};
        }
        registerUnresolvedEditorChange(request);
        return {status: "conflict", snapshot: editorContentSnapshot(request.target)!};
    };

    /** 用户选择"采用当前正文"：丢弃候选登记。保留候选的重提走实例的 commitChange，受理时自动清登记。 */
    const discardUnresolvedEditorChange = (token: string): void => clearUnresolvedEditorChange(token);

    /** 标签实例已无任何引用：文档身份、缓冲与临时字号一起释放；未解决输入随身份作废。 */
    const releaseEditorDocument = (path: string): void => {
        documentIds.delete(path);
        const nextBuffers = {...workspaceBuffers.value};
        delete nextBuffers[path];
        workspaceBuffers.value = nextBuffers;
        const nextOverrides = {...monacoFontSizeOverridesByPath.value};
        delete nextOverrides[path];
        monacoFontSizeOverridesByPath.value = nextOverrides;
        unresolvedEditorChanges.value = unresolvedEditorChanges.value.filter((item) => item.target.path !== path);
    };

    /** 会话事务的统一落账口：发布新会话/树，并释放本次不再被引用的文档。返回是否落账。 */
    const applyEditorSessionOutcome = (outcome: EditorSessionOutcome): boolean => {
        if (!outcome.ok) {
            return false;
        }
        publishEditorSession(outcome.state);
        for (const path of outcome.evicted) {
            releaseEditorDocument(path);
        }
        return true;
    };

    /**
     * 在某组打开（或激活）标签。缓冲存在性是调用方的职责：这里只维护标签实例与活动选择。
     */
    const openEditorTabInGroup = (groupId: string, node: WorkspaceFileNode, openMode: WorkspaceOpenMode): boolean => {
        const path = node.path;
        const existing = findEditorSessionTab(editorSession.value, groupId, path);
        return applyEditorSessionOutcome(openTabInGroup(editorSession.value, {
            groupId,
            path,
            title: node.title?.trim() || path,
            editorId: existing?.editorId ?? null,
            mode: openMode,
        }, {
            // 脏文档与有未解决输入的文档不能被 preview 静默顶替（转为常驻）。
            canEvictPreview: (candidate) => {
                const buffer = workspaceBuffers.value[candidate];
                return buffer !== undefined && buffer.content === buffer.lastSyncedContent
                    && !hasUnresolvedEditorChangeForPath(candidate);
            },
        }));
    };

    const selectEditorGroup = (groupId: string): boolean =>
        applyEditorSessionOutcome(selectActiveGroup(editorSession.value, groupId));

    /** 只记录本实例的显式编辑器选择；null 表示下次恢复按配置选择。 */
    const setWorkspaceTabEditor = (groupId: string, filePath: string, editorId: string | null): void => {
        applyEditorSessionOutcome(updateTabInstance(editorSession.value, groupId, filePath, {editorId}));
    };

    const setWorkspaceTabPinned = (groupId: string, filePath: string, pinned: boolean): void => {
        applyEditorSessionOutcome(updateTabInstance(editorSession.value, groupId, filePath, {pinned, preview: pinned ? false : undefined}));
    };

    const toggleWorkspaceTabPinned = (groupId: string, filePath: string): void => {
        const current = findEditorSessionTab(editorSession.value, groupId, filePath);
        setWorkspaceTabPinned(groupId, filePath, !current?.pinned);
    };

    /** 将预览标签转为常驻标签。 */
    const keepWorkspaceTab = (groupId: string, filePath: string): void => {
        applyEditorSessionOutcome(updateTabInstance(editorSession.value, groupId, filePath, {preview: false}));
    };

    /** 组内重排（拖拽落位）；跨组移动走 `transferEditorTab`。 */
    const moveWorkspaceTab = (
        groupId: string,
        filePath: string,
        targetPath: string | null,
        targetPinned: boolean,
        position: "before" | "after",
    ): void => {
        applyEditorSessionOutcome(reorderTab(editorSession.value, groupId, filePath, targetPath, targetPinned, position));
    };

    /** 移除一个无法恢复的文档：清掉**所有组**对它的引用与缓存。 */
    const removeWorkspaceTabState = (filePath: string): void => {
        if (editorSession.value.groups.some((group) => group.tabs.some((tab) => tab.path === filePath))) {
            const groups = editorSession.value.groups
                .map((group) => group.tabs.some((tab) => tab.path === filePath)
                    ? {
                        id: group.id,
                        activePath: group.activePath === filePath ? "" : group.activePath,
                        tabs: group.tabs.filter((tab) => tab.path !== filePath),
                    }
                    : group);
            publishEditorSession({groups, activeGroupId: editorSession.value.activeGroupId});
        }
        releaseEditorDocument(filePath);
    };

    /**
     * 从持久化的标签状态中恢复当前活动文件。
     *
     * 门禁只覆盖恢复动作本身：同一组的用户在恢复期间打开文档会推进激活序号，恢复随即让位。
     */
    const restoreWorkspaceTabFromPersistedState = async (): Promise<void> => {
        const groupId = editorSession.value.activeGroupId;
        const operation = beginDocumentActivation(groupId);
        restoringWorkspaceFile.value = true;
        try {
            const paths = [...new Set([activeWorkspaceTabPath.value, ...(findEditorSessionGroup(editorSession.value, groupId)?.tabs.map((tab) => tab.path) ?? [])])].filter(Boolean);
            for (const path of paths) {
                if (!acceptsActivation(operation)) return;
                const tab = findEditorSessionTab(editorSession.value, groupId, path);
                try {
                    await activateWorkspaceFile(groupId, path, tab?.preview ? "preview" : "permanent", {forceDisk: true}, operation);
                    return;
                } catch (error) {
                    if (!acceptsActivation(operation)) return;
                    const buffer = workspaceBuffers.value[path];
                    const dirty = Boolean(buffer && buffer.content !== buffer.lastSyncedContent);
                    if (isMissingWorkspaceFile(error) && !dirty) removeWorkspaceTabState(path);
                    else {
                        editorGroupErrors.value = {...editorGroupErrors.value, [groupId]: error instanceof Error ? error.message : "文件读取失败"};
                        return;
                    }
                }
            }
            if (acceptsActivation(operation)) clearActiveFile();
        } finally {
            if (operation.generation === workspaceGeneration.value && operation.workspaceKey === workspaceSessionKey.value) {
                restoringWorkspaceFile.value = false;
                finishGroupActivation(groupId, operation.sequence);
            }
        }
    };

    /**
     * 加载工作区文件树。
     */
    const loadWorkspaceTree = async (options: WorkspaceTreeLoadOptions = {}): Promise<WorkspaceFileNode[]> => {
        const requestKey = workspaceTreeRequestKey();
        const generation = workspaceGeneration.value;
        if (!options.bypassPendingRequest && workspaceTreeRequest?.key === requestKey) {
            return await workspaceTreeRequest.promise;
        }
        loadingWorkspaceTree.value = true;
        const promise = (async () => {
            const snapshot = await $fetch<WorkspaceTreeSnapshotDto<WorkspaceFileNode>>("/api/workspace-files/tree", {
                query: workspaceQuery(),
            });
            if (generation !== workspaceGeneration.value || workspaceSessionKey.value !== requestKey) {
                return snapshot.nodes;
            }
            workspaceTree.value = snapshot.nodes;
            workspaceIssues.value = snapshot.issues;
            workspaceTreeRevision.value = snapshot.revision;
            for (const [path, buffer] of Object.entries(workspaceBuffers.value)) {
                const nextNode = snapshot.nodes.find((node) => node.path === path);
                if (!nextNode) {
                    continue;
                }
                workspaceBuffers.value = {
                    ...workspaceBuffers.value,
                    [path]: {
                        ...buffer,
                        node: nextNode,
                    },
                };
            }
            return snapshot.nodes;
        })();
        workspaceTreeRequest = {key: requestKey, promise};
        try {
            return await promise;
        } finally {
            if (workspaceTreeRequest?.promise === promise) {
                workspaceTreeRequest = null;
                loadingWorkspaceTree.value = false;
            }
        }
    };

    /**
     * 读取工作区路径元信息。
     */
    const statWorkspacePath = async (filePath: string): Promise<WorkspaceFileNode> => {
        return await $fetch<WorkspaceFileNode>("/api/workspace-files/stat", {
            query: {...workspaceQuery(), path: filePath},
        });
    };

    /**
     * 从已加载的 tree snapshot 中读取节点元信息，避免文件树点击时重复请求 stat。
     */
    const findWorkspaceNode = (filePath: string): WorkspaceFileNode | undefined => {
        const normalizedPath = normalizeWorkspaceFilePath(filePath);
        return workspaceTree.value.find((node) => normalizeWorkspaceFilePath(node.path) === normalizedPath);
    };

    /**
     * 一次文档激活的身份：工作面 + 代次 + **组** + 该组自己的激活序号。
     * 序号按组持有，因此组 A 打开文档不会取消组 B 的在途读取。
     */
    type DocumentActivation = {generation: number; workspaceKey: string; groupId: string; sequence: number; query: WorkspaceQueryInput};
    const beginDocumentActivation = (groupId: string): DocumentActivation => {
        const operation = {
            generation: workspaceGeneration.value,
            workspaceKey: workspaceSessionKey.value,
            groupId,
            sequence: (activationSequences.get(groupId) ?? 0) + 1,
            query: workspaceQuery(),
        };
        activationSequences.set(groupId, operation.sequence);
        editorGroupLoading.value = {...editorGroupLoading.value, [groupId]: true};
        editorGroupErrors.value = {...editorGroupErrors.value, [groupId]: null};
        return operation;
    };
    const acceptsActivation = (operation: DocumentActivation): boolean => operation.generation === workspaceGeneration.value
        && operation.workspaceKey === workspaceSessionKey.value
        && (activationSequences.get(operation.groupId) ?? 0) === operation.sequence;
    const finishGroupActivation = (groupId: string, sequence: number): void => {
        if ((activationSequences.get(groupId) ?? 0) !== sequence) {
            return;
        }
        editorGroupLoading.value = {...editorGroupLoading.value, [groupId]: false};
    };
    const isMissingWorkspaceFile = (error: unknown): boolean => typeof error === "object" && error !== null
        && (("statusCode" in error && error.statusCode === 404) || ("status" in error && error.status === 404));

    /**
     * 写入或刷新一条缓冲。修订号单调递增：重新读盘（forceDisk 或磁盘事件）也会推进它，
     * 让仍在显示的旧实例知道自己的基线已失效。
     */
    const setBuffer = (path: string, node: WorkspaceFileNode, content: string, lastSyncedContent: string, lastSyncedMtimeMs: number | null): void => {
        const previous = workspaceBuffers.value[path];
        workspaceBuffers.value = {
            ...workspaceBuffers.value,
            [path]: {node, content, lastSyncedContent, lastSyncedMtimeMs, contentRevision: (previous?.contentRevision ?? 0) + 1},
        };
    };

    const activateEditableWorkspaceFile = async (
        groupId: string, filePath: string, knownDetail: WorkspaceFileNode | undefined, openMode: WorkspaceOpenMode,
        options: WorkspaceLoadOptions, operation: DocumentActivation,
    ): Promise<WorkspaceFileNode | null> => {
        const cached = workspaceBuffers.value[filePath];
        if (cached && (!options.forceDisk || cached.content !== cached.lastSyncedContent)) {
            if (!acceptsActivation(operation)) return null;
            openEditorTabInGroup(groupId, cached.node, openMode);
            return cached.node;
        }
        const detail = knownDetail ?? await $fetch<WorkspaceFileNode>("/api/workspace-files/stat", {query: {...operation.query, path: filePath}});
        if (!acceptsActivation(operation)) return null;
        if (!detail.editable) {
            setBuffer(detail.path, detail, "", "", detail.mtimeMs);
            openEditorTabInGroup(groupId, detail, openMode);
            return detail;
        }
        const file = await $fetch<WorkspaceReadResponse>("/api/workspace-files/read", {query: {...operation.query, path: filePath}});
        if (!acceptsActivation(operation)) return null;
        setBuffer(detail.path, detail, file.content, file.content, file.mtimeMs);
        openEditorTabInGroup(groupId, detail, openMode);
        return detail;
    };

    const activateWorkspaceFile = async (
        groupId: string, filePath: string, openMode: WorkspaceOpenMode, options: WorkspaceLoadOptions, operation: DocumentActivation,
        knownDetail?: WorkspaceFileNode,
    ): Promise<WorkspaceFileNode | null> => {
        const cached = workspaceBuffers.value[filePath];
        if (cached && (!options.forceDisk || cached.content !== cached.lastSyncedContent)) {
            return activateEditableWorkspaceFile(groupId, filePath, cached.node, openMode, options, operation);
        }
        const detail = knownDetail ?? findWorkspaceNode(filePath)
            ?? await $fetch<WorkspaceFileNode>("/api/workspace-files/stat", {query: {...operation.query, path: filePath}});
        if (!acceptsActivation(operation)) return null;
        if (detail.isDirectory && detail.contentNode) {
            const indexPath = `${detail.path.replace(/\/$/, "")}/index.md`;
            return activateEditableWorkspaceFile(groupId, indexPath, findWorkspaceNode(indexPath), openMode, options, operation);
        }
        return activateEditableWorkspaceFile(groupId, detail.path, detail, openMode, options, operation);
    };

    const requestWorkspaceActivation = async (groupId: string, filePath: string, openMode: WorkspaceOpenMode, options: WorkspaceLoadOptions, detail?: WorkspaceFileNode): Promise<WorkspaceFileNode | null> => {
        const operation = beginDocumentActivation(groupId);
        try {
            return await activateWorkspaceFile(groupId, filePath, openMode, options, operation, detail);
        } catch (error) {
            if (!acceptsActivation(operation)) return null;
            editorGroupErrors.value = {...editorGroupErrors.value, [groupId]: error instanceof Error ? error.message : "文件读取失败"};
            throw error;
        } finally {
            finishGroupActivation(groupId, operation.sequence);
        }
    };

    /** 组相关 API 一律显式带 groupId；只有"在当前组打开"的领域入口默认用活动组。 */
    const loadWorkspaceFile = (filePath: string, knownDetail?: WorkspaceFileNode, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> =>
        requestWorkspaceActivation(editorSession.value.activeGroupId, filePath, openMode, options, knownDetail);
    const selectWorkspacePathInGroup = (groupId: string, filePath: string, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> =>
        requestWorkspaceActivation(groupId, filePath, openMode, options);
    const selectWorkspacePath = (filePath: string, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> =>
        selectWorkspacePathInGroup(editorSession.value.activeGroupId, filePath, openMode, options);
    const openWorkspacePath = (filePath: string, openMode: WorkspaceOpenMode): Promise<WorkspaceFileNode | null> =>
        requestWorkspaceActivation(editorSession.value.activeGroupId, filePath, openMode, {});
    const openWorkspaceNode = (node: WorkspaceFileNode, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> =>
        requestWorkspaceActivation(editorSession.value.activeGroupId, node.path, openMode, options, node);
    const openWorkspaceNodeInGroup = (groupId: string, node: WorkspaceFileNode, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> =>
        requestWorkspaceActivation(groupId, node.path, openMode, options, node);

    /**
     * 按**文档身份**保存。不依赖活动组、不借选择标签驱动保存；同一文档合并在途保存。
     */
    const saveDocumentByTarget = async (target: EditorDocumentTarget, options: WorkspaceSaveOptions = {}): Promise<WorkspaceFileNode | null> => {
        const previous = inflightSaves.get(target.path);
        if (previous) {
            await previous.catch(() => undefined);
        }
        if (!acceptsDocument(target) || !workspaceBuffers.value[target.path]) {
            return null;
        }
        const operation = writeDocument(target, options);
        inflightSaves.set(target.path, operation);
        savingPaths.value = [...new Set([...savingPaths.value, target.path])];
        try {
            return await operation;
        } finally {
            if (inflightSaves.get(target.path) === operation) {
                inflightSaves.delete(target.path);
            }
            savingPaths.value = savingPaths.value.filter((path) => path !== target.path);
        }
    };

    /**
     * 一次写入请求。确认只推进"已提交内容"的磁盘基线：提交之后用户继续输入的内容仍是 dirty。
     */
    const writeDocument = async (target: EditorDocumentTarget, options: WorkspaceSaveOptions): Promise<WorkspaceFileNode | null> => {
        const buffer = workspaceBuffers.value[target.path];
        if (!buffer?.node.editable) {
            return null;
        }
        const pathToSave = buffer.node.path;
        const contentToSave = options.content ?? buffer.content;
        try {
            const nextNode = await $fetch<WorkspaceFileNode>("/api/workspace-files/write", {
                method: "PUT",
                body: {
                    ...workspaceQuery(),
                    path: pathToSave,
                    content: contentToSave,
                    baseContent: buffer.lastSyncedContent,
                    expectedMtimeMs: options.expectedMtimeMs ?? buffer.lastSyncedMtimeMs,
                    force: options.force ?? false,
                },
            });
            if (!acceptsDocument(target)) return null;
            const latest = workspaceBuffers.value[nextNode.path];
            if (!latest) return null;
            workspaceBuffers.value = {
                ...workspaceBuffers.value,
                [nextNode.path]: {
                    node: nextNode,
                    // 显式传入 content 的保存（合并结果）在缓冲未被改动时把该内容也落到缓冲。
                    content: options.content === undefined || latest.content !== buffer.content ? latest.content : contentToSave,
                    lastSyncedContent: contentToSave,
                    lastSyncedMtimeMs: nextNode.mtimeMs,
                    contentRevision: latest.contentRevision,
                },
            };
            await loadWorkspaceTree();
            return nextNode;
        } catch (error) {
            if (!acceptsDocument(target)) return null;
            const conflict = readWorkspaceWriteConflict(error);
            if (conflict) {
                workspaceWriteConflict.value = conflict;
                workspaceConflictTarget.value = target;
                workspaceConflictDialogOpen.value = true;
                return null;
            }
            throw error;
        }
    };

    /**
     * 保存活动组的活动文档。有未解决输入时停手：不能把"timer 已清"当输入已入 Store，
     * 也不能在该文档还有待用户裁决的候选时把它写盘。
     */
    const saveCurrentFile = async (options: WorkspaceSaveOptions = {}): Promise<WorkspaceFileNode | null> => {
        const target = activeWorkspaceDocumentTarget.value;
        if (!target || flushEditorPending() === "conflict" || hasUnresolvedEditorChangeForPath(target.path)) {
            return null;
        }
        return await saveDocumentByTarget(target, options);
    };

    /**
     * 保存全部带未保存改动的文档：按缓冲去重，不切换活动组、不借标签驱动。
     */
    const saveDirtyWorkspaceFiles = async (): Promise<void> => {
        if (flushEditorPending() === "conflict" || unresolvedEditorChanges.value.length > 0) {
            return;
        }
        const generation = workspaceGeneration.value;
        const key = workspaceSessionKey.value;
        const dirtyPaths = Object.entries(workspaceBuffers.value)
            .filter(([, buffer]) => buffer.content !== buffer.lastSyncedContent)
            .map(([path]) => path);

        for (const filePath of dirtyPaths) {
            if (generation !== workspaceGeneration.value || key !== workspaceSessionKey.value) return;
            const buffer = workspaceBuffers.value[filePath];
            if (!buffer || buffer.content === buffer.lastSyncedContent) continue;
            await saveDocumentByTarget(documentTarget(filePath), {});
        }
    };

    /**
     * 保存未落盘内容后下载当前 Project Workspace 或 Workspace Root .nbook 压缩包。
     */
    const downloadCurrentWorkspace = async (): Promise<string> => {
        if (workspaceKind.value !== "user-assets" && !currentProjectRoot.value) {
            throw new Error("当前没有可下载的 Project Workspace");
        }

        await saveDirtyWorkspaceFiles();
        if (hasUnsavedWorkspaceChanges.value) {
            throw new Error("还有未保存的 Project Workspace 文件，请处理后再下载");
        }

        const response = await $fetch.raw<Blob>("/api/workspace-files/download", {
            query: workspaceQuery(),
            responseType: "blob",
        });
        const filename = resolveDownloadFilename(response.headers.get("content-disposition")) ?? "workspace.zip";
        const blob = response._data;
        if (!blob) {
            throw new Error("下载响应为空");
        }

        triggerBrowserDownload(blob, filename);
        return filename;
    };

    /**
     * 上传单个文件到当前挂载根的 upload/ 目录。
     */
    const uploadFileToUploadFolder = async (file: File): Promise<WorkspaceUploadResult> => {
        const formData = createWorkspaceUploadFormData();
        formData.append("file", file, file.name);
        const result = await $fetch<WorkspaceUploadResult>("/api/workspace-files/upload-file", {
            method: "POST",
            body: formData,
        });
        await loadWorkspaceTree();
        const uploadedPath = result.files.find((item) => item.path.startsWith("upload/"))?.path;
        if (uploadedPath) {
            await selectWorkspacePath(uploadedPath, "permanent").catch(() => null);
        }
        return result;
    };

    /**
     * 上传 Project 文件集合，目录结构由浏览器 relative path 保留。
     */
    const uploadProjectFiles = async (files: File[]): Promise<WorkspaceUploadResult> => {
        const formData = createWorkspaceUploadFormData();
        formData.append("mode", "files");
        for (const file of files) {
            formData.append("files", file, file.name);
            formData.append("relativePath", readBrowserRelativePath(file));
        }
        const result = await $fetch<WorkspaceUploadResult>("/api/workspace-files/upload-project", {
            method: "POST",
            body: formData,
        });
        await loadWorkspaceTree();
        return result;
    };

    /**
     * 上传 Project zip 压缩包，服务端解包并跳过已有文件。
     */
    const uploadProjectZip = async (file: File): Promise<WorkspaceUploadResult> => {
        const formData = createWorkspaceUploadFormData();
        formData.append("mode", "zip");
        formData.append("zip", file, file.name);
        const result = await $fetch<WorkspaceUploadResult>("/api/workspace-files/upload-project", {
            method: "POST",
            body: formData,
        });
        await loadWorkspaceTree();
        return result;
    };

    const createWorkspaceUploadFormData = (): FormData => {
        const formData = new FormData();
        const query = workspaceQuery();
        if ("workspaceKind" in query) {
            formData.append("workspaceKind", query.workspaceKind);
        } else {
            formData.append("projectRoot", query.projectRoot);
        }
        return formData;
    };

    const readBrowserRelativePath = (file: File): string => {
        const relativePath = (file as File & {webkitRelativePath?: string}).webkitRelativePath;
        return relativePath?.trim() || file.name;
    };

    /**
     * 将系统 assets 中缺失的文件同步到用户 assets。
     */
    const syncUserAssetsFromSystem = async (): Promise<UserAssetsSyncResultDto> => {
        if (workspaceKind.value !== "user-assets") {
            throw new Error("只有用户资产工作区可以同步系统 assets");
        }
        const result = await $fetch<UserAssetsSyncResultDto>("/api/workspace-files/sync-user-assets", {
            method: "POST",
        });
        await loadWorkspaceTree();
        return result;
    };

    /**
     * 读取用户资产同步 warning 对应的系统/用户版本 diff 内容。
     */
    const fetchUserAssetsSyncConflictDetail = async (input: {
        kind: UserAssetsSyncConflictKindDto;
        fileName?: string;
        assetPath?: string;
    }): Promise<UserAssetsSyncConflictDetailDto> => {
        return await $fetch<UserAssetsSyncConflictDetailDto>("/api/workspace-files/user-assets-sync-conflict", {
            query: input,
        });
    };

    /**
     * 创建工作区文本文件。
     */
    const createWorkspaceFile = async (filePath: string, nextContent = ""): Promise<WorkspaceFileNode> => {
        const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/create-file", {
            method: "POST",
            body: {
                ...workspaceQuery(),
                path: filePath,
                content: nextContent,
            },
        });
        await loadWorkspaceTree();
        return node;
    };

    /**
     * 创建工作区目录。
     */
    const createWorkspaceDirectory = async (dirPath: string, indexContent: string | null = null): Promise<WorkspaceFileNode> => {
        const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/create-directory", {
            method: "POST",
            body: {
                ...workspaceQuery(),
                path: dirPath,
                indexContent,
            },
        });
        await loadWorkspaceTree();
        return node;
    };

    /**
     * 将文本文件转换成同名目录节点。
     */
    const convertWorkspaceFileToDirectory = async (filePath: string): Promise<WorkspaceFileNode> => {
        const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/convert-file-to-directory", {
            method: "POST",
            body: {
                ...workspaceQuery(),
                path: filePath,
            },
        });
        await loadWorkspaceTree();
        return node;
    };

    /**
     * 移动或重命名工作区路径。
     */
    const renameWorkspacePath = async (from: string, to: string): Promise<WorkspaceFileNode> => {
        const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/rename", {
            method: "PATCH",
            body: {...workspaceQuery(), from, to},
        });
        await loadWorkspaceTree();
        return node;
    };

    /**
     * 路径移动（重命名/移动）后迁移**所有引用**：组标签实例、活动标签、缓冲与文档身份、临时字号。
     *
     * `documentId` 跟着路径走：同一份打开实例在移动后仍是同一个身份（内容与 dirty 不变），
     * 但旧目标里的 `path` 不再匹配，旧视图回调因此失效——这正是移动该有的语义。
     */
    const migrateWorkspacePaths = (sourcePath: string, targetPath: string, isDirectory: boolean): void => {
        const groups = editorSession.value.groups.map((group) => ({
            id: group.id,
            activePath: rewriteWorkspaceMovedPath(group.activePath, sourcePath, targetPath, isDirectory) ?? group.activePath,
            tabs: group.tabs.map((tab) => {
                const nextPath = rewriteWorkspaceMovedPath(tab.path, sourcePath, targetPath, isDirectory);
                return nextPath ? {...tab, path: nextPath} : tab;
            }),
        }));
        publishEditorSession({groups, activeGroupId: editorSession.value.activeGroupId});

        const nextBuffers: Record<string, WorkspaceFileBuffer> = {};
        const nextIds = new Map<string, string>();
        for (const [path, buffer] of Object.entries(workspaceBuffers.value)) {
            const nextPath = rewriteWorkspaceMovedPath(path, sourcePath, targetPath, isDirectory) ?? path;
            nextBuffers[nextPath] = buffer;
            const id = documentIds.get(path);
            if (id) {
                nextIds.set(nextPath, id);
            }
        }
        workspaceBuffers.value = nextBuffers;
        documentIds.clear();
        for (const [path, id] of nextIds) {
            documentIds.set(path, id);
        }

        const nextOverrides: Record<string, number> = {};
        for (const [path, size] of Object.entries(monacoFontSizeOverridesByPath.value)) {
            nextOverrides[rewriteWorkspaceMovedPath(path, sourcePath, targetPath, isDirectory) ?? path] = size;
        }
        monacoFontSizeOverridesByPath.value = nextOverrides;
    };

    /**
     * 立即在本地树中应用一次路径移动（文件树与全部打开引用一起改）。
     */
    const applyOptimisticWorkspaceMove = (sourceNode: WorkspaceFileNode, targetPath: string): void => {
        workspaceTree.value = workspaceTree.value.map((node) => {
            const nextPath = rewriteWorkspaceMovedPath(node.path, sourceNode.path, targetPath, sourceNode.isDirectory);
            return nextPath ? {...node, path: nextPath} : node;
        });
        migrateWorkspacePaths(sourceNode.path, targetPath, sourceNode.isDirectory);
    };

    /**
     * 乐观移动工作区路径，用于拖拽后立即更新文件树。
     */
    const optimisticRenameWorkspacePath = async (from: string, to: string): Promise<WorkspaceFileNode> => {
        const sourceNode = workspaceTree.value.find((node) => normalizeWorkspaceFilePath(node.path) === normalizeWorkspaceFilePath(from));
        if (!sourceNode) {
            return await renameWorkspacePath(from, to);
        }

        const snapshot = {
            workspaceTree: workspaceTree.value,
            workspaceBuffers: workspaceBuffers.value,
            editorSession: editorSession.value,
            documentIds: new Map(documentIds),
            monacoOverrides: monacoFontSizeOverridesByPath.value,
        };
        applyOptimisticWorkspaceMove(sourceNode, normalizeWorkspaceMovedPath(to, sourceNode.isDirectory));

        try {
            const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/rename", {
                method: "PATCH",
                body: {...workspaceQuery(), from, to},
            });
            await loadWorkspaceTree();
            return node;
        } catch (error) {
            workspaceTree.value = snapshot.workspaceTree;
            workspaceBuffers.value = snapshot.workspaceBuffers;
            editorSession.value = snapshot.editorSession;
            documentIds.clear();
            for (const [path, id] of snapshot.documentIds) {
                documentIds.set(path, id);
            }
            monacoFontSizeOverridesByPath.value = snapshot.monacoOverrides;
            publishEditorLayout();
            throw error;
        }
    };

    /**
     * 删除工作区路径：所有组里指向它的标签实例与缓冲一起摘掉。
     */
    const deleteWorkspacePath = async (filePath: string, recursive = false): Promise<void> => {
        await $fetch("/api/workspace-files/delete", {
            method: "DELETE",
            body: {
                ...workspaceQuery(),
                path: filePath,
                recursive,
            },
        });
        const normalizedPath = normalizeWorkspaceFilePath(filePath);
        const touches = (path: string): boolean => {
            const normalized = normalizeWorkspaceFilePath(path);
            return normalized === normalizedPath || normalized.startsWith(`${normalizedPath}/`);
        };
        publishEditorSession({
            groups: editorSession.value.groups.map((group) => ({
                id: group.id,
                activePath: touches(group.activePath) ? "" : group.activePath,
                tabs: group.tabs.filter((tab) => !touches(tab.path)),
            })),
            activeGroupId: editorSession.value.activeGroupId,
        });
        for (const path of Object.keys(workspaceBuffers.value)) {
            if (touches(path)) {
                releaseEditorDocument(path);
            }
        }
        const nextMonacoOverrides: Record<string, number> = {};
        for (const [path, size] of Object.entries(monacoFontSizeOverridesByPath.value)) {
            if (!touches(path)) {
                nextMonacoOverrides[path] = size;
            }
        }
        monacoFontSizeOverridesByPath.value = nextMonacoOverrides;
        await loadWorkspaceTree();
    };

    /**
     * 切换到已打开的标签页（默认活动组；组相关调用走 `selectWorkspaceTabInGroup`）。
     */
    const selectWorkspaceTabInGroup = async (groupId: string, filePath: string): Promise<WorkspaceFileNode | null> => {
        const tab = findEditorSessionTab(editorSession.value, groupId, filePath);
        return await selectWorkspacePathInGroup(groupId, filePath, tab?.preview ? "preview" : "permanent");
    };
    const selectWorkspaceTab = async (filePath: string): Promise<WorkspaceFileNode | null> =>
        await selectWorkspaceTabInGroup(editorSession.value.activeGroupId, filePath);

    /**
     * 关闭指定组的标签实例。调用方负责在**最后引用**的脏文档上先确认。
     *
     * 未解决输入先结算：conflict 时停手，不关闭。
     */
    const closeWorkspaceTab = async (groupId: string, filePath: string, discardChanges = false): Promise<void> => {
        if (flushEditorPending(groupId) === "conflict" && !discardChanges) {
            return;
        }
        const tab = findEditorSessionTab(editorSession.value, groupId, filePath);
        if (!tab) {
            return;
        }
        const buffer = workspaceBuffers.value[filePath];
        const dirty = Boolean(buffer && buffer.content !== buffer.lastSyncedContent);
        if (dirty && !discardChanges) {
            return;
        }
        const removed = removeTab(editorGrid, editorSession.value, groupId, filePath);
        if (!removed.ok || !applyEditorSessionOutcome(removed)) {
            return;
        }
        // 该组的活动标签换成下一个（若有）时按需读取尚未加载的文档。
        const activeGroupId = editorSession.value.activeGroupId;
        const nextPath = findEditorSessionGroup(editorSession.value, activeGroupId)?.activePath ?? "";
        if (nextPath && !workspaceBuffers.value[nextPath]) {
            try {
                await selectWorkspacePathInGroup(activeGroupId, nextPath, "permanent");
            } catch {
                // 读取失败已在组的诊断里呈现，这里不再抛给关闭流程。
            }
        }
    };

    /**
     * 内容区实测尺寸：程序布局的输入，不产生保存意图。
     */
    const setEditorExtent = (extent: GridExtent): void => {
        editorExtent.value = extent;
        publishEditorLayout();
    };

    /**
     * 一场分栏手势的落账：提交里的整批分支变化（含交汇处两根轴）由公共助手一次交给树，
     * 任一项不通过就整批不落账，也不推进修订；成功时只推进**一次**会话修订，
     * 让存储会话记录下结束的手势意图。
     */
    const commitEditorGesture = (commit: Readonly<GridGestureCommit>): {ok: true} | {ok: false; reason: string} => {
        if (commit.contextKey !== currentWorkspaceRoot.value) {
            return {ok: false, reason: "工作面已切换，本次调整没有落账"};
        }
        const applied = applyEditorGesture(editorGrid, commit);
        if (!applied.ok) {
            return applied;
        }
        editorSessionRevision.value += 1;
        publishEditorLayout();
        return {ok: true};
    };

    /**
     * 把标签以 copy/move 放到目标组旁的新组。工具栏分屏是 copy（共用正文，不复制缓冲）；
     * 拖到组边缘是 move（源组因此为空时塌陷）。
     */
    const splitEditorTab = (input: Readonly<{
        sourceGroupId: string;
        targetGroupId: string;
        newGroupId: string;
        path: string;
        direction: EditorSplitDirection;
        mode: "copy" | "move";
    }>): boolean => applyEditorSessionOutcome(splitTabToNewGroup(editorGrid, editorSession.value, input));

    /** 跨组移动：目标组已有同路径时激活该标签并删除来源引用，不创建重复实例。 */
    const transferEditorTab = (input: Readonly<{
        sourceGroupId: string;
        targetGroupId: string;
        path: string;
        targetPath?: string | null;
        targetPinned?: boolean;
        position?: "before" | "after";
    }>): boolean => applyEditorSessionOutcome(transferTab(editorGrid, editorSession.value, input));

    /** 已分组（深度优先，与渲染顺序一致）。 */
    const editorGroups = computed(() => editorSession.value.groups);

    /** 存储会话读取的候选快照：会话状态 + 树快照（不暴露可变树实例）。 */
    const readEditorSessionSnapshot = (): {state: EditorSessionState; grid: GridSnapshot} => ({
        state: editorSession.value,
        grid: serializeEditorSession(editorSession.value, editorGrid).grid,
    });

    /** 存储会话恢复：整体替换会话与树（恢复结果已由 `editor-session` 校验过）。 */
    const replaceEditorSession = (restored: Readonly<{state: EditorSessionState; grid: Grid<string>}>): void => {
        editorGrid = restored.grid;
        publishEditorSession(restored.state);
    };

    /**
     * 设置某个标签页的 Monaco 临时字号；此状态不持久化，随标签页生命周期清理。
     */
    const setMonacoFontSizeOverride = (filePath: string, fontSize: number): void => {
        if (!filePath || !Number.isFinite(fontSize)) {
            return;
        }

        monacoFontSizeOverridesByPath.value = {
            ...monacoFontSizeOverridesByPath.value,
            [filePath]: Math.min(Math.max(Math.round(fontSize), 10), 32),
        };
    };

    /**
     * 把一条文档级诊断写到引用它**所有**组上（多组显示同一文档时诊断要一致）。
     */
    const setDocumentErrorForPath = (path: string, message: string): void => {
        const groups = editorSession.value.groups.filter((group) => group.tabs.some((tab) => tab.path === path));
        if (groups.length === 0) {
            return;
        }
        const next = {...editorGroupErrors.value};
        for (const group of groups) {
            next[group.id] = message;
        }
        editorGroupErrors.value = next;
    };

    /**
     * 从磁盘同步外部文件变化。dirty 文件只标记冲突，不自动覆盖用户输入。
     *
     * 遍历的是**缓冲**（打开文档的唯一 authority），不再借标签列表：同文档两组只处理一次。
     */
    const syncWorkspaceFromDisk = async (events: WorkspaceFileChangeEventDto[]): Promise<WorkspaceDiskSyncResult> => {
        const unchanged: WorkspaceDiskSyncResult = {activeFile: "unchanged", dirtyPaths: [], deletedPaths: []};
        if (!canAccessWorkspace.value || events.length === 0) return unchanged;
        flushEditorPending();
        const generation = workspaceGeneration.value;
        const key = workspaceSessionKey.value;
        const query = workspaceQuery();
        const previousTarget = activeWorkspaceDocumentTarget.value;
        const previousPath = previousTarget?.path ?? "";
        const dirtyPaths: string[] = [];
        const deletedPaths: string[] = [];
        const current = () => generation === workspaceGeneration.value && key === workspaceSessionKey.value;
        await loadWorkspaceTree({bypassPendingRequest: true});
        if (!current()) return unchanged;
        for (const [path, buffer] of Object.entries(workspaceBuffers.value)) {
            if (!current()) return unchanged;
            if (path === previousPath || !workspacePathTouchedByEvents(path, events)) continue;
            const target = documentTarget(path);
            if (buffer.content !== buffer.lastSyncedContent) {
                dirtyPaths.push(path);
                continue;
            }
            const node = findWorkspaceNode(path);
            if (!node) {
                removeWorkspaceTabState(path);
                deletedPaths.push(path);
                continue;
            }
            if (!node.editable) continue;
            try {
                const file = await $fetch<WorkspaceReadResponse>("/api/workspace-files/read", {query: {...query, path}});
                if (!current() || !acceptsDocument(target)) return unchanged;
                const latest = workspaceBuffers.value[path];
                if (latest && latest.content !== latest.lastSyncedContent) {
                    dirtyPaths.push(path);
                    continue;
                }
                setBuffer(path, node, file.content, file.content, file.mtimeMs);
            } catch (error) {
                if (!current() || !acceptsDocument(target)) return unchanged;
                if (isMissingWorkspaceFile(error)) {
                    removeWorkspaceTabState(path);
                    deletedPaths.push(path);
                } else setDocumentErrorForPath(path, error instanceof Error ? error.message : "文件同步失败");
            }
        }
        if (!current() || !previousTarget || !matchesEditorDocument(previousTarget, activeWorkspaceDocumentTarget.value)
            || !workspacePathTouchedByEvents(previousPath, events)) return {activeFile: "unchanged", dirtyPaths, deletedPaths};
        flushEditorPending();
        const active = activeWorkspaceFile.value;
        if (!active) return {activeFile: "unchanged", dirtyPaths, deletedPaths};
        const node = findWorkspaceNode(previousPath);
        if (node?.mtimeMs === active.lastSyncedMtimeMs) return {activeFile: "unchanged", dirtyPaths, deletedPaths};
        if (active.content !== active.lastSyncedContent) return {
            activeFile: "dirty", dirtyPaths: [...dirtyPaths, previousPath], deletedPaths: node ? deletedPaths : [...deletedPaths, previousPath],
        };
        if (!node) {
            removeWorkspaceTabState(previousPath);
            return {activeFile: "deleted", dirtyPaths, deletedPaths: [...deletedPaths, previousPath]};
        }
        try {
            const groupId = editorSession.value.activeGroupId;
            const tab = findEditorSessionTab(editorSession.value, groupId, previousPath);
            const result = await selectWorkspacePathInGroup(groupId, previousPath, tab?.preview ? "preview" : "permanent", {forceDisk: true});
            return {activeFile: result ? "reloaded" : "unchanged", dirtyPaths, deletedPaths};
        } catch {
            return {activeFile: "unchanged", dirtyPaths, deletedPaths};
        }
    };

    /**
     * 用冲突里的真实文件内容覆盖该文档的权威正文（不看活动组：冲突可能发生在后台组的文档上）。
     */
    const applyWorkspaceConflictRemote = (conflict: WorkspaceWriteConflictDto): void => {
        const buffer = workspaceBuffers.value[conflict.path];
        if (!buffer) {
            return;
        }
        if (!conflict.remoteExists || !conflict.node) {
            removeWorkspaceTabState(conflict.path);
            return;
        }
        setBuffer(conflict.path, conflict.node as WorkspaceFileNode, conflict.remoteContent, conflict.remoteContent, conflict.actualMtimeMs);
    };

    /**
     * 把手动合并结果写入该文档，并把真实文件版本作为新的保存基线。
     */
    const applyWorkspaceConflictMergedContent = (conflict: WorkspaceWriteConflictDto, content: string): void => {
        const buffer = workspaceBuffers.value[conflict.path];
        if (!buffer) {
            return;
        }
        const nextNode = (conflict.node as WorkspaceFileNode | null) ?? buffer.node;
        setBuffer(conflict.path, nextNode, content, conflict.remoteContent, conflict.actualMtimeMs);
    };

    /**
     * 处理 workspace 写入冲突。保存目标取自冲突登记的身份（不再假设"冲突就是当前活动文件"）。
     */
    const resolveWorkspaceWriteConflict = async (resolution: WorkspaceFileConflictResolution): Promise<WorkspaceFileNode | null> => {
        const conflict = workspaceWriteConflict.value;
        const target = workspaceConflictTarget.value;
        workspaceWriteConflict.value = null;
        workspaceConflictTarget.value = null;
        if (!conflict || resolution.action === "cancel") {
            return null;
        }

        if (resolution.action === "reload-remote") {
            applyWorkspaceConflictRemote(conflict);
            return null;
        }
        const saveTarget = target && acceptsDocument(target)
            ? target
            : documentTarget(conflict.path);
        if (resolution.action === "overwrite-local") {
            return await saveDocumentByTarget(saveTarget, {force: true});
        }

        applyWorkspaceConflictMergedContent(conflict, resolution.content);
        return await saveDocumentByTarget(saveTarget, {
            content: resolution.content,
            expectedMtimeMs: conflict.actualMtimeMs,
        });
    };

    /**
     * 规范化工作区路径，去掉结尾斜杠。
     */
    const normalizeWorkspaceFilePath = (filePath: string): string => {
        return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
    };

    /**
     * 从 Content-Disposition 中读取下载文件名。
     */
    const resolveDownloadFilename = (contentDisposition: string | null): string | null => {
        if (!contentDisposition) {
            return null;
        }

        const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
        if (utf8Match?.[1]) {
            return decodeURIComponent(utf8Match[1]);
        }

        const asciiMatch = /filename="([^"]+)"/i.exec(contentDisposition);
        return asciiMatch?.[1] ?? null;
    };

    /**
     * 判断某个工作区路径是否被文件事件影响。
     */
    const workspacePathTouchedByEvents = (filePath: string, events: WorkspaceFileChangeEventDto[]): boolean => {
        const normalizedPath = normalizeWorkspaceFilePath(filePath);
        return events.some((event) => {
            const eventPath = normalizeWorkspaceFilePath(event.path);
            return normalizedPath === eventPath || normalizedPath.startsWith(`${eventPath}/`);
        });
    };

    /**
     * 按节点类型规范化移动后的路径。
     */
    const normalizeWorkspaceMovedPath = (filePath: string, isDirectory: boolean): string => {
        const normalizedPath = normalizeWorkspaceFilePath(filePath);
        return isDirectory ? `${normalizedPath}/` : normalizedPath;
    };

    /**
     * 计算当前路径在一次移动后的新路径。
     */
    const rewriteWorkspaceMovedPath = (
        currentPath: string,
        sourcePath: string,
        targetPath: string,
        sourceIsDirectory: boolean,
    ): string | null => {
        const normalizedCurrentPath = currentPath.replace(/\\/g, "/");
        if (!sourceIsDirectory) {
            return normalizeWorkspaceFilePath(normalizedCurrentPath) === normalizeWorkspaceFilePath(sourcePath)
                ? normalizeWorkspaceFilePath(targetPath)
                : null;
        }

        const sourcePrefix = normalizeWorkspaceMovedPath(sourcePath, true);
        const targetPrefix = normalizeWorkspaceMovedPath(targetPath, true);
        if (normalizedCurrentPath === sourcePrefix) {
            return targetPrefix;
        }
        if (normalizedCurrentPath.startsWith(sourcePrefix)) {
            return `${targetPrefix}${normalizedCurrentPath.slice(sourcePrefix.length)}`;
        }
        return null;
    };

    /**
     * 读取指定 detail 的本地回退栈。
     */
    const getDetailUndoStack = (key: string): string[] => {
        return [...(detailUndoStacks.value[key] ?? [])];
    };

    /**
     * 向指定 detail 的本地回退栈压入一条快照。
     */
    const pushDetailUndoSnapshot = (key: string, snapshot: string): void => {
        if (!snapshot) {
            return;
        }

        const currentStack = detailUndoStacks.value[key] ?? [];
        if (currentStack.at(-1) === snapshot) {
            return;
        }

        detailUndoStacks.value = {
            ...detailUndoStacks.value,
            [key]: [...currentStack, snapshot].slice(-DETAIL_UNDO_LIMIT),
        };
    };

    /**
     * 弹出指定 detail 的上一条快照。
     */
    const popDetailUndoSnapshot = (key: string): string | null => {
        const currentStack = detailUndoStacks.value[key] ?? [];
        if (currentStack.length === 0) {
            return null;
        }

        const nextStack = [...currentStack];
        const snapshot = nextStack.pop() ?? null;
        detailUndoStacks.value = {
            ...detailUndoStacks.value,
            [key]: nextStack,
        };
        return snapshot;
    };

    /**
     * 清空指定 detail 的回退历史。
     */
    const clearDetailUndoStack = (key: string): void => {
        if (!(key in detailUndoStacks.value)) {
            return;
        }

        const nextStacks = {...detailUndoStacks.value};
        delete nextStacks[key];
        detailUndoStacks.value = nextStacks;
    };

    /** 使 mutation 前启动的 Catalog GET 失去发布权。 */
    const invalidateProjectCatalog = (): void => {
        projectCatalogGeneration += 1;
    };

    /**
     * 加载完整 Project Catalog snapshot；同一 generation 的并发调用共享请求。
     * mutation 期间迟到的请求会自动追读当前 generation，绝不发布旧结果。
     */
    const loadProjects = async (): Promise<ProjectCatalogSnapshot> => {
        const generation = projectCatalogGeneration;
        if (projectCatalogRequest?.generation === generation) {
            return await projectCatalogRequest.promise;
        }

        const readSnapshot = async (): Promise<ProjectCatalogSnapshot> => {
            try {
                const snapshot = await $fetch<ProjectListResponseDto>("/api/projects");
                if (generation !== projectCatalogGeneration) {
                    return await loadProjects();
                }
                const published = Object.freeze({
                    revision: snapshot.revision,
                    projects: Object.freeze(snapshot.projects.map((project) => Object.freeze({...project}))),
                });
                projectSnapshot.value = published;
                return published;
            } catch (error) {
                if (generation !== projectCatalogGeneration) {
                    return await loadProjects();
                }
                throw error;
            } finally {
                if (projectCatalogRequest?.generation === generation) {
                    projectCatalogRequest = null;
                }
            }
        };

        const promise = readSnapshot();
        projectCatalogRequest = {generation, promise};
        return await promise;
    };

    /** mutation 已确认提交后，无法发布完整 Catalog 时保留 committed true。 */
    const refreshAfterProjectMutation = async (operation: ProjectCatalogMutation): Promise<void> => {
        try {
            await loadProjects();
        } catch (cause) {
            throw new ProjectCatalogRefreshError(operation, {cause});
        }
    };

    /** mutation 请求前后推进 generation；成功响应统一回读服务端权威 Catalog。 */
    const runProjectMutation = async <T>(input: Readonly<{
        operation: ProjectCatalogMutation;
        request: () => Promise<T>;
        committed?: (result: T) => void;
    }>): Promise<T> => {
        invalidateProjectCatalog();
        let result: T;
        try {
            result = await input.request();
        } catch (error) {
            invalidateProjectCatalog();
            throw error;
        }
        invalidateProjectCatalog();
        input.committed?.(result);
        await refreshAfterProjectMutation(input.operation);
        return result;
    };

    /**
     * 关闭当前 Project，进入「未选择 Project」状态（首页项目选择界面）。
     *
     * 只清理内存视图状态并落盘会话记忆，不发任何请求；presence 由页面侧显式释放。
     */
    const closeProjectWorkspace = (): void => {
        persistWorkspaceSession();
        resetDocumentLifecycle();
        workspaceKind.value = "novel";
        currentProjectRoot.value = "";
        clearWorkspaceSelection();
        clearActiveFile();
        clearWorkspaceState();
    };

    /** 清理已由服务端 snapshot 证明不存在的 Project 本地工作区记忆。 */
    const forgetProject = (projectRoot: string): void => {
        if (currentProjectRoot.value === projectRoot) {
            closeProjectWorkspace();
        }
        clearNovelWorkspaceSession(projectRoot);
    };

    /**
     * 切换到全局用户 assets 工作区。
     */
    const switchToUserAssetsWorkspace = async (): Promise<void> => {
        persistWorkspaceSession();
        workspaceKind.value = "user-assets";
        restoreWorkspaceSession();
        await initializeWorkspace();
    };

    /**
     * 提交已经通过 Project 激活事务的目标，并初始化其文件树与标签。
     */
    const switchToNovelWorkspace = async (projectRoot: string): Promise<void> => {
        persistWorkspaceSession();
        workspaceKind.value = "novel";
        currentProjectRoot.value = projectRoot;
        restoreWorkspaceSession();
        await initializeWorkspace();
    };

    /**
     * 新建小说。
     */
    const createProject = async (title: string, summary: string = ""): Promise<string> => {
        const result = await runProjectMutation<ProjectCreateResponseDto>({
            operation: "create",
            request: () => $fetch<ProjectCreateResponseDto>("/api/projects", {
                method: "POST",
                body: {title, summary},
            }),
        });
        return result.project.projectRoot;
    };

    /**
     * 删除小说。
     */
    const deleteProject = async (projectRoot: string): Promise<void> => {
        await runProjectMutation<ProjectDeleteResponseDto>({
            operation: "delete",
            request: () => $fetch<ProjectDeleteResponseDto>("/api/projects/item", {
                method: "DELETE",
                query: {projectRoot},
            }),
            committed: () => forgetProject(projectRoot),
        });
    };

    /** 上传或清除 Project 封面，并由 Store 唯一发布返回的 metadata。 */
    const updateProjectCover = async (projectRoot: string, file: File | null): Promise<ProjectMetadataDto> => {
        const result = await runProjectMutation<ProjectMutationResponseDto>({
            operation: "cover-update",
            request: () => {
                const query = new URLSearchParams({projectRoot}).toString();
                if (file === null) {
                    return $fetch<ProjectMutationResponseDto>(`/api/projects/cover?${query}`, {method: "DELETE"});
                }
                const body = new FormData();
                body.append("file", file, file.name);
                return $fetch<ProjectMutationResponseDto>(`/api/projects/cover?${query}`, {method: "PUT", body});
            },
        });
        return result.project;
    };

    /**
     * 初始化已激活的 Project Workspace；缺失目标进入未选择状态，绝不自动挑选其它 Project。
     */
    const initializeWorkspace = async (): Promise<void> => {
        const generation = workspaceGeneration.value;
        const key = workspaceSessionKey.value;
        loadingWorkspace.value = true;
        try {
            if (!canAccessWorkspace.value) {
                clearWorkspaceSelection();
                clearActiveFile();
                clearWorkspaceState();
                return;
            }
            await loadWorkspaceTree();
            if (generation !== workspaceGeneration.value || key !== workspaceSessionKey.value) return;
            await restoreWorkspaceTabFromPersistedState();
        } finally {
            if (generation === workspaceGeneration.value && key === workspaceSessionKey.value) loadingWorkspace.value = false;
        }
    };

    return {
        activeEditorGroupId,
        activeWorkspaceDocumentTarget,
        activeWorkspaceTabPath,
        workspaceGeneration,
        loadingWorkspaceDocument,
        workspaceDocumentError,
        updateWorkspaceDocument,
        commitEditorChange,
        unresolvedEditorChanges,
        hasUnresolvedEditorChanges,
        discardUnresolvedEditorChange,
        readUnresolvedEditorChange,
        registerEditorFlush,
        flushEditorPending,
        activeToolView,
        applyWorkspaceConflictMergedContent,
        applyWorkspaceConflictRemote,
        clearActiveFile,
        closeWorkspaceTab,
        commitEditorGesture,
        editorGroups,
        editorLayout,
        editorSession,
        editorSessionRevision,
        editorTree,
        editorDocumentTarget: documentTarget,
        editorGroupErrors,
        editorGroupLoading,
        readEditorSessionSnapshot,
        replaceEditorSession,
        selectEditorGroup,
        setEditorExtent,
        splitEditorTab,
        transferEditorTab,
        convertWorkspaceFileToDirectory,
        createWorkspaceDirectory,
        createWorkspaceFile,
        createProject,
        currentNovel,
        currentProjectRoot,
        currentWorkspaceRoot,
        canAccessWorkspace,
        deleteProject,
        deleteWorkspacePath,
        downloadCurrentWorkspace,
        forgetProject,
        hasUnsavedFileChanges,
        hasUnsavedWorkspaceChanges,
        initializeWorkspace,
        lastSyncedFileContent,
        layoutMode,
        agentSessionPanelOpen,
        agentSessionPanelWidth,
        agentStudioPanelOpen,
        agentStudioPanelWidth,
        agentStudioFileTreeWidth,
        loadingWorkspace,
        loadProjects,
        loadWorkspaceFile,
        loadWorkspaceTree,
        syncWorkspaceFromDisk,
        persistWorkspaceSession,
        resolveWorkspaceWriteConflict,
        keepWorkspaceTab,
        moveWorkspaceTab,
        novels,
        openWorkspacePath,
        openWorkspaceNode,
        openWorkspaceNodeInGroup,
        optimisticRenameWorkspacePath,
        plotWorkbenchOpen,
        plotWorkbenchTab,
        plotPlanningFocusId,
        detailUndoStacks,
        getDetailUndoStack,
        pushDetailUndoSnapshot,
        popDetailUndoSnapshot,
        clearDetailUndoStack,
        configRevision,
        bumpConfigRevision,
        reasoningOptions,
        saveCurrentFile,
        saveDocumentByTarget,
        saveDirtyWorkspaceFiles,
        selectedStoryThreadId,
        selectedStorySceneId,
        selectedLorebookEntryId,
        selectedCharacterId,
        selectedModel,
        selectedReasoning,
        selectedFileContent,
        selectedFileNode,
        selectedFilePath,
        selectWorkspaceTab,
        selectWorkspaceTabInGroup,
        setSelectedModelLabel,
        showEditorWorkspace,
        isUserAssetsWorkspace,
        selectWorkspacePath,
        selectWorkspacePathInGroup,
        setMonacoFontSizeOverride,
        setWorkspaceTabPinned,
        setWorkspaceTabEditor,
        toggleWorkspaceTabPinned,
        switchToNovelWorkspace,
        closeProjectWorkspace,
        switchToUserAssetsWorkspace,
        updateProjectCover,
        syncUserAssetsFromSystem,
        fetchUserAssetsSyncConflictDetail,
        uploadFileToUploadFolder,
        uploadProjectFiles,
        uploadProjectZip,
        markdownEditorPreferences,
        monacoEditorPreferences,
        monacoFontSizeOverridesByPath,
        plotRefreshVersion,
        loadingWorkspaceTree,
        renameWorkspacePath,
        restoreWorkspaceTabFromPersistedState,
        restoringWorkspaceFile,
        savingFile,
        workspaceKind,
        workspaceReady,
        workspaceConflictDialogOpen,
        workspaceWriteConflict,
        workspaceIssues,
        workspaceTreeRevision,
        workspaceBuffers,
        workspaceSessions,
        workspaceTabs,
        workspaceTree,
    };
}, {
    persist: [
        {
            key: "novel.ide.session",
            storage: piniaPluginPersistedstate.sessionStorage(),
            pick: [
            "currentProjectRoot",
            "selectedLorebookEntryId",
            "selectedCharacterId",
            "workspaceSessions",
            "detailUndoStacks",
        ],
    },
    {
            key: "novel.ide.local",
            // 三个已迁移字段（左右栏尺寸与书架模式）已退出 `pick`：读写都在工作台 Storage 会话里
            // （`app/utils/workbench/layout-session.ts`），本桶不再承载它们的运行期值。
            //
            // 旧「活动左侧页签」字段也已退出 `pick`，且**没有**运行期状态：工具上下文由
            // 非持久的 `activeToolView` 承载（页面按真实可见性发布）。序列化器只负责把原件里的原值
            // 原样留在桶里（见 `storage-migration-legacy-bucket.ts` 的退役字段），不把它迁成新选择、
            // 也不制造缺省值。
            //
            // storage/serializer 门禁**暂时保留**：原件未安全保留（暂存失败、data 备份未落盘）时，
            // 三个源值只存在于这个桶里，序列化器必须继续从捕获原件补齐它们，免得其它字段的整键重写
            // 把它们抹掉（迁移合同「启动顺序」第 2/5 步）。退役判据与调用点在启动接线
            // `app/plugins/storage-migration.client.ts`：原件已暂存且 data 备份落盘（或迁移 phase 已 complete）。
            storage: legacyBucketStorage(),
            serializer: legacyBucketSerializer,
            pick: [
            "agentSessionPanelOpen",
            "agentSessionPanelWidth",
            "agentStudioPanelOpen",
            "agentStudioPanelWidth",
            "agentStudioFileTreeWidth",
            "selectedModel",
            "selectedReasoning",
            "markdownEditorPreferences",
            "monacoEditorPreferences",
        ],
        },
    ],
});
