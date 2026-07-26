<script setup lang="ts">
import {storeToRefs} from "pinia";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import type {ConfigBootstrapDto} from "nbook/shared/dto/config.dto";
import {isNovelIdeTab, type NovelIdeTab} from "nbook/app/components/novel-ide/mock-data";
import MarkdownStudioWorkbench from "nbook/app/components/markdown-studio/MarkdownStudioWorkbench.vue";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import AgentTraceViewerDialog from "nbook/app/components/novel-ide/agent/trace-viewer/AgentTraceViewerDialog.vue";import WorkspaceHistoryInboxDialog from "nbook/app/components/novel-ide/history/WorkspaceHistoryInboxDialog.vue";import AgentModeSessionSidebar from "nbook/app/components/novel-ide/agent/AgentModeSessionSidebar.vue";
import NovelIdeHeader from "nbook/app/components/novel-ide/NovelIdeHeader.vue";
import NovelIdeSidebar from "nbook/app/components/novel-ide/NovelIdeSidebar.vue";
import NovelIdeSettingsDialog from "nbook/app/components/novel-ide/NovelIdeSettingsDialog.vue";
import NovelIdeToolPanel from "nbook/app/components/novel-ide/NovelIdeToolPanel.vue";
import WorldEngineWorkbenchDialog from "nbook/app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue";
import RpModeSurface from "nbook/app/components/novel-ide/rp/RpModeSurface.vue";
import NovelPromptBar from "nbook/app/components/novel-ide/NovelPromptBar.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import NovelBookshelfDialog from "nbook/app/components/novel-ide/NovelBookshelfDialog.vue";
import UserProfileWorkbenchDialog from "nbook/app/components/profile-template-editor/UserProfileWorkbenchDialog.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceFileConflictDialog from "nbook/app/components/novel-ide/workspace/WorkspaceFileConflictDialog.vue";
import WorkspaceLocationProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceLocationProfileDialog.vue";
import WorkspaceRuleProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceRuleProfileDialog.vue";
import type {WorkspaceReferencePreviewMeta} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";
import {useMarkdownStudioController} from "nbook/app/composables/useMarkdownStudioController";
import {useWorkspaceFileEvents} from "nbook/app/composables/useWorkspaceFileEvents";
import {useProjectSession} from "nbook/app/composables/useProjectSession";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState, MarkdownCommandKind} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useNovelIdeStore, type AgentWorkspaceSyncPayload, type WorkspaceEditorKind, type WorkspaceEditorViewMode, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileChangeEventDto, WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import type {AgentSessionSummaryDto, AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-session.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    collectWorkspaceReferencePathCandidates,
} from "nbook/app/utils/workspace-reference-search";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";
import {resolveWorkspaceFileExtension, type FrontmatterProfileKind} from "nbook/shared/editor-workbench";
import {buildSelectionRefChip, type InlineEditPayload, type InlineEditReference, type InlineEditTask} from "nbook/app/utils/inline-editor-selection";

type SameDocumentViewTransition = {
    ready: Promise<void>;
};

type SameDocumentViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void | Promise<void>) => SameDocumentViewTransition;
};

type LayoutModeTransitionDirection = "to-agent" | "to-ide";

const WELCOME_LOREBOOK_ENTRY_TYPES = ["location", "character", "item", "rule", "note"] as const;

type WelcomeLorebookEntryType = typeof WELCOME_LOREBOOK_ENTRY_TYPES[number];

const initialized = ref(false);
const themeHostRef = ref<HTMLElement | null>(null);
const currentUser = ref<AuthSessionDto["user"]>(null);
const bookshelfOpen = ref(false);
const settingsDialogOpen = ref(false);
const traceViewerOpen = ref(false);
const historyInboxOpen = ref(false);
const historyInboxRefreshKey = ref(0);
const worldEngineWorkbenchOpen = ref(false);
/** RP 模式独立界面开关。 */
const rpModeOpen = ref(false);
const worldEngineWorkbenchHasUnsavedDrafts = ref(false);
const worldEngineWorkbenchSaving = ref(false);
const profileWorkbenchOpen = ref(false);
const frontmatterProfileKind = ref<FrontmatterProfileKind | null>(null);
const agentStudioFileTreeOpen = ref(false);
const saveQueued = ref(false);
const workspaceEventAbortController = ref<AbortController | null>(null);
const agentResizeHandleRef = ref<HTMLElement | null>(null);
const agentStudioResizeHandleRef = ref<HTMLElement | null>(null);
const agentStudioFileTreeResizeHandleRef = ref<HTMLElement | null>(null);
const layoutTransitionDirection = ref<LayoutModeTransitionDirection | null>(null);
const markdownSkillCatalog = ref<AgentSkillCatalogItemDto[]>([]);
const markdownSkillCatalogLoaded = ref(false);
const markdownSkillCatalogLoading = ref(false);
let markdownSkillCatalogRequest: Promise<void> | null = null;
let workspaceFileSyncRunning = false;
let pendingWorkspaceFileEvents: WorkspaceFileChangeEventDto[] = [];
const USER_ASSETS_PROJECT_TARGET = "workspace/.nbook";
const MODE_TRANSITION_SELECTORS = [
    ".ide-agent-mode-switch",
    ".agent-mode-session-sidebar",
    ".mode-transition-ide-tools",
    ".mode-transition-studio",
    ".mode-transition-agent",
] as const;
const IDE_PAPER_TRANSITION_SELECTORS = [
    ".mode-transition-ide-tools",
    ".mode-transition-studio",
] as const;

const novelIdeStore = useNovelIdeStore();
const route = useRoute();
const router = useRouter();
const {
    activeLeftTab,
    activeWorkspaceTabPath,
    currentNovelId,
    currentNovel,
    hasUnsavedWorkspaceChanges,
    lastSyncedFileContent,
    loadingWorkspace,
    layoutMode,
    agentSessionPanelOpen,
    agentSessionPanelWidth,
    agentStudioFileTreeWidth,
    agentStudioPanelWidth,
    novels,
    rightPanelOpen,
    savingFile,
    selectedFileContent,
    selectedFileNode,
    selectedFilePath,
    activeThemeId,
    customThemes,
    themeVarsSnapshot,
    viewMode,
    markdownEditorPreferences,
    monacoEditorPreferences,
    monacoFontSizeOverridesByPath,
    workspaceReady,
    workspaceIssues,
    workspaceTabs,
    workspaceTree,
    workspaceKind,
    isUserAssetsWorkspace,
    leftPanelWidth,
    plotWorkbenchOpen,
    rightPanelWidth,
} = storeToRefs(novelIdeStore);
const {
    applyAgentWorkspaceSync,
    initializeWorkspace,
    loadWorkspaceTree,
    saveCurrentFile,
    saveDirtyWorkspaceFiles,
    closeWorkspaceTab,
    keepWorkspaceTab,
    moveWorkspaceTab,
    selectWorkspaceTab,
    setSelectedModelLabel,
    setMonacoFontSizeOverride,
    setWorkspaceTabPinned,
    setWorkspaceTabViewMode,
    resolveWorkspaceWriteConflict,
    syncWorkspaceFromDisk,
    switchNovel,
    switchToNovelWorkspace,
    switchToUserAssetsWorkspace,
    loadNovels,
} = novelIdeStore;
const {mountThemeHost} = useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot);
const workspaceFileEvents = useWorkspaceFileEvents();
// Task 94：项目显式生命周期——当前小说项目保持 open 并声明用户在场；user-assets 工作区不参与 open/presence。
const projectSessionTarget = computed<string | null>(() => workspaceKind.value === "novel" && currentNovelId.value ? currentNovelId.value : null);
useProjectSession(projectSessionTarget);
const authSessionState = useAuthSessionState();
const agentSurfaceRef = ref<InstanceType<typeof AgentChatSurface> | null>(null);

const studio = useMarkdownStudioController({
    markdown: selectedFileContent,
    viewMode,
});
// store 在切文件 / 磁盘同步 / 保存前先结算编辑器防抖输入，防止防抖窗口内的输入被误判为「无修改」
novelIdeStore.registerActiveEditorFlush(() => studio.flushActiveEditor());

const {choose, prompt} = useDialog();
const notification = useNotification();
const {t} = useI18n();

const novelItems = computed(() => novels.value.map((novel) => ({
    label: novel.title,
    value: novel.id,
    active: novel.id === currentNovelId.value,
})));

type ProjectRouteTarget =
    | {kind: "user-assets"}
    | {kind: "project"; projectPath: string}
    | {kind: "default"};

/**
 * 解析页面 URL 中的 project target。workspace/.nbook 是 user-assets 保留值。
 */
const parseProjectRouteTarget = (): ProjectRouteTarget => {
    const projectQuery = typeof route.query.project === "string" ? route.query.project.trim() : "";
    if (projectQuery === USER_ASSETS_PROJECT_TARGET) {
        return {kind: "user-assets"};
    }
    if (/^workspace\/[^/]+$/u.test(projectQuery)) {
        return {kind: "project", projectPath: projectQuery};
    }
    return {kind: "default"};
};

/**
 * 生成规范 project URL，确保 query value 中的斜杠编码为 %2F。
 */
const buildProjectRoute = (projectTarget: string): string => {
    return `/?${new URLSearchParams({project: projectTarget}).toString()}`;
};

const workspaceBootstrapped = ref(false);
const consumingRouteOpenPath = ref(false);
const lastMissingProjectNoticeTarget = ref("");
const discardOpenPathForProjectFallback = ref(false);
const displayRightPanelOpen = computed(() => workspaceBootstrapped.value && rightPanelOpen.value);
const isAgentMode = computed(() => layoutMode.value === "agent");
const agentSurfaceActive = computed(() => workspaceBootstrapped.value && (rightPanelOpen.value || isAgentMode.value));
const agentModeSessions = computed(() => agentSurfaceRef.value?.sessions ?? []);
const agentModeActiveSessionId = computed(() => agentSurfaceRef.value?.activeSessionId ?? null);
const agentModeLoadingSession = computed(() => agentSurfaceRef.value?.loadingSession ?? false);
const agentModeRunning = computed(() => agentSurfaceRef.value?.running ?? false);
const agentModeSessionActionId = computed(() => agentSurfaceRef.value?.sessionActionId ?? null);
const agentModeReservedWidth = computed(() => 56 + (agentSessionPanelOpen.value ? agentSessionPanelWidth.value : 0) + 340);
const agentStudioMaxWidth = computed(() => {
    if (!import.meta.client) {
        return 620;
    }
    return Math.max(320, window.innerWidth - agentModeReservedWidth.value);
});
const agentStudioFileTreeMaxWidth = computed(() => Math.min(360, Math.max(240, agentStudioPanelWidth.value - 80)));
const agentStudioPanelVisible = computed({
    get: () => novelIdeStore.agentStudioPanelOpen,
    set: (value: boolean) => {
        novelIdeStore.agentStudioPanelOpen = value;
    },
});
const agentStudioPanelOpen = computed(() => workspaceBootstrapped.value && agentStudioPanelVisible.value);
const {isResizing: resizingAgentPanel, panelStyle: agentPanelStyle} = useResizablePanel(agentResizeHandleRef, {
    size: computed(() => rightPanelWidth.value),
    minSize: 320,
    maxSize: 720,
    edge: "left",
    enabled: computed(() => !isAgentMode.value && displayRightPanelOpen.value),
    syncDuringResize: true,
    onResize: (width) => {
        rightPanelWidth.value = width;
    },
});
const {isResizing: resizingAgentStudioPanel, panelStyle: agentStudioPanelStyle} = useResizablePanel(agentStudioResizeHandleRef, {
    size: computed(() => agentStudioPanelWidth.value),
    minSize: 320,
    maxSize: agentStudioMaxWidth,
    edge: "left",
    enabled: computed(() => isAgentMode.value && agentStudioPanelOpen.value),
    onResizeEnd: (width) => {
        agentStudioPanelWidth.value = width;
    },
});
const {isResizing: resizingAgentStudioFileTree, panelStyle: agentStudioFileTreeStyle} = useResizablePanel(agentStudioFileTreeResizeHandleRef, {
    size: computed(() => agentStudioFileTreeWidth.value),
    minSize: 160,
    maxSize: agentStudioFileTreeMaxWidth,
    edge: "left",
    enabled: computed(() => isAgentMode.value && agentStudioPanelOpen.value && agentStudioFileTreeOpen.value),
    onResizeEnd: (width) => {
        agentStudioFileTreeWidth.value = width;
    },
});
const agentSlotStyle = computed(() => {
    if (isAgentMode.value) {
        return {};
    }
    return displayRightPanelOpen.value ? agentPanelStyle.value : {width: "0px"};
});
const agentStudioStyle = computed(() => {
    if (!isAgentMode.value) {
        return {};
    }
    if (layoutTransitionDirection.value === "to-agent") {
        return {width: "0px"};
    }
    return agentStudioPanelOpen.value ? agentStudioPanelStyle.value : {width: "0px"};
});
const displayActiveLeftTab = computed<NovelIdeTab | null>(() => {
    if (!workspaceBootstrapped.value) {
        return "files";
    }
    if (isUserAssetsWorkspace.value) {
        return "files";
    }
    if (activeLeftTab.value === null) {
        return null;
    }
    return isNovelIdeTab(activeLeftTab.value) ? activeLeftTab.value : "files";
});
const ideToolPanelOpen = computed(() => !isAgentMode.value && displayActiveLeftTab.value !== null);
const ideToolPanelStyle = computed(() => ideToolPanelOpen.value ? {width: `${leftPanelWidth.value}px`} : {width: "0px"});
const displaySidebarActiveTab = computed<NovelIdeTab | "sessions" | null>(() => isAgentMode.value ? "sessions" : displayActiveLeftTab.value);
const displayNovelTitle = computed(() => isUserAssetsWorkspace.value ? t("ide.header.userAssets") : currentNovel.value?.title ?? "");
const displayNovelItems = computed(() => isUserAssetsWorkspace.value ? [] : novelItems.value);
const displayNovelIdForAgent = computed(() => isUserAssetsWorkspace.value ? "" : currentNovelId.value);
const agentWorkspaceKey = computed(() => {
    if (isUserAssetsWorkspace.value) {
        return "user-assets";
    }
    return currentNovelId.value || "workspace";
});

/**
 * 当前文件扩展名，统一用于编辑器类型判断。
 */
const currentFileExtension = computed(() => {
    return resolveWorkspaceFileExtension(selectedFilePath.value);
});

const activeWorkspaceTab = computed(() => workspaceTabs.value.find((tab) => tab.path === activeWorkspaceTabPath.value) ?? null);
const currentWorkspaceViewMode = computed(() => activeWorkspaceTab.value?.viewMode ?? (isMarkdownFile.value ? "rich" : "source"));
const currentEditorKind = computed(() => activeWorkspaceTab.value?.editorKind ?? (isMarkdownFile.value ? "markdown" : selectedFileNode.value?.editable ? "monaco" : "readonly"));
const workspaceDisplayReady = computed(() => workspaceBootstrapped.value && workspaceReady.value);
const displayWorkspaceTabs = computed(() => workspaceDisplayReady.value ? workspaceTabs.value : []);
const displayActiveWorkspaceTabPath = computed(() => workspaceDisplayReady.value ? activeWorkspaceTabPath.value : "");
const displaySelectedFileNode = computed(() => workspaceDisplayReady.value ? selectedFileNode.value : null);
const displayCurrentEditorKind = computed<WorkspaceEditorKind>(() => workspaceDisplayReady.value ? currentEditorKind.value : "readonly");
const displayCurrentWorkspaceViewMode = computed<WorkspaceEditorViewMode>(() => workspaceDisplayReady.value ? currentWorkspaceViewMode.value : "source");
const displayMonacoTemporaryFontSize = computed(() => displayActiveWorkspaceTabPath.value
    ? monacoFontSizeOverridesByPath.value[displayActiveWorkspaceTabPath.value] ?? null
    : null);
const characterProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "character",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "character" : null;
    },
});
const locationProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "location",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "location" : null;
    },
});
const ruleProfileVisible = computed({
    get: () => frontmatterProfileKind.value === "rule",
    set: (visible: boolean): void => {
        frontmatterProfileKind.value = visible ? "rule" : null;
    },
});
const workspaceReferenceRefreshKey = computed(() => workspaceTree.value
    .map((node) => [
        node.path,
        node.entryType ?? "",
        node.icon ?? "",
        node.status ?? "",
        node.contentNode ? "content" : "plain",
        node.frontmatterError ?? "",
        node.mtimeMs,
    ].join(":"))
    .join("|"));
/**
 * Markdown 文件继续进入 MarkdownStudio。
 */
const isMarkdownFile = computed(() => currentFileExtension.value === ".md");
const isPlainTextFile = computed(() => [".txt", ".text", ".markdown"].includes(currentFileExtension.value));
const inlinePromptExpanded = ref(false);
const inlinePromptInstruction = ref("");
const inlinePromptTask = ref<InlineEditTask>("chat");
const inlinePromptReferences = ref<InlineEditReference[]>([]);
const inlinePromptHoveredReference = ref<InlineEditReference | null>(null);
const inlinePromptRunning = ref(false);
const inlinePromptStatusText = ref(t("ide.inlineAi.initialStatus"));
const inlinePromptEditPreview = ref("");
const displayInlinePromptSessionLabel = computed(() => {
    return unref(agentSurfaceRef.value?.inlineEditorSessionLabel) || t("ide.inlineAi.sessionLabel");
});
const inlinePromptSessions = computed<AgentSessionSummaryDto[]>(() => {
    return unref(agentSurfaceRef.value?.inlineEditorSessions) ?? [];
});
const inlinePromptSessionId = computed<number | null>(() => {
    return unref(agentSurfaceRef.value?.inlineEditorSessionId) ?? null;
});
const inlinePromptSessionLoading = computed(() => {
    return unref(agentSurfaceRef.value?.inlineEditorSessionLoading) ?? false;
});
const inlinePromptResultText = computed(() => {
    return unref(agentSurfaceRef.value?.inlineEditorResultText) || "";
});
const inlinePromptAgentRunning = computed(() => {
    return unref(agentSurfaceRef.value?.inlineEditorRunning) ?? false;
});
const inlinePromptBusy = computed(() => inlinePromptRunning.value || inlinePromptAgentRunning.value || loadingWorkspace.value);
const displayInlinePromptEditPreview = computed(() => {
    return unref(agentSurfaceRef.value?.inlineEditPreview) || inlinePromptEditPreview.value;
});
const inlinePromptLiveView = computed(() => unref(agentSurfaceRef.value?.inlineEditorLiveView) ?? {
    thinking: "",
    content: "",
    status: null,
    editPreview: "",
    resultText: "",
});
const inlinePromptSelectableModels = computed(() => unref(agentSurfaceRef.value?.selectableModels) ?? []);
const inlinePromptSessionModelSelectionValue = computed(() => unref(agentSurfaceRef.value?.inlineSessionModelSelectionValue) ?? null);
const inlinePromptSessionModelDraft = computed<AgentSessionModelDraft>(() => unref(agentSurfaceRef.value?.inlineSessionModelDraft) ?? {
    modelKey: null,
    reasoningEffort: null,
});
const inlinePromptSessionModelSaving = computed(() => unref(agentSurfaceRef.value?.inlineSessionModelSaving) ?? false);
const inlinePromptSessionModelPopoverOpen = computed(() => unref(agentSurfaceRef.value?.inlineSessionModelPopoverOpen) ?? false);
const inlinePromptSessionThinkingResolvedLabel = computed(() => unref(agentSurfaceRef.value?.inlineSessionThinkingResolvedLabel) ?? "");
const inlinePromptAvailable = computed(() => {
    return workspaceDisplayReady.value
        && selectedFileNode.value?.editable === true
        && (isMarkdownFile.value || isPlainTextFile.value);
});

const inlineTaskLabels = computed<Record<InlineEditTask, string>>(() => ({
    chat: t("ide.inlineAi.taskChat"),
    rewrite: t("ide.inlineAi.taskRewrite"),
    polish: t("ide.inlineAi.taskPolish"),
    expand: t("ide.inlineAi.taskExpand"),
    condense: t("ide.inlineAi.taskCondense"),
    continue_after: t("ide.inlineAi.taskContinueAfter"),
    bridge: t("ide.inlineAi.taskBridge"),
}));

const markdownCommandSections = computed(() => [
    {
        id: "ai",
        title: "AI",
        items: [
            createMarkdownCommandItem("command:ai-generate", t("ide.markdownMenu.aiGenerate"), t("ide.markdownMenu.aiGenerateDescription"), "i-lucide-sparkles", "paragraph", true),
            createMarkdownCommandItem("command:ai-rewrite", t("ide.markdownMenu.aiRewrite"), t("ide.markdownMenu.aiRewriteDescription"), "i-lucide-wand-sparkles", "paragraph", true),
        ],
    },
    {
        id: "style",
        title: "Style",
        items: [
            createMarkdownCommandItem("command:paragraph", t("ide.markdownMenu.paragraph"), t("ide.markdownMenu.paragraphDescription"), "i-lucide-type", "paragraph"),
            createMarkdownCommandItem("command:heading-1", t("ide.markdownMenu.heading1"), t("ide.markdownMenu.heading1Description"), "i-lucide-heading-1", "heading-1"),
            createMarkdownCommandItem("command:heading-2", t("ide.markdownMenu.heading2"), t("ide.markdownMenu.heading2Description"), "i-lucide-heading-2", "heading-2"),
            createMarkdownCommandItem("command:heading-3", t("ide.markdownMenu.heading3"), t("ide.markdownMenu.heading3Description"), "i-lucide-heading-3", "heading-3"),
            createMarkdownCommandItem("command:bullet-list", t("ide.markdownMenu.bulletList"), t("ide.markdownMenu.bulletListDescription"), "i-lucide-list", "bullet-list"),
            createMarkdownCommandItem("command:ordered-list", t("ide.markdownMenu.orderedList"), t("ide.markdownMenu.orderedListDescription"), "i-lucide-list-ordered", "ordered-list"),
            createMarkdownCommandItem("command:blockquote", t("ide.markdownMenu.blockquote"), t("ide.markdownMenu.blockquoteDescription"), "i-lucide-text-quote", "blockquote"),
            createMarkdownCommandItem("command:code-block", t("ide.markdownMenu.codeBlock"), t("ide.markdownMenu.codeBlockDescription"), "i-lucide-square-code", "code-block"),
            createMarkdownCommandItem("command:horizontal-rule", t("ide.markdownMenu.horizontalRule"), t("ide.markdownMenu.horizontalRuleDescription"), "i-lucide-minus", "horizontal-rule"),
        ],
    },
    {
        id: "insert",
        title: "Insert",
        items: [
            createMarkdownCommandItem("command:image", t("ide.markdownMenu.image"), t("ide.markdownMenu.imageDescription"), "i-lucide-image", "image", true),
            createMarkdownCommandItem("command:link", t("ide.markdownMenu.link"), t("ide.markdownMenu.linkDescription"), "i-lucide-link", "link", true),
            createMarkdownCommandItem("command:reference", t("ide.markdownMenu.reference"), t("ide.markdownMenu.referenceDescription"), "i-lucide-at-sign", "reference"),
            createMarkdownCommandItem("command:comment", t("ide.markdownMenu.comment"), t("ide.markdownMenu.commentDescription"), "i-lucide-message-square-plus", "comment", true),
        ],
    },
]);

/**
 * 创建 Markdown slash command 菜单项。
 */
function createMarkdownCommandItem(
    id: string,
    label: string,
    description: string,
    iconClass: string,
    markdownCommand: MarkdownCommandKind,
    disabled = false,
): AgentTriggerMenuItem {
    return {
        id,
        label,
        description,
        iconClass,
        markdownCommand,
        disabled,
        trailingSpace: false,
    };
}

/**
 * 按需加载 Markdown Studio 的 skill 触发菜单。
 */
async function refreshMarkdownSkillCatalog(): Promise<void> {
    if (markdownSkillCatalogLoaded.value) {
        return;
    }
    if (markdownSkillCatalogRequest) {
        return await markdownSkillCatalogRequest;
    }

    markdownSkillCatalogRequest = (async () => {
        markdownSkillCatalogLoading.value = true;
        try {
            markdownSkillCatalog.value = await $fetch<AgentSkillCatalogItemDto[]>("/api/agent/skills");
            markdownSkillCatalogLoaded.value = true;
        } finally {
            markdownSkillCatalogLoading.value = false;
            markdownSkillCatalogRequest = null;
        }
    })();
    return await markdownSkillCatalogRequest;
}

/**
 * 解析 Markdown Studio 的 $ skill 菜单。
 */
function resolveMarkdownSkillMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    if (!markdownSkillCatalogLoaded.value && !markdownSkillCatalogLoading.value) {
        void refreshMarkdownSkillCatalog();
    }

    const query = context.query.trim().toLocaleLowerCase("zh-CN");
    const items = markdownSkillCatalog.value
        .filter((item) => !query || `${item.name} ${item.description}`.toLocaleLowerCase("zh-CN").includes(query))
        .map((item) => ({
            id: `skill:${item.name}`,
            label: item.name,
            description: item.description,
            iconClass: "i-lucide-sparkles",
            hint: `$${item.name}`,
            skill: {
                name: item.name,
            },
        }));

    if (markdownSkillCatalogLoading.value && items.length === 0) {
        return {
            title: t("ide.markdownMenu.skillTitle"),
            prefix: "$",
            sections: [{
                id: "skill-loading",
                items: [{
                    id: "skill:loading",
                    label: t("ide.markdownMenu.skillLoading"),
                    description: t("ide.markdownMenu.skillLoadingDescription"),
                    iconClass: "i-lucide-loader-circle animate-spin",
                    disabled: true,
                }],
            }],
        };
    }

    if (markdownSkillCatalogLoaded.value && items.length === 0) {
        return {
            title: t("ide.markdownMenu.skillTitle"),
            prefix: "$",
            sections: [{
                id: "skill-empty",
                items: [{
                    id: "skill:empty",
                    label: t("ide.markdownMenu.skillEmpty"),
                    description: markdownSkillCatalog.value.length > 0 ? t("ide.markdownMenu.skillNoMatchDescription") : t("ide.markdownMenu.skillNoneDescription"),
                    iconClass: "i-lucide-info",
                    disabled: true,
                }],
            }],
        };
    }

    return {
        title: t("ide.markdownMenu.skillTitle"),
        prefix: "$",
        sections: items.length > 0 ? [{id: "skill", items}] : [],
    };
}

/**
 * 解析 Markdown Studio 的 / 命令、@ 引用菜单和 $ skill 菜单。
 */
function resolveMarkdownMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    if (context.kind === "command") {
        const query = context.query.trim().toLocaleLowerCase("zh-CN");
        const sections = markdownCommandSections.value
            .map((section) => ({
                ...section,
                items: section.items.filter((item) => !query || `${item.label} ${item.description} ${item.hint ?? ""}`.toLocaleLowerCase("zh-CN").includes(query)),
            }))
            .filter((section) => section.items.length > 0);
        return {
            title: t("ide.markdownMenu.commandTitle"),
            prefix: "/",
            sections: sections.length > 0 ? sections : [createEmptyMenuSection(context.query)],
        };
    }
    if (context.kind === "skill") {
        return resolveMarkdownSkillMenu(context);
    }

    const referenceSections = buildWorkspaceReferenceSections(workspaceTree.value, context.query);
    return {
        title: t("ide.markdownMenu.referenceTitle"),
        prefix: "@",
        sections: referenceSections.length > 0 ? referenceSections : [createEmptyMenuSection(context.query)],
    };
}

/**
 * 搜索无结果时仍保留菜单，避免 Suggestion 直接关闭。
 */
function createEmptyMenuSection(query: string): {id: string; title: string; items: AgentTriggerMenuItem[]} {
    const label = query.trim() ? t("ide.markdownMenu.noMatch") : t("ide.markdownMenu.noReference");
    return {
        id: "empty",
        title: "",
        items: [{
            id: "empty-result",
            label,
            description: query.trim() ? t("ide.markdownMenu.tryAnotherKeyword") : t("ide.markdownMenu.noWorkspaceReference"),
            iconClass: "i-lucide-search-x",
            disabled: true,
        }],
    };
}

/**
 * 打开 Markdown 引用指向的 workspace 文件。
 */
async function openWorkspaceReference(target: string): Promise<void> {
    const resolvedPath = resolveReferencePath(target, selectedFilePath.value);
    if (!resolvedPath) {
        notification.warning(t("ide.shell.referenceOpenMissing", {target}), {title: t("ide.shell.referenceOpenFailedTitle")});
        return;
    }
    await novelIdeStore.openWorkspacePath(resolvedPath, "permanent");
    if (isAgentMode.value) {
        agentStudioPanelVisible.value = true;
    }
}

/**
 * 在页面关闭或刷新前同步落下当前 workspace 会话。
 */
function flushWorkspaceSession(): void {
    novelIdeStore.persistWorkspaceSession();
}

/**
 * 为 TipTap 引用 chip 解析真实 workspace 节点。
 */
function resolveWorkspaceReferencePreview(target: string, sourcePath: string): WorkspaceReferencePreviewMeta {
    const node = resolveReferenceNode(target, sourcePath);
    if (!node) {
        return {
            target,
            resolvedPath: null,
            entryType: null,
            icon: null,
            title: "",
            status: null,
            broken: true,
            contentNode: false,
            isDirectory: false,
        };
    }

    const isValidContentNode = Boolean(node.contentNode && node.entryType && !node.frontmatterError);
    const entryType = isValidContentNode
        ? node.entryType
        : isWorkspacePlanFile(node.path)
            ? "plan"
            : node.isDirectory ? "folder" : "file";
    return {
        target,
        resolvedPath: node.isDirectory && node.hasIndex ? `${normalizeWorkspacePath(node.path)}/index.md` : node.path,
        entryType,
        icon: node.icon ? `i-lucide-${node.icon}` : null,
        title: node.title?.trim() || basename(node.path),
        status: node.status,
        broken: false,
        contentNode: isValidContentNode,
        isDirectory: node.isDirectory,
    };
}

/**
 * 判断路径是否是 Agent thread Markdown 工作文件。
 */
function isWorkspacePlanFile(filePath: string): boolean {
    const normalizedPath = normalizeWorkspacePath(filePath).toLowerCase();
    return /\.agent\/[^/]+\/.+\.md$/i.test(normalizedPath)
        || /^\.agent\/[^/]+\/.+\.md$/i.test(normalizedPath);
}

/**
 * 将引用 target 解析为可打开路径。
 */
function resolveReferencePath(target: string, sourcePath: string): string | null {
    const node = resolveReferenceNode(target, sourcePath);
    if (!node) {
        return null;
    }
    if (node.isDirectory) {
        return node.hasIndex ? `${normalizeWorkspacePath(node.path)}/index.md` : node.path;
    }
    return node.path;
}

/**
 * 将引用 target 解析为 workspace tree 中的节点。
 */
function resolveReferenceNode(target: string, sourcePath: string): WorkspaceFileNode | null {
    const cleanTarget = stripReferenceFragment(target.trim());
    if (!cleanTarget || cleanTarget.startsWith("/") || isExternalOrSchemeTarget(cleanTarget)) {
        return null;
    }

    const decodedTarget = safeDecodeURI(cleanTarget).replace(/\\/g, "/");
    const basePath = decodedTarget.startsWith("./") || decodedTarget.startsWith("../")
        ? dirname(sourcePath)
        : "";
    const normalizedTarget = normalizeWorkspacePath(joinWorkspacePath(basePath, decodedTarget));
    const candidates = collectWorkspaceReferencePathCandidates(normalizedTarget, novelIdeStore.currentWorkspaceRoot);
    for (const candidate of candidates) {
        const node = findWorkspaceNode(candidate);
        if (node) {
            return node;
        }
    }
    return null;
}

/**
 * 根据标准化路径查找 workspace 节点。
 */
function findWorkspaceNode(path: string): WorkspaceFileNode | null {
    const normalizedPath = normalizeWorkspacePath(path);
    return workspaceTree.value.find((node) => normalizeWorkspacePath(node.path) === normalizedPath) ?? null;
}

/**
 * 判断 target 是否是外部链接或协议链接。
 */
function isExternalOrSchemeTarget(target: string): boolean {
    return /^(?:https?:|mailto:|tel:|#)/i.test(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
}

/**
 * 安全解码 URI。
 */
function safeDecodeURI(target: string): string {
    try {
        return decodeURI(target);
    } catch {
        return target;
    }
}

/**
 * 去掉 query/hash。
 */
function stripReferenceFragment(target: string): string {
    const queryIndex = target.indexOf("?");
    const hashIndex = target.indexOf("#");
    const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
    return indexes.length > 0 ? target.slice(0, Math.min(...indexes)) : target;
}

/**
 * 拼接并归一化 workspace 路径。
 */
function joinWorkspacePath(basePath: string, target: string): string {
    const segments = `${basePath ? `${basePath}/` : ""}${target}`.split("/");
    const resolved: string[] = [];
    for (const segment of segments) {
        if (!segment || segment === ".") {
            continue;
        }
        if (segment === "..") {
            resolved.pop();
            continue;
        }
        resolved.push(segment);
    }
    return resolved.join("/");
}

/**
 * 返回路径父目录。
 */
function dirname(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";
}

/**
 * 返回路径 basename。
 */
function basename(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 标准化 workspace 相对路径。
 */
function normalizeWorkspacePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/^\.\//, "");
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * 保存当前真实文件；保存冲突由 store 打开 Diff dialog。
 */
const saveCurrentWorkspaceFile = async (): Promise<void> => {
    if (!initialized.value || !selectedFileNode.value?.editable) {
        return;
    }
    if (savingFile.value) {
        saveQueued.value = true;
        return;
    }

    try {
        await saveCurrentFile();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.shell.autoSaveFailed")), {title: t("ide.shell.autoSaveFailedTitle")});
    } finally {
        if (saveQueued.value && !novelIdeStore.workspaceWriteConflict && selectedFileContent.value !== lastSyncedFileContent.value) {
            saveQueued.value = false;
            await saveCurrentWorkspaceFile();
            return;
        }
        saveQueued.value = false;
    }
};

/**
 * 将 TipTap 选区加入底部 Inline AI 输入栏。
 */
function addInlineAiReference(reference: InlineEditReference): void {
    inlinePromptReferences.value = [
        ...inlinePromptReferences.value.filter((item) => item.ref !== reference.ref || item.text !== reference.text),
        reference,
    ];
    inlinePromptExpanded.value = true;
    inlinePromptStatusText.value = reference.match === "unique"
        ? t("ide.inlineAi.referenceAdded")
        : t("ide.inlineAi.referenceAddedWeak");
}

/**
 * 清除一个 Inline AI 引用。
 */
function clearInlineAiReference(index: number): void {
    const removedReference = inlinePromptReferences.value[index] ?? null;
    inlinePromptReferences.value = inlinePromptReferences.value.filter((_reference, referenceIndex) => referenceIndex !== index);
    if (removedReference && inlinePromptHoveredReference.value?.ref === removedReference.ref) {
        inlinePromptHoveredReference.value = null;
    }
}

/**
 * 构造发送给 AgentChatFlow 的可见用户消息。
 */
function buildInlineVisibleMessage(payload: InlineEditPayload): string {
    const chips = payload.references.length > 0
        ? payload.references.map((reference) => reference.ref)
        : [buildSelectionRefChip({path: payload.targetPath})];
    const instruction = payload.instruction.trim() || t("ide.inlineAi.defaultInstruction");
    return `**${inlineTaskLabels.value[payload.task]}** ${chips.join(" ")}\n\n${instruction}`;
}

/**
 * 将 IDE store 路径规范化为当前 Project File Scope 相对路径。
 *
 * @example
 * // 当 currentNovelId = "ming-ding-zhi-shi-2"
 * resolveInlineEditorTargetPath("manuscript/001/index.md")
 * // => "manuscript/001/index.md"
 *
 * resolveInlineEditorTargetPath("ming-ding-zhi-shi-2/manuscript/001/index.md")
 * // => "manuscript/001/index.md"（清理旧slug前缀）
 */
function resolveInlineEditorTargetPath(projectRelativePath: string): string {
    if (!projectRelativePath) {
        return projectRelativePath;
    }
    const projectSlug = currentNovelId.value;
    if (!projectSlug) {
        // user-assets 或 welcome 模式没有Project File Scope，保留入口原值。
        return projectRelativePath;
    }
    const normalized = projectRelativePath.replaceAll("\\", "/").replace(/^\/+/, "");
    const workspacePrefix = `workspace/${projectSlug}/`;
    if (normalized.startsWith(workspacePrefix)) {
        return normalized.slice(workspacePrefix.length);
    }
    return normalized.startsWith(`${projectSlug}/`)
        ? normalized.slice(projectSlug.length + 1)
        : normalized;
}

/**
 * 批量转换 selection references 的路径，并重新生成 canonical chip。
 */
function resolveInlineEditorReferences(references: InlineEditReference[]): InlineEditReference[] {
    return references.map((reference) => {
        const resolvedPath = resolveInlineEditorTargetPath(reference.path);
        return {
            ...reference,
            path: resolvedPath,
            ref: buildSelectionRefChip({
                path: resolvedPath,
                range: reference.range,
            }),
        };
    });
}

/**
 * 发送 Inline AI 编辑任务给 inline.editor profile。
 */
async function sendInlineEditorPrompt(): Promise<void> {
    if (inlinePromptBusy.value) {
        return;
    }
    if (!inlinePromptAvailable.value) {
        notification.warning(t("ide.inlineAi.unsupportedFile"), {title: "Inline AI"});
        return;
    }
    if (!selectedFilePath.value) {
        notification.warning(t("ide.inlineAi.openEditableFileFirst"), {title: "Inline AI"});
        return;
    }
    if (!inlinePromptInstruction.value.trim() && inlinePromptReferences.value.length === 0) {
        notification.warning(t("ide.inlineAi.missingInstruction"), {title: "Inline AI"});
        return;
    }

    const payload: InlineEditPayload = {
        version: 1,
        task: inlinePromptTask.value,
        targetPath: resolveInlineEditorTargetPath(selectedFilePath.value),
        instruction: inlinePromptInstruction.value.trim(),
        references: resolveInlineEditorReferences(inlinePromptReferences.value),
    };
    const agentSurface = agentSurfaceRef.value;
    if (!agentSurface?.sendInlineEditorPrompt) {
        notification.error(t("ide.inlineAi.agentNotReady"), {title: "Inline AI"});
        return;
    }

    inlinePromptRunning.value = true;
    inlinePromptStatusText.value = t("ide.inlineAi.sending");
    inlinePromptEditPreview.value = "";

    try {
        await saveCurrentWorkspaceFile();
        await agentSurface.sendInlineEditorPrompt(payload, buildInlineVisibleMessage(payload));
        inlinePromptInstruction.value = "";
        inlinePromptReferences.value = [];
        inlinePromptHoveredReference.value = null;
        inlinePromptStatusText.value = t("ide.inlineAi.started");
    } catch (error) {
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.sendFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    } finally {
        inlinePromptRunning.value = false;
    }
}

/**
 * 停止当前 Inline AI 任务。
 */
async function stopInlineEditorPrompt(): Promise<void> {
    await agentSurfaceRef.value?.stopInlineEditorPrompt?.();
    inlinePromptRunning.value = false;
    inlinePromptStatusText.value = t("ide.inlineAi.stopRequested");
}

/**
 * 在 PromptBar 内切换后台 Inline AI session。
 */
async function selectInlineEditorSession(sessionId: number): Promise<void> {
    try {
        await agentSurfaceRef.value?.selectInlineEditorSession?.(sessionId);
        inlinePromptStatusText.value = t("ide.inlineAi.boundSession");
    } catch (error) {
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.bindFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

/**
 * 在当前 Project Workspace 下创建新的 Inline AI session。
 */
async function createInlineEditorSession(): Promise<void> {
    try {
        await agentSurfaceRef.value?.createInlineEditorSession?.();
        inlinePromptStatusText.value = t("ide.inlineAi.sessionCreated");
    } catch (error) {
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.createSessionFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

/**
 * 显式打开右侧 Agent 面板查看当前 Inline AI session。
 */
async function openInlineEditorSessionChat(): Promise<void> {
    try {
        rightPanelOpen.value = true;
        await agentSurfaceRef.value?.openInlineEditorSession?.();
    } catch (error) {
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.openModelPanelFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

function updateInlineSessionModelDraft(value: AgentSessionModelDraft): void {
    agentSurfaceRef.value?.setInlineSessionModelDraft?.(value);
}

function updateInlineSessionModelPopoverOpen(value: boolean): void {
    agentSurfaceRef.value?.setInlineSessionModelPopoverOpen?.(value);
}

/**
 * 切换工作区编辑模式。
 */
const setCurrentWorkspaceViewMode = (mode: WorkspaceEditorViewMode): void => {
    if (!selectedFilePath.value) {
        return;
    }
    setWorkspaceTabViewMode(selectedFilePath.value, mode);
    viewMode.value = mode;
};

watch(currentWorkspaceViewMode, (mode) => {
    viewMode.value = mode;
}, {immediate: true});

watch([inlinePromptAvailable, agentSurfaceRef], ([available, surface]) => {
    if (available && surface?.refreshInlineEditorSessions) {
        void surface.refreshInlineEditorSessions();
    }
}, {immediate: true});

watch(selectedFilePath, () => {
    inlinePromptReferences.value = [];
    inlinePromptHoveredReference.value = null;
    inlinePromptEditPreview.value = "";
    inlinePromptStatusText.value = t("ide.inlineAi.initialStatus");
});

/**
 * 关闭标签页，脏文件先确认。
 */
const closeEditorTab = async (filePath: string): Promise<void> => {
    const tab = workspaceTabs.value.find((item) => item.path === filePath);
    if (!tab) {
        return;
    }
    if (!tab.dirty) {
        await closeWorkspaceTab(filePath, true);
        return;
    }
    const action = await choose(t("ide.shell.closeTabUnsaved"), [
        {label: t("ide.shell.save"), value: "save", tone: "primary"},
        {label: t("ide.shell.discard"), value: "discard", tone: "danger"},
        {label: t("common.cancel"), value: "cancel"},
    ], t("ide.shell.closeTabTitle"));
    if (action === "cancel") {
        return;
    }
    if (action === "save" && filePath !== selectedFilePath.value) {
        await selectWorkspaceTab(filePath);
    }
    if (action === "save") {
        await saveCurrentWorkspaceFile();
    }
    await closeWorkspaceTab(filePath, true);
};

/**
 * 处理切换前的未保存文件修改。
 */
type WorkspaceSwitchDecision = "save" | "discard" | "cancel";

/**
 * 处理切换前的未保存文件修改。
 */
const resolveUnsavedWorkspaceChanges = async (): Promise<WorkspaceSwitchDecision> => {
    if (!hasUnsavedWorkspaceChanges.value) {
        return "save";
    }

    const action = await choose(t("ide.shell.unsavedWorkspaceMessage"), [
        {label: t("ide.shell.save"), value: "save", tone: "primary"},
        {label: t("ide.shell.discard"), value: "discard", tone: "danger"},
        {label: t("common.cancel"), value: "cancel"},
    ], t("ide.shell.unsavedWorkspaceTitle"));

    if (action === "cancel") {
        return "cancel";
    }
    if (action === "save") {
        await saveDirtyWorkspaceFiles();
        return "save";
    }

    return "discard";
};

/**
 * 切换 Project 前保护 World Engine Workbench 的会话态草稿。
 */
const confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch = async (): Promise<boolean> => {
    if (!worldEngineWorkbenchOpen.value) {
        return true;
    }
    if (worldEngineWorkbenchSaving.value) {
        await choose("World Engine 正在保存 Slice，请等待保存完成后再切换 Project。", [
            {label: t("common.confirm"), value: "ok", tone: "primary"},
        ], "World Engine 正在保存");
        return false;
    }
    if (!worldEngineWorkbenchHasUnsavedDrafts.value) {
        return true;
    }
    const action = await choose("World Engine Workbench 有未保存草稿。切换 Project 会放弃这些会话草稿。", [
        {label: "放弃草稿并切换", value: "discard", tone: "danger"},
        {label: t("common.cancel"), value: "cancel"},
    ], "World Engine 草稿未保存");
    if (action === "cancel") {
        return false;
    }
    return action === "discard";
};

/**
 * 切换小说前先处理当前文件保存状态。
 */
const handleSwitchNovel = async (novelId: string): Promise<void> => {
    if (novelId === currentNovelId.value) {
        if (route.query.project !== novelId) {
            await router.replace(buildProjectRoute(novelId));
        }
        return;
    }

    if (!(await confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch())) {
        return;
    }

    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        return;
    }

    await switchNovel(novelId, {discardWorkspaceChanges: decision === "discard"});
    await router.replace(buildProjectRoute(novelId));
};

/**
 * 捕获模式切换前后需要平滑移动的元素位置。
 */
const captureModeTransitionRects = (): Map<string, DOMRect> => {
    const rects = new Map<string, DOMRect>();
    for (const selector of MODE_TRANSITION_SELECTORS) {
        const element = document.querySelector(selector);
        if (element instanceof HTMLElement) {
            rects.set(selector, element.getBoundingClientRect());
        }
    }
    return rects;
};

/**
 * 克隆当前 IDE 工作区，作为向左滑出的纸面快照。
 */
const createIdePaperSlideOverlay = (): HTMLElement | null => {
    const items = IDE_PAPER_TRANSITION_SELECTORS
        .map((selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return null;
            }
            return {element, rect};
        })
        .filter((item): item is {element: HTMLElement; rect: DOMRect} => item !== null);

    if (items.length === 0) {
        return null;
    }

    const left = Math.min(...items.map((item) => item.rect.left));
    const top = Math.min(...items.map((item) => item.rect.top));
    const right = Math.max(...items.map((item) => item.rect.right));
    const bottom = Math.max(...items.map((item) => item.rect.bottom));
    const overlay = document.createElement("div");
    overlay.className = "mode-transition-paper";
    overlay.style.position = "fixed";
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${right - left}px`;
    overlay.style.height = `${bottom - top}px`;
    overlay.style.zIndex = "80";
    overlay.style.pointerEvents = "none";
    overlay.style.overflow = "hidden";
    overlay.style.transform = "translate3d(0, 0, 0)";
    overlay.style.willChange = "transform";

    for (const item of items) {
        const clone = item.element.cloneNode(true) as HTMLElement;
        clone.style.position = "absolute";
        clone.style.left = `${item.rect.left - left}px`;
        clone.style.top = `${item.rect.top - top}px`;
        clone.style.width = `${item.rect.width}px`;
        clone.style.height = `${item.rect.height}px`;
        clone.style.margin = "0";
        clone.style.pointerEvents = "none";
        clone.style.transform = "none";
        overlay.appendChild(clone);
    }

    themeHostRef.value?.appendChild(overlay);
    return overlay;
};

/**
 * 播放 IDE 纸面向左滑出动画。
 */
const animateIdePaperSlideOut = (overlay: HTMLElement | null): void => {
    if (!overlay) {
        return;
    }

    const rect = overlay.getBoundingClientRect();
    const distance = Math.max(rect.right + 24, window.innerWidth * 0.72);
    const animation = overlay.animate([
        {transform: "translate3d(0, 0, 0)"},
        {transform: `translate3d(-${distance}px, 0, 0)`},
    ], {
        duration: 360,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
    });
    animation.onfinish = () => overlay.remove();
    window.setTimeout(() => overlay.remove(), 420);
};

/**
 * 在不支持 View Transition 的浏览器里，用纸面滑动 + FLIP 缓和布局 order 变化。
 */
const runFallbackLayoutModeTransition = async (mutation: () => void): Promise<void> => {
    const direction = layoutMode.value === "ide" ? "to-agent" : "to-ide";
    layoutTransitionDirection.value = direction;
    await nextTick();
    const beforeRects = captureModeTransitionRects();
    const idePaperOverlay = direction === "to-agent" ? createIdePaperSlideOverlay() : null;
    mutation();
    await nextTick();

    const animated: Array<{
        element: HTMLElement;
        transform: string;
        transition: string;
        willChange: string;
    }> = [];

    for (const selector of MODE_TRANSITION_SELECTORS) {
        if (direction === "to-agent" && IDE_PAPER_TRANSITION_SELECTORS.includes(selector as typeof IDE_PAPER_TRANSITION_SELECTORS[number])) {
            continue;
        }

        const element = document.querySelector(selector);
        const beforeRect = beforeRects.get(selector);
        if (!(element instanceof HTMLElement) || !beforeRect) {
            continue;
        }

        const afterRect = element.getBoundingClientRect();
        if (beforeRect.width === 0 || beforeRect.height === 0 || afterRect.width === 0 || afterRect.height === 0) {
            continue;
        }

        const deltaX = beforeRect.left - afterRect.left;
        const deltaY = beforeRect.top - afterRect.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
            continue;
        }

        animated.push({
            element,
            transform: element.style.transform,
            transition: element.style.transition,
            willChange: element.style.willChange,
        });
        element.style.transition = "none";
        element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
        element.style.willChange = "transform";
    }

    if (animated.length === 0) {
        animateIdePaperSlideOut(idePaperOverlay);
        window.setTimeout(() => {
            if (layoutTransitionDirection.value === direction) {
                layoutTransitionDirection.value = null;
            }
        }, 360);
        return;
    }

    document.body.getBoundingClientRect();
    requestAnimationFrame(() => {
        animateIdePaperSlideOut(idePaperOverlay);
        for (const item of animated) {
            item.element.style.transition = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
            item.element.style.transform = "translate3d(0, 0, 0)";
        }
        window.setTimeout(() => {
            for (const item of animated) {
                item.element.style.transform = item.transform;
                item.element.style.transition = item.transition;
                item.element.style.willChange = item.willChange;
            }
            if (layoutTransitionDirection.value === direction) {
                layoutTransitionDirection.value = null;
            }
        }, 320);
    });
};

/**
 * 使用浏览器 View Transition 包裹主模式切换，减轻 DOM order 改变带来的硬切。
 */
const runLayoutModeTransition = async (mutation: () => void): Promise<void> => {
    if (!import.meta.client) {
        mutation();
        await nextTick();
        return;
    }

    if (layoutMode.value === "ide") {
        await runFallbackLayoutModeTransition(mutation);
        return;
    }

    const transitionDocument = document as SameDocumentViewTransitionDocument;
    if (!transitionDocument.startViewTransition) {
        await runFallbackLayoutModeTransition(mutation);
        return;
    }

    const transition = transitionDocument.startViewTransition(async () => {
        layoutTransitionDirection.value = layoutMode.value === "ide" ? "to-agent" : "to-ide";
        mutation();
        await nextTick();
    });
    await transition.ready.catch(() => {});
    window.setTimeout(() => {
        layoutTransitionDirection.value = null;
    }, 320);
};

/**
 * 切换主界面的 IDE / Agent layout mode。
 */
const toggleAgentLayoutMode = async (): Promise<void> => {
    if (layoutMode.value === "agent") {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
            rightPanelOpen.value = true;
        });
        return;
    }
    await runLayoutModeTransition(() => {
        layoutMode.value = "agent";
        rightPanelOpen.value = true;
    });
    await agentSurfaceRef.value?.ensureSessionReady();
};

/**
 * Agent Mode 左侧栏请求刷新 leader sessions。
 */
const refreshAgentModeSessions = async (): Promise<void> => {
    await agentSurfaceRef.value?.refreshSessionsWithQuery({
        profileGroup: "leader",
        status: "active",
        relation: "all",
        limit: 50,
    });
};

/**
 * Agent Mode 选择指定 session。
 */
const selectAgentModeSession = async (sessionId: number): Promise<void> => {
    await agentSurfaceRef.value?.selectSession(sessionId);
};

/**
 * trace 查看器请求打开某个 session：先切 session（loadSession 同步落 activeSessionId，
 * 使随后 active watcher 的 ensureSessionReady 提前返回，避免恢复旧 session 覆盖目标），
 * 再确保 Agent 面板可见（Agent Mode 下面板已可见，无需动开关）。
 */
const openTraceSession = async (sessionId: number): Promise<void> => {
    await agentSurfaceRef.value?.selectSession(sessionId);
    if (!isAgentMode.value) {
        rightPanelOpen.value = true;
    }
};

/**
 * Agent Mode 新建默认 leader session。
 */
const createAgentModeSession = async (): Promise<void> => {
    await agentSurfaceRef.value?.createSession();
};

/**
 * Agent Mode 归档指定 session。
 */
const archiveAgentModeSession = async (session: AgentSessionSummaryDto): Promise<void> => {
    await agentSurfaceRef.value?.archiveSessionFromDialog(session);
};

/**
 * Agent Mode 手动重命名指定 session。
 */
const renameAgentModeSession = async (session: AgentSessionSummaryDto): Promise<void> => {
    await agentSurfaceRef.value?.renameSessionFromDialog(session);
};

/**
 * 关闭当前 Agent 槽位。
 */
const closeAgentSurface = (): void => {
    if (layoutMode.value === "agent") {
        layoutMode.value = "ide";
        rightPanelOpen.value = true;
        return;
    }
    rightPanelOpen.value = false;
};

/**
 * 切换 Agent Mode 的右侧 Studio 区域。
 */
const toggleAgentModeStudio = (): void => {
    agentStudioPanelVisible.value = !agentStudioPanelVisible.value;
};

/**
 * 处理左侧窄 sidebar 的模式入口。
 */
const handleSidebarToggle = (tab: NovelIdeTab | "sessions"): void => {
    if (tab === "sessions") {
        agentSessionPanelOpen.value = !agentSessionPanelOpen.value;
        return;
    }
    if (isAgentMode.value) {
        void runLayoutModeTransition(() => {
            layoutMode.value = "ide";
            rightPanelOpen.value = true;
            activeLeftTab.value = tab;
        });
        return;
    }
    toggleLeftTab(tab);
};

/**
 * Agent 写入后刷新通用文件树；旧 chapter 事件仍交给 store 兼容处理。
 */
const handleAgentWorkspaceUpdated = async (payload: AgentWorkspaceSyncPayload): Promise<void> => {
    const result = await applyAgentWorkspaceSync(payload);
    await loadWorkspaceTree();
    historyInboxRefreshKey.value += 1;
    if (result === "applied") {
        studio.scrollToTop();
    }
};

/**
 * 合并并应用 workspace 文件系统事件。
 */
const flushWorkspaceFileEvents = async (): Promise<void> => {
    if (workspaceFileSyncRunning) {
        return;
    }
    workspaceFileSyncRunning = true;
    try {
        while (pendingWorkspaceFileEvents.length > 0) {
            const events = pendingWorkspaceFileEvents;
            pendingWorkspaceFileEvents = [];
            const result = await syncWorkspaceFromDisk(events);
            if (result.activeFile === "dirty") {
                notification.warning(t("ide.shell.fileSyncConflictMessage"), {title: t("ide.shell.fileSyncConflictTitle")});
            }
            if (result.activeFile === "deleted") {
                notification.warning(t("ide.shell.fileDeletedMessage"), {title: t("ide.shell.fileDeletedTitle")});
            }
        }
    } finally {
        workspaceFileSyncRunning = false;
    }
};

/**
 * 处理 workspace 文件事件流。
 */
const handleWorkspaceFileEvent = (event: WorkspaceFileStreamEventDto): void => {
    if (event.type !== "workspace_files_changed") {
        return;
    }
    pendingWorkspaceFileEvents.push(...event.events);
    historyInboxRefreshKey.value += 1;
    void flushWorkspaceFileEvents();
};

/**
 * 订阅当前 workspace 的文件变化。
 */
const subscribeWorkspaceEvents = (): void => {
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
    pendingWorkspaceFileEvents = [];
    if (!import.meta.client) {
        return;
    }

    const abortController = new AbortController();
    workspaceEventAbortController.value = abortController;
    const target = workspaceKind.value === "user-assets"
        ? {workspaceKind: "user-assets"} as const
        : currentNovelId.value ? {projectPath: currentNovelId.value} as const : null;
    if (!target) {
        return;
    }
    void workspaceFileEvents.subscribe(target, handleWorkspaceFileEvent, abortController.signal)
        .catch((error) => {
            if (abortController.signal.aborted) {
                return;
            }
            console.warn("[workspace-files] event stream failed", error);
            notification.warning(t("ide.shell.syncInterruptedMessage"), {title: t("ide.shell.syncInterruptedTitle")});
        });
};

/**
 * 读取后端默认模型展示名。
 */
const syncDefaultModelLabel = async (): Promise<void> => {
    try {
        const query = workspaceKind.value === "user-assets" || !currentNovelId.value
            ? {workspaceKind: "user-assets"} as const
            : {workspaceKind: "novel", projectPath: currentNovelId.value} as const;
        const settings = await $fetch<ConfigBootstrapDto>("/api/config/bootstrap", {
            query,
        });
        setSelectedModelLabel(settings.modelSettings.defaultModelLabel);
        novelIdeStore.applyThemeConfig(settings.ui.theme, settings.ui.customThemes);
    } catch {
        setSelectedModelLabel(null);
    }
};

/**
 * 同步当前登录用户，用于右上角账户菜单。
 */
const syncAuthSession = async (): Promise<void> => {
    if (authSessionState.session.value) {
        currentUser.value = authSessionState.session.value.user;
        return;
    }
    try {
        const session = await $fetch<AuthSessionDto>("/api/auth/me");
        authSessionState.setSession(session);
        currentUser.value = session.user;
    } catch {
        authSessionState.setSession(null);
        currentUser.value = null;
    }
};

/**
 * 退出登录并回到登录页。
 */
const logout = async (): Promise<void> => {
    await $fetch("/api/auth/logout", {method: "POST"});
    authSessionState.setSession(null);
    currentUser.value = null;
    await navigateTo("/login");
};

/**
 * 进入管理员后台。
 */
const openAdmin = async (): Promise<void> => {
    await navigateTo("/admin/users");
};

/**
 * 切换左侧标签；若重复点击则收起。
 */
const toggleLeftTab = (tab: NovelIdeTab): void => {
    activeLeftTab.value = activeLeftTab.value === tab ? null : tab;
};

/**
 * 从主 IDE 打开当前 Project 的 World Engine 工作台。
 */
const openWorldEngineWorkbench = (): void => {
    if (isUserAssetsWorkspace.value || !currentNovelId.value) {
        return;
    }
    worldEngineWorkbenchOpen.value = true;
};

/**
 * 从主 IDE 打开当前 Project 的 RP 模式独立界面。
 */
const openRpMode = (): void => {
    if (isUserAssetsWorkspace.value || !currentNovelId.value) {
        return;
    }
    rpModeOpen.value = true;
};

/**
 * 三态布局切换（Agent / IDE / RP）：agent 与 ide 沿用原布局切换，rp 打开 RP 独立界面。
 */
const setLayoutMode = async (mode: "agent" | "ide" | "rp"): Promise<void> => {
    if (mode === "rp") {
        openRpMode();
        return;
    }
    rpModeOpen.value = false;
    if ((mode === "agent") !== isAgentMode.value) {
        await toggleAgentLayoutMode();
    }
};

/**
 * 从主 IDE 打开当前 Project 的 Plot 工作台。
 */
const openPlotWorkbench = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value) {
        return;
    }

    if (isAgentMode.value) {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
            rightPanelOpen.value = true;
            activeLeftTab.value = "plot";
        });
    } else {
        activeLeftTab.value = "plot";
    }

    plotWorkbenchOpen.value = true;
};

/**
 * 打开全局用户 assets 工作区。
 */
const openUserAssets = (): void => {
    const resolved = router.resolve(buildProjectRoute(USER_ASSETS_PROJECT_TARGET));
    window.open(resolved.href, "_blank", "noopener,noreferrer");
};

/**
 * 根据页面 query 初始化当前工作区。
 */
const initializeWorkspaceFromRoute = async (): Promise<void> => {
    const target = parseProjectRouteTarget();
    if (target.kind === "user-assets") {
        await switchToUserAssetsWorkspace();
        activeLeftTab.value = "files";
        return;
    }

    if (target.kind === "project") {
        const list = await loadNovels();
        const routeProjectExists = list.some((novel) => novel.id === target.projectPath);
        discardOpenPathForProjectFallback.value = !routeProjectExists;
        await switchToNovelWorkspace(routeProjectExists ? target.projectPath : list[0]?.id);
        notifyProjectRouteFallback(target);
        return;
    }

    discardOpenPathForProjectFallback.value = false;
    await switchToNovelWorkspace();
    notifyProjectRouteFallback(target);
};

/**
 * 判断当前 store 状态是否已经匹配页面 query。
 */
const workspaceRouteSynced = (): boolean => {
    const target = parseProjectRouteTarget();
    if (target.kind === "user-assets") {
        return isUserAssetsWorkspace.value;
    }
    if (target.kind === "project" && novels.value.some((novel) => novel.id === target.projectPath)) {
        return workspaceKind.value === "novel" && currentNovelId.value === target.projectPath;
    }
    return !route.query.project && workspaceKind.value === "novel";
};

/**
 * 将当前小说页面规范成可分享的 query URL。
 */
const normalizeNovelRouteQuery = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value || !currentNovelId.value) {
        return;
    }
    if (route.query.project === currentNovelId.value) {
        return;
    }
    await router.replace(buildProjectRoute(currentNovelId.value));
};

/**
 * URL 指定的 Project 不存在或已删除时，告知作者已切回当前可用 Project。
 */
const notifyProjectRouteFallback = (target: ProjectRouteTarget): void => {
    if (target.kind !== "project") {
        return;
    }
    if (workspaceKind.value !== "novel" || currentNovelId.value === target.projectPath) {
        lastMissingProjectNoticeTarget.value = "";
        return;
    }
    if (lastMissingProjectNoticeTarget.value === target.projectPath) {
        return;
    }
    lastMissingProjectNoticeTarget.value = target.projectPath;
    const fallbackTitle = displayNovelTitle.value || currentNovelId.value || "可用 Project";
    const openPathHint = typeof route.query.openPath === "string" ? " 已忽略原链接中的文件路径。" : "";
    notification.warning(`Project ${target.projectPath} 不存在或已删除，已切换到 ${fallbackTitle}。${openPathHint}`, {title: "Project 已不可用"});
};

/**
 * 取消 route 触发的 workspace 切换时，把 URL 拉回当前实际 workspace。
 */
const restoreCurrentWorkspaceRoute = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value) {
        if (route.query.project === USER_ASSETS_PROJECT_TARGET) {
            return;
        }
        await router.replace(buildProjectRoute(USER_ASSETS_PROJECT_TARGET));
        return;
    }
    await normalizeNovelRouteQuery();
};

/**
 * 监听页面 query 变化，允许主页面直接切换 novel/user-assets workspace。
 */
const syncWorkspaceRoute = async (): Promise<void> => {
    if (workspaceRouteSynced()) {
        await consumeWorkspaceOpenPathFromRoute();
        if (!isUserAssetsWorkspace.value) {
            await normalizeNovelRouteQuery();
        }
        subscribeWorkspaceEvents();
        return;
    }
    if (!(await confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch())) {
        await restoreCurrentWorkspaceRoute();
        return;
    }
    const decision = await resolveUnsavedWorkspaceChanges();
    if (decision === "cancel") {
        await restoreCurrentWorkspaceRoute();
        return;
    }
    await initializeWorkspaceFromRoute();
    await consumeWorkspaceOpenPathFromRoute();
    if (!isUserAssetsWorkspace.value) {
        await normalizeNovelRouteQuery();
    }
    subscribeWorkspaceEvents();
};

/**
 * 打开当前 Markdown 文件的类型专属 frontmatter 档案。
 */
function openFrontmatterProfile(kind: FrontmatterProfileKind): void {
    frontmatterProfileKind.value = kind;
}

/**
 * 从欢迎页打开文件树；Agent Mode 下展开 Studio 内部文件树。
 */
function openWelcomeFiles(): void {
    if (isAgentMode.value) {
        agentStudioPanelVisible.value = true;
        agentStudioFileTreeOpen.value = true;
        return;
    }
    activeLeftTab.value = "files";
}

/**
 * 从欢迎页打开 Project Workspace 路径。
 */
async function openWelcomeWorkspacePath(filePath: string): Promise<void> {
    openWelcomeFiles();
    try {
        if (filePath === "world-engine/calendar.ts") {
            const created = await ensureWorldEngineCalendarFile();
            await novelIdeStore.selectWorkspacePath(filePath, "permanent");
            if (created) {
                notification.success("已创建 world-engine/calendar.ts", {title: "Calendar 配置已就绪"});
            }
            return;
        }
        await novelIdeStore.selectWorkspacePath(filePath, "permanent");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.shell.openPathFailed", {path: filePath})), {title: t("ide.shell.openPathFailedTitle")});
    }
}

/**
 * 为旧 Project 补齐新版 Calendar 入口文件。
 */
async function ensureWorldEngineCalendarFile(): Promise<boolean> {
    const nodes = await novelIdeStore.loadWorkspaceTree();
    if (nodes.some((node) => node.path === "world-engine/calendar.ts")) {
        return false;
    }
    await createMissingWorldEngineCalendarFile();
    return true;
}

/**
 * 创建新版 Calendar 入口文件。
 */
async function createMissingWorldEngineCalendarFile(): Promise<void> {
    await novelIdeStore.createWorkspaceFile("world-engine/calendar.ts", buildWorldEngineCalendarTemplate());
}

/**
 * 默认 Calendar 草稿，保持和项目模板同一套 simple calendar 语义。
 */
function buildWorldEngineCalendarTemplate(): string {
    return [
        "/**",
        " * World Engine Calendar.",
        " *",
        " * 默认使用 Simple Calendar。可以改成 type: 'gregorian' 使用真实公历，",
        " * 或改成 type: 'custom' 手写 format / parse。",
        " */",
        "",
        "export default {",
        "  type: 'simple',",
        "  eraBefore: '蒙昧纪元',",
        "  eraAfter: '新生纪元',",
        "  baseUnit: 'second',",
        "  units: [",
        "    { name: 'minute', parent: 'second', ratio: 60 },",
        "    { name: 'hour', parent: 'minute', ratio: 60 },",
        "    { name: 'day', parent: 'hour', ratio: 24 },",
        "    { name: 'month', parent: 'day', ratio: 30 },",
        "    { name: 'year', parent: 'month', ratio: 12 }",
        "  ],",
        "  format: '{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}:{second:02}'",
        "};",
        "",
    ].join("\n");
}

/**
 * 消费 `openPath` 深链，在当前 Project Workspace 内打开目标文件。
 */
async function consumeWorkspaceOpenPathFromRoute(): Promise<void> {
    if (consumingRouteOpenPath.value || isUserAssetsWorkspace.value || !currentNovelId.value || typeof route.query.openPath !== "string") {
        return;
    }
    if (discardOpenPathForProjectFallback.value) {
        discardOpenPathForProjectFallback.value = false;
        const nextQuery = {...route.query};
        delete nextQuery.openPath;
        await router.replace({path: route.path, query: nextQuery});
        return;
    }
    const filePath = normalizeWorkspacePath(route.query.openPath);
    if (!filePath) {
        return;
    }
    consumingRouteOpenPath.value = true;
    try {
        await openWelcomeWorkspacePath(filePath);
        const nextQuery = {...route.query};
        delete nextQuery.openPath;
        await router.replace({path: route.path, query: nextQuery});
    } finally {
        consumingRouteOpenPath.value = false;
    }
}

/**
 * 从欢迎页打开 IDE 右侧 Agent 面板。
 */
async function openWelcomeAgentPanel(): Promise<void> {
    rightPanelOpen.value = true;
    if (isAgentMode.value) {
        await agentSurfaceRef.value?.ensureSessionReady();
    }
}

/**
 * 从欢迎页切入 Agent Mode；如果已经在 Agent Mode，则确保 session 已准备好。
 */
async function openWelcomeAgentMode(): Promise<void> {
    if (!isAgentMode.value) {
        await toggleAgentLayoutMode();
        return;
    }
    await agentSurfaceRef.value?.ensureSessionReady();
}

/**
 * 从欢迎页执行顶部 Agent / Studio 主按钮同等动作。
 */
function toggleWelcomeAgentSurface(): void {
    if (isAgentMode.value) {
        toggleAgentModeStudio();
        return;
    }
    rightPanelOpen.value = true;
}

/**
 * 创建欢迎页默认章节文件。
 */
async function createWelcomeChapter(): Promise<void> {
    const input = await prompt(t("ide.shell.createChapterPrompt"), "manuscript/001-volume/new-chapter/index.md", t("ide.shell.createChapterTitle"));
    const filePath = normalizeWelcomeChapterPath(input);
    if (!filePath) {
        return;
    }
    await createWelcomeFile(filePath, buildWelcomeMarkdownContent(filePath), t("ide.shell.createChapterFailed"));
}

/**
 * 创建欢迎页普通 Markdown 文件。
 */
async function createWelcomeMarkdownFile(): Promise<void> {
    const input = await prompt(t("ide.shell.createMarkdownPrompt"), "manuscript/new-file.md", t("ide.shell.createMarkdownTitle"));
    const filePath = normalizeWelcomeMarkdownPath(input);
    if (!filePath) {
        return;
    }
    await createWelcomeFile(filePath, buildWelcomeMarkdownContent(filePath), t("ide.shell.createMarkdownFailed"));
}

/**
 * 创建欢迎页 Lorebook 条目。
 */
async function createWelcomeLorebookEntry(): Promise<void> {
    const selectedType = await choose(t("ide.shell.createLorebookTypePrompt"), [
        {label: t("ide.shell.lorebookLocation"), value: "location", tone: "primary"},
        {label: t("ide.shell.lorebookCharacter"), value: "character"},
        {label: t("ide.shell.lorebookItem"), value: "item"},
        {label: t("ide.shell.lorebookRule"), value: "rule"},
        {label: t("ide.shell.lorebookNote"), value: "note"},
        {label: t("common.cancel"), value: "cancel"},
    ], t("ide.shell.createLorebookTitle"));
    if (!isWelcomeLorebookEntryType(selectedType)) {
        return;
    }

    const input = await prompt(t("ide.shell.createLorebookPathPrompt"), `lorebook/${selectedType}/new-entry/index.md`, t("ide.shell.createLorebookTitle"));
    const filePath = normalizeWelcomeLorebookPath(input, selectedType);
    if (!filePath) {
        return;
    }
    await createWelcomeFile(filePath, buildWelcomeLorebookContent(filePath, selectedType), t("ide.shell.createLorebookFailed"));
}

/**
 * 通过 workspace file API 创建文件并选中。
 */
async function createWelcomeFile(filePath: string, content: string, fallbackMessage: string): Promise<void> {
    try {
        const node = await novelIdeStore.createWorkspaceFile(filePath, content);
        await novelIdeStore.selectWorkspacePath(node.path, "permanent");
        notification.success(t("ide.shell.createSuccess", {path: node.path}), {title: t("ide.shell.createSuccessTitle")});
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, fallbackMessage), {title: fallbackMessage});
    }
}

/**
 * 判断 choose 返回值是否是欢迎页支持的 Lorebook 类型。
 */
function isWelcomeLorebookEntryType(value: string): value is WelcomeLorebookEntryType {
    return WELCOME_LOREBOOK_ENTRY_TYPES.includes(value as WelcomeLorebookEntryType);
}

/**
 * 归一化欢迎页输入的章节路径。章节目录输入默认落到 index.md。
 */
function normalizeWelcomeChapterPath(input: string | null): string {
    const normalizedPath = normalizeWelcomeWorkspacePath(input);
    if (!normalizedPath) {
        return "";
    }
    if (normalizedPath.toLowerCase().endsWith("/index.md")) {
        return normalizedPath;
    }
    if (normalizedPath.endsWith("/")) {
        return `${normalizedPath}index.md`;
    }
    if (/\.md$/i.test(normalizedPath)) {
        return normalizedPath;
    }
    return `${normalizedPath}/index.md`;
}

/**
 * 归一化欢迎页输入的 Markdown 路径。
 */
function normalizeWelcomeMarkdownPath(input: string | null): string {
    const normalizedPath = normalizeWelcomeWorkspacePath(input);
    if (!normalizedPath) {
        return "";
    }
    if (/\.md$/i.test(normalizedPath)) {
        return normalizedPath;
    }
    return `${normalizedPath}.md`;
}

/**
 * 归一化欢迎页输入的 Lorebook 条目路径。
 */
function normalizeWelcomeLorebookPath(input: string | null, entryType: WelcomeLorebookEntryType): string {
    const normalizedPath = normalizeWelcomeWorkspacePath(input);
    if (!normalizedPath) {
        return "";
    }

    const pathWithRoot = normalizedPath.startsWith("lorebook/")
        ? normalizedPath
        : `lorebook/${entryType}/${normalizedPath}`;
    if (pathWithRoot.toLowerCase().endsWith("/index.md")) {
        return pathWithRoot;
    }
    if (/\.md$/i.test(pathWithRoot)) {
        return `${pathWithRoot.replace(/\.md$/i, "")}/index.md`;
    }
    return `${pathWithRoot}/index.md`;
}

/**
 * 统一清理欢迎页输入路径中的斜杠和相对前缀。
 */
function normalizeWelcomeWorkspacePath(input: string | null): string {
    if (typeof input !== "string") {
        return "";
    }
    return input
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\/+/u, "")
        .replace(/^\/+/u, "")
        .replace(/\/+/g, "/");
}

/**
 * 生成普通 Markdown 初始内容。
 */
function buildWelcomeMarkdownContent(filePath: string): string {
    return `---\ntitle: ${JSON.stringify(resolveWelcomeTitle(filePath))}\nstatus: draft\n---\n\n`;
}

/**
 * 生成 Lorebook 初始内容。
 */
function buildWelcomeLorebookContent(filePath: string, entryType: WelcomeLorebookEntryType): string {
    const subtypeBlock = entryType === "character" ? "subtype: person\n" : "";
    const characterBlock = entryType === "character"
        ? `character:\n    logline: ""\n    profile: {}\n    story: {}\n    meta:\n        pinned: false\n        primaryContext: null\n`
        : "";
    return `---\ntitle: ${JSON.stringify(resolveWelcomeTitle(filePath))}\ntype: ${entryType}\n${subtypeBlock}status: draft\naliases: []\ntags: []\nsummary: ""\nrefs: []\nretrieval:\n    enabled: true\n    trigger: null\ngovernance:\n    source: manual\n    review: proposed\n${characterBlock}---\n\n`;
}

/**
 * 从 workspace 路径推导可读标题。
 */
function resolveWelcomeTitle(filePath: string): string {
    const normalizedPath = filePath.replace(/\/index\.md$/i, "").replace(/\.md$/i, "");
    const segments = normalizedPath.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment ?? "new-file";
}

onMounted(() => {
    void (async () => {
        if (!import.meta.client) {
            workspaceBootstrapped.value = true;
            return;
        }

        try {
            mountThemeHost(themeHostRef.value);
            window.addEventListener("pagehide", flushWorkspaceSession);
            window.addEventListener("beforeunload", flushWorkspaceSession);
            void syncAuthSession();
            await initializeWorkspaceFromRoute();
            await syncDefaultModelLabel();
            await consumeWorkspaceOpenPathFromRoute();
            if (!isUserAssetsWorkspace.value) {
                await normalizeNovelRouteQuery();
            }
            subscribeWorkspaceEvents();
            initialized.value = true;
        } finally {
            workspaceBootstrapped.value = true;
        }
    })();
});

watch(() => [route.query.project, route.query.openPath] as const, () => {
    if (!initialized.value) {
        return;
    }
    void syncWorkspaceRoute();
});

onBeforeUnmount(() => {
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
    if (import.meta.client) {
        window.removeEventListener("pagehide", flushWorkspaceSession);
        window.removeEventListener("beforeunload", flushWorkspaceSession);
    }
    novelIdeStore.persistWorkspaceSession();
});
</script>

<template>
    <!-- IDE 页面根容器 -->
    <div ref="themeHostRef" class="novel-ide-page ide-shell flex h-screen flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300">
        <NovelIdeHeader
            class="ide-panel ide-header"
            :right-panel-open="isAgentMode ? agentStudioPanelOpen : displayRightPanelOpen"
            :agent-mode-active="isAgentMode"
            :rp-mode-active="rpModeOpen"
            :novel-title="displayNovelTitle"
            :novel-items="displayNovelItems"
            :current-user="currentUser"
            :workspace-mode="isUserAssetsWorkspace ? 'user-assets' : 'novel'"
            @toggle-layout-mode="void toggleAgentLayoutMode()"
            @set-layout-mode="void setLayoutMode($event)"
            @toggle-agent="isAgentMode ? toggleAgentModeStudio() : rightPanelOpen = !rightPanelOpen"
            @open-bookshelf="bookshelfOpen = true"
            @open-plot-workbench="openPlotWorkbench"
            @open-world-engine="openWorldEngineWorkbench"
            @open-user-assets="openUserAssets"
            @open-profile-workbench="profileWorkbenchOpen = true"
            @open-trace-viewer="traceViewerOpen = true"
            @open-history-inbox="historyInboxOpen = true"
            @switch-novel="handleSwitchNovel"
            @open-admin="void openAdmin()"
            @logout="void logout()"
        />
        <WorldEngineWorkbenchDialog v-if="!isUserAssetsWorkspace" v-model="worldEngineWorkbenchOpen" :project-path="currentNovelId" :project-title="displayNovelTitle" @has-unsaved-drafts-change="worldEngineWorkbenchHasUnsavedDrafts = $event" @saving-change="worldEngineWorkbenchSaving = $event" @open-workspace-path="void openWelcomeWorkspacePath($event)" />

        <!-- RP 模式第三布局：占据头部下方整个内容区；Agent/IDE 布局用 v-show 保活 -->
        <RpModeSurface
            v-if="rpModeOpen && !isUserAssetsWorkspace"
            :active="rpModeOpen"
            :project-path="currentNovelId"
            :novel-id="displayNovelIdForAgent"
            :open-reference="openWorkspaceReference"
            class="min-h-0 flex-1"
        />

        <div v-show="!rpModeOpen" class="flex min-h-0 flex-1 overflow-hidden">
            <NovelIdeSidebar class="ide-sidebar" :active-tab="displaySidebarActiveTab" :agent-mode="isAgentMode" :user-assets-mode="isUserAssetsWorkspace" @toggle-tab="handleSidebarToggle" @collapse="activeLeftTab = null" @open-settings="settingsDialogOpen = true" />

            <AgentModeSessionSidebar
                :sessions="agentModeSessions"
                :active-session-id="agentModeActiveSessionId"
                :loading="agentModeLoadingSession"
                :running="agentModeRunning"
                :action-id="agentModeSessionActionId"
                :workspace-key="agentWorkspaceKey"
                :open="isAgentMode && agentSessionPanelOpen"
                :width="agentSessionPanelWidth"
                @update:width="agentSessionPanelWidth = $event"
                @select="void selectAgentModeSession($event)"
                @create="void createAgentModeSession()"
                @archive="void archiveAgentModeSession($event)"
                @rename="void renameAgentModeSession($event)"
                @refresh="void refreshAgentModeSessions()"
            />

            <div
                class="mode-transition-ide-tools flex h-full shrink-0 overflow-hidden transition-[width,opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    ideToolPanelOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none -translate-x-2 opacity-0',
                    layoutTransitionDirection ? 'transition-none' : '',
                ]"
                :style="ideToolPanelStyle"
            >
                <NovelIdeToolPanel v-model:width="leftPanelWidth" class="ide-panel h-full" :active-tab="displayActiveLeftTab" :user-assets-mode="isUserAssetsWorkspace" @close="activeLeftTab = null" @open-world-engine="openWorldEngineWorkbench" />
            </div>

            <!-- Studio 工作区 -->
            <main
                class="mode-transition-studio ide-editor-canvas relative flex min-w-0 flex-col overflow-hidden bg-[var(--editor-bg)] transition-[width,flex-basis,opacity,border-color,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    isAgentMode ? 'shrink order-3' : 'flex-1 order-2',
                    isAgentMode && agentStudioPanelOpen && layoutTransitionDirection !== 'to-agent' ? 'border-l border-[var(--border-color)] opacity-100' : '',
                    isAgentMode && !agentStudioPanelOpen ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection === 'to-agent' ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection ? 'transition-none' : '',
                    resizingAgentStudioPanel ? 'select-none transition-none' : '',
                ]"
                :style="agentStudioStyle"
            >
                <template v-if="isAgentMode && agentStudioPanelOpen">
                    <div ref="agentStudioResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                        <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentStudioPanel ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                    </div>
                </template>
                <div v-if="isAgentMode" class="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-3">
                    <div class="min-w-0">
                        <div class="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Studio</div>
                    </div>
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="agentStudioFileTreeOpen ? t('ide.shell.collapseFileTree') : t('ide.shell.expandFileTree')" @click="agentStudioFileTreeOpen = !agentStudioFileTreeOpen">
                        <span :class="agentStudioFileTreeOpen ? 'i-lucide-panel-right-close' : 'i-lucide-folder-tree'" class="h-4 w-4"></span>
                    </button>
                </div>

                <div class="flex min-h-0 flex-1 overflow-hidden">
                    <div class="contain-layout-paint flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" :class="resizingAgentStudioPanel || resizingAgentStudioFileTree ? 'pointer-events-none select-none' : ''">
                        <MarkdownStudioWorkbench
                            v-model:content="selectedFileContent"
                            :controller="studio"
                            :tabs="displayWorkspaceTabs"
                            :active-path="displayActiveWorkspaceTabPath"
                            :node="displaySelectedFileNode"
                            :editor-kind="displayCurrentEditorKind"
                            :workspace-view-mode="displayCurrentWorkspaceViewMode"
                            :theme="activeThemeId"
                            :compact="isAgentMode"
                            :agent-mode-active="isAgentMode"
                            :workspace-mode="isUserAssetsWorkspace ? 'user-assets' : 'novel'"
                            :editor-preferences="markdownEditorPreferences"
                            :monaco-preferences="monacoEditorPreferences"
                            :monaco-temporary-font-size="displayMonacoTemporaryFontSize"
                            :reference-refresh-key="workspaceReferenceRefreshKey"
                            :resolve-menu="resolveMarkdownMenu"
                            :open-reference="openWorkspaceReference"
                            :resolve-reference="resolveWorkspaceReferencePreview"
                            :inline-ai-references="inlinePromptReferences"
                            :inline-ai-highlight-reference="inlinePromptHoveredReference"
                            :enable-quick-triggers="true"
                            @select-tab="void selectWorkspaceTab($event)"
                            @close-tab="void closeEditorTab($event)"
                            @set-pin="setWorkspaceTabPinned"
                            @keep-tab="keepWorkspaceTab"
                            @move-tab="moveWorkspaceTab"
                            @set-view-mode="setCurrentWorkspaceViewMode"
                            @update-monaco-temporary-font-size="setMonacoFontSizeOverride(displayActiveWorkspaceTabPath, $event)"
                            @save-request="void saveCurrentWorkspaceFile()"
                            @open-frontmatter-profile="openFrontmatterProfile"
                            @open-path="void openWelcomeWorkspacePath($event)"
                            @open-files="openWelcomeFiles"
                            @create-chapter="void createWelcomeChapter()"
                            @create-markdown-file="void createWelcomeMarkdownFile()"
                            @create-lorebook-entry="void createWelcomeLorebookEntry()"
                            @open-agent-panel="void openWelcomeAgentPanel()"
                            @switch-agent-mode="void openWelcomeAgentMode()"
                            @toggle-agent-surface="toggleWelcomeAgentSurface"
                            @open-bookshelf="bookshelfOpen = true"
                            @open-user-assets="openUserAssets"
                            @open-profile-workbench="profileWorkbenchOpen = true"
                            @inline-ai-reference="addInlineAiReference"
                        />
                    </div>
                    <div
                        v-if="isAgentMode && agentStudioFileTreeOpen"
                        class="agent-mode-studio-file-tree relative h-full shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-panel)]"
                        :class="resizingAgentStudioPanel || resizingAgentStudioFileTree ? 'select-none transition-none' : ''"
                        :style="agentStudioFileTreeStyle"
                    >
                        <div ref="agentStudioFileTreeResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                            <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentStudioFileTree ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                        </div>
                        <div class="contain-layout-paint h-full">
                            <WorkspaceFilePanel />
                        </div>
                    </div>
                </div>

                <NovelPromptBar
                    v-if="!isAgentMode && inlinePromptAvailable"
                    class="ide-prompt-bar"
                    :model-value="inlinePromptInstruction"
                    :loading="inlinePromptBusy"
                    :running="inlinePromptRunning || inlinePromptAgentRunning"
                    :expanded="inlinePromptExpanded"
                    :task="inlinePromptTask"
                    :references="inlinePromptReferences"
                    :current-path="selectedFilePath"
                    :session-label="displayInlinePromptSessionLabel"
                    :sessions="inlinePromptSessions"
                    :active-session-id="inlinePromptSessionId"
                    :session-loading="inlinePromptSessionLoading"
                    :edit-preview="displayInlinePromptEditPreview"
                    :result-text="inlinePromptResultText"
                    :live-view="inlinePromptLiveView"
                    :selectable-models="inlinePromptSelectableModels"
                    :session-model-selection-value="inlinePromptSessionModelSelectionValue"
                    :session-model-draft="inlinePromptSessionModelDraft"
                    :session-model-saving="inlinePromptSessionModelSaving"
                    :session-model-popover-open="inlinePromptSessionModelPopoverOpen"
                    :session-thinking-resolved-label="inlinePromptSessionThinkingResolvedLabel"
                    @update:model-value="inlinePromptInstruction = $event"
                    @update:expanded="inlinePromptExpanded = $event"
                    @update:task="inlinePromptTask = $event"
                    @clear-reference="clearInlineAiReference"
                    @hover-reference="inlinePromptHoveredReference = $event"
                    @select-session="void selectInlineEditorSession($event)"
                    @create-session="void createInlineEditorSession()"
                    @open-session-chat="void openInlineEditorSessionChat()"
                    @update-session-model-selection="void agentSurfaceRef?.updateInlineSessionModelSelection?.($event)"
                    @update:session-model-draft="updateInlineSessionModelDraft"
                    @update:session-model-popover-open="updateInlineSessionModelPopoverOpen"
                    @toggle-session-model-popover="agentSurfaceRef?.toggleInlineSessionModelPopover?.()"
                    @apply-session-model-settings="void agentSurfaceRef?.applyInlineSessionModelSettings?.()"
                    @reset-session-model-settings="void agentSurfaceRef?.resetInlineSessionModelSettings?.()"
                    @send="void sendInlineEditorPrompt()"
                    @stop="void stopInlineEditorPrompt()"
                />
            </main>

            <!-- Agent Chat Surface 槽位 -->
            <section
                class="mode-transition-agent relative z-30 flex h-full min-h-0 shrink-0 flex-col bg-[var(--bg-panel)] transition-[width,flex,opacity,border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                :class="[
                    isAgentMode ? 'order-2 min-w-[340px] flex-[1.2] border-x border-[var(--border-color)] opacity-100' : 'order-3 shadow-2xl',
                    !isAgentMode && displayRightPanelOpen ? 'border-l border-[var(--border-color)] opacity-100' : '',
                    !isAgentMode && !displayRightPanelOpen ? 'pointer-events-none border-l-0 opacity-0' : '',
                    layoutTransitionDirection ? 'transition-none' : '',
                    resizingAgentPanel ? 'select-none transition-none' : '',
                ]"
                :style="agentSlotStyle"
            >
                <template v-if="!isAgentMode && displayRightPanelOpen">
                    <div ref="agentResizeHandleRef" class="group absolute -left-1 top-0 z-30 h-full w-2 cursor-col-resize">
                        <div class="ml-1 h-full w-[2px] bg-[var(--accent-main)] opacity-0 transition-all duration-150 group-hover:opacity-100" :class="resizingAgentPanel ? 'opacity-100 shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-main)_28%,transparent)]' : ''"></div>
                    </div>
                </template>
                <AgentChatSurface
                    ref="agentSurfaceRef"
                    class="contain-layout-paint min-h-0 flex-1"
                    :active="agentSurfaceActive"
                    :layout="isAgentMode ? 'workbench' : 'drawer'"
                    :novel-id="displayNovelIdForAgent"
                    :history-inbox-refresh-key="historyInboxRefreshKey"
                    :selected-file-path="selectedFilePath"
                    :open-reference="openWorkspaceReference"
                    @close="closeAgentSurface"
                    @sync-workspace="void handleAgentWorkspaceUpdated($event)"
                    @open-reference="void openWorkspaceReference($event)"
                    @open-history-inbox="historyInboxOpen = true"
                />
            </section>
        </div>

        <NovelBookshelfDialog v-model="bookshelfOpen" :before-workspace-switch="confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch" @switched="void router.replace(buildProjectRoute($event))" />
        <NovelIdeSettingsDialog v-model="settingsDialogOpen" />
        <AgentTraceViewerDialog v-model="traceViewerOpen" @open-session="void openTraceSession($event)" />
        <WorkspaceHistoryInboxDialog v-model="historyInboxOpen" :project-path="isUserAssetsWorkspace ? null : currentNovelId" :theme="activeThemeId" />
        <UserProfileWorkbenchDialog v-model="profileWorkbenchOpen" />
        <WorkspaceFileConflictDialog
            v-model="novelIdeStore.workspaceConflictDialogOpen"
            :conflict="novelIdeStore.workspaceWriteConflict"
            :theme="activeThemeId"
            @resolve="void resolveWorkspaceWriteConflict($event)"
        />
        <WorkspaceCharacterDetailPanel
            v-model="characterProfileVisible"
            dialog-only
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="0"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceLocationProfileDialog
            v-model="locationProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceRuleProfileDialog
            v-model="ruleProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
    </div>
</template>

<style scoped>
.novel-ide-page {
    --ide-header-height: 48px;
    --ide-toolbar-height: 48px;
    --editor-min-height: calc(100vh - var(--ide-header-height) - var(--ide-toolbar-height));
}

.plain-text-editor {
    caret-color: var(--accent-main);
}

:global(.contain-layout-paint) {
    contain: layout paint;
}

:global(.ide-agent-mode-switch) {
    view-transition-name: ide-agent-mode-switch;
}

:global(.mode-transition-agent) {
    view-transition-name: ide-agent-surface;
}

:global(.mode-transition-studio) {
    view-transition-name: ide-studio-surface;
}

:global(.mode-transition-ide-tools) {
    view-transition-name: ide-tools-panel;
}

:global(.agent-mode-session-sidebar) {
    view-transition-name: agent-session-panel;
}

:global(::view-transition-old(root)),
:global(::view-transition-new(root)),
:global(::view-transition-old(ide-agent-mode-switch)),
:global(::view-transition-new(ide-agent-mode-switch)),
:global(::view-transition-old(ide-agent-surface)),
:global(::view-transition-new(ide-agent-surface)),
:global(::view-transition-old(ide-studio-surface)),
:global(::view-transition-new(ide-studio-surface)),
:global(::view-transition-old(ide-tools-panel)),
:global(::view-transition-new(ide-tools-panel)),
:global(::view-transition-old(agent-session-panel)),
:global(::view-transition-new(agent-session-panel)) {
    animation-duration: 300ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
