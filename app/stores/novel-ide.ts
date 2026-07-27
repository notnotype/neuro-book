import type {
    ChapterDetailDto,
    ChapterDetailWriteResponseDto,
    ChapterSummaryDto,
    NovelListItemDto,
    NovelTreeDto,
    ReorderChaptersRequestDto,
    ReorderVolumesRequestDto,
    UpdateVolumeRequestDto,
    VolumeDto,
} from "nbook/shared/dto/novel-chapter.dto";
import type {ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import {resolveTheme} from "nbook/app/utils/theme/resolve-theme";
import {triggerBrowserDownload} from "nbook/app/utils/browser-download";
import type {CustomThemeDto, ThemeAppearance} from "nbook/shared/theme/theme-vars";
import type { NovelIdeTab } from "nbook/app/components/novel-ide/mock-data";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    resolveDefaultWorkspaceViewMode,
    resolveWorkspaceEditorKind,
    resolveWorkspaceFileExtension,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
    type WorkspaceEditorKind,
    type WorkspaceEditorViewMode,
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

export type {WorkspaceEditorKind, WorkspaceEditorViewMode} from "nbook/shared/editor-workbench";

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
    editorKind: WorkspaceEditorKind;
    viewMode: WorkspaceEditorViewMode;
    pinned: boolean;
    preview: boolean;
    dirty: boolean;
};

export type WorkspaceOpenMode = "preview" | "permanent";
export type NovelIdeLayoutMode = "ide" | "agent";

type WorkspaceFileBuffer = {
    node: WorkspaceFileNode;
    content: string;
    lastSyncedContent: string;
    lastSyncedMtimeMs: number | null;
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
type WorkspaceQueryInput = {projectPath: string} | {workspaceKind: "user-assets"};

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

type SwitchNovelOptions = {
    discardWorkspaceChanges?: boolean;
};

/**
 * Agent 推送工作区同步事件。
 */
export type AgentWorkspaceSyncPayload = {
    kind: "chapter_content";
    chapterId: string;
    toolName: string;
    toolCallId: string;
} | {
    kind: "chapter_tree";
    toolName: string;
    toolCallId: string;
} | {
    kind: "plot_tree";
    toolName: string;
    toolCallId: string;
};

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

/**
 * Agent 写回当前章节但用户仍有未保存改动时，先暂存这份刷新。
 */
export type PendingAgentChapterUpdate = {
    detail: ChapterDetailDto;
    toolName: string;
    toolCallId: string;
};

const REASONING_OPTIONS = ["超高", "高", "中", "低"] as const;
const DEFAULT_NOVEL_TITLE = "未命名小说";
const DETAIL_UNDO_LIMIT = 20;
const DEFAULT_MODEL_LABEL = "未配置模型";

/**
 * 统一管理小说 IDE 的业务状态与核心数据动作。
 */
export const useNovelIdeStore = defineStore("novelIde", () => {
    const novels = ref<NovelListItemDto[]>([]);
    const currentNovelId = ref("");
    const selectedChapterId = ref("");
    const selectedStoryThreadId = ref<string | null>(null);
    const selectedStorySceneId = ref<string | null>(null);
    const selectedLorebookEntryId = ref<string | null>(null);
    const selectedCharacterId = ref<string | null>(null);
    const plotRefreshVersion = ref(0);
    const novelTree = ref<NovelTreeDto | null>(null);
    const workspaceTree = ref<WorkspaceFileNode[]>([]);
    const workspaceTabs = ref<WorkspaceEditorTab[]>([]);
    const activeWorkspaceTabPath = ref("");
    const workspaceBuffers = ref<Record<string, WorkspaceFileBuffer>>({});
    const workspaceSessions = ref<Record<string, WorkspaceSessionState>>({});
    const workspaceKind = ref<WorkspaceKind>("novel");
    const configRevision = ref(0);
    const activeWorkspaceFile = ref<WorkspaceActiveFile | null>(null);
    const workspaceIssues = ref<WorkspaceFileIssue[]>([]);
    const workspaceWriteConflict = ref<WorkspaceWriteConflictDto | null>(null);
    const workspaceConflictDialogOpen = ref(false);
    const content = ref("");
    const lastSyncedChapterContent = ref("");
    const pendingAgentChapterUpdate = ref<PendingAgentChapterUpdate | null>(null);
    const detailUndoStacks = ref<Record<string, string[]>>({});

    const loadingWorkspace = ref(false);
    const loadingWorkspaceTree = ref(false);
    const restoringWorkspaceFile = ref(false);
    const savingFile = ref(false);
    const hydratingChapter = ref(false);
    const creatingChapterTree = ref(false);
    const mutatingChapterTree = ref(false);

    const activeLeftTab = ref<NovelIdeTab | null>("files");
    const layoutMode = ref<NovelIdeLayoutMode>("ide");
    const agentSessionPanelOpen = ref(true);
    const agentSessionPanelWidth = ref(280);
    const agentStudioPanelOpen = ref(true);
    const agentStudioPanelWidth = ref(460);
    const agentStudioFileTreeWidth = ref(200);
    const leftPanelWidth = ref(340);
    const plotWorkbenchOpen = ref(false);
    // 剧本工作台当前 tab:线程规划 / 承诺账本 / 决策记录;侧栏计数入口与账本跳转联动直接写它。
    const plotWorkbenchTab = ref<"thread" | "promises" | "decisions">("thread");
    // 跳账本时要聚焦的 promise/decision id;为空表示无待消费的聚焦请求,对应 tab 消费一次后置回 null。
    const plotPlanningFocusId = ref<string | null>(null);
    const rightPanelOpen = ref(false);
    const rightPanelWidth = ref(400);
    // ComfyUI 生图悬浮面板显隐；面板内参数草稿与任务运行态在 comfy-ui store，不持久化。
    const comfyUiPanelOpen = ref(false);
    const selectedModel = ref<string>(DEFAULT_MODEL_LABEL);
    const selectedReasoning = ref<string>(REASONING_OPTIONS[2] ?? "中");
    const activeThemeId = ref<string>("sepia");
    const customThemes = ref<CustomThemeDto[]>([]);
    const activeThemeAppearance = ref<ThemeAppearance>("light");
    const themeVarsSnapshot = ref<ThemeVars | null>(null);
    const theme = activeThemeId;
    const viewMode = ref<WorkspaceEditorViewMode>("rich");
    const markdownEditorPreferences = ref<MarkdownEditorPreferences>({
        ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    });
    const monacoEditorPreferences = ref<MonacoEditorPreferences>({
        ...DEFAULT_MONACO_EDITOR_PREFERENCES,
    });
    const monacoFontSizeOverridesByPath = ref<Record<string, number>>({});

    let volumeReorderRevision = 0;
    let chapterReorderRevision = 0;
    let workspaceTreeRequest: {
        key: string;
        promise: Promise<WorkspaceFileNode[]>;
    } | null = null;
    const workspaceTreeRevision = ref(0);

    const reasoningOptions = [...REASONING_OPTIONS];

    /**
     * 按当前主题 ID 与自定义主题列表刷新首屏主题快照。
     */
    const rememberThemeSnapshot = (): void => {
        const resolved = resolveTheme(activeThemeId.value, customThemes.value);
        activeThemeId.value = resolved.id;
        activeThemeAppearance.value = resolved.appearance;
        themeVarsSnapshot.value = {...resolved.vars};
    };

    /**
     * 应用后端返回的全局主题配置。
     */
    const applyThemeConfig = (themeId: string, nextCustomThemes: CustomThemeDto[]): void => {
        customThemes.value = [...nextCustomThemes];
        activeThemeId.value = themeId;
        rememberThemeSnapshot();
    };

    /**
     * 只切换当前活动主题，并同步首屏快照。
     */
    const applyThemeSelection = (themeId: string): void => {
        activeThemeId.value = themeId;
        rememberThemeSnapshot();
    };

    /**
     * 更新自定义主题列表，并保证当前主题仍可解析。
     */
    const applyCustomThemes = (nextCustomThemes: CustomThemeDto[]): void => {
        customThemes.value = [...nextCustomThemes];
        rememberThemeSnapshot();
    };

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
     * 当前选中的章节摘要。
     */
    const selectedChapter = computed<ChapterSummaryDto | null>(() => {
        for (const volume of novelTree.value?.volumes ?? []) {
            const chapter = volume.chapters.find((item) => item.id === selectedChapterId.value);
            if (chapter) {
                return chapter;
            }
        }
        return null;
    });

    /**
     * 当前选中的小说详情
     */
    const currentNovel = computed<NovelListItemDto | null>(() => {
        return novels.value.find((novel) => novel.id === currentNovelId.value) ?? null;
    });
    const currentWorkspaceRoot = computed(() => workspaceKind.value === "user-assets"
        ? "workspace/.nbook"
        : currentNovel.value?.workspaceSlug ? `workspace/${currentNovel.value.workspaceSlug}` : "");
    const workspaceSessionKey = computed(() => workspaceKind.value === "user-assets" ? "user-assets" : `novel:${currentNovelId.value}`);
    const isUserAssetsWorkspace = computed(() => workspaceKind.value === "user-assets");
    const canAccessWorkspace = computed(() => workspaceKind.value === "user-assets" || Boolean(currentNovelId.value));

    /**
     * 当前活动文件路径。对外保留 selected 命名，内部只从 activeWorkspaceFile 投影。
     */
    const selectedFilePath = computed(() => activeWorkspaceFile.value?.node.path ?? "");

    /**
     * 当前活动文件节点。目录或不可编辑文件也通过同一个活动文件模型表达。
     */
    const selectedFileNode = computed(() => activeWorkspaceFile.value?.node ?? null);

    /**
     * 当前活动文件正文。写入时只更新 activeWorkspaceFile，避免多状态并行漂移。
     */
    const selectedFileContent = computed({
        get: () => activeWorkspaceFile.value?.content ?? "",
        set: (content: string) => {
            if (!activeWorkspaceFile.value) {
                return;
            }
            activeWorkspaceFile.value = {
                ...activeWorkspaceFile.value,
                content,
            };
        },
    });

    /**
     * 当前活动文件最近一次同步到磁盘的正文。
     */
    const lastSyncedFileContent = computed(() => activeWorkspaceFile.value?.lastSyncedContent ?? "");

    /**
     * 工作区文件是否已完成初始化恢复，可用于页面首帧渲染 gating。
     */
    const workspaceReady = computed(() => !loadingWorkspace.value && !restoringWorkspaceFile.value);

    /**
     * 当前正文是否仍有未保存改动。
     */
    const hasUnsavedChapterChanges = computed(() => content.value !== lastSyncedChapterContent.value);

    /**
     * 当前文件是否有未保存改动。
     */
    const hasUnsavedFileChanges = computed(() => selectedFileContent.value !== lastSyncedFileContent.value);

    /**
     * 任意 workspace 标签是否有未保存改动。
     */
    const hasUnsavedWorkspaceChanges = computed(() => {
        return hasUnsavedFileChanges.value || workspaceTabs.value.some((tab) => tab.dirty);
    });

    /**
     * 章节树相关操作是否忙碌。
     */
    const chapterPanelBusy = computed(() => creatingChapterTree.value || mutatingChapterTree.value);

    /**
     * 是否已经选中了一个可编辑章节。
     */
    const showEditorWorkspace = computed(() => selectedFileNode.value?.editable === true);

    /**
     * 当前正文字符数。
     */
    const wordCount = computed(() => selectedFileContent.value.trim().length);

    /**
     * 清空当前章节上下文，回到空白工作区。
     */
    const clearActiveChapter = (): void => {
        selectedChapterId.value = "";
        selectedStoryThreadId.value = null;
        selectedStorySceneId.value = null;
        selectedLorebookEntryId.value = null;
        selectedCharacterId.value = null;
        content.value = "";
        lastSyncedChapterContent.value = "";
        pendingAgentChapterUpdate.value = null;
    };

    /**
     * 清空当前文件选择。
     */
    const clearActiveFile = (): void => {
        persistActiveWorkspaceBuffer();
        activeWorkspaceTabPath.value = "";
        activeWorkspaceFile.value = null;
    };

    /**
     * 清空当前小说的文件工作区状态，避免跨 novel 复用标签页和缓存。
     */
    const clearWorkspaceState = (): void => {
        activeWorkspaceTabPath.value = "";
        activeWorkspaceFile.value = null;
        workspaceTree.value = [];
        workspaceTabs.value = [];
        workspaceBuffers.value = {};
        workspaceIssues.value = [];
        workspaceTreeRevision.value = 0;
        workspaceWriteConflict.value = null;
        workspaceConflictDialogOpen.value = false;
        monacoFontSizeOverridesByPath.value = {};
    };

    /**
     * 持久化当前 workspace 会话。
     */
    const persistWorkspaceSession = (): void => {
        persistActiveWorkspaceBuffer();
        const key = workspaceSessionKey.value;
        if (!key || key === "novel:") {
            return;
        }
        workspaceSessions.value = {
            ...workspaceSessions.value,
            [key]: {
                activeWorkspaceTabPath: activeWorkspaceTabPath.value,
                workspaceTabs: workspaceTabs.value,
                workspaceBuffers: workspaceBuffers.value,
                monacoFontSizeOverridesByPath: monacoFontSizeOverridesByPath.value,
            },
        };
    };

    /**
     * 恢复指定 workspace 会话的编辑状态。
     */
    const restoreWorkspaceSession = (): void => {
        const snapshot = workspaceSessions.value[workspaceSessionKey.value];
        activeWorkspaceTabPath.value = snapshot?.activeWorkspaceTabPath ?? "";
        workspaceTabs.value = snapshot?.workspaceTabs ?? [];
        workspaceBuffers.value = snapshot?.workspaceBuffers ?? {};
        monacoFontSizeOverridesByPath.value = snapshot?.monacoFontSizeOverridesByPath ?? {};
        activeWorkspaceFile.value = null;
        workspaceTree.value = [];
        workspaceIssues.value = [];
        workspaceTreeRevision.value = 0;
        workspaceWriteConflict.value = null;
        workspaceConflictDialogOpen.value = false;
    };

    /**
     * 清理指定 Project Workspace 的本地编辑会话，避免同名重建后复用旧标签和 buffer。
     */
    const clearNovelWorkspaceSession = (novelId: string): void => {
        const key = `novel:${novelId}`;
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
        if (!currentNovelId.value) {
            throw new Error("当前未选择小说，无法访问 workspace");
        }
        return {projectPath: currentNovelId.value};
    };

    /**
     * 当前 tree 请求的去重键。Project Workspace 与 user-assets 必须隔离。
     */
    const workspaceTreeRequestKey = (): string => {
        const query = workspaceQuery();
        return "workspaceKind" in query ? `kind:${query.workspaceKind}` : `project:${query.projectPath}`;
    };

    /** 活动编辑器防抖结算钩子，见 registerActiveEditorFlush */
    let activeEditorFlush: (() => void) | null = null;

    /**
     * 注册活动编辑器的防抖结算钩子（由 index.vue 在 studio controller 就绪后注入）。
     * 编辑器输入走 300ms 防抖上报，store 在读取 activeWorkspaceFile.content 做
     * dirty 判定 / buffer 持久化 / 保存之前必须先触发一次 flush，否则防抖窗口内
     * 的输入会被误判为「无修改」——切文件丢字、外部同步覆盖导致的文本回退都源于此。
     */
    const registerActiveEditorFlush = (fn: (() => void) | null): void => {
        activeEditorFlush = fn;
    };

    /**
     * 结算活动编辑器的未上报输入（未注册钩子时 no-op）。
     * 调用后 activeWorkspaceFile.content 即为编辑器最新内容。
     */
    const flushActiveEditorPending = (): void => {
        activeEditorFlush?.();
    };

    /**
     * 当前文件内容写入 tab buffer，用于多标签切换。
     */
    const persistActiveWorkspaceBuffer = (): void => {
        flushActiveEditorPending();
        if (!activeWorkspaceFile.value) {
            return;
        }

        const activePath = activeWorkspaceFile.value.node.path;
        workspaceBuffers.value = {
            ...workspaceBuffers.value,
            [activePath]: {
                node: activeWorkspaceFile.value.node,
                content: activeWorkspaceFile.value.content,
                lastSyncedContent: activeWorkspaceFile.value.lastSyncedContent,
                lastSyncedMtimeMs: activeWorkspaceFile.value.lastSyncedMtimeMs,
            },
        };
        syncWorkspaceTabDirty(activePath);
    };

    /**
     * 根据文件路径推断编辑器类型。
     */
    const inferWorkspaceEditorKind = (node: WorkspaceFileNode): WorkspaceEditorKind => {
        return resolveWorkspaceEditorKind(node.path, node.editable);
    };

    /**
     * 兼容旧持久化中的 split/mixed 模式，并约束标签视图模式。
     */
    const normalizeWorkspaceViewMode = (mode: string | undefined): WorkspaceEditorViewMode => {
        if (mode === "source" || mode === "rich") {
            return mode;
        }
        if (mode === "split" || mode === "mixed") {
            return "rich";
        }
        return "rich";
    };

    /**
     * 打开或更新一个工作区标签页。
     */
    const upsertWorkspaceTab = (node: WorkspaceFileNode, openMode: WorkspaceOpenMode): void => {
        const path = node.path;
        const existingTab = workspaceTabs.value.find((tab) => tab.path === path);
        const activeDirty = activeWorkspaceFile.value?.node.path === path
            ? activeWorkspaceFile.value.content !== activeWorkspaceFile.value.lastSyncedContent
            : false;
        const preview = openMode === "preview"
            ? existingTab?.preview ?? true
            : false;
        const nextTab: WorkspaceEditorTab = {
            path,
            title: node.title?.trim() || path,
            editorKind: inferWorkspaceEditorKind(node),
            viewMode: normalizeWorkspaceViewMode(existingTab?.viewMode ?? resolveDefaultWorkspaceViewMode(path)),
            pinned: existingTab?.pinned ?? false,
            preview: existingTab?.pinned ? false : preview,
            dirty: activeDirty,
        };
        if (nextTab.preview) {
            const nextBuffers = {...workspaceBuffers.value};
            for (const tab of workspaceTabs.value) {
                if (tab.preview && !tab.dirty && tab.path !== path) {
                    delete nextBuffers[tab.path];
                }
            }
            workspaceBuffers.value = nextBuffers;
            workspaceTabs.value = workspaceTabs.value.filter((tab) => !tab.preview || tab.dirty || tab.path === path);
        }

        workspaceTabs.value = existingTab
            ? workspaceTabs.value.map((tab) => tab.path === path ? {...tab, ...nextTab} : tab)
            : [...workspaceTabs.value, nextTab];
        activeWorkspaceTabPath.value = path;
    };

    /**
     * 同步指定标签的 dirty 标记。
     */
    const syncWorkspaceTabDirty = (filePath: string): void => {
        const buffer = workspaceBuffers.value[filePath];
        const isActivePath = activeWorkspaceFile.value?.node.path === filePath;
        const activeFile = activeWorkspaceFile.value;
        const dirty = isActivePath && activeFile
            ? activeFile.content !== activeFile.lastSyncedContent
            : Boolean(buffer && buffer.content !== buffer.lastSyncedContent);
        const node = isActivePath ? activeFile?.node : buffer?.node;

        workspaceTabs.value = workspaceTabs.value.map((tab) => tab.path === filePath ? {
            ...tab,
            dirty,
            preview: dirty ? false : Boolean(tab.preview),
            title: node?.title?.trim() || tab.title,
            editorKind: node ? inferWorkspaceEditorKind(node) : tab.editorKind,
        } : tab);
    };

    /**
     * 设置当前 Markdown 标签的显示模式。
     */
    const setWorkspaceTabViewMode = (filePath: string, mode: WorkspaceEditorViewMode): void => {
        workspaceTabs.value = workspaceTabs.value.map((tab) => tab.path === filePath ? {
            ...tab,
            viewMode: normalizeWorkspaceViewMode(mode),
        } : tab);
    };

    /**
     * 切换工作区标签固定状态。
     */
    const toggleWorkspaceTabPinned = (filePath: string): void => {
        const currentTab = workspaceTabs.value.find((tab) => tab.path === filePath);
        setWorkspaceTabPinned(filePath, !currentTab?.pinned);
    };

    /**
     * 设置工作区标签固定状态。
     */
    const setWorkspaceTabPinned = (filePath: string, pinned: boolean): void => {
        workspaceTabs.value = workspaceTabs.value.map((tab) => tab.path === filePath ? {
            ...tab,
            pinned,
            preview: pinned ? false : Boolean(tab.preview),
        } : {
            ...tab,
            pinned: Boolean(tab.pinned),
            preview: Boolean(tab.preview),
        });
    };

    /**
     * 将预览标签转为常驻标签。
     */
    const keepWorkspaceTab = (filePath: string): void => {
        workspaceTabs.value = workspaceTabs.value.map((tab) => tab.path === filePath ? {
            ...tab,
            preview: false,
        } : {
            ...tab,
            preview: Boolean(tab.preview),
        });
    };

    /**
     * 拖拽移动工作区标签页，可跨 pinned 与普通分组。
     */
    const moveWorkspaceTab = (
        filePath: string,
        targetPath: string | null,
        targetPinned: boolean,
        position: "before" | "after",
    ): void => {
        const movingTab = workspaceTabs.value.find((tab) => tab.path === filePath);
        if (!movingTab) {
            return;
        }

        const restTabs = workspaceTabs.value
            .filter((tab) => tab.path !== filePath)
            .map((tab) => ({...tab, preview: Boolean(tab.preview)}));
        const nextMovingTab = {
            ...movingTab,
            pinned: targetPinned,
            preview: targetPinned ? false : Boolean(movingTab.preview),
        };
        const targetIndex = targetPath
            ? restTabs.findIndex((tab) => tab.path === targetPath)
            : -1;
        if (targetIndex >= 0) {
            const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
            restTabs.splice(insertIndex, 0, nextMovingTab);
        } else {
            const lastGroupIndex = restTabs.reduce((lastIndex, tab, index) => tab.pinned === targetPinned ? index : lastIndex, -1);
            restTabs.splice(lastGroupIndex + 1, 0, nextMovingTab);
        }

        workspaceTabs.value = restTabs;
    };

    /**
     * 移除一个无法恢复的工作区标签和对应缓存。
     */
    const removeWorkspaceTabState = (filePath: string): void => {
        const nextBuffers = {...workspaceBuffers.value};
        delete nextBuffers[filePath];
        workspaceBuffers.value = nextBuffers;
        workspaceTabs.value = workspaceTabs.value.filter((tab) => tab.path !== filePath);
        if (activeWorkspaceTabPath.value === filePath) {
            activeWorkspaceTabPath.value = "";
        }
        if (activeWorkspaceFile.value?.node.path === filePath) {
            activeWorkspaceFile.value = null;
        }
    };

    /**
     * 从持久化的标签状态中恢复当前活动文件。
     */
    const restoreWorkspaceTabFromPersistedState = async (): Promise<void> => {
        restoringWorkspaceFile.value = true;
        try {
            const candidatePaths = [
                activeWorkspaceTabPath.value,
                selectedFilePath.value,
                ...workspaceTabs.value.map((tab) => tab.path),
            ].filter((path, index, paths) => Boolean(path) && paths.indexOf(path) === index);

            for (const path of candidatePaths) {
                const tab = workspaceTabs.value.find((item) => item.path === path);
                try {
                    await selectWorkspacePath(path, tab?.preview ? "preview" : "permanent", {forceDisk: true});
                    return;
                } catch {
                    removeWorkspaceTabState(path);
                }
            }

            clearActiveFile();
        } finally {
            restoringWorkspaceFile.value = false;
        }
    };

    /**
     * 加载工作区文件树。
     */
    const loadWorkspaceTree = async (options: WorkspaceTreeLoadOptions = {}): Promise<WorkspaceFileNode[]> => {
        const requestKey = workspaceTreeRequestKey();
        if (!options.bypassPendingRequest && workspaceTreeRequest?.key === requestKey) {
            return await workspaceTreeRequest.promise;
        }
        loadingWorkspaceTree.value = true;
        const promise = (async () => {
            const snapshot = await $fetch<WorkspaceTreeSnapshotDto<WorkspaceFileNode>>("/api/workspace-files/tree", {
                query: workspaceQuery(),
            });
            if (workspaceTreeRequestKey() !== requestKey) {
                return snapshot.nodes;
            }
            workspaceTree.value = snapshot.nodes;
            workspaceIssues.value = snapshot.issues;
            workspaceTreeRevision.value = snapshot.revision;
            if (activeWorkspaceFile.value) {
                const nextActiveNode = snapshot.nodes.find((node) => node.path === activeWorkspaceFile.value?.node.path);
                if (nextActiveNode) {
                    activeWorkspaceFile.value = {
                        ...activeWorkspaceFile.value,
                        node: nextActiveNode,
                    };
                }
            }
            for (const tab of workspaceTabs.value) {
                const nextNode = snapshot.nodes.find((node) => node.path === tab.path);
                if (!nextNode) {
                    continue;
                }
                const buffer = workspaceBuffers.value[tab.path];
                if (buffer) {
                    workspaceBuffers.value = {
                        ...workspaceBuffers.value,
                        [tab.path]: {
                            ...buffer,
                            node: nextNode,
                        },
                    };
                }
            }
            return snapshot.nodes;
        })();
        workspaceTreeRequest = {key: requestKey, promise};
        try {
            return await promise;
        } finally {
            if (workspaceTreeRequest?.key === requestKey) {
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
     * 激活一个可编辑文件，并按需从缓存或磁盘读取正文。
     */
    const activateEditableWorkspaceFile = async (
        filePath: string,
        knownDetail: WorkspaceFileNode | undefined,
        openMode: WorkspaceOpenMode,
        options: WorkspaceLoadOptions,
    ): Promise<WorkspaceFileNode | null> => {
        const [detail, file] = await Promise.all([
            knownDetail ? Promise.resolve(knownDetail) : statWorkspacePath(filePath),
            $fetch<WorkspaceReadResponse>("/api/workspace-files/read", {
                query: {...workspaceQuery(), path: filePath},
            }),
        ]);
        const existingBuffer = options.forceDisk ? undefined : workspaceBuffers.value[detail.path];
        const content = existingBuffer?.content ?? file.content;
        const lastSyncedContent = existingBuffer?.lastSyncedContent ?? file.content;

        activeWorkspaceFile.value = {
            node: detail,
            content,
            lastSyncedContent,
            lastSyncedMtimeMs: existingBuffer?.lastSyncedMtimeMs ?? file.mtimeMs,
        };
        upsertWorkspaceTab(detail, openMode);
        return detail;
    };

    /**
     * 激活工作区文件或目录，是文件树、标签页和刷新恢复共用的唯一入口。
     */
    const activateWorkspaceFile = async (filePath: string, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> => {
        persistActiveWorkspaceBuffer();
        const detail = findWorkspaceNode(filePath) ?? await statWorkspacePath(filePath);
        if (detail.isDirectory && detail.contentNode) {
            const normalizedDir = detail.path.replace(/\/$/, "");
            const indexPath = `${normalizedDir}/index.md`;
            return await activateEditableWorkspaceFile(indexPath, findWorkspaceNode(indexPath), openMode, options);
        }

        if (!detail.editable) {
            activeWorkspaceFile.value = {
                node: detail,
                content: "",
                lastSyncedContent: "",
                lastSyncedMtimeMs: detail.mtimeMs,
            };
            upsertWorkspaceTab(detail, openMode);
            return detail;
        }

        return await activateEditableWorkspaceFile(detail.path, detail, openMode, options);
    };

    /**
     * 加载可编辑文本文件。
     */
    const loadWorkspaceFile = async (filePath: string, knownDetail?: WorkspaceFileNode, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> => {
        persistActiveWorkspaceBuffer();
        return await activateEditableWorkspaceFile(filePath, knownDetail, openMode, options);
    };

    /**
     * 选择工作区文件或目录。
     */
    const selectWorkspacePath = async (filePath: string, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> => {
        return await activateWorkspaceFile(filePath, openMode, options);
    };

    /**
     * 以预览或常驻方式打开工作区路径。
     */
    const openWorkspacePath = async (filePath: string, openMode: WorkspaceOpenMode): Promise<WorkspaceFileNode | null> => {
        return await selectWorkspacePath(filePath, openMode);
    };

    /**
     * 从文件树节点打开路径。调用方已经持有节点元信息时走这个入口，避免额外 stat 请求。
     */
    const openWorkspaceNode = async (node: WorkspaceFileNode, openMode: WorkspaceOpenMode = "permanent", options: WorkspaceLoadOptions = {}): Promise<WorkspaceFileNode | null> => {
        persistActiveWorkspaceBuffer();
        if (node.isDirectory && node.contentNode) {
            const normalizedDir = node.path.replace(/\/$/, "");
            const indexPath = `${normalizedDir}/index.md`;
            return await activateEditableWorkspaceFile(indexPath, findWorkspaceNode(indexPath), openMode, options);
        }
        if (!node.editable) {
            activeWorkspaceFile.value = {
                node,
                content: "",
                lastSyncedContent: "",
                lastSyncedMtimeMs: node.mtimeMs,
            };
            upsertWorkspaceTab(node, openMode);
            return node;
        }
        return await activateEditableWorkspaceFile(node.path, node, openMode, options);
    };

    /**
     * 保存当前工作区文件。
     */
    const saveCurrentFile = async (options: WorkspaceSaveOptions = {}): Promise<WorkspaceFileNode | null> => {
        // 先结算防抖输入，保证保存的是编辑器最新内容（flush 会替换 activeWorkspaceFile 对象，必须在取快照前）
        flushActiveEditorPending();
        const activeFile = activeWorkspaceFile.value;
        if (!activeFile?.node.editable || savingFile.value) {
            return null;
        }

        const pathToSave = activeFile.node.path;
        const contentToSave = options.content ?? activeFile.content;
        savingFile.value = true;
        try {
            const nextNode = await $fetch<WorkspaceFileNode>("/api/workspace-files/write", {
                method: "PUT",
                body: {
                    ...workspaceQuery(),
                    path: pathToSave,
                    content: contentToSave,
                    baseContent: activeFile.lastSyncedContent,
                    expectedMtimeMs: options.expectedMtimeMs ?? activeFile.lastSyncedMtimeMs,
                    force: options.force ?? false,
                },
            });
            const isStillActiveFile = activeWorkspaceFile.value?.node.path === pathToSave;
            const nextActiveContent = options.content !== undefined
                ? contentToSave
                : activeWorkspaceFile.value?.content ?? contentToSave;
            if (isStillActiveFile) {
                activeWorkspaceFile.value = {
                    node: nextNode,
                    content: nextActiveContent,
                    lastSyncedContent: contentToSave,
                    lastSyncedMtimeMs: nextNode.mtimeMs,
                };
            }
            const currentBuffer = workspaceBuffers.value[nextNode.path];
            workspaceBuffers.value = {
                ...workspaceBuffers.value,
                [nextNode.path]: {
                    node: nextNode,
                    content: isStillActiveFile ? nextActiveContent : currentBuffer?.content ?? contentToSave,
                    lastSyncedContent: contentToSave,
                    lastSyncedMtimeMs: nextNode.mtimeMs,
                },
            };
            if (isStillActiveFile) {
                const currentTab = workspaceTabs.value.find((tab) => tab.path === nextNode.path);
                upsertWorkspaceTab(nextNode, currentTab?.preview ? "preview" : "permanent");
            }
            syncWorkspaceTabDirty(nextNode.path);
            await loadWorkspaceTree();
            return nextNode;
        } catch (error) {
            const conflict = readWorkspaceWriteConflict(error);
            if (conflict) {
                workspaceWriteConflict.value = conflict;
                workspaceConflictDialogOpen.value = true;
                return null;
            }
            throw error;
        } finally {
            savingFile.value = false;
        }
    };

    /**
     * 保存全部带未保存改动的 workspace 标签。
     */
    const saveDirtyWorkspaceFiles = async (): Promise<void> => {
        persistActiveWorkspaceBuffer();
        const dirtyPaths = workspaceTabs.value
            .filter((tab) => tab.dirty)
            .map((tab) => tab.path);

        for (const filePath of dirtyPaths) {
            await selectWorkspaceTab(filePath);
            await saveCurrentFile();
        }
    };

    /**
     * 保存未落盘内容后下载当前 Project Workspace 或 Workspace Root .nbook 压缩包。
     */
    const downloadCurrentWorkspace = async (): Promise<string> => {
        if (workspaceKind.value !== "user-assets" && !currentNovelId.value) {
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
            formData.append("projectPath", query.projectPath);
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
     * 立即在本地树中应用一次路径移动。
     */
    const applyOptimisticWorkspaceMove = (sourceNode: WorkspaceFileNode, targetPath: string): void => {
        const nextTree = workspaceTree.value.map((node) => {
            const nextPath = rewriteWorkspaceMovedPath(node.path, sourceNode.path, targetPath, sourceNode.isDirectory);
            if (!nextPath) {
                return node;
            }
            return {
                ...node,
                path: nextPath,
            };
        });
        workspaceTree.value = nextTree;

        const nextSelectedPath = selectedFilePath.value
            ? rewriteWorkspaceMovedPath(selectedFilePath.value, sourceNode.path, targetPath, sourceNode.isDirectory) ?? selectedFilePath.value
            : "";
        if (!activeWorkspaceFile.value || !nextSelectedPath) {
            activeWorkspaceFile.value = null;
            return;
        }
        activeWorkspaceFile.value = {
            ...activeWorkspaceFile.value,
            node: nextTree.find((node) => node.path === nextSelectedPath) ?? activeWorkspaceFile.value.node,
        };
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
            activeWorkspaceFile: activeWorkspaceFile.value,
        };
        const optimisticPath = normalizeWorkspaceMovedPath(to, sourceNode.isDirectory);
        applyOptimisticWorkspaceMove(sourceNode, optimisticPath);

        try {
            const node = await $fetch<WorkspaceFileNode>("/api/workspace-files/rename", {
                method: "PATCH",
                body: {...workspaceQuery(), from, to},
            });
            await loadWorkspaceTree();
            return node;
        } catch (error) {
            workspaceTree.value = snapshot.workspaceTree;
            activeWorkspaceFile.value = snapshot.activeWorkspaceFile;
            throw error;
        }
    };

    /**
     * 删除工作区路径。
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
        if (activeWorkspaceFile.value?.node.path === filePath) {
            clearActiveFile();
        }
        const normalizedPath = normalizeWorkspaceFilePath(filePath);
        const nextBuffers = {...workspaceBuffers.value};
        for (const path of Object.keys(nextBuffers)) {
            if (normalizeWorkspaceFilePath(path) === normalizedPath || normalizeWorkspaceFilePath(path).startsWith(`${normalizedPath}/`)) {
                delete nextBuffers[path];
            }
        }
        workspaceBuffers.value = nextBuffers;
        const nextMonacoOverrides = {...monacoFontSizeOverridesByPath.value};
        for (const path of Object.keys(nextMonacoOverrides)) {
            if (normalizeWorkspaceFilePath(path) === normalizedPath || normalizeWorkspaceFilePath(path).startsWith(`${normalizedPath}/`)) {
                delete nextMonacoOverrides[path];
            }
        }
        monacoFontSizeOverridesByPath.value = nextMonacoOverrides;
        workspaceTabs.value = workspaceTabs.value.filter((tab) => {
            const tabPath = normalizeWorkspaceFilePath(tab.path);
            return tabPath !== normalizedPath && !tabPath.startsWith(`${normalizedPath}/`);
        });
        await loadWorkspaceTree();
    };

    /**
     * 切换到已打开的标签页。
     */
    const selectWorkspaceTab = async (filePath: string): Promise<WorkspaceFileNode | null> => {
        const tab = workspaceTabs.value.find((item) => item.path === filePath);
        return await selectWorkspacePath(filePath, tab?.preview ? "preview" : "permanent");
    };

    /**
     * 关闭指定标签页。调用方负责在脏文件时先确认。
     */
    const closeWorkspaceTab = async (filePath: string, discardChanges = false): Promise<void> => {
        const tabIndex = workspaceTabs.value.findIndex((tab) => tab.path === filePath);
        if (tabIndex < 0) {
            return;
        }

        if (!discardChanges && workspaceTabs.value[tabIndex]?.dirty) {
            return;
        }

        const nextBuffers = {...workspaceBuffers.value};
        delete nextBuffers[filePath];
        workspaceBuffers.value = nextBuffers;
        const nextMonacoOverrides = {...monacoFontSizeOverridesByPath.value};
        delete nextMonacoOverrides[filePath];
        monacoFontSizeOverridesByPath.value = nextMonacoOverrides;
        const nextTabs = workspaceTabs.value.filter((tab) => tab.path !== filePath);
        workspaceTabs.value = nextTabs;

        if (activeWorkspaceTabPath.value !== filePath) {
            return;
        }

        const nextTab = nextTabs[Math.max(0, tabIndex - 1)] ?? nextTabs[0] ?? null;
        if (!nextTab) {
            activeWorkspaceTabPath.value = "";
            activeWorkspaceFile.value = null;
            return;
        }

        await selectWorkspacePath(nextTab.path, "permanent");
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
     * 从磁盘同步外部文件变化。dirty 文件只标记冲突，不自动覆盖用户输入。
     */
    const syncWorkspaceFromDisk = async (events: WorkspaceFileChangeEventDto[]): Promise<WorkspaceDiskSyncResult> => {
        if ((workspaceKind.value !== "user-assets" && !currentNovelId.value) || events.length === 0) {
            return {
                activeFile: "unchanged",
                dirtyPaths: [],
                deletedPaths: [],
            };
        }

        // 先结算防抖输入再取 dirty 快照：防抖窗口内的输入若不计入判定，
        // 活动文件会被误判为「无修改」而走 forceDisk 重载，本地输入被磁盘内容覆盖（文本回退）
        flushActiveEditorPending();
        const previousActivePath = activeWorkspaceFile.value?.node.path ?? "";
        const previousActiveDirty = Boolean(
            activeWorkspaceFile.value
            && activeWorkspaceFile.value.content !== activeWorkspaceFile.value.lastSyncedContent,
        );
        const previousActiveTab = workspaceTabs.value.find((tab) => tab.path === previousActivePath);
        const dirtyPaths: string[] = [];
        const deletedPaths: string[] = [];

        await loadWorkspaceTree({bypassPendingRequest: true});

        const syncInactiveTabBuffer = async (tab: WorkspaceEditorTab): Promise<void> => {
            if (tab.path === previousActivePath || !workspacePathTouchedByEvents(tab.path, events)) {
                return;
            }
            const buffer = workspaceBuffers.value[tab.path];
            if (buffer && buffer.content !== buffer.lastSyncedContent) {
                dirtyPaths.push(tab.path);
                return;
            }

            const nextNode = workspaceTree.value.find((node) => normalizeWorkspaceFilePath(node.path) === normalizeWorkspaceFilePath(tab.path));
            if (!nextNode) {
                removeWorkspaceTabState(tab.path);
                deletedPaths.push(tab.path);
                return;
            }
            if (!nextNode.editable) {
                return;
            }

            try {
                const file = await $fetch<WorkspaceReadResponse>("/api/workspace-files/read", {
                    query: {...workspaceQuery(), path: tab.path},
                });
                workspaceBuffers.value = {
                    ...workspaceBuffers.value,
                    [tab.path]: {
                        node: nextNode,
                        content: file.content,
                        lastSyncedContent: file.content,
                        lastSyncedMtimeMs: file.mtimeMs,
                    },
                };
                syncWorkspaceTabDirty(tab.path);
            } catch {
                removeWorkspaceTabState(tab.path);
                deletedPaths.push(tab.path);
            }
        };

        for (const tab of [...workspaceTabs.value]) {
            await syncInactiveTabBuffer(tab);
        }

        if (!previousActivePath || !workspacePathTouchedByEvents(previousActivePath, events)) {
            return {
                activeFile: "unchanged",
                dirtyPaths,
                deletedPaths,
            };
        }

        // 保存回声抑制：磁盘 mtime 与本地最后同步 mtime 一致，说明这次事件是
        // 自己 save 落盘后的 watcher 回声。此时既不该报冲突（保存后继续打字是
        // 正常 dirty，不是外部改动），也不该 forceDisk 重载（会白跑一次读取并
        // 重置光标）。外部工具写入必然产生新 mtime，不会命中该分支。
        const activeNodeOnDisk = workspaceTree.value.find((node) => normalizeWorkspaceFilePath(node.path) === normalizeWorkspaceFilePath(previousActivePath));
        if (
            activeNodeOnDisk
            && activeWorkspaceFile.value?.node.path === previousActivePath
            && activeNodeOnDisk.mtimeMs === activeWorkspaceFile.value.lastSyncedMtimeMs
        ) {
            return {
                activeFile: "unchanged",
                dirtyPaths,
                deletedPaths,
            };
        }

        const activeStillExists = workspaceTree.value.some((node) => normalizeWorkspaceFilePath(node.path) === normalizeWorkspaceFilePath(previousActivePath));
        if (previousActiveDirty) {
            return {
                activeFile: "dirty",
                dirtyPaths: [...dirtyPaths, previousActivePath],
                deletedPaths: activeStillExists ? deletedPaths : [...deletedPaths, previousActivePath],
            };
        }

        if (!activeStillExists) {
            removeWorkspaceTabState(previousActivePath);
            return {
                activeFile: "deleted",
                dirtyPaths,
                deletedPaths: [...deletedPaths, previousActivePath],
            };
        }

        try {
            await selectWorkspacePath(previousActivePath, previousActiveTab?.preview ? "preview" : "permanent", {forceDisk: true});
            return {
                activeFile: "reloaded",
                dirtyPaths,
                deletedPaths,
            };
        } catch {
            removeWorkspaceTabState(previousActivePath);
            return {
                activeFile: "deleted",
                dirtyPaths,
                deletedPaths: [...deletedPaths, previousActivePath],
            };
        }
    };

    /**
     * 使用冲突中的真实文件内容覆盖当前编辑器状态。
     */
    const applyWorkspaceConflictRemote = (conflict: WorkspaceWriteConflictDto): void => {
        if (!activeWorkspaceFile.value || activeWorkspaceFile.value.node.path !== conflict.path) {
            return;
        }
        if (!conflict.remoteExists || !conflict.node) {
            removeWorkspaceTabState(conflict.path);
            return;
        }

        const nextNode = conflict.node as WorkspaceFileNode;
        activeWorkspaceFile.value = {
            node: nextNode,
            content: conflict.remoteContent,
            lastSyncedContent: conflict.remoteContent,
            lastSyncedMtimeMs: conflict.actualMtimeMs,
        };
        workspaceBuffers.value = {
            ...workspaceBuffers.value,
            [conflict.path]: {
                node: nextNode,
                content: conflict.remoteContent,
                lastSyncedContent: conflict.remoteContent,
                lastSyncedMtimeMs: conflict.actualMtimeMs,
            },
        };
        syncWorkspaceTabDirty(conflict.path);
    };

    /**
     * 把手动合并结果写入当前编辑器，并把真实文件版本作为新的保存基线。
     */
    const applyWorkspaceConflictMergedContent = (conflict: WorkspaceWriteConflictDto, content: string): void => {
        if (!activeWorkspaceFile.value || activeWorkspaceFile.value.node.path !== conflict.path) {
            return;
        }
        const nextNode = (conflict.node as WorkspaceFileNode | null) ?? activeWorkspaceFile.value.node;
        activeWorkspaceFile.value = {
            node: nextNode,
            content,
            lastSyncedContent: conflict.remoteContent,
            lastSyncedMtimeMs: conflict.actualMtimeMs,
        };
        workspaceBuffers.value = {
            ...workspaceBuffers.value,
            [conflict.path]: {
                node: nextNode,
                content,
                lastSyncedContent: conflict.remoteContent,
                lastSyncedMtimeMs: conflict.actualMtimeMs,
            },
        };
        syncWorkspaceTabDirty(conflict.path);
    };

    /**
     * 处理当前 workspace 写入冲突。
     */
    const resolveWorkspaceWriteConflict = async (resolution: WorkspaceFileConflictResolution): Promise<WorkspaceFileNode | null> => {
        const conflict = workspaceWriteConflict.value;
        workspaceWriteConflict.value = null;
        if (!conflict || resolution.action === "cancel") {
            return null;
        }

        if (resolution.action === "reload-remote") {
            applyWorkspaceConflictRemote(conflict);
            return null;
        }
        if (resolution.action === "overwrite-local") {
            return await saveCurrentFile({force: true});
        }

        applyWorkspaceConflictMergedContent(conflict, resolution.content);
        return await saveCurrentFile({
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

    /**
     * 用详情响应回填树上的章节摘要信息。
     */
    const syncChapterSummary = (chapter: ChapterDetailDto): void => {
        if (!novelTree.value) {
            return;
        }

        novelTree.value = {
            ...novelTree.value,
            volumes: novelTree.value.volumes.map((volume) => ({
                ...volume,
                chapters: volume.chapters.map((item) => item.id === chapter.id ? {
                    ...item,
                    volumeId: chapter.volumeId,
                    title: chapter.title,
                    status: chapter.status,
                    summary: chapter.summary,
                    characters: chapter.characters,
                    todos: chapter.todos,
                    wordCount: chapter.wordCount,
                    updatedAt: chapter.updatedAt,
                } : item),
            })),
            totalWords: novelTree.value.volumes.reduce((sum, volume) => (
                sum + volume.chapters.reduce((chapterSum, item) => (
                    chapterSum + (item.id === chapter.id ? chapter.wordCount : item.wordCount)
                ), 0)
            ), 0),
        };
    };

    /**
     * 用分卷响应回填树上的篇信息。
     */
    const syncVolumeSummary = (nextVolume: VolumeDto): void => {
        if (!novelTree.value) {
            return;
        }

        novelTree.value = {
            ...novelTree.value,
            volumes: novelTree.value.volumes.map((volume) => volume.id === nextVolume.id ? {
                ...volume,
                title: nextVolume.title,
                summary: nextVolume.summary,
                sortOrder: nextVolume.sortOrder,
                updatedAt: nextVolume.updatedAt,
            } : volume),
        };
    };

    /**
     * 直接替换本地树结构。
     */
    const syncNovelTree = (tree: NovelTreeDto): void => {
        novelTree.value = tree;
    };

    /**
     * 将章节详情同步到中央编辑区状态。
     */
    const applyChapterDetail = async (detail: ChapterDetailDto): Promise<ChapterDetailDto> => {
        hydratingChapter.value = true;
        selectedChapterId.value = detail.id;
        syncChapterSummary(detail);
        content.value = detail.content;
        lastSyncedChapterContent.value = detail.content;
        await nextTick();
        hydratingChapter.value = false;
        return detail;
    };

    /**
     * 获取指定章节详情。
     */
    const fetchChapterDetail = async (chapterId: string): Promise<ChapterDetailDto> => {
        return await $fetch<ChapterDetailDto>(`/api/novels/${currentNovelId.value}/chapters/${chapterId}`);
    };

    /**
     * 加载当前小说树。
     */
    const loadNovelTree = async (novelId: string): Promise<NovelTreeDto> => {
        const tree = await $fetch<NovelTreeDto>(`/api/novels/${novelId}/tree`);
        novelTree.value = tree;
        return tree;
    };

    /**
     * 创建默认小说工作区。
     */
    const createDefaultWorkspace = async (): Promise<string> => {
        const novel = await $fetch<{id: string}>("/api/projects", {
            method: "POST",
            body: {
                title: DEFAULT_NOVEL_TITLE,
                summary: "",
            },
        });

        return novel.id;
    };

    /**
     * 确保至少存在一个默认 Project Workspace，并刷新本地小说列表。
     */
    const ensureDefaultNovel = async (): Promise<NovelListItemDto[]> => {
        let list = await loadNovels();
        if (list.length > 0) {
            return list;
        }

        const novelId = await createDefaultWorkspace();
        currentNovelId.value = novelId;
        list = await loadNovels();
        return list;
    };

    /**
     * 读取并应用指定章节详情。
     */
    const loadChapterDetail = async (chapterId: string): Promise<ChapterDetailDto | null> => {
        if (!currentNovelId.value) {
            return null;
        }

        const detail = await fetchChapterDetail(chapterId);
        pendingAgentChapterUpdate.value = null;
        return await applyChapterDetail(detail);
    };

    /**
     * 刷新章节树并切到指定章节。
     */
    const refreshTreeAndLoadChapter = async (chapterId: string): Promise<ChapterDetailDto | null> => {
        if (!currentNovelId.value) {
            return null;
        }

        await loadNovelTree(currentNovelId.value);
        return await loadChapterDetail(chapterId);
    };

    /**
     * 应用 Agent 推送的工作区同步事件。
     * 返回值用于让页面决定是否追加 UI 副作用（例如滚动）。
     */
    const applyAgentWorkspaceSync = async (
        payload: AgentWorkspaceSyncPayload,
    ): Promise<"tree" | "applied" | "pending" | "ignored"> => {
        if (!currentNovelId.value) {
            return "ignored";
        }

        if (payload.kind === "chapter_tree") {
            await loadWorkspaceTree();
            return "tree";
        }

        if (payload.kind === "plot_tree") {
            plotRefreshVersion.value += 1;
            return "tree";
        }

        if (payload.chapterId !== selectedChapterId.value) {
            return "ignored";
        }

        const detail = await fetchChapterDetail(payload.chapterId);
        syncChapterSummary(detail);

        if (hasUnsavedChapterChanges.value) {
            pendingAgentChapterUpdate.value = {
                detail,
                toolName: payload.toolName,
                toolCallId: payload.toolCallId,
            };
            return "pending";
        }

        pendingAgentChapterUpdate.value = null;
        await applyChapterDetail(detail);
        return "applied";
    };

    /**
     * 接受挂起中的 Agent 章节写回。
     */
    const acceptPendingAgentChapterUpdate = async (): Promise<ChapterDetailDto | null> => {
        const nextUpdate = pendingAgentChapterUpdate.value;
        if (!nextUpdate) {
            return null;
        }

        pendingAgentChapterUpdate.value = null;
        return await applyChapterDetail(nextUpdate.detail);
    };

    /**
     * 忽略本次 Agent 写回，保留本地编辑内容。
     */
    const dismissPendingAgentChapterUpdate = (): void => {
        pendingAgentChapterUpdate.value = null;
    };

    /**
     * 保存当前章节正文。
     */
    const saveCurrentChapterContent = async (): Promise<ChapterDetailWriteResponseDto | null> => {
        if (hydratingChapter.value || !currentNovelId.value || !selectedChapterId.value) {
            return null;
        }

        const detail = await $fetch<ChapterDetailWriteResponseDto>(`/api/novels/${currentNovelId.value}/chapters/${selectedChapterId.value}/content`, {
            method: "PUT",
            body: {
                content: content.value,
            },
        });

        syncChapterSummary(detail);
        lastSyncedChapterContent.value = detail.content;
        return detail;
    };

    /**
     * 在前端本地应用分卷排序，避免接口回包时整树闪动。
     */
    const applyLocalVolumeReorder = (items: ReorderVolumesRequestDto["items"]): void => {
        if (!novelTree.value) {
            return;
        }

        const volumeMap = new Map(novelTree.value.volumes.map((volume) => [volume.id, volume]));
        const nextVolumes = [...items]
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .map((item) => {
                const volume = volumeMap.get(item.volumeId);
                return volume ? {
                    ...volume,
                    sortOrder: item.sortOrder,
                } : null;
            })
            .filter((item): item is VolumeDto => item !== null);

        if (nextVolumes.length !== novelTree.value.volumes.length) {
            return;
        }

        novelTree.value = {
            ...novelTree.value,
            volumes: nextVolumes,
        };
    };

    /**
     * 在前端本地应用章节排序，避免接口回包时整树闪动。
     */
    const applyLocalChapterReorder = (items: ReorderChaptersRequestDto["items"]): void => {
        if (!novelTree.value) {
            return;
        }

        const chapterMap = new Map(
            novelTree.value.volumes.flatMap((volume) => volume.chapters.map((chapter) => [chapter.id, chapter] as const))
        );
        const chapterGroups = new Map<string, ReorderChaptersRequestDto["items"]>();

        for (const item of items) {
            const group = chapterGroups.get(item.volumeId) ?? [];
            group.push(item);
            chapterGroups.set(item.volumeId, group);
        }

        let totalMappedChapters = 0;
        const nextVolumes = novelTree.value.volumes.map((volume) => {
            const group = [...(chapterGroups.get(volume.id) ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
            totalMappedChapters += group.length;

            return {
                ...volume,
                chapters: group.map((item) => {
                    const chapter = chapterMap.get(item.chapterId);
                    if (!chapter) {
                        return null;
                    }

                    return {
                        ...chapter,
                        volumeId: item.volumeId,
                        sortOrder: item.sortOrder,
                    };
                }).filter((item): item is VolumeDto["chapters"][number] => item !== null),
            };
        });

        if (totalMappedChapters !== chapterMap.size || nextVolumes.some((volume, index) => volume.chapters.length !== (chapterGroups.get(novelTree.value?.volumes[index]?.id ?? "")?.length ?? 0))) {
            return;
        }

        novelTree.value = {
            ...novelTree.value,
            volumes: nextVolumes,
        };
    };

    /**
     * 加载小说列表。
     */
    const loadNovels = async (options: {includeProjectPath?: string} = {}): Promise<NovelListItemDto[]> => {
        const query = options.includeProjectPath ? {includeProjectPath: options.includeProjectPath} : undefined;
        const list = query
            ? await $fetch<NovelListItemDto[]>("/api/projects", {query})
            : await $fetch<NovelListItemDto[]>("/api/projects");
        novels.value = list;
        return list;
    };

    /**
     * 切换小说。
     */
    const switchNovel = async (novelId: string, options: SwitchNovelOptions = {}): Promise<void> => {
        if (novelId === currentNovelId.value) {
            return;
        }

        if (hydratingChapter.value) {
            return;
        }
        persistActiveWorkspaceBuffer();
        if (hasUnsavedWorkspaceChanges.value && !options.discardWorkspaceChanges) {
            throw new Error("当前 workspace 仍有未保存修改，切换小说前请先保存或放弃修改");
        }

        persistWorkspaceSession();
        workspaceKind.value = "novel";
        currentNovelId.value = novelId;
        selectedChapterId.value = "";
        restoreWorkspaceSession();
        await initializeWorkspace();
    };

    /**
     * 切换到全局用户 assets 工作区。
     */
    const switchToUserAssetsWorkspace = async (): Promise<void> => {
        persistWorkspaceSession();
        workspaceKind.value = "user-assets";
        restoreWorkspaceSession();
        loadingWorkspace.value = true;
        try {
            await loadWorkspaceTree();
            await restoreWorkspaceTabFromPersistedState();
        } finally {
            loadingWorkspace.value = false;
        }
    };

    /**
     * 切换到小说 workspace；传入 novelId 时优先打开指定小说。
     */
    const switchToNovelWorkspace = async (novelId?: string): Promise<void> => {
        if (workspaceKind.value === "novel" && (!novelId || novelId === currentNovelId.value)) {
            await initializeWorkspace();
            return;
        }

        persistWorkspaceSession();
        workspaceKind.value = "novel";
        if (novelId) {
            currentNovelId.value = novelId;
        }
        selectedChapterId.value = "";
        restoreWorkspaceSession();
        await initializeWorkspace();
    };

    /**
     * 新建小说。
     */
    const createNovel = async (title: string, summary: string = ""): Promise<string> => {
        const novel = await $fetch<{id: string}>("/api/projects", {
            method: "POST",
            body: { title, summary },
        });

        await loadNovels();
        return novel.id;
    };

    /**
     * 删除小说。
     */
    const deleteNovel = async (novelId: string): Promise<void> => {
        await $fetch("/api/projects/item", {
            method: "DELETE",
            query: {projectPath: novelId},
        });

        clearNovelWorkspaceSession(novelId);
        await loadNovels();

        if (currentNovelId.value === novelId) {
            currentNovelId.value = novels.value[0]?.id ?? "";
            selectedChapterId.value = "";
            restoreWorkspaceSession();
            await initializeWorkspace();
        }
    };

    /**
     * 初始化小说工作区，并校验持久化后的小说/章节选择是否合法。
     */
    const initializeWorkspace = async (): Promise<void> => {
        if (workspaceKind.value === "user-assets") {
            loadingWorkspace.value = true;
            try {
                await loadWorkspaceTree();
                await restoreWorkspaceTabFromPersistedState();
            } finally {
                loadingWorkspace.value = false;
            }
            return;
        }

        loadingWorkspace.value = true;

        try {
            const list = await ensureDefaultNovel();

            if (!list.length) {
                clearActiveChapter();
                clearActiveFile();
                clearWorkspaceState();
                currentNovelId.value = "";
                novelTree.value = null;
                return;
            }

            const previousNovelId = currentNovelId.value;
            const persistedNovel = list.find((item) => item.id === currentNovelId.value);
            currentNovelId.value = persistedNovel?.id ?? list[0]?.id ?? "";
            if (workspaceKind.value !== "novel") {
                workspaceKind.value = "novel";
            }
            if (previousNovelId && previousNovelId !== currentNovelId.value) {
                restoreWorkspaceSession();
            }
            if (!currentNovelId.value) {
                clearActiveChapter();
                clearActiveFile();
                clearWorkspaceState();
                novelTree.value = null;
                return;
            }

            novelTree.value = null;
            await loadWorkspaceTree();

            await restoreWorkspaceTabFromPersistedState();
        } finally {
            loadingWorkspace.value = false;
        }
    };

    /**
     * 更新章节元数据。
     */
    const updateChapter = async (chapterId: string, payload: Partial<ChapterDetailDto>): Promise<ChapterDetailDto> => {
        const detail = await $fetch<ChapterDetailDto>(`/api/novels/${currentNovelId.value}/chapters/${chapterId}`, {
            method: "PATCH",
            body: payload,
        });

        syncChapterSummary(detail);
        return detail;
    };

    /**
     * 更新分卷元数据。
     */
    const updateVolume = async (volumeId: string, payload: UpdateVolumeRequestDto): Promise<VolumeDto> => {
        mutatingChapterTree.value = true;
        try {
            const volume = await $fetch<VolumeDto>(`/api/novels/${currentNovelId.value}/volumes/${volumeId}`, {
                method: "PATCH",
                body: payload,
            });
            syncVolumeSummary(volume);
            return volume;
        } finally {
            mutatingChapterTree.value = false;
        }
    };

    /**
     * 保存分卷排序。
     */
    const reorderVolumes = async (items: ReorderVolumesRequestDto["items"]): Promise<void> => {
        if (!currentNovelId.value || items.length === 0) {
            return;
        }

        const currentRevision = ++volumeReorderRevision;
        applyLocalVolumeReorder(items);

        try {
            await $fetch<NovelTreeDto>(`/api/novels/${currentNovelId.value}/volumes/reorder`, {
                method: "POST",
                body: { items },
            });
        } catch (error) {
            if (currentRevision === volumeReorderRevision) {
                await loadNovelTree(currentNovelId.value);
            }
            throw error;
        }
    };

    /**
     * 保存章节排序。
     */
    const reorderChapters = async (items: ReorderChaptersRequestDto["items"]): Promise<void> => {
        if (!currentNovelId.value || items.length === 0) {
            return;
        }

        const currentRevision = ++chapterReorderRevision;
        applyLocalChapterReorder(items);

        try {
            await $fetch<NovelTreeDto>(`/api/novels/${currentNovelId.value}/chapters/reorder`, {
                method: "POST",
                body: { items },
            });
        } catch (error) {
            if (currentRevision === chapterReorderRevision) {
                await loadNovelTree(currentNovelId.value);
            }
            throw error;
        }
    };

    watch(selectedFileContent, () => {
        if (!activeWorkspaceFile.value) {
            return;
        }
        syncWorkspaceTabDirty(activeWorkspaceFile.value.node.path);
    });

    return {
        activeLeftTab,
        activeThemeAppearance,
        activeThemeId,
        activeWorkspaceTabPath,
        acceptPendingAgentChapterUpdate,
        applyAgentWorkspaceSync,
        applyChapterDetail,
        applyCustomThemes,
        applyThemeConfig,
        applyThemeSelection,
        applyWorkspaceConflictMergedContent,
        applyWorkspaceConflictRemote,
        chapterPanelBusy,
        clearActiveChapter,
        clearActiveFile,
        closeWorkspaceTab,
        content,
        convertWorkspaceFileToDirectory,
        createWorkspaceDirectory,
        createWorkspaceFile,
        createDefaultWorkspace,
        ensureDefaultNovel,
        createNovel,
        creatingChapterTree,
        currentNovel,
        currentNovelId,
        currentWorkspaceRoot,
        customThemes,
        canAccessWorkspace,
        deleteNovel,
        deleteWorkspacePath,
        dismissPendingAgentChapterUpdate,
        downloadCurrentWorkspace,
        fetchChapterDetail,
        hasUnsavedChapterChanges,
        hasUnsavedFileChanges,
        hasUnsavedWorkspaceChanges,
        hydratesChapter: hydratingChapter,
        hydratingChapter,
        initializeWorkspace,
        lastSyncedChapterContent,
        lastSyncedFileContent,
        layoutMode,
        agentSessionPanelOpen,
        agentSessionPanelWidth,
        agentStudioPanelOpen,
        agentStudioPanelWidth,
        agentStudioFileTreeWidth,
        leftPanelWidth,
        loadChapterDetail,
        loadingWorkspace,
        loadNovels,
        loadNovelTree,
        mutatingChapterTree,
        loadWorkspaceFile,
        loadWorkspaceTree,
        registerActiveEditorFlush,
        syncWorkspaceFromDisk,
        persistWorkspaceSession,
        resolveWorkspaceWriteConflict,
        keepWorkspaceTab,
        moveWorkspaceTab,
        novels,
        novelTree,
        openWorkspacePath,
        openWorkspaceNode,
        optimisticRenameWorkspacePath,
        pendingAgentChapterUpdate,
        plotWorkbenchOpen,
        plotWorkbenchTab,
        plotPlanningFocusId,
        comfyUiPanelOpen,
        detailUndoStacks,
        getDetailUndoStack,
        pushDetailUndoSnapshot,
        popDetailUndoSnapshot,
        clearDetailUndoStack,
        configRevision,
        bumpConfigRevision,
        reasoningOptions,
        refreshTreeAndLoadChapter,
        reorderChapters,
        reorderVolumes,
        rightPanelOpen,
        rightPanelWidth,
        saveCurrentChapterContent,
        saveCurrentFile,
        saveDirtyWorkspaceFiles,
        selectedChapter,
        selectedChapterId,
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
        setSelectedModelLabel,
        showEditorWorkspace,
        isUserAssetsWorkspace,
        selectWorkspacePath,
        setMonacoFontSizeOverride,
        setWorkspaceTabPinned,
        setWorkspaceTabViewMode,
        toggleWorkspaceTabPinned,
        switchNovel,
        switchToNovelWorkspace,
        switchToUserAssetsWorkspace,
        syncUserAssetsFromSystem,
        fetchUserAssetsSyncConflictDetail,
        uploadFileToUploadFolder,
        uploadProjectFiles,
        uploadProjectZip,
        syncChapterSummary,
        syncNovelTree,
        syncVolumeSummary,
        theme,
        themeVarsSnapshot,
        markdownEditorPreferences,
        monacoEditorPreferences,
        monacoFontSizeOverridesByPath,
        updateChapter,
        updateVolume,
        viewMode,
        wordCount,
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
            "currentNovelId",
            "selectedChapterId",
            "selectedLorebookEntryId",
            "selectedCharacterId",
            "workspaceSessions",
            "detailUndoStacks",
        ],
    },
    {
            key: "novel.ide.local",
            pick: [
            "activeLeftTab",
            "layoutMode",
            "agentSessionPanelOpen",
            "agentSessionPanelWidth",
            "agentStudioPanelOpen",
            "agentStudioPanelWidth",
            "agentStudioFileTreeWidth",
            "leftPanelWidth",
            "rightPanelOpen",
            "rightPanelWidth",
            "comfyUiPanelOpen",
            "selectedModel",
            "selectedReasoning",
            "activeThemeId",
            "activeThemeAppearance",
            "customThemes",
            "themeVarsSnapshot",
            "viewMode",
            "markdownEditorPreferences",
            "monacoEditorPreferences",
        ],
        },
    ],
});
