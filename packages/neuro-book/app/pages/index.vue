<script setup lang="ts">
import {DragDropProvider} from "@dnd-kit/vue";
import {storeToRefs} from "pinia";
import type {AuthSessionDto} from "nbook/shared/dto/auth.dto";
import type {ConfigBootstrapDto} from "nbook/shared/dto/config.dto";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import EditorViewHost from "nbook/app/components/editor-workbench/EditorViewHost.vue";
import EditorWelcome from "nbook/app/components/editor-workbench/EditorWelcome.vue";
import {useEditorWorkbench} from "nbook/app/composables/useEditorWorkbench";
import type {EditorGroupState} from "nbook/app/components/editor-workbench/editor-view.types";
import AgentChatSurface from "nbook/app/components/novel-ide/agent/AgentChatSurface.vue";
import AgentTraceViewerDialog from "nbook/app/components/novel-ide/agent/trace-viewer/AgentTraceViewerDialog.vue";import WorkspaceHistoryInboxDialog from "nbook/app/components/novel-ide/history/WorkspaceHistoryInboxDialog.vue";import AgentModeSessionSidebar from "nbook/app/components/novel-ide/agent/AgentModeSessionSidebar.vue";
import NovelIdeActivityBar from "nbook/app/components/novel-ide/NovelIdeActivityBar.vue";
import NovelIdeProfileDialog from "nbook/app/components/novel-ide/NovelIdeProfileDialog.vue";
import NovelIdeSettingsDialog from "nbook/app/components/novel-ide/NovelIdeSettingsDialog.vue";
import WorldEngineWorkbenchDialog from "nbook/app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue";
import NovelPromptBar from "nbook/app/components/novel-ide/NovelPromptBar.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import ProjectPickerScreen from "nbook/app/components/novel-ide/ProjectPickerScreen.vue";
import DesktopTitleBar from "nbook/app/components/common/DesktopTitleBar.vue";
import WorkbenchShell from "nbook/app/components/workbench/WorkbenchShell.vue";
import WorkbenchContainerInstances from "nbook/app/components/workbench/WorkbenchContainerInstances.vue";
import WorkbenchPartHost from "nbook/app/components/workbench/WorkbenchPartHost.vue";
import WorkbenchDropOverlay from "nbook/app/components/workbench/WorkbenchDropOverlay.vue";
import WorkbenchDragOverlay from "nbook/app/components/workbench/WorkbenchDragOverlay.vue";
import WorkbenchViewInstances from "nbook/app/components/workbench/WorkbenchViewInstances.vue";
import WorkbenchStatusBar from "nbook/app/components/workbench/WorkbenchStatusBar.vue";
import WorkbenchStatusBarItem from "nbook/app/components/workbench/WorkbenchStatusBarItem.vue";
import {useWorkbenchDrop} from "nbook/app/composables/useWorkbenchDrop";
import {
    productWorkbenchRegistry,
    resolveViewPresentation,
    SHELL_FILES_VIEW,
    type ContainerViewPresentation,
    type PartContainerPresentation,
    type WorkbenchViewPresentation,
} from "nbook/app/utils/workbench/product-catalog";
import {
    useWorkbenchViewPlacements,
    type ViewPlacementsOutcome,
    type ViewSizesInput,
} from "nbook/app/utils/workbench/view-placements-session";
import {
    clientToolPanels,
    clientToolViewIdOf,
    resolveActiveToolView,
    sameToolFocus,
    type WorkbenchToolViewFocus,
} from "nbook/app/utils/workbench/tool-context";
import {
    registerWorkbenchToolRevealPort,
    type WorkbenchToolRevealPort,
} from "nbook/app/utils/workbench/tool-reveal-port";
import {useEditorSessionStorage} from "nbook/app/utils/editor-workbench/editor-session-storage";
import type {ShellDragCollapseMap} from "nbook/app/utils/workbench/layout";
import type {WorkbenchLayoutSurface} from "nbook/app/utils/workbench/layout-session";
import type {WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import type {WorkbenchPanelPreferences} from "nbook/app/utils/workbench/panel-state";
import {
    isToolPartId,
    toolPartOfLocation,
    TOOL_PART_IDS,
    type ContainerMoveRequest,
    type ToolPartId,
    type ToolPartLocation,
    type ViewMoveRequest,
} from "nbook/app/utils/workbench/view-placements";
import {provideWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";
import {useWorkbenchViewActions} from "nbook/app/composables/useWorkbenchViewActions";
import type {CommandResult, Release} from "nbook/app/utils/workbench/commands";
import {
    executePanelActionItem,
    registerViewTitleCommands,
    registerWorkbenchShellCommands,
    resolvePanelTitleActions,
    SHELL_CONTAINER_COMMAND_IDS,
    SHELL_FILES_REFRESH_COMMAND,
    type WorkbenchShellCommandPort,
} from "nbook/app/utils/workbench/workbench-shell-commands";
import type {WorkbenchTitleActionEvent, WorkbenchTitleActionItems} from "nbook/app/utils/workbench/view-title-actions";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";
import UserProfileWorkbenchDialog from "nbook/app/components/profile-template-editor/UserProfileWorkbenchDialog.vue";
import WorkspaceCharacterDetailPanel from "nbook/app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue";
import WorkspaceFileConflictDialog from "nbook/app/components/novel-ide/workspace/WorkspaceFileConflictDialog.vue";
import WorkspaceLocationProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceLocationProfileDialog.vue";
import WorkspaceRuleProfileDialog from "nbook/app/components/novel-ide/workspace/WorkspaceRuleProfileDialog.vue";
import type {WorkspaceReferencePreviewMeta} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {ensureThemeHost} from "nbook/app/utils/theme/host";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import {useAuthSessionState} from "nbook/app/composables/useAuthSessionState";
import {useWorkspaceFileEvents} from "nbook/app/composables/useWorkspaceFileEvents";
import {isProjectSessionSupersededError, useProjectSession} from "nbook/app/composables/useProjectSession";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useDialog} from "nbook/app/composables/useDialog";
import {getWorkspaceLorebookTypeMeta} from "nbook/app/components/novel-ide/workspace/workspace-entry-meta";
import {useNotification} from "nbook/app/composables/useNotification";
import {useInlineEditorAgentController} from "nbook/app/composables/useInlineEditorAgentController";
import {useWorkbenchChromeRegistration} from "nbook/app/composables/useWorkbenchChrome";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState, MarkdownCommandKind} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {useNovelIdeStore, type WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFileChangeEventDto, WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import type {AgentSessionSummaryDto, AgentSkillCatalogItemDto} from "nbook/shared/dto/agent-session.dto";
import {agentSessionScopeKey} from "nbook/app/utils/agent-session-scope-key";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    projectRouteProgressView,
    reduceProjectRouteProgress,
    type ProjectRouteProgress,
    type ProjectRouteProgressPhase,
} from "nbook/app/utils/project-route-progress";
import {
    collectWorkspaceReferencePathCandidates,
} from "nbook/app/utils/workspace-reference-search";
import {buildWorkspaceReferenceSections} from "nbook/app/utils/workspace-reference-menu";
import {canEditContentFrontmatter, resolveWorkspaceFileExtension, type FrontmatterProfileKind} from "nbook/shared/editor-workbench";
import {buildSelectionRefChip, type InlineEditPayload, type InlineEditReference, type InlineEditTask} from "nbook/app/utils/inline-editor-selection";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import {dispatchDesktopMenuCommand} from "@notnotype/neuro-book-contracts/desktop";
import {resolveTitleBarEditRoute, type TitleBarEditCommand} from "nbook/app/utils/workbench-chrome";
import {useTitleBarEditTarget} from "nbook/app/composables/useTitleBarEditTarget";

type SameDocumentViewTransition = {
    ready: Promise<void>;
};

type SameDocumentViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void | Promise<void>) => SameDocumentViewTransition;
};

type LayoutModeTransitionDirection = "to-agent" | "to-ide";

const WELCOME_LOREBOOK_ENTRY_TYPES = ["location", "character", "item", "rule", "note"] as const;

type WelcomeLorebookEntryType = typeof WELCOME_LOREBOOK_ENTRY_TYPES[number];

// TEMP-MODULE-MARKER
console.info("[PAGE-MODULE] fresh-build-marker-1");

const initialized = ref(false);
const themeHostRef = ref<HTMLElement | null>(null);
const currentUser = ref<AuthSessionDto["user"]>(null);
const accountProfileOpen = ref(false);
const settingsDialogOpen = ref(false);
const traceViewerOpen = ref(false);
const historyInboxOpen = ref(false);
const agentPanelOpen = ref(false);
const historyInboxRefreshKey = ref(0);
const worldEngineWorkbenchOpen = ref(false);
const worldEngineWorkbenchHasUnsavedDrafts = ref(false);
const worldEngineWorkbenchSaving = ref(false);
const profileWorkbenchOpen = ref(false);
const frontmatterProfileKind = ref<FrontmatterProfileKind | null>(null);
const agentStudioFileTreeOpen = ref(false);
const workspaceEventAbortController = ref<AbortController | null>(null);
const agentStudioResizeHandleRef = ref<HTMLElement | null>(null);
const agentStudioFileTreeResizeHandleRef = ref<HTMLElement | null>(null);
const layoutTransitionDirection = ref<LayoutModeTransitionDirection | null>(null);
const markdownSkillCatalog = ref<AgentSkillCatalogItemDto[]>([]);
const markdownSkillCatalogLoaded = ref(false);
const markdownSkillCatalogLoading = ref(false);
let markdownSkillCatalogRequest: Promise<void> | null = null;
let workspaceFileSyncRunning = false;
let pendingWorkspaceFileEvents: WorkspaceFileChangeEventDto[] = [];
let workspaceEventRevision = 0;
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
    activeWorkspaceTabPath,
    currentProjectRoot,
    currentNovel,
    hasUnsavedWorkspaceChanges,
    lastSyncedFileContent,
    loadingWorkspace,
    restoringWorkspaceFile,
    layoutMode,
    agentSessionPanelOpen,
    agentSessionPanelWidth,
    agentStudioFileTreeWidth,
    agentStudioPanelWidth,
    novels,
    savingFile,
    selectedFileContent,
    selectedFileNode,
    selectedFilePath,
    markdownEditorPreferences,
    monacoEditorPreferences,
    monacoFontSizeOverridesByPath,
    workspaceReady,
    workspaceIssues,
    workspaceTabs,
    workspaceTree,
    workspaceKind,
    isUserAssetsWorkspace,
    plotWorkbenchOpen,
} = storeToRefs(novelIdeStore);
const {
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
    resolveWorkspaceWriteConflict,
    syncWorkspaceFromDisk,
    switchToNovelWorkspace,
    closeProjectWorkspace,
    switchToUserAssetsWorkspace,
    loadProjects,
} = novelIdeStore;
const theme = useProductTheme();
const workspaceFileEvents = useWorkspaceFileEvents();
// Current Project 只有在 open + presence_ready 后才提交；URL 在此之前只是打开意图。
const projectSession = useProjectSession();
const projectSwitching = ref(false);
const projectRouteProgress = ref<ProjectRouteProgress | null>(null);
let projectRouteIntentRevision = 0;
let processedProjectRouteRevision = 0;
let projectRouteSyncPromise: Promise<void> | null = null;
let terminalProjectFailurePromise: Promise<void> | null = null;
const workspaceBootstrapped = ref(false);
/** Project 数据面只在 Studio user-assets 或 exact ready Project 已提交时挂载。 */
const projectSurfaceActive = computed(() => workspaceBootstrapped.value && (
    !projectSwitching.value && (isUserAssetsWorkspace.value
    || Boolean(
        projectSession.state.value.status === "ready"
        && currentProjectRoot.value
        && projectSession.state.value.ready.projectRoot === currentProjectRoot.value,
    ))
));
const agentProjectReadyRevision = computed(() => projectSession.state.value.status === "ready"
    ? projectSession.state.value.ready.revision
    : null);
/**
 * 工作台布局的工作面：布局记录归属由它决定，外壳据此进入 / 切换 Storage 会话。
 *
 * 与 `projectSurfaceActive` 同源（exact ready Project / 用户资产 / 未开项目），但**不**受 `projectSwitching`
 * 与 `workspaceBootstrapped` 影响：过渡期仍属于上一个工作面，切换收口由会话负责（旧目标意图先提交、再释放）。
 */
const workbenchLayoutSurface = computed<WorkbenchLayoutSurface>(() => {
    if (isUserAssetsWorkspace.value) {
        return {kind: "user-assets"};
    }
    const state = projectSession.state.value;
    if (state.status !== "ready" || !currentProjectRoot.value || state.ready.projectRoot !== currentProjectRoot.value) {
        return {kind: "idle"};
    }
    return {kind: "project", ready: {projectRoot: state.ready.projectRoot, publicId: state.ready.publicId, revision: state.ready.revision}};
});
watch(projectSurfaceActive, (active) => {
    if (!active) agentPanelOpen.value = false;
});
// Task 129：未选择 Project 时渲染项目选择界面。状态完全派生自 store，删除最后一本书 / URL 指向不存在的
// Project / 裸 `/` 三条路径自动收敛到同一状态，不额外维护一份开关。
const projectPickerActive = computed(() => workspaceBootstrapped.value
    && !isUserAssetsWorkspace.value
    && !currentProjectRoot.value
    && (projectSession.state.value.status === "idle" || projectSession.state.value.status === "failed"));
const projectTransitionActive = computed(() => projectSwitching.value
    || projectSession.state.value.status === "opening"
    || projectSession.state.value.status === "reconnecting");
const authSessionState = useAuthSessionState();
const agentSurfaceRef = ref<InstanceType<typeof AgentChatSurface> | null>(null);
type InlinePromptOwner = Readonly<{
    revision: number;
    operationKey: string;
    surface: NonNullable<typeof agentSurfaceRef.value>;
}>;
let inlinePromptRequestRevision = 0;

/** 捕获 Prompt Bar 调用时的 Surface 实例与独立 Inline Project generation。 */
function captureInlinePromptOwner(): InlinePromptOwner | null {
    const surface = agentSurfaceRef.value;
    const operationKey = unref(surface?.inlineOperationScopeKey);
    if (!surface || typeof operationKey !== "string") return null;
    return {revision: ++inlinePromptRequestRevision, operationKey, surface};
}

/** 页面副作用只能由当前 Prompt 请求和当前 Project generation 发布。 */
function acceptsInlinePromptOwner(owner: InlinePromptOwner): boolean {
    return owner.revision === inlinePromptRequestRevision
        && agentSurfaceRef.value === owner.surface
        && unref(owner.surface.inlineOperationScopeKey) === owner.operationKey;
}


const {alert, choose, chooseCards, prompt} = useDialog();
const notification = useNotification();
const {t} = useI18n();
/**
 * 主页的编辑器分组：由编排层逐组呈现（组 id 与布局树上的叶 id 同源），页面只叠加
 * 首帧就绪门禁（未完成 workspace 引导前不显示标签与诊断，避免闪一下旧内容）。
 */
const editorGroups = computed<EditorGroupState[]>(() => editorWorkbench.groups.value.map((group) => ({
    id: group.id,
    tabs: workspaceDisplayReady.value ? [...group.tabs] : [],
    activePath: workspaceDisplayReady.value ? group.activePath : "",
    menus: group.menus,
    // 视图贡献的动作词汇（EditorAction）与工具条动作（EditorToolbarAction）不是同一套：这里只做字段映射。
    toolbarActions: group.actions.map((action) => ({
        id: action.id,
        label: action.label,
        iconClass: action.iconClass ?? "i-lucide-zap",
        disabled: action.disabled,
        active: action.checked,
    })),
    busy: !workspaceDisplayReady.value || group.busy,
    diagnosis: group.diagnosis,
})));
/** 逐组拿编排层的正式呈现（document/editorId/actions 不在 EditorGroupState 里）。 */
function groupPresentation(groupId: string) {
    return editorWorkbench.groups.value.find((group) => group.id === groupId) ?? null;
}

/** 状态栏事实：全部来自真实状态，没有假终端 / 假 Git / 假行列号。 */
const statusBarSaveState = computed<{label: string; variant: "default" | "warning" | "info"}>(() => {
    if (savingFile.value) {
        return {label: t("editorWorkbench.saving"), variant: "info"};
    }
    if (novelIdeStore.hasUnsavedFileChanges) {
        return {label: t("editorWorkbench.unsaved"), variant: "warning"};
    }
    return {label: selectedFileNode.value?.editable ? t("editorWorkbench.saved") : t("ide.workbench.noDocument"), variant: "default"};
});
const statusBarEditorLabel = computed(() => editorWorkbench.editorLabelOf(editorWorkbench.activeGroupId.value) ?? t("ide.workbench.noDocument"));
const statusBarGroupCount = computed(() => editorWorkbench.groupIds.value.length);
const statusBarGroupIndex = computed(() => Math.max(1, editorWorkbench.groupIds.value.indexOf(editorWorkbench.activeGroupId.value) + 1));
const statusBarVisibleViews = computed(() => viewPresentation.value?.entries.filter((entry) => entry.visible).length ?? 0);
const statusBarContainers = computed(() => workbenchRegistryResult.value.ok ? workbenchRegistryResult.value.value.containers().length : 0);

const editorWorkbench = useEditorWorkbench({
    bindings: {
        code: {
            preferences: () => monacoEditorPreferences.value,
            temporaryFontSize: (path) => monacoFontSizeOverridesByPath.value[path] ?? null,
            setTemporaryFontSize: (target, size) => {
                if (target.generation === novelIdeStore.workspaceGeneration) setMonacoFontSizeOverride(target.path, size);
            },
        },
        markdown: {
            preferences: () => markdownEditorPreferences.value,
            canEditFrontmatter: (target) => canEditContentFrontmatter(target.path, selectedFileNode.value?.editable ?? false, selectedFileNode.value?.contentNode ?? false),
            referenceRefreshKey: () => workspaceReferenceRefreshKey.value,
            resolveMenu: resolveMarkdownMenu,
            openReference: (target) => {void openWorkspaceReference(target);},
            resolveReference: resolveWorkspaceReferencePreview,
            inlineAiReferences: () => inlinePromptReferences.value,
            inlineAiHighlightReference: () => inlinePromptHoveredReference.value,
            enableQuickTriggers: () => true,
            openFrontmatterProfile,
            addInlineAiReference,
        },
    },
    chooseClose: (title) => choose(t("editorWorkbench.closeMessage", {title}), [
        {label: t("editorWorkbench.saveAndClose"), value: "save", tone: "primary"},
        {label: t("editorWorkbench.discard"), value: "discard", tone: "danger"},
        {label: t("editorWorkbench.cancel"), value: "cancel"},
    ], t("editorWorkbench.closeTitle")),
});
const inlineEditorAgent = useInlineEditorAgentController({
    active: projectSurfaceActive,
    projectReadyRevision: agentProjectReadyRevision,
    selectedFilePath,
});
const desktopBridge = computed(() => import.meta.client ? window.neuroBookDesktop : undefined);
/**
 * 视图宿主的上下文事实：谁持有事实谁填，descriptor 层不 import store。
 *
 * `project` 与 `workbenchLayoutSurface` 同源（不受 `projectSwitching` 影响）：切换过渡期仍按上一个
 * 工作面呈现，避免左叶在切项目时空一下。`session` / `job` 的 authority 目前没有页面级投影，
 * 按不可用上报——没有视图声明它们，将来声明时必须接真实事实（失败方向安全）。
 */
const workbenchViewContext = computed<WorkbenchContext>(() => {
    const surface = workbenchLayoutSurface.value;
    const project = surface.kind === "project";
    return {
        project,
        selection: Boolean(selectedFileNode.value),
        "user-assets": isUserAssetsWorkspace.value,
        desktop: Boolean(desktopBridge.value),
        authorities: {
            project,
            files: novelIdeStore.canAccessWorkspace,
            session: false,
            job: false,
        },
        projectRoot: surface.kind === "project" ? surface.ready.projectRoot : null,
    };
});

/**
 * 工具 View 的位置会话（`workbench.views/customizations`，user/local）：跨 Project 的界面定制。
 *
 * 呈现与记录分离：`placements.record` 是本窗口呈现据以建立的底本（**不跟随外来订阅刷新**），
 * 三个容器的切片都从这一份统一求值里取，不各自解释位置。
 */
const viewPlacements = useWorkbenchViewPlacements({context: () => workbenchViewContext.value});
/**
 * 编辑会话的存储会话（`workbench.editor/session` 与 `user-assets-session`）：分组拓扑 + 逐组标签
 * 一条记录原子落盘，恢复顺序与冲突出口都在这一层。工作面标识变化时自动重读并重订阅。
 */
const editorSessionStorage = useEditorSessionStorage({surface: workbenchLayoutSurface});
const workbenchRegistryResult = computed(() => productWorkbenchRegistry());

/** Part 标题：容器移动菜单里的落点文案（i18n 归页面，`resolveViewPresentation` 不发明 key）。 */
const PART_TITLE_KEYS: Record<ToolPartId, string> = {
    left: "ide.workbench.part.left",
    right: "ide.workbench.part.right",
    panel: "ide.workbench.part.panel",
};

/**
 * 统一呈现求值：容器落位、View 位置、可见性、动作可用性与活动容器都从这一份取。
 *
 * 记录、覆盖与活动容器都来自唯一的位置会话（`workbench.views/customizations` 的唯一写者）。
 */
const viewPresentation = computed<WorkbenchViewPresentation | null>(() => {
    const registry = workbenchRegistryResult.value;
    if (!registry.ok) {
        return null;
    }
    const record = viewPlacements.record.value;
    return resolveViewPresentation({
        registry: registry.value,
        context: workbenchViewContext.value,
        overrides: record.placements,
        customContainers: record.customContainers,
        viewSizes: record.viewSizes,
        containerOverrides: record.containerPlacements,
        suppressedContainers: record.suppressedContainers,
        activeContainerByPart: record.activeContainerByPart,
        titleOf: (descriptor) => t(descriptor.titleKey),
        partTitleOf: (partId) => t(PART_TITLE_KEYS[partId]),
    });
});

/** 注册表不可用时的诊断：Part 宿主照画，把原因显示出来，不静默空白。 */
const viewPresentationProblem = computed<readonly string[]>(() => {
    const registry = workbenchRegistryResult.value;
    if (!registry.ok) {
        return [`产品 Workbench 声明不可用：${registry.reason}`];
    }
    return viewPresentation.value?.issues ?? [];
});

/** 某个 Part 的容器切片；注册表不可用时返回只有诊断的空切片（宿主不自己解析记录）。 */
function partPresentation(partId: ToolPartId): PartContainerPresentation {
    return viewPresentation.value?.part(partId) ?? {partId, containers: [], activeContainerId: null, problems: [...viewPresentationProblem.value]};
}

/** 容器实例层要的是**全部常驻**容器的切片（被抑制的也在，停在它自己的 parking）。 */
const containerSlices = computed<readonly ContainerViewPresentation[]>(() => viewPresentation.value?.residentContainers ?? []);

/** 主侧栏当前的容器清单：活动栏上半只列它们（标题与图标已解析）。 */
const activityContainers = computed(() => partPresentation("left").containers.map((container) => ({
    containerId: container.containerId,
    title: container.title,
    icon: container.icon,
    location: container.location,
    partId: container.partId,
    viewIds: container.memberViewIds,
    canMoveContainer: container.canMoveContainer,
})));

/** 一次位置命令的回执 → 用户可见诊断：`saved` / `unchanged` 不打扰，`pending` 与 `rejected` 都要说。 */
function reportPlacementOutcome(outcome: ViewPlacementsOutcome, titleKey: string): void {
    if (outcome.status === "rejected" || outcome.status === "pending") {
        notification.warning(outcome.diagnosis, {title: t(titleKey)});
    }
}

/** 移动一个工具 View：来源与锚点原样交给唯一写者，命令边界会重新校验（陈旧来源会被拒）。 */
async function handleMoveView(request: ViewMoveRequest): Promise<void> {
    reportPlacementOutcome(await viewPlacements.moveView(request), "ide.workbench.view.moveRejected");
}

/** 移动一个容器：整体换落位，视图归属与顺序不变。 */
async function handleMoveContainer(request: ContainerMoveRequest): Promise<void> {
    reportPlacementOutcome(await viewPlacements.moveContainer(request), "ide.workbench.container.moveRejected");
}

/**
 * 选择一个 Part 的活动容器（活动栏 / 标签 / 落点三条入口共用）。
 *
 * 重复点当前项**保持选择**并显式打开该 Part：`select-container` 意图在同一次合成里清掉
 * 显式隐藏与拖收起，页面不切换成 null 来表达「当前项」。
 */
async function handleSelectContainer(partId: ToolPartId, containerId: string): Promise<void> {
    reportPlacementOutcome(await viewPlacements.selectContainer(partId, containerId), "ide.workbench.container.selectRejected");
}

/** 活动栏回传容器 id → 它此刻生效的 Part（容器可能已被搬到别的落位）。 */
function handleOpenContainer(containerId: string): void {
    const partId = containerPart(containerId) ?? "left";
    void handleSelectContainer(partId, containerId);
}

/** 某个容器此刻生效的 Part；未登记 / 不可落位返回 `null`。 */
function containerPart(containerId: string): ToolPartId | null {
    return viewPresentation.value?.container(containerId)?.partId ?? null;
}

/** 一场 View 尺寸手势：整批交给唯一写者（批内失败整批不落账），来源容器与上下文由会话复验。 */
async function handleViewSizes(payload: ViewSizesInput): Promise<void> {
    reportPlacementOutcome(await viewPlacements.setViewSizes(payload), "ide.workbench.view.sizeRejected");
}

/**
 * 外壳拖到零的变化：一次手势可能同时收起多个 Part，逐个写进同一条定制记录（同一个写者、串行队列）。
 * 拉回 / 选容器 / 揭示视图都会把这位置回 false，所以这里只写「本场真正改变的位」。
 */
async function handleDragCollapse(payload: {contextKey: string; parts: ShellDragCollapseMap}): Promise<void> {
    for (const [partId, collapsed] of Object.entries(payload.parts)) {
        if (!isToolPartId(partId) || collapsed === undefined) {
            continue;
        }
        const outcome = await viewPlacements.setPartVisibility({partId, dragCollapsed: collapsed});
        reportPlacementOutcome(outcome, "ide.workbench.container.visibilityRejected");
    }
}

/** 拖到零的偏好位（外壳据此把相应叶的内容压到 0px，保留 1px 恢复边界）。 */
const dragCollapsedParts = computed(() => viewPlacements.record.value.dragCollapsedParts ?? {});
/** 面板状态（user 级定制）：位置 / 对齐 / 隐藏 / 收起走同一条记录、同一个写者。 */
const panelPreferences = computed(() => viewPlacements.panelState.value);
/** 瞬时最大化只在页面内存：换位置/对齐/隐藏/收起或进入紧凑呈现时由外壳回传清除。 */
const panelMaximized = ref(false);
async function handlePanelState(patch: Partial<WorkbenchPanelPreferences>): Promise<void> {
    const outcome = await viewPlacements.setPanelState(patch);
    if (outcome.status === "rejected") {
        notification.warning(outcome.diagnosis, {title: t("ide.workbench.panel.stateRejected")});
    }
}
/** 状态栏的面板显隐：隐藏是零占用；再点一次同时清 hidden 与 collapsed，按原尺寸恢复。 */
async function togglePanelVisibility(): Promise<void> {
    if (panelPreferences.value.hidden) {
        await handlePanelState({hidden: false, collapsed: false});
        return;
    }
    await handlePanelState({hidden: true});
}

/**
 * 工具视图焦点（Agent 客户端上下文的工具上下文来源，**非持久**）。
 *
 * 它只按**真实可见**的事实发布：某个 Part 的活动容器里第一个可见、且已登记到客户端上下文的 View。
 * 书架遮罩、显式隐藏与拖收起的 Part 内容根本不在屏幕上，因此不算可见；真实可见性一变就重发，
 * 没有真实工具时是 `null`——不拿旧页签词表谎报 characters/plot（映射见 `tool-context.ts`）。
 */
const unavailableToolParts = computed<readonly ToolPartId[]>(() => {
    const parts = new Set<ToolPartId>();
    if (projectPickerActive.value) {
        parts.add("left");
        parts.add("right");
    }
    if (panelPreferences.value.hidden || panelPreferences.value.collapsed) {
        // 显式隐藏与菜单 32px 收起都只剩（或没有）标签头，容器内容不在屏幕上。
        parts.add("panel");
    }
    for (const partId of TOOL_PART_IDS) {
        if (dragCollapsedParts.value[partId] === true) {
            parts.add(partId);
        }
    }
    return [...parts];
});
const resolvedToolView = computed<WorkbenchToolViewFocus>(() => resolveActiveToolView({
    presentation: viewPresentation.value,
    unavailableParts: unavailableToolParts.value,
}));
/**
 * Agent 清了焦点（`ide.activePanel = null`）之后，要等真实可见焦点**变了**才重新发布：
 * 记住被清掉的焦点，派生出同一条事实时保持为空，"清空"才不是一句空话（也不隐藏任何 Part）。
 */
const clearedToolView = ref<WorkbenchToolViewFocus>(null);
function publishToolView(): void {
    const resolved = resolvedToolView.value;
    const next: WorkbenchToolViewFocus = resolved !== null && sameToolFocus(clearedToolView.value, resolved) ? null : resolved;
    if (sameToolFocus(next, novelIdeStore.activeToolView)) {
        return;
    }
    novelIdeStore.activeToolView = next;
}
watch(resolvedToolView, (next) => {
    if (!sameToolFocus(next, clearedToolView.value)) {
        clearedToolView.value = null;
    }
    publishToolView();
}, {immediate: true});
/**
 * 切工作面（换 Project / 进出用户资产）：上一个工作面的焦点与"被清空"的抑制都不属于新工作面，
 * 先松开抑制并按新呈现重发；同一份真实事实不会因为切了工作面就变成 null。
 */
const workbenchSurfaceKey = computed(() => {
    const surface = workbenchLayoutSurface.value;
    return surface.kind === "project" ? `project:${surface.ready.projectRoot}` : surface.kind;
});
watch(workbenchSurfaceKey, () => {
    clearedToolView.value = null;
    publishToolView();
});

/**
 * 揭示完成后重发工具焦点：松开"被清空"的抑制，并按新的真实可见性发布一次
 * （揭示可能没有改变派生事实——例如工具本来就可见——所以不能只等派生变化）。
 */
function republishToolViewAfterReveal(outcome: ViewPlacementsOutcome): void {
    if (outcome.status === "rejected") {
        return;
    }
    clearedToolView.value = null;
    publishToolView();
}

/**
 * 揭示一个 View（欢迎页与 Agent 的 `ide.activePanel` 共用）：走唯一 `reveal-view` 命令
 * （选中它生效的容器、打开目标 Part、清掉内容收起），再重发工具焦点；
 * `rejected` / `pending` 的诊断照旧走落位回执提示。
 */
async function revealToolView(viewId: string): Promise<ViewPlacementsOutcome> {
    const outcome = await viewPlacements.revealView(viewId);
    reportPlacementOutcome(outcome, "ide.workbench.view.revealRejected");
    republishToolViewAfterReveal(outcome);
    return outcome;
}

/**
 * 工具揭示端口（页面登记、按生命周期释放）：Agent 的 `client.ide.activePanel` 写入的唯一落点。
 *
 * 能力与动作都交给真实工作台：`capability()` 只报已登记的 View 对应的页签，
 * `reveal()` 走 `reveal-view` 命令，回执里带落盘状态（`pending` 就是"UI 已应用、保存未确认"）。
 */
const toolRevealPort: WorkbenchToolRevealPort = {
    capability: () => {
        const registry = workbenchRegistryResult.value;
        if (!registry.ok) {
            return [];
        }
        const registered = new Set(registry.value.views().map((view) => view.id));
        return clientToolPanels().filter((panel) => {
            const viewId = clientToolViewIdOf(panel);
            return viewId !== null && registered.has(viewId);
        });
    },
    reveal: async (panel) => {
        if (panel === null) {
            // 只清工具焦点上下文：不动任何 Part 的显隐，也不改用户的容器选择。
            clearedToolView.value = resolvedToolView.value;
            publishToolView();
            return {status: "cleared"};
        }
        const viewId = clientToolViewIdOf(panel);
        if (viewId === null || !toolRevealPort.capability().includes(panel)) {
            return {status: "rejected", diagnosis: t("agent.clientVariables.activePanelNotWired", {panel})};
        }
        const outcome = await revealToolView(viewId);
        if (outcome.status === "rejected") {
            return {status: "rejected", diagnosis: outcome.diagnosis};
        }
        const containerId = viewPresentation.value?.entries.find((entry) => entry.view.id === viewId)?.containerId ?? null;
        const partId = containerId === null ? null : viewPresentation.value?.container(containerId)?.partId ?? null;
        if (partId === null) {
            return {status: "rejected", diagnosis: t("ide.workbench.view.revealUnmounted", {viewId})};
        }
        return {status: "revealed", partId, viewId, persisted: outcome.status};
    },
};
/**
 * 端口只在客户端登记：SSR 没有真实工作台，也没有工具上下文要发布；登记按生命周期释放，
 * 卸载时顺带清空工具焦点，不把本页的上下文留给下一个工作面。
 */
if (import.meta.client) {
    const releaseToolRevealPort = registerWorkbenchToolRevealPort(toolRevealPort);
    onBeforeUnmount(() => {
        releaseToolRevealPort();
        novelIdeStore.activeToolView = null;
    });
}

/**
 * 工具拖放（`@dnd-kit/vue`）：提供者必须在页面（一次拖动可能跨外壳三处），拖动结束与菜单、
 * 「移动到」子菜单共用同一条命令门禁，页面只按**落点载荷**路由到 `moveView` / `moveContainer`。
 *
 * 激活元素写成 `handle ?? element`（dnd-kit 自己的默认就是这个）：只写 `source.handle` 时，
 * 任何没给 `handle` 的拖动源都会被**静默跳过**（`bind` 里 `if (!target) continue`，一个监听器都不挂），
 * 表现是"按下去毫无反应"，而不是报错。
 */
/**
 * 拖放的判定、预览与提交都在 `useWorkbenchDrop` 里（同一份几何、同一个 resolver）：
 * 页面只把唯一写者的三条方法交出去，并按回执提示；落点载荷与几何由渲染层登记。
 */
const workbenchDrop = useWorkbenchDrop({
    presentation: () => viewPresentation.value,
    contextKey: () => viewPlacements.contextKey(),
    ports: {
        moveView: (request) => viewPlacements.moveView(request),
        detachView: (request) => viewPlacements.detachView(request),
        moveContainer: (request) => viewPlacements.moveContainer(request),
        mergeContainer: (request) => viewPlacements.mergeContainer(request),
    },
    onOutcome: (outcome) => {
        // `saved` / `unchanged` 不打扰用户；拒绝与未确认的原始诊断都显示出来，不静默吞掉。
        if (outcome.status === "saved" || outcome.status === "unchanged") {
            return;
        }
        notification.warning(outcome.diagnosis, {title: t("ide.workbench.view.moveFailed")});
    },
});

/** 预览文案：动作种类 + 并入的视图数（拖动中显示在插入线旁）；`noop` 带预览时只承诺保持布局。 */
const dropPreviewLabel = computed(() => {
    const preview = workbenchDrop.preview.value;
    if (preview === null) {
        return "";
    }
    if (workbenchDrop.decision.value === "noop") {
        return t("ide.workbench.drop.keepLayout");
    }
    if (workbenchDrop.decision.value === "merge-container") {
        return t("ide.workbench.container.command.merge", {count: preview.count});
    }
    return workbenchDrop.decision.value === "move-container"
        ? t("ide.workbench.container.command.moveTo")
        : t("ide.workbench.view.moveTo");
});

/**
 * 跟随指针的唯一 Overlay 的文案：按 `useWorkbenchDrop` 冻结的源载荷，从**当前呈现**里取标题与图标。
 *
 * 取不到（视图 / 容器这一刻已不在呈现里）时回落到 id：拖动期间结构变化本来就整场取消，
 * 这里只保证「拖着的标签不会是空的」。
 */
const dropOverlay = computed<{label: string; iconClass: string | undefined} | null>(() => {
    const source = workbenchDrop.source.value;
    if (source === null) {
        return null;
    }
    if (source.kind === "workbench-view") {
        const entry = viewPresentation.value?.entries.find((item) => item.view.id === source.viewId) ?? null;
        return {label: entry?.title ?? source.viewId, iconClass: entry?.view.icon};
    }
    const container = viewPresentation.value?.container(source.containerId) ?? null;
    return {label: container?.title ?? source.containerId, iconClass: container?.icon};
});
const workbenchShellRef = ref<InstanceType<typeof WorkbenchShell> | null>(null);
/**
 * 叶的显隐都由页面事实驱动，走外壳暴露的 `setLeafVisible`：
 * - `titlebar` **两种宿主都显示**：浏览器没有 bridge 也要有可用标题栏（菜单按真实能力裁剪）；
 * - `left` / `right` 在书架（picker）态收起，主区整个让给书架视图——与接入前「图标条 + 书架」等价。
 */
watch([workbenchShellRef, projectPickerActive], ([shell, pickerActive]) => {
    if (!shell) return;
    shell.setLeafVisible("left", !pickerActive);
    shell.setLeafVisible("right", !pickerActive);
});

/**
 * 工作台命令宿主：与 Lab 同形的 provide/inject host。
 *
 * 本任务只注册**外壳与 View 标题**两域的具名命令（面板位置/对齐/隐藏/收起/最大化/移动视图，以及
 * 打开视图贡献的刷新），不迁移全部编辑器命令、不加全局快捷键、不新建命令面板 UI——那些仍属后续切片。
 */
const workbenchCommands = provideWorkbenchCommands({
    development: import.meta.dev,
    report: (error: Error): void => {
        notification.error(error.message);
    },
});

/** 命令上下文与视图可见性求值同源：谁都不许各记一份环境事实。 */
watch(workbenchViewContext, (context) => {
    workbenchCommands.context.value = context;
}, {immediate: true});

/** View 标题动作：句柄与状态存在宿主，点击经 canonical 命令命中**精确实例**。 */
const viewActions = useWorkbenchViewActions({
    registry: workbenchCommands.registry,
    entries: () => viewPresentation.value?.entries ?? [],
    titleOf: (metadata) => t(metadata.titleKey),
    context: () => workbenchCommands.context.value,
    onFailure: (diagnosis) => notification.warning(diagnosis, {title: t("ide.workbench.view.actionFailed")}),
});

/** 框架命令的宿主端口：面板状态与位置类命令都写唯一 placement 会话，最大化只改页面内存。 */
const shellCommandPort: WorkbenchShellCommandPort = {
    state: () => ({
        panel: {...panelPreferences.value, maximized: panelMaximized.value},
        mode: workbenchShellRef.value?.facts?.mode ?? "split",
        ready: !viewPlacements.loading.value,
    }),
    setPanelState: (patch) => viewPlacements.setPanelState(patch),
    setMaximized: (maximized) => {
        panelMaximized.value = maximized;
    },
    moveView: (request) => viewPlacements.moveView(request),
    moveContainer: (request) => viewPlacements.moveContainer(request),
    mergeContainer: (request) => viewPlacements.mergeContainer(request),
    reopenContainer: (containerId) => viewPlacements.reopenContainer(containerId),
    selectContainer: (partId, containerId) => viewPlacements.selectContainer(partId, containerId),
    restoreContainerPlacement: (containerId) => viewPlacements.restoreContainerPlacement(containerId),
    restoreViewPlacement: (viewId) => viewPlacements.restoreViewPlacement(viewId),
    setPartVisibility: (input) => viewPlacements.setPartVisibility(input),
    revealView: async (viewId) => {
        // 命令 / 菜单路径与欢迎页、Agent 共用同一条 reveal-view 命令；这里只额外重发工具焦点，
        // 诊断仍由命令结果的既有报告通道给出（不在这一层重复提示）。
        const outcome = await viewPlacements.revealView(viewId);
        republishToolViewAfterReveal(outcome);
        return outcome;
    },
};

/** 容器动作组（标签 / 标题右侧的菜单）：本产品只给「恢复默认落点」，选中后经真实容器命令执行。 */
const containerActions = computed<WorkbenchTitleActionItems>(() => ({
    primary: [],
    secondary: [{
        id: SHELL_CONTAINER_COMMAND_IDS.restore,
        label: t("ide.workbench.container.command.restore"),
        icon: "i-lucide-rotate-ccw",
    }],
}));

const commandReleases: Release[] = [];
function registerCommands(label: string, result: CommandResult<Release>): void {
    if (!result.ok) {
        notification.error(`${label}：${result.reason}`);
        return;
    }
    commandReleases.push(result.value);
}
registerCommands("外壳命令注册失败", registerWorkbenchShellCommands(workbenchCommands.registry, shellCommandPort));
// View 标题命令按宿主的白名单注册：View 贡献只声明 commandId，元数据由这里给定。
registerCommands("View 标题命令注册失败", registerViewTitleCommands(workbenchCommands.registry, [SHELL_FILES_REFRESH_COMMAND], {runAction: viewActions.runAction}));
onBeforeUnmount(() => {
    for (const release of commandReleases.splice(0)) {
        release();
    }
});

/**
 * 位置会话的上下文签名：容器几何、手势基线与尺寸批的上下文键。
 *
 * 与 `titleActionsContextKey`（面板呈现串，只用于关旧菜单）**不是同一个值**：
 * 尺寸批按会话签名校验，把呈现串传下去会让每次尺寸提交都被判为过期。
 */
const placementContextKey = computed(() => viewPlacements.contextKey());

/** 标题动作的上下文键：面板状态或活动 View 的代际变化都会让旧菜单关闭、旧目标作废。 */
const titleActionsContextKey = computed(() => [
    workbenchLayoutSurface.value.kind,
    panelPreferences.value.position,
    panelPreferences.value.alignment,
    panelPreferences.value.hidden ? "hidden" : "visible",
    panelPreferences.value.collapsed ? "collapsed" : "expanded",
    panelMaximized.value ? "maximized" : "normal",
].join("|"));

/** Panel 框架操作：菜单里看到的禁用与原因，与命令 `run` 判的是同一条规则。 */
const panelTitleActions = computed<WorkbenchTitleActionItems>(() => resolvePanelTitleActions({
    state: {...panelPreferences.value, maximized: panelMaximized.value},
    mode: workbenchShellRef.value?.facts?.mode ?? "split",
    ready: !viewPlacements.loading.value,
    titleOf: (titleKey) => t(titleKey),
}));

/** 标题操作的三层落点：框架项经命令目录执行，容器项经容器命令执行，View 项经实例句柄执行。 */
async function handleTitleAction(payload: WorkbenchTitleActionEvent): Promise<void> {
    if (payload.scope === "panel") {
        const result = await executePanelActionItem(workbenchCommands.registry, payload.actionId);
        if (!result.ok) {
            notification.warning(result.reason, {title: t("ide.workbench.panel.stateRejected")});
        }
        return;
    }
    if (payload.scope === "container") {
        // 容器动作组里的每一条都是容器命令（当前只有「恢复默认落点」）：点击重新求值后再执行。
        const result = await workbenchCommands.registry.executeCommand(payload.actionId, {containerId: payload.target.containerId});
        if (!result.ok) {
            notification.warning(result.reason, {title: t("ide.workbench.container.actionRejected")});
        }
        return;
    }
    await viewActions.run(payload.target, payload.actionId);
}
let removeDesktopMenuListener: (() => void) | null = null;
let desktopZoomQueue: Promise<void> = Promise.resolve();

/** 焦点事实：菜单的编辑动作按真实焦点判断（Studio 的 undo 不冒充所有输入框的 undo）。 */
const titleBarEdit = useTitleBarEditTarget({
    editorActive: () => editorWorkbench.editorFocused.value,
});

/** 原生编辑命令的 DOM 命令名（`selectAll` 的拼写是 DOM 的规定，不是这里的命名口味）。 */
const NATIVE_EDIT_COMMANDS: Record<TitleBarEditCommand, string> = {
    "edit.undo": "undo",
    "edit.redo": "redo",
    "edit.cut": "cut",
    "edit.copy": "copy",
    "edit.paste": "paste",
    "edit.select-all": "selectAll",
};

/**
 * 编辑命令的执行去处，与标题栏菜单的 enabled 用同一份判定：
 * 菜单里禁用过的命令，这里也不会跑到另一个编辑器上。
 */
function executeEditCommand(command: TitleBarEditCommand): void {
    const route = resolveTitleBarEditRoute(command, {
        desktop: desktopBridge.value !== undefined,
        surfaceActive: projectSurfaceActive.value,
        editTarget: titleBarEdit.target.value,
    });
    if (route === "unavailable") {
        notification.info("当前没有可执行的编辑动作：请先把光标放进编辑器或输入框。", {title: "编辑命令未执行"});
        return;
    }
    if (route === "editor") {
        if (command === "edit.undo") {
            editorWorkbench.undo();
        } else {
            editorWorkbench.redo();
        }
        return;
    }
    // 键盘从标题栏发起时焦点在标题栏里：先把焦点还给最近的可编辑元素，原生命令才会作用在它身上。
    if (titleBarEdit.titleBarOwnsFocus.value) {
        titleBarEdit.rememberedElement.value?.focus();
    }
    if (!document.execCommand(NATIVE_EDIT_COMMANDS[command])) {
        notification.info("当前没有可编辑的选区。", {title: "编辑命令未执行"});
    }
}

/** 串行更新 Desktop 缩放，避免连续点击读取到同一个旧值。 */
function queueDesktopZoom(target: "in" | "out" | "reset"): void {
    desktopZoomQueue = desktopZoomQueue.then(async () => {
        const bridge = desktopBridge.value;
        if (!bridge) return;
        const current = await bridge.settings();
        const zoomFactor = target === "reset"
            ? 1
            : Math.min(2, Math.max(0.75, current.zoomFactor + (target === "in" ? 0.05 : -0.05)));
        await bridge.updateSettings({zoomFactor});
    }).catch((error: unknown) => {
        notification.error(error instanceof Error ? error.message : "无法更新 Desktop 缩放。", {title: "Desktop 设置失败"});
    });
}

/** 消费桌面宿主发来的菜单命令（原生菜单，或自绘菜单经 bridge 转发）。 */
async function dispatchMenuCommand(command: DesktopMenuCommandId): Promise<void> {
    const bridge = desktopBridge.value;
    await dispatchDesktopMenuCommand(command, {
        open: () => {
            if (projectSurfaceActive.value) {
                openWelcomeFiles();
                return;
            }
            notification.info("请先打开一个 Project，再打开文件。", {title: "文件"});
        },
        settings: () => {
            settingsDialogOpen.value = true;
        },
        quit: () => bridge ? bridge.window("quit") : undefined,
        undo: () => executeEditCommand("edit.undo"),
        redo: () => executeEditCommand("edit.redo"),
        cut: () => executeEditCommand("edit.cut"),
        copy: () => executeEditCommand("edit.copy"),
        paste: () => executeEditCommand("edit.paste"),
        selectAll: () => executeEditCommand("edit.select-all"),
        reload: () => window.location.reload(),
        zoomIn: () => queueDesktopZoom("in"),
        zoomOut: () => queueDesktopZoom("out"),
        zoomReset: () => queueDesktopZoom("reset"),
        documentation: () => {
            notification.info("文档站尚未嵌入应用外壳，请在浏览器中打开文档站。", {title: "文档"});
        },
        about: async () => {
            const status = await bridge?.status();
            await alert(status
                ? `NeuroBook\n版本：${status.version}\n连接：${status.connection === "local" ? "本地 Product" : "远端服务"}`
                : "NeuroBook\n运行方式：浏览器（无桌面外壳）", "关于 NeuroBook");
        },
    });
}

type ProjectTransitionView =
    | {mode: "determinate"; title: string; label: string; stepLabel: string; current: number; total: number; width: string}
    | {mode: "indeterminate"; title: string; label: string};

/** 把 route revision 与 Controller phase 投影为用户可读进度，不按耗时伪造百分比。 */
const projectTransitionView = computed<ProjectTransitionView>(() => {
    const progressView = projectRouteProgressView({
        sessionState: projectSession.state.value,
        progress: projectRouteProgress.value,
        currentRevision: projectRouteIntentRevision,
    });
    const title = t(`ide.projectLoading.${progressView.titleKey}`);
    const label = t(`ide.projectLoading.${progressView.labelKey}`);
    if (progressView.mode === "indeterminate") return {mode: "indeterminate", title, label};
    return {
        mode: "determinate",
        title,
        label,
        stepLabel: t("ide.projectLoading.step", {current: progressView.current, total: progressView.total}),
        current: progressView.current,
        total: progressView.total,
        width: `${(progressView.current / progressView.total) * 100}%`,
    };
});

const novelItems = computed(() => novels.value.map((novel) => ({
    label: novel.title,
    value: novel.projectRoot,
    active: novel.projectRoot === currentProjectRoot.value,
})));

type ProjectRouteTarget =
    | {kind: "user-assets"}
    | {kind: "project"; projectRoot: string}
    | {kind: "default"};

/**
 * 解析页面 URL 中的 project target。workspace/.nbook 是 user-assets 保留值。
 */
const parseProjectRouteTarget = (): ProjectRouteTarget => {
    const projectQuery = typeof route.query.project === "string" ? route.query.project.trim() : "";
    if (projectQuery === USER_ASSETS_PROJECT_TARGET) {
        return {kind: "user-assets"};
    }
    if (/^[^/\\]+$/u.test(projectQuery)) {
        return {kind: "project", projectRoot: projectQuery};
    }
    return {kind: "default"};
};

/**
 * 生成规范 project URL，确保 query value 中的斜杠编码为 %2F。
 */
const buildProjectRoute = (projectTarget: string): string => {
    return `/?${new URLSearchParams({project: projectTarget}).toString()}`;
};

const consumingRouteOpenPath = ref(false);
const displayAgentPanelOpen = computed(() => workspaceBootstrapped.value && agentPanelOpen.value);
const isAgentMode = computed(() => layoutMode.value === "agent");
const agentSurfaceActive = computed(() => projectSurfaceActive.value && (displayAgentPanelOpen.value || isAgentMode.value));
const agentModeSessions = computed(() => agentSurfaceRef.value?.sessions ?? []);
const agentModeActiveSessionId = computed(() => agentSurfaceRef.value?.activeSessionId ?? null);
const agentModeLoadingSession = computed(() => agentSurfaceRef.value?.loadingSession ?? false);
const agentModeRunning = computed(() => agentSurfaceRef.value?.running ?? false);
const agentModeSessionActionId = computed(() => agentSurfaceRef.value?.sessionActionId ?? null);
const agentModeReservedWidth = computed(() => 56 + (agentSessionPanelOpen.value ? agentSessionPanelWidth.value : 0) + 340);
const {width: viewportWidth} = useWindowSize();
const agentPanelOverlay = computed(() => viewportWidth.value > 0 && viewportWidth.value < 800);
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
const agentStudioStyle = computed(() => {
    if (!isAgentMode.value) {
        return {};
    }
    if (layoutTransitionDirection.value === "to-agent") {
        return {width: "0px"};
    }
    return agentStudioPanelOpen.value ? agentStudioPanelStyle.value : {width: "0px"};
});

/**
 * 主侧栏当前的容器由位置记录与容器切片决定（`partPresentation("left")`）。页面不再有并行的
 * 「活动左侧页签」状态：工具上下文由非持久的 `activeToolView` 承载（见下面的工具焦点发布），
 * 活动栏与工具视图的呈现都不从它推导选择。
 */
const displayNovelTitle = computed(() => isUserAssetsWorkspace.value
    ? t("ide.header.userAssets")
    : currentNovel.value?.title ?? currentProjectRoot.value);
const displayNovelItems = computed(() => isUserAssetsWorkspace.value ? [] : novelItems.value);
const displayNovelIdForAgent = computed(() => isUserAssetsWorkspace.value ? "" : currentProjectRoot.value);
const agentScopeKey = computed(() => agentSessionScopeKey(isUserAssetsWorkspace.value ? "user-assets" : "novel", currentProjectRoot.value));

/**
 * 当前文件扩展名，统一用于编辑器类型判断。
 */
const currentFileExtension = computed(() => {
    return resolveWorkspaceFileExtension(selectedFilePath.value);
});

const workspaceDisplayReady = computed(() => workspaceBootstrapped.value && workspaceReady.value);
const displaySelectedFileNode = computed(() => workspaceDisplayReady.value ? selectedFileNode.value : null);
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
const displayInlinePromptSessionLabel = computed(() => inlineEditorAgent.sessionLabel.value || t("ide.inlineAi.sessionLabel"));
const inlinePromptSessions = inlineEditorAgent.sessions;
const inlinePromptSessionId = inlineEditorAgent.sessionId;
const inlinePromptSessionLoading = inlineEditorAgent.sessionLoading;
const inlinePromptResultText = inlineEditorAgent.resultText;
const inlinePromptAgentRunning = inlineEditorAgent.running;
const inlinePromptBusy = computed(() => inlinePromptRunning.value || inlinePromptAgentRunning.value || loadingWorkspace.value);
const displayInlinePromptEditPreview = computed(() => inlineEditorAgent.editPreview.value || inlinePromptEditPreview.value);
const inlinePromptLiveView = inlineEditorAgent.liveView;
const inlinePromptSelectableModels = inlineEditorAgent.selectableModels;
const inlinePromptSessionModelSelectionValue = inlineEditorAgent.sessionModelSelectionValue;
const inlinePromptSessionModelDraft = inlineEditorAgent.sessionModelDraft;
const inlinePromptSessionModelSaving = inlineEditorAgent.sessionModelSaving;
const inlinePromptSessionModelPopoverOpen = inlineEditorAgent.sessionModelPopoverOpen;
const inlinePromptSessionThinkingResolvedLabel = inlineEditorAgent.sessionThinkingResolvedLabel;
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
    await editorWorkbench.save();
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
 * // 当 currentProjectRoot = "ming-ding-zhi-shi-2"
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
    const projectSlug = currentProjectRoot.value;
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

    const owner = captureInlinePromptOwner();
    if (!owner) {
        notification.error(t("ide.inlineAi.agentNotReady"), {title: "Inline AI"});
        return;
    }
    const payload: InlineEditPayload = {
        version: 1,
        task: inlinePromptTask.value,
        targetPath: resolveInlineEditorTargetPath(selectedFilePath.value),
        instruction: inlinePromptInstruction.value.trim(),
        references: resolveInlineEditorReferences(inlinePromptReferences.value),
    };

    inlinePromptRunning.value = true;
    inlinePromptStatusText.value = t("ide.inlineAi.sending");
    inlinePromptEditPreview.value = "";

    try {
        await saveCurrentWorkspaceFile();
        if (!acceptsInlinePromptOwner(owner)) return;
        const result = await inlineEditorAgent.sendPrompt(
            payload,
            buildInlineVisibleMessage(payload),
            owner.operationKey,
        );
        if (!acceptsInlinePromptOwner(owner) || result.status === "superseded") return;
        inlinePromptInstruction.value = "";
        inlinePromptReferences.value = [];
        inlinePromptHoveredReference.value = null;
        inlinePromptStatusText.value = t("ide.inlineAi.started");
    } catch (error) {
        if (!acceptsInlinePromptOwner(owner)) return;
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.sendFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    } finally {
        if (acceptsInlinePromptOwner(owner)) {
            inlinePromptRunning.value = false;
        }
    }
}

/**
 * 停止当前 Inline AI 任务。
 */
async function stopInlineEditorPrompt(): Promise<void> {
    const owner = captureInlinePromptOwner();
    if (!owner) return;
    const result = await inlineEditorAgent.stopPrompt();
    if (!acceptsInlinePromptOwner(owner) || result.status === "superseded") return;
    inlinePromptRunning.value = false;
    inlinePromptStatusText.value = t("ide.inlineAi.stopRequested");
}

/**
 * 在 PromptBar 内切换后台 Inline AI session。
 */
async function selectInlineEditorSession(sessionId: number): Promise<void> {
    const owner = captureInlinePromptOwner();
    if (!owner) return;
    try {
        const result = await inlineEditorAgent.selectSession(sessionId);
        if (!acceptsInlinePromptOwner(owner) || result.status === "superseded") return;

        inlinePromptStatusText.value = t("ide.inlineAi.boundSession");
    } catch (error) {
        if (!acceptsInlinePromptOwner(owner)) return;
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.bindFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

/**
 * 在当前 Project Workspace 下创建新的 Inline AI session。
 */
async function createInlineEditorSession(): Promise<void> {
    const owner = captureInlinePromptOwner();
    if (!owner) return;
    try {
        const result = await inlineEditorAgent.createSession();
        if (!acceptsInlinePromptOwner(owner) || result.status === "superseded") return;
        inlinePromptStatusText.value = t("ide.inlineAi.sessionCreated");
    } catch (error) {
        if (!acceptsInlinePromptOwner(owner)) return;
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.createSessionFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

/**
 * 进入 Agent 模式查看当前 Inline AI session。
 */
async function openInlineEditorSessionChat(): Promise<void> {
    const owner = captureInlinePromptOwner();
    if (!owner) return;
    try {
        agentSessionPanelOpen.value = true;
        await nextTick();
        const result = await owner.surface.openInlineEditorSession();
        if (result.status === "failed") {
            if (owner.revision === inlinePromptRequestRevision && agentSurfaceRef.value === owner.surface) {
                inlinePromptStatusText.value = result.message;
            }
            return;
        }
        if (!acceptsInlinePromptOwner(owner) || result.status === "superseded") return;
        await showAgentSession(result.value.sessionId);
    } catch (error) {
        if (!acceptsInlinePromptOwner(owner)) return;
        inlinePromptStatusText.value = resolveApiErrorMessage(error, t("ide.inlineAi.openModelPanelFailed"));
        notification.error(inlinePromptStatusText.value, {title: "Inline AI"});
    }
}

function updateInlineSessionModelDraft(value: AgentSessionModelDraft): void {
    inlineEditorAgent.setSessionModelDraft(value);
}

function updateInlineSessionModelPopoverOpen(value: boolean): void {
    inlineEditorAgent.setSessionModelPopoverOpen(value);
}


watch([inlinePromptAvailable, agentSurfaceRef], ([available, surface]) => {
    if (available && surface?.refreshInlineEditorSessions) {
        void surface.refreshInlineEditorSessions().catch((error: unknown) => {
            if (agentSurfaceRef.value !== surface) return;
            notification.error(resolveApiErrorMessage(error, t("ide.inlineAi.bindFailed")), {title: "Inline AI"});
        });
    }
}, {immediate: true});

watch(() => unref(agentSurfaceRef.value?.inlineOperationScopeKey), (nextScope, previousScope) => {
    if (previousScope === undefined || nextScope === previousScope) return;
    inlinePromptRequestRevision += 1;
    inlinePromptRunning.value = false;
    inlinePromptStatusText.value = t("ide.inlineAi.initialStatus");
});

watch(selectedFilePath, () => {
    inlinePromptReferences.value = [];
    inlinePromptHoveredReference.value = null;
    inlinePromptEditPreview.value = "";
    inlinePromptStatusText.value = t("ide.inlineAi.initialStatus");
});

/**
 * 处理切换前的未保存文件修改。
 */
type WorkspaceSwitchDecision = "save" | "discard" | "cancel";

/**
 * 排空编辑会话已形成的意图（分组/标签/活动组/尺寸手势）。未确认时停住切换：
 * 布局改动不能因为切工作面被静默丢掉，用户可在编辑区顶部按提示选择重试 / 采用已保存 / 覆盖。
 */
async function flushEditorSessionBeforeSwitch(): Promise<boolean> {
    if (await editorSessionStorage.flush()) {
        return true;
    }
    notification.warning("编辑布局还有未确认的保存，请先在编辑区顶部处理，或放弃本窗口的布局改动。", {title: "编辑布局待确认"});
    return false;
}

/**
 * 编辑会话记录的提示与出口：首读失败/未确认/冲突/受保护各有明确动作，
 * 「以本窗口布局覆盖」按计划先向用户确认要替换其它窗口已保存的布局。
 */
const editorSessionNotice = computed(() => editorSessionStorage.notice.value);
const editorSessionNoticeActions = computed(() => {
    const notice = editorSessionNotice.value;
    if (!notice) return {retry: false, adopt: false, overwrite: false, abandon: false};
    return {
        retry: notice.retryable,
        adopt: notice.kind === "conflict",
        overwrite: notice.kind === "conflict" && notice.overwritable,
        abandon: notice.kind === "unsaved" || notice.kind === "conflict",
    };
});
async function adoptSavedEditorLayout(): Promise<void> {
    await editorSessionStorage.adoptSaved();
}
async function overwriteSavedEditorLayout(): Promise<void> {
    const confirmed = await choose("以本窗口布局覆盖会替换其它窗口已保存的分组与标签。继续？", [
        {label: "覆盖", value: "overwrite", tone: "danger"},
        {label: t("common.cancel"), value: "cancel"},
    ], "覆盖已保存布局");
    if (confirmed !== "overwrite") return;
    await editorSessionStorage.overwriteWithSaved();
}

const resolveUnsavedWorkspaceChanges = async (): Promise<WorkspaceSwitchDecision> => {
    // 未解决输入必须先裁决：不把"防抖已清"当已入 Store，也不在有候选待裁决时切工作面。
    if (editorWorkbench.flush() === "conflict" || novelIdeStore.hasUnresolvedEditorChanges) {
        notification.warning("有编辑内容与最新正文冲突，请先在编辑区顶部选择「采用当前正文」或「保留此视图内容」再切换。", {title: "有待裁决的编辑内容"});
        return "cancel";
    }
    if (!hasUnsavedWorkspaceChanges.value) {
        return await flushEditorSessionBeforeSwitch() ? "save" : "cancel";
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
        if (!await flushEditorSessionBeforeSwitch()) {
            return "cancel";
        }
        return "save";
    }
    if (!await flushEditorSessionBeforeSwitch()) {
        return "cancel";
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
    if (novelId === currentProjectRoot.value) {
        if (route.query.project !== novelId) {
            await router.replace(buildProjectRoute(novelId));
        }
        return;
    }
    await router.push(buildProjectRoute(novelId));
};

/**
 * 从项目选择界面进入 Project。
 *
 * 只改 URL，真正的 workspace 切换交给 route watch（`syncWorkspaceRoute`）统一执行；
 * 用 push 而不是 replace，浏览器后退可以回到选择界面。
 */
const openProjectFromPicker = async (projectRoot: string): Promise<void> => {
    await router.push(buildProjectRoute(projectRoot));
};

/**
 * 关闭当前 Project 回到项目选择界面。
 *
 * 只断开本窗口的 presence，不调用强制 close，
 * 因此其它窗口仍能继续持有同一个 Project。取消时保持 URL 原样，不留下多余的历史记录。
 */
const openProjectPicker = async (): Promise<void> => {
    await router.push("/");
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
        });
        return;
    }
    await runLayoutModeTransition(() => {
        layoutMode.value = "agent";
    });
    await nextTick();
    await agentSurfaceRef.value?.ensureSessionReady();
};

/**
 * 打开右侧 Agent 面板并选择指定 Session。
 */
async function showAgentSession(sessionId: number): Promise<void> {
    if (isAgentMode.value) {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
        });
    }
    agentPanelOpen.value = true;
    await nextTick();
    const surface = agentSurfaceRef.value;
    if (!surface) return;
    await surface.ensureSessionReady();
    await surface.selectSession(sessionId);
}

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
    await showAgentSession(sessionId);
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
    if (isAgentMode.value) {
        layoutMode.value = "ide";
    }
    agentPanelOpen.value = false;
};

/**
 * 标题栏与 B/S Activity Bar 共用的 Agent 侧栏开关。
 * 面板关闭时不挂载完整 Agent Surface，避免普通启动提前建立 Session/SSE。
 */
const toggleAgentPanel = async (): Promise<void> => {
    if (!projectSurfaceActive.value) return;
    if (isAgentMode.value) {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
        });
    }
    agentPanelOpen.value = !agentPanelOpen.value;
    if (!agentPanelOpen.value) return;
    await nextTick();
    await agentSurfaceRef.value?.ensureSessionReady();
};

/**
 * 切换 Agent Mode 的右侧 Studio 区域。
 */
const toggleAgentModeStudio = (): void => {
    agentStudioPanelVisible.value = !agentStudioPanelVisible.value;
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
function stopWorkspaceEvents(): void {
    workspaceEventRevision += 1;
    workspaceEventAbortController.value?.abort();
    workspaceEventAbortController.value = null;
    pendingWorkspaceFileEvents = [];
}

const subscribeWorkspaceEvents = (): void => {
    stopWorkspaceEvents();
    if (!import.meta.client) {
        return;
    }

    const target = workspaceKind.value === "user-assets"
        ? {workspaceKind: "user-assets"} as const
        : currentProjectRoot.value
            && projectSession.state.value.status === "ready"
            && projectSession.state.value.ready.projectRoot === currentProjectRoot.value
            ? {projectRoot: currentProjectRoot.value} as const
            : null;
    if (!target) {
        return;
    }
    const revision = workspaceEventRevision;
    const projectReadyRevision = projectSession.state.value.status === "ready"
        ? projectSession.state.value.ready.revision
        : null;
    const abortController = new AbortController();
    workspaceEventAbortController.value = abortController;
    void workspaceFileEvents.subscribe(target, (event) => {
        if (revision !== workspaceEventRevision) return;
        if (projectReadyRevision !== null && (
            projectSession.state.value.status !== "ready"
            || projectSession.state.value.ready.revision !== projectReadyRevision
        )) return;
        handleWorkspaceFileEvent(event);
    }, abortController.signal)
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
        const query = workspaceKind.value === "user-assets" || !currentProjectRoot.value
            ? {workspaceKind: "user-assets"} as const
            : {workspaceKind: "novel", projectRoot: currentProjectRoot.value} as const;
        const settings = await $fetch<ConfigBootstrapDto>("/api/config/bootstrap", {
            query,
        });
        setSelectedModelLabel(settings.modelSettings.defaultModelLabel);
        theme.applyStoredAxes({themeId: settings.ui.themeId, appearance: settings.ui.appearance});
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
 * 从主 IDE 打开当前 Project 的 World Engine 工作台。
 */
const openWorldEngineWorkbench = (): void => {
    if (isUserAssetsWorkspace.value || !currentProjectRoot.value) {
        return;
    }
    worldEngineWorkbenchOpen.value = true;
};

/**
 * 从主 IDE 打开当前 Project 的 Plot 工作台。
 *
 * 只切模式与打开对话框：它不再写「活动左侧页签」——主侧栏显示哪个容器由位置记录决定，
 * 一个对话框的开关不该顺手改用户的容器选择。
 */
const openPlotWorkbench = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value) {
        return;
    }

    if (isAgentMode.value) {
        await runLayoutModeTransition(() => {
            layoutMode.value = "ide";
        });
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
 * 冷切换开始后立即停用旧 Project 工作面，再等待本标签页 presence 完整退出。
 * Project Dialog 的开关同时清零，避免新 Project ready 后复用旧 Project 的会话态界面。
 */
const releaseProjectSurface = async (): Promise<void> => {
    stopWorkspaceEvents();
    worldEngineWorkbenchOpen.value = false;
    plotWorkbenchOpen.value = false;
    settingsDialogOpen.value = false;
    traceViewerOpen.value = false;
    historyInboxOpen.value = false;
    agentPanelOpen.value = false;
    profileWorkbenchOpen.value = false;
    frontmatterProfileKind.value = null;
    await projectSession.release();
    closeProjectWorkspace();
};

/**
 * 消费 reconnect 后出现的 terminal failure。
 *
 * route transition 自身的打开失败仍由对应 worker 收口；这里仅处理页面已经 ready 后
 * 异步失去 Project 的情况，Controller 已负责展示领域错误，页面不重复通知。
 */
const handleTerminalProjectSessionFailure = (): void => {
    if (projectSwitching.value || terminalProjectFailurePromise) return;
    stopWorkspaceEvents();
    terminalProjectFailurePromise = (async () => {
        await releaseProjectSurface();
        await router.replace("/");
    })().catch((error: unknown) => {
        notification.error(resolveApiErrorMessage(error, "返回 Project 列表失败"), {title: "Project 清理失败"});
    }).finally(() => {
        terminalProjectFailurePromise = null;
    });
};

/**
 * 根据页面 query 初始化当前工作区。
 *
 * 裸 `/`（default）不再自动打开上一次的 Project：置「未选择 Project」状态并落到项目选择界面。
 */
const initializeWorkspaceFromRoute = async (target: ProjectRouteTarget, revision: number): Promise<void> => {
    if (target.kind === "user-assets") {
        await releaseProjectSurface();
        if (!ownsProjectRouteIntent(revision)) return;
        await switchToUserAssetsWorkspace();
        if (!ownsProjectRouteIntent(revision)) return;
        // 分组拓扑与逐组标签的真相在编辑会话记录里：领域会话（sessionStorage 的正文草稿）先恢复，
        // 记录随后按"组集合"覆盖呈现；两边都完成才允许拓扑调整。
        await editorSessionStorage.initialize();
        if (!ownsProjectRouteIntent(revision)) return;
        // 用户资产工作面的容器选择归位置记录（`workbench.views/customizations`），
        // 路由就绪不再强写一个"活动左侧页签"覆盖用户选择。
        return;
    }

    if (target.kind === "project") {
        await releaseProjectSurface();
        if (!ownsProjectRouteIntent(revision)) return;
        setProjectRouteProgress(revision, "opening-project");
        await projectSession.open(target.projectRoot);
        if (!ownsProjectRouteIntent(revision)) {
            await projectSession.release();
            return;
        }
        setProjectRouteProgress(revision, "syncing-project");
        // ProjectSession 是存在性真相源；Catalog 仅补充展示 metadata，不能阻塞 direct-open。
        void loadProjects().catch(() => undefined);
        setProjectRouteProgress(revision, "loading-tree");
        await switchToNovelWorkspace(target.projectRoot);
        if (!ownsProjectRouteIntent(revision)) {
            await releaseProjectSurface();
            return;
        }
        setProjectRouteProgress(revision, "restoring-content");
        await editorSessionStorage.initialize();
        if (!ownsProjectRouteIntent(revision)) {
            await releaseProjectSurface();
            return;
        }
        return;
    }

    await releaseProjectSurface();
};

/**
 * 判断当前 store 状态是否已经匹配页面 query。
 */
const workspaceRouteSynced = (): boolean => {
    const target = parseProjectRouteTarget();
    if (target.kind === "user-assets") {
        return isUserAssetsWorkspace.value;
    }
    if (target.kind === "project") {
        return workspaceKind.value === "novel"
            && currentProjectRoot.value === target.projectRoot
            && projectSession.state.value.status === "ready"
            && projectSession.state.value.ready.projectRoot === target.projectRoot;
    }
    // 裸 `/` 只在「未选择 Project」时才算同步；否则（例如从项目页浏览器后退）要走完整切换流程。
    return !route.query.project && !currentProjectRoot.value;
};

/**
 * 将当前小说页面规范成可分享的 query URL。
 */
const normalizeNovelRouteQuery = async (): Promise<void> => {
    if (isUserAssetsWorkspace.value || !currentProjectRoot.value) {
        return;
    }
    if (route.query.project === currentProjectRoot.value) {
        return;
    }
    await router.replace(buildProjectRoute(currentProjectRoot.value));
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
const ownsProjectRouteIntent = (revision: number): boolean => revision === projectRouteIntentRevision;

/** 只有当前 route revision 能推进自己的 Project 冷切换进度。 */
const setProjectRouteProgress = (revision: number, phase: ProjectRouteProgressPhase): void => {
    if (!ownsProjectRouteIntent(revision)) return;
    projectRouteProgress.value = reduceProjectRouteProgress(projectRouteProgress.value, {type: "advance", revision, phase});
};

// 确定进度记录已到达的最高阶段，避免 Controller/Store 瞬时状态复位时倒退。
watch(() => projectSession.state.value, (next) => {
    if (next.status === "opening" && next.phase === "connecting-presence") {
        setProjectRouteProgress(projectRouteIntentRevision, "connecting-presence");
    }
}, {flush: "sync"});
watch(restoringWorkspaceFile, (restoring) => {
    if (restoring) setProjectRouteProgress(projectRouteIntentRevision, "restoring-content");
}, {flush: "sync"});

/** 消费一个固定 route revision；每个异步边界后都验证 ownership。 */
const syncWorkspaceRoute = async (revision: number): Promise<void> => {
    const target = parseProjectRouteTarget();
    if (workspaceRouteSynced()) {
        await consumeWorkspaceOpenPathFromRoute();
        if (!ownsProjectRouteIntent(revision)) return;
        if (!isUserAssetsWorkspace.value) {
            await normalizeNovelRouteQuery();
            if (!ownsProjectRouteIntent(revision)) return;
        }
        subscribeWorkspaceEvents();
        return;
    }
    if (!(await confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch())) {
        if (!ownsProjectRouteIntent(revision)) return;
        await restoreCurrentWorkspaceRoute();
        return;
    }
    if (!ownsProjectRouteIntent(revision)) return;
    const decision = await resolveUnsavedWorkspaceChanges();
    if (!ownsProjectRouteIntent(revision)) return;
    if (decision === "cancel") {
        await restoreCurrentWorkspaceRoute();
        return;
    }
    projectRouteProgress.value = reduceProjectRouteProgress(projectRouteProgress.value, {
        type: "start",
        revision,
        kind: target.kind === "project" ? "project" : "other",
    });
    projectSwitching.value = true;
    try {
        await initializeWorkspaceFromRoute(target, revision);
        if (!ownsProjectRouteIntent(revision)) return;
        await consumeWorkspaceOpenPathFromRoute();
        if (!ownsProjectRouteIntent(revision)) return;
        if (!isUserAssetsWorkspace.value) {
            await normalizeNovelRouteQuery();
            if (!ownsProjectRouteIntent(revision)) return;
        }
        subscribeWorkspaceEvents();
    } catch (error) {
        if (!ownsProjectRouteIntent(revision) || isProjectSessionSupersededError(error)) return;
        const controllerReportedFailure = projectSession.state.value.status === "failed";
        await releaseProjectSurface();
        if (!ownsProjectRouteIntent(revision)) return;
        await router.replace("/");
        if (!controllerReportedFailure) {
            notification.error(resolveApiErrorMessage(error, "打开 Project 失败"), {title: "Project 打开失败"});
        }
    } finally {
        if (ownsProjectRouteIntent(revision)) {
            projectSwitching.value = false;
            projectRouteProgress.value = reduceProjectRouteProgress(projectRouteProgress.value, {type: "clear", revision});
        }
    }
};

/**
 * Route watcher 只登记 intent。单一 worker 串行执行确认与 cold transition；新 intent
 * 会立刻使旧 revision 失效，opening 阶段还会主动释放其 transport owner。
 */
const requestWorkspaceRouteSync = (): void => {
    if (!initialized.value) return;
    projectRouteIntentRevision += 1;
    if (projectSession.state.value.status === "opening" || projectSession.state.value.status === "reconnecting") {
        void projectSession.release();
    }
    startWorkspaceRouteSync();
};

/** 启动唯一 route worker；finally 再检查一次，避免收尾微任务间隙丢失 intent。 */
const startWorkspaceRouteSync = (): void => {
    if (projectRouteSyncPromise) return;
    projectRouteSyncPromise = (async () => {
        while (processedProjectRouteRevision < projectRouteIntentRevision) {
            const revision = projectRouteIntentRevision;
            try {
                await syncWorkspaceRoute(revision);
            } catch (error) {
                if (ownsProjectRouteIntent(revision) && !isProjectSessionSupersededError(error)) {
                    const controllerReportedFailure = projectSession.state.value.status === "failed";
                    await releaseProjectSurface();
                    if (ownsProjectRouteIntent(revision)) {
                        await router.replace("/");
                        if (!controllerReportedFailure) {
                            notification.error(resolveApiErrorMessage(error, "打开 Project 失败"), {title: "Project 打开失败"});
                        }
                    }
                }
            } finally {
                processedProjectRouteRevision = revision;
            }
        }
    })().finally(() => {
        projectRouteSyncPromise = null;
        if (processedProjectRouteRevision >= projectRouteIntentRevision) {
            projectSwitching.value = false;
            projectRouteProgress.value = reduceProjectRouteProgress(projectRouteProgress.value, {
                type: "clear-through",
                revision: processedProjectRouteRevision,
            });
        }
        if (processedProjectRouteRevision < projectRouteIntentRevision) startWorkspaceRouteSync();
    });
};

/**
 * 打开当前 Markdown 文件的类型专属 frontmatter 档案。
 */
function openFrontmatterProfile(kind: FrontmatterProfileKind): void {
    frontmatterProfileKind.value = kind;
}

/**
 * 从欢迎页打开文件树；Agent Mode 下展开 Studio 内部文件树。
 *
 * 主侧栏那一支与 Agent 的 `ide.activePanel = files` 走**同一条**揭示命令：选中文件工具当前生效的
 * 容器、打开目标 Part、清掉 View 与面板的内容收起——同一条记录、同一次提交，并按真实可见性重发
 * 工具焦点；这里不写任何「活动页签」。
 */
function openWelcomeFiles(): void {
    if (isAgentMode.value) {
        agentStudioPanelVisible.value = true;
        agentStudioFileTreeOpen.value = true;
        return;
    }
    void revealToolView(SHELL_FILES_VIEW.id);
}

/**
 * 从欢迎页打开 Project Workspace 路径。
 */
async function openWelcomeWorkspacePath(filePath: string, groupId?: string): Promise<void> {
    openWelcomeFiles();
    const openIn = groupId ?? novelIdeStore.activeEditorGroupId;
    try {
        if (filePath === "world-engine/calendar.ts") {
            const created = await ensureWorldEngineCalendarFile();
            await novelIdeStore.selectWorkspacePathInGroup(openIn, filePath, "permanent");
            if (created) {
                notification.success("已创建 world-engine/calendar.ts", {title: "Calendar 配置已就绪"});
            }
            return;
        }
        await novelIdeStore.selectWorkspacePathInGroup(openIn, filePath, "permanent");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("ide.shell.openPathFailed", {path: filePath})), {title: t("ide.shell.openPathFailedTitle")});
    }
}

/**
 * 处理编辑器面包屑路径节点点击导航；`groupId` 决定在哪个组打开（点击发生在该组里）。
 */
async function handleBreadcrumbNavigate(groupId: string, item: {id: string; path?: string}): Promise<void> {
    if (item.path) {
        if (item.path === groupPresentation(groupId)?.activePath) {
            void editorWorkbench.focusGroup(groupId);
            return;
        }
        await openWelcomeWorkspacePath(item.path, groupId);
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
    if (consumingRouteOpenPath.value || isUserAssetsWorkspace.value || !currentProjectRoot.value || typeof route.query.openPath !== "string") {
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
 * 从欢迎页打开右侧 Agent 面板。
 */
async function openWelcomeAgentPanel(): Promise<void> {
    if (!agentPanelOpen.value) {
        await toggleAgentPanel();
        return;
    }
    await agentSurfaceRef.value?.ensureSessionReady();
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
    const typeLabelKeys: Record<WelcomeLorebookEntryType, string> = {
        location: "ide.shell.lorebookLocation",
        character: "ide.shell.lorebookCharacter",
        item: "ide.shell.lorebookItem",
        rule: "ide.shell.lorebookRule",
        note: "ide.shell.lorebookNote",
    };
    const selectedType = await chooseCards(t("ide.shell.createLorebookTypePrompt"), WELCOME_LOREBOOK_ENTRY_TYPES.map((type) => {
        const meta = getWorkspaceLorebookTypeMeta(type);
        return {
            label: t(typeLabelKeys[type]),
            value: type,
            icon: meta.icon,
            iconClass: meta.iconClass,
        };
    }), t("ide.shell.createLorebookTitle"));
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

useWorkbenchChromeRegistration({
    title: () => {
        if (!projectSurfaceActive.value) return t("ide.picker.title");
        const fileName = displaySelectedFileNode.value?.title?.trim();
        const workspaceTitle = displayNovelTitle.value || t("ide.header.noNovelSelected");
        return fileName ? `${fileName} — ${workspaceTitle}` : workspaceTitle;
    },
    appearance: () => theme.appearance.value,
    surfaceActive: () => projectSurfaceActive.value,
    currentProjectRoot: () => currentProjectRoot.value || null,
    projects: () => novels.value.map((novel) => ({
        projectRoot: novel.projectRoot,
        title: novel.title,
    })),
    agentPanelOpen: () => displayAgentPanelOpen.value,
    openBookshelf: () => openProjectPicker(),
    switchProject: (projectRoot) => handleSwitchNovel(projectRoot),
    toggleAgentPanel: () => toggleAgentPanel(),
    invokeMenuCommand: (command) => dispatchMenuCommand(command),
    editTarget: () => titleBarEdit.target.value,
    projectUrl: (projectRoot) => router.resolve(projectRoot === null ? "/" : buildProjectRoute(projectRoot)).href,
});

onMounted(() => {
    if (import.meta.client) {
        removeDesktopMenuListener = desktopBridge.value?.onMenuCommand((command) => {
            void dispatchMenuCommand(command).catch((error: unknown) => {
                notification.error(error instanceof Error ? error.message : "Desktop 菜单命令执行失败。", {title: "Desktop 菜单"});
            });
        }) ?? null;
    }
    void (async () => {
        if (!import.meta.client) {
            workspaceBootstrapped.value = true;
            return;
        }

        try {
            ensureThemeHost(themeHostRef.value);
            window.addEventListener("pagehide", flushWorkspaceSession);
            window.addEventListener("beforeunload", flushWorkspaceSession);
            void syncAuthSession();
            initialized.value = true;
            requestWorkspaceRouteSync();
            while (projectRouteSyncPromise) await projectRouteSyncPromise;
            await syncDefaultModelLabel();
        } catch (error) {
            if (!isProjectSessionSupersededError(error)) {
                const controllerReportedFailure = projectSession.state.value.status === "failed";
                await releaseProjectSurface();
                await router.replace("/");
                if (!controllerReportedFailure) {
                    notification.error(resolveApiErrorMessage(error, "打开 Project 失败"), {title: "Project 打开失败"});
                }
            }
        } finally {
            workspaceBootstrapped.value = true;
        }
    })();
});

// 服务端重启后 Project 会得到新的 ready revision；文件事件必须跟随同一 generation 重订阅。
watch(projectSession.state, (next, previous) => {
    if (next.status === "failed") {
        stopWorkspaceEvents();
        handleTerminalProjectSessionFailure();
        return;
    }
    if (next.status !== "ready") {
        if (previous.status === "ready") stopWorkspaceEvents();
        return;
    }
    if (next.ready.projectRoot !== currentProjectRoot.value) return;
    if (previous.status !== "ready" || previous.ready.revision !== next.ready.revision) {
        subscribeWorkspaceEvents();
    }
});

watch(() => [route.query.project, route.query.openPath] as const, requestWorkspaceRouteSync);

onBeforeUnmount(() => {
    removeDesktopMenuListener?.();
    removeDesktopMenuListener = null;
    stopWorkspaceEvents();
    if (import.meta.client) {
        window.removeEventListener("pagehide", flushWorkspaceSession);
        window.removeEventListener("beforeunload", flushWorkspaceSession);
    }
    novelIdeStore.persistWorkspaceSession();
});
</script>

<template>
    <!-- IDE 页面根容器 -->
    <div
        ref="themeHostRef"
        class="novel-ide-page ide-shell flex h-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300"
        :data-workbench-layout-mode="layoutMode"
    >
        <!-- Project 激活事务期间阻止旧数据面继续编辑。 -->
        <div v-if="projectTransitionActive" class="fixed inset-0 z-[120] grid place-items-center bg-[var(--overlay-bg)] px-4" role="status" aria-live="polite" aria-atomic="true">
            <!-- Project 加载进度：确定阶段按实际完成节点推进，重连保持不定进度。 -->
            <section class="w-full max-w-[360px] rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4 text-[var(--text-main)] shadow-lg">
                <div class="flex items-start gap-3">
                    <span class="project-loading-spinner i-lucide-loader-circle mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--status-info)]" aria-hidden="true"></span>
                    <div class="min-w-0 flex-1">
                        <h2 class="text-sm font-medium">{{ projectTransitionView.title }}</h2>
                        <div class="mt-1 flex min-h-5 items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                            <span class="min-w-0">{{ projectTransitionView.label }}</span>
                            <span v-if="projectTransitionView.mode === 'determinate'" class="shrink-0 tabular-nums">{{ projectTransitionView.stepLabel }}</span>
                        </div>
                    </div>
                </div>
                <div
                    class="project-loading-track mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--status-info-bg)]"
                    role="progressbar"
                    :aria-label="projectTransitionView.label"
                    :aria-valuemin="projectTransitionView.mode === 'determinate' ? 0 : undefined"
                    :aria-valuemax="projectTransitionView.mode === 'determinate' ? projectTransitionView.total : undefined"
                    :aria-valuenow="projectTransitionView.mode === 'determinate' ? projectTransitionView.current : undefined"
                    :aria-valuetext="projectTransitionView.mode === 'determinate' ? `${projectTransitionView.stepLabel} - ${projectTransitionView.label}` : projectTransitionView.label"
                >
                    <div v-if="projectTransitionView.mode === 'determinate'" class="project-loading-fill h-full rounded-full bg-[var(--status-info)]" :style="{width: projectTransitionView.width}"></div>
                    <div v-else class="project-loading-indeterminate h-full w-1/3 rounded-full bg-[var(--status-info)]"></div>
                </div>
            </section>
        </div>

        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <WorldEngineWorkbenchDialog v-if="projectSurfaceActive && !isUserAssetsWorkspace" v-model="worldEngineWorkbenchOpen" :project-root="currentProjectRoot" :project-title="displayNovelTitle" :surface="workbenchLayoutSurface" @has-unsaved-drafts-change="worldEngineWorkbenchHasUnsavedDrafts = $event" @saving-change="worldEngineWorkbenchSaving = $event" @open-workspace-path="void openWelcomeWorkspacePath($event)" />

        <!-- 工作台外壳骨架（#192 阶段 1 步骤 2）：四个叶挂的是外壳部件，业务组件暂不挂载（仍在仓库里）。
             left / right 叶已换成容器部件（步骤 5），editor 叶仍是演示占位块。
             Project 是否打开只影响叶内容与动作可用性，不阻塞外壳渲染（spec ui.workbench-shell）：
             未选择 Project 时书架视图落在 editor 叶，标题栏与图标条照常在位。
             占位块的面/描边/字号只走 nb-ui 主题变量（见下面 .workbench-demo-leaf）：
             写死一个色，主题换掉后外壳就会是唯一没跟上的一块。 -->
        <DragDropProvider
            :sensors="workbenchDrop.sensors"
            @drag-start="workbenchDrop.handlers.onDragStart"
            @drag-move="workbenchDrop.handlers.onDragMove"
            @drag-over="workbenchDrop.handlers.onDragOver"
            @drag-end="workbenchDrop.handlers.onDragEnd">
        <WorkbenchViewInstances :views="viewPresentation?.entries ?? []" :view-factory-resolver="resolveWorkbenchViewFactory"
            @view-actions="(target, states) => viewActions.setStates(target, states)"
            @view-handle-ready="(target, handle) => viewActions.bindHandle(target, handle)">
        <!-- 容器实例层：每个容器一个 ViewHost，按 Part 宿主登记的挂载目标搬进去；活动容器一换只搬 DOM。 -->
        <WorkbenchContainerInstances :containers="containerSlices"
            :view-sizes="viewPlacements.record.value.viewSizes ?? {}"
            :context-key="viewPlacements.contextKey()"
            :allow-container-move="true"
            :actions-context-key="titleActionsContextKey"
            :actions-by-view="viewActions.actionsByView.value"
            :allow-view-move="true"
            :move-label="t('ide.workbench.view.moveTo')"
            :view-actions-label="t('ide.workbench.view.actions')"
            @move-view="(request) => void handleMoveView(request)"
            @view-sizes="(payload) => void handleViewSizes(payload)"
            @title-action="(payload) => void handleTitleAction(payload)">
        <WorkbenchShell ref="workbenchShellRef" :surface="workbenchLayoutSurface"
            :panel="panelPreferences" :maximized="panelMaximized"
            :drag-collapsed-parts="dragCollapsedParts"
            @update:maximized="panelMaximized = $event"
            @drag-collapse="(payload) => void handleDragCollapse(payload)">
            <template #titlebar>
                <!-- 自绘 header 纳入 titlebar 叶：平台边界（bridge 命令、安全区、菜单数据）仍在组件内。 -->
                <DesktopTitleBar />
            </template>
            <template #activity>
                <!-- 图标条宿主换成 activity 叶：叶宽是树上的刚性尺寸（卡片 + 两侧留白），
                     卡片四周的留白由外壳加在叶上，组件只负责卡片自己长什么样。
                     上半只列主侧栏容器（单选），工具与账户命令在底部两组。 -->
                <NovelIdeActivityBar
                    class="h-full"
                    :containers="activityContainers"
                    :active-container-id="partPresentation('left').activeContainerId"
                    :allow-container-move="true"
                    :allow-view-move="true"
                    :context-key="viewPlacements.contextKey()"
                    :container-actions="containerActions"
                    @container-action="(containerId: string, actionId: string) => void handleTitleAction({scope: 'container', target: {containerId}, actionId})"
                    :desktop-available="Boolean(desktopBridge)"
                    :surface-active="projectSurfaceActive"
                    :user-assets-mode="isUserAssetsWorkspace"
                    :current-user="currentUser"
                    @open-home="void openProjectPicker()"
                    @open-container="handleOpenContainer"
                    @open-world-engine="openWorldEngineWorkbench"
                    @open-plot-workbench="void openPlotWorkbench()"
                    @open-trace-viewer="traceViewerOpen = true"
                    @open-history-inbox="historyInboxOpen = true"
                    @open-settings="settingsDialogOpen = true"
                    @open-profile="accountProfileOpen = true"
                    @open-admin="void openAdmin()"
                    @logout="void logout()"
                />
            </template>
            <template #left>
                <!-- 左 Part 宿主：容器选择器（Activity Bar 选中的容器在这里显示）+ 容器落点 + 挂载目标。
                     容器里的 View 由 `WorkbenchContainerInstances` 把 ViewHost 搬进挂载目标渲染。 -->
                <WorkbenchPartHost
                    :presentation="partPresentation('left')"
                    :context-key="viewPlacements.contextKey()"
            :actions-context-key="titleActionsContextKey"
                    :actions-by-view="viewActions.actionsByView.value"
                    :view-actions-label="t('ide.workbench.view.actions')"
                    :move-view-label="t('ide.workbench.view.moveTo')"
                    :container-actions="containerActions"
                    :container-actions-label="t('ide.workbench.container.actions')"
                    :move-container-label="t('ide.workbench.container.command.moveTo')"
                    :empty-text="t('ide.workbench.container.emptyPart')"
                    :allow-container-move="true"
                    :allow-view-move="true"
                    @select-container="(containerId: string) => void handleSelectContainer(containerPart(containerId) ?? 'left', containerId)"
                    @move-container="(request) => void handleMoveContainer(request)"
                    @move-view="(request) => void handleMoveView(request)"
                    @title-action="(payload) => void handleTitleAction(payload)"
                />
            </template>
            <template #editor>
                <!-- 未选择 Project：书架视图（原整页 picker）落在主区；left / right 叶由页面收起，主区整个归它。 -->
                <ProjectPickerScreen v-if="projectPickerActive" @open="void openProjectFromPicker($event)" @open-user-assets="openUserAssets" />
                <div v-else class="flex h-full min-h-0 min-w-0 flex-col">
                <!-- 编辑会话记录：未确认 / 冲突 / 受保护 / 首读失败都在这里给出明确动作。 -->
                <div v-if="editorSessionNotice" role="status"
                    class="flex shrink-0 items-center gap-2 border-b border-[var(--divider)] bg-[var(--status-info-bg)] px-3 py-1.5 text-xs text-[var(--text-main)]">
                    <span class="i-lucide-layout-dashboard h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ editorSessionNotice.diagnosis }}</span>
                    <button v-if="editorSessionNoticeActions.retry" type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        @click="void editorSessionStorage.retry()">重试保存</button>
                    <button v-if="editorSessionNoticeActions.adopt" type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        @click="void adoptSavedEditorLayout()">采用已保存布局</button>
                    <button v-if="editorSessionNoticeActions.overwrite" type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        @click="void overwriteSavedEditorLayout()">以本窗口布局覆盖</button>
                    <button v-if="editorSessionNoticeActions.abandon" type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                        @click="editorSessionStorage.abandon()">放弃</button>
                </div>
                <!-- 恢复期问题（过滤的失效标签、追加的未保存文档等）：只报告，不自动写回记录。 -->
                <div v-if="editorSessionStorage.issues.value.length > 0" role="status"
                    class="flex shrink-0 items-center gap-2 border-b border-[var(--divider)] px-3 py-1 text-[11px] text-[var(--text-muted)]">
                    <span class="i-lucide-info h-3 w-3 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{{ editorSessionStorage.issues.value.join("；") }}</span>
                </div>
                <!-- 未解决输入：视图候选与权威正文冲突，必须由用户显式裁决后才能保存/关闭/切换。 -->
                <div v-if="editorWorkbench.unresolvedChanges.value.length > 0" role="alert"
                    class="flex shrink-0 flex-col gap-1 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-1.5 text-xs text-[var(--text-main)]">
                    <div v-for="item in editorWorkbench.unresolvedChanges.value" :key="item.token" class="flex items-center gap-2">
                        <span class="i-lucide-git-compare-arrows h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
                        <span class="min-w-0 flex-1 truncate">编辑内容与最新正文冲突：{{ item.path }}</span>
                        <template v-if="item.groupId">
                            <button type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                                @click="editorWorkbench.resolveConflict(item.groupId, item.token, 'adopt-current')">采用当前正文</button>
                            <button type="button" class="cursor-pointer rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
                                @click="editorWorkbench.resolveConflict(item.groupId, item.token, 'keep-view')">保留此视图内容</button>
                        </template>
                        <span v-else class="text-[var(--text-muted)]">请回到该编辑组处理</span>
                    </div>
                </div>
                <EditorWorkbench
                    class="flex-1"
                    :groups="editorGroups" :tree="editorWorkbench.editorTree.value" :layout="editorWorkbench.editorLayout.value"
                    :active-group-id="editorWorkbench.activeGroupId.value" :allow-split="editorSessionStorage.ready.value"
                    @container-extent="editorWorkbench.setContainer"
                    :context-key="editorWorkbench.gestureContextKey.value" :revision="editorWorkbench.gestureRevision.value"
                    :on-gesture-commit="editorWorkbench.acceptGesture"
                    @select-tab="editorWorkbench.selectTab" @close-tab="editorWorkbench.closeTab"
                    @set-pin="editorWorkbench.setPin" @keep-tab="editorWorkbench.keepTab"
                    @move-tab="editorWorkbench.moveTab"
                    @transfer-tab="(payload) => editorWorkbench.transfer(payload)"
                    @split-tab="(payload) => editorWorkbench.splitToEdge(payload)"
                    @toolbar-action="editorWorkbench.runViewAction"
                    @select-menu="editorWorkbench.selectMenu"
                    @retry="editorWorkbench.retry" @open-as-code="(groupId) => editorWorkbench.switchEditor(groupId, 'code')"
                    @navigate-breadcrumb="(groupId, item) => handleBreadcrumbNavigate(groupId, item)"
                    @empty-focus="editorWorkbench.selectGroup" @focus-group="editorWorkbench.selectGroup">
                <!-- 每片叶挂自己的真实视图宿主：实例 token 与文档身份一起校验，后台组就绪不抢焦点。 -->
                <template #content="{ groupId }">
                    <EditorViewHost v-if="groupPresentation(groupId)?.document"
                        :document="groupPresentation(groupId)!.document!"
                        :editor-id="groupPresentation(groupId)?.editorId ?? null"
                        :registry="editorWorkbench.registry"
                        :commit-change="(request) => editorWorkbench.commitChange(groupId, request)"
                        :conflict-resolution="editorWorkbench.conflictRequest.value?.groupId === groupId ? editorWorkbench.conflictRequest.value : null"
                        @handle-ready="(target, token, handle) => editorWorkbench.bindViewHandle(groupId, target, token, handle)"
                        @save-request="() => void editorWorkbench.save(groupId)"
                        @focus-change="(target, token, focused) => editorWorkbench.setFocus(groupId, target, token, focused)"
                        @view-actions="(target, token, actions) => editorWorkbench.setActions(groupId, target, token, actions)"
                        @view-error="(target, token, message) => editorWorkbench.viewError(groupId, target, token, message)"
                        @conflict-resolved="editorWorkbench.acknowledgeConflict" />
                    <EditorWelcome v-else :node="groupId === editorWorkbench.activeGroupId.value ? displaySelectedFileNode : null"
                        :tabs="editorGroups.find((item) => item.id === groupId)?.tabs ?? []" :workspace-mode="workspaceKind"
                        @select-tab="(path) => editorWorkbench.selectTab(groupId, path)" @open-path="(path) => openWelcomeWorkspacePath(path, groupId)"
                        @open-files="openWelcomeFiles" @create-chapter="createWelcomeChapter" @create-markdown-file="createWelcomeMarkdownFile"
                        @create-lorebook-entry="createWelcomeLorebookEntry" @open-agent-panel="openWelcomeAgentPanel"
                        @open-profile-workbench="profileWorkbenchOpen = true" />
                </template>
                <template #empty="{ groupId }">
                    <EditorWelcome :node="null" :tabs="editorGroups.find((item) => item.id === groupId)?.tabs ?? []" :workspace-mode="workspaceKind"
                        @select-tab="(path) => editorWorkbench.selectTab(groupId, path)" @open-path="(path) => openWelcomeWorkspacePath(path, groupId)"
                        @open-files="openWelcomeFiles" @create-chapter="createWelcomeChapter" @create-markdown-file="createWelcomeMarkdownFile"
                        @create-lorebook-entry="createWelcomeLorebookEntry" @open-agent-panel="openWelcomeAgentPanel"
                        @open-profile-workbench="profileWorkbenchOpen = true" />
                </template>
            </EditorWorkbench>
                </div>
            </template>
            <template #right>
                <!-- 右 Part 宿主：与左栏、底部共用同一份容器切片；容器可以被用户搬到这里。 -->
                <WorkbenchPartHost
                    :presentation="partPresentation('right')"
                    :context-key="viewPlacements.contextKey()"
            :actions-context-key="titleActionsContextKey"
                    :actions-by-view="viewActions.actionsByView.value"
                    :view-actions-label="t('ide.workbench.view.actions')"
                    :move-view-label="t('ide.workbench.view.moveTo')"
                    :container-actions="containerActions"
                    :container-actions-label="t('ide.workbench.container.actions')"
                    :move-container-label="t('ide.workbench.container.command.moveTo')"
                    :empty-text="t('ide.workbench.container.emptyPart')"
                    :allow-container-move="true"
                    :allow-view-move="true"
                    @select-container="(containerId: string) => void handleSelectContainer(containerPart(containerId) ?? 'right', containerId)"
                    @move-container="(request) => void handleMoveContainer(request)"
                    @move-view="(request) => void handleMoveView(request)"
                    @title-action="(payload) => void handleTitleAction(payload)"
                />
            </template>
            <template #panel="{ collapsed }">
                <!-- 底部 Part 宿主：收起时只留 32px 标题头（叶仍在树里，容器里的实例不重挂）。 -->
                <WorkbenchPartHost
                    :presentation="partPresentation('panel')"
                    :panel-collapsed="collapsed"
                    :context-key="viewPlacements.contextKey()"
            :actions-context-key="titleActionsContextKey"
                    :actions-by-view="viewActions.actionsByView.value"
                    :view-actions-label="t('ide.workbench.view.actions')"
                    :move-view-label="t('ide.workbench.view.moveTo')"
                    :panel-actions="panelTitleActions"
                    :panel-actions-label="t('ide.workbench.panel.more')"
                    :panel-collapse-label="t('ide.workbench.panel.command.collapse')"
                    :container-actions="containerActions"
                    :container-actions-label="t('ide.workbench.container.actions')"
                    :move-container-label="t('ide.workbench.container.command.moveTo')"
                    :empty-text="t('ide.workbench.container.emptyPart')"
                    :allow-container-move="true"
                    :allow-view-move="true"
                    @select-container="(containerId: string) => void handleSelectContainer('panel', containerId)"
                    @move-container="(request) => void handleMoveContainer(request)"
                    @move-view="(request) => void handleMoveView(request)"
                    @title-action="(payload) => void handleTitleAction(payload)"
                    @panel-collapse="(payload) => void handlePanelState({collapsed: payload.collapsed})"
                />
            </template>
            <template #statusbar>
                <!-- 状态栏只显示真实事实：工作面/Project、活动文档保存态、活动组、活动编辑器、可见视图计数与底部显隐。 -->
                <WorkbenchStatusBar :aria-label="t('ide.workbench.statusBar')">
                    <template #left>
                        <WorkbenchStatusBarItem id="workspace" :clickable="false"
                            :icon="isUserAssetsWorkspace ? 'i-lucide-user-round' : 'i-lucide-book-marked'"
                            :label="isUserAssetsWorkspace ? t('ide.workbench.userAssets') : displayNovelTitle" />
                        <WorkbenchStatusBarItem id="save-state" :clickable="false" :variant="statusBarSaveState.variant" :label="statusBarSaveState.label" />
                    </template>
                    <template #right>
                        <WorkbenchStatusBarItem id="active-editor" :clickable="false" :label="statusBarEditorLabel" />
                        <WorkbenchStatusBarItem id="editor-group" :clickable="false" icon="i-lucide-columns-2"
                            :label="`${statusBarGroupIndex}/${statusBarGroupCount}`" />
                        <WorkbenchStatusBarItem id="workbench-views" :clickable="false" icon="i-lucide-panels-top-left"
                            :label="`${statusBarVisibleViews}/${statusBarContainers}`" />
                        <WorkbenchStatusBarItem id="panel-visibility" icon="i-lucide-panel-bottom"
                            :active="!panelPreferences.hidden"
                            :label="panelPreferences.hidden ? t('ide.workbench.panelShow') : t('ide.workbench.panelHide')"
                            :aria-label="panelPreferences.hidden ? t('ide.workbench.panelShow') : t('ide.workbench.panelHide')"
                            data-shell-focus-target="panel-toggle"
                            @click="void togglePanelVisibility()" />
                    </template>
                </WorkbenchStatusBar>
            </template>
        </WorkbenchShell>
        </WorkbenchContainerInstances>
        </WorkbenchViewInstances>
        <WorkbenchDropOverlay
            :preview="workbenchDrop.preview.value"
            :kind="workbenchDrop.decision.value ?? ''"
            :label="dropPreviewLabel"
        />
        <!-- 唯一 Custom Overlay：跟指针走的是它，源条目原地不动、也不生成占位副本。 -->
        <WorkbenchDragOverlay
            :source="workbenchDrop.source.value"
            :label="dropOverlay?.label ?? ''"
            :icon-class="dropOverlay?.iconClass"
        />
        </DragDropProvider>

        <NovelIdeSettingsDialog v-model="settingsDialogOpen" />
        <NovelIdeProfileDialog v-model="accountProfileOpen" />
        <AgentTraceViewerDialog v-if="projectSurfaceActive" v-model="traceViewerOpen" @open-session="void openTraceSession($event)" />
        <WorkspaceHistoryInboxDialog v-if="projectSurfaceActive" v-model="historyInboxOpen" :project-root="isUserAssetsWorkspace ? null : currentProjectRoot" />
        <UserProfileWorkbenchDialog v-model="profileWorkbenchOpen" />
        <WorkspaceFileConflictDialog
            v-if="projectSurfaceActive"
            v-model="novelIdeStore.workspaceConflictDialogOpen"
            :conflict="novelIdeStore.workspaceWriteConflict"
            @resolve="void resolveWorkspaceWriteConflict($event)"
        />
        <WorkspaceCharacterDetailPanel
            v-if="projectSurfaceActive"
            v-model="characterProfileVisible"
            dialog-only
            :node="selectedFileNode"
            :issues="workspaceIssues"
            :height="0"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceLocationProfileDialog
            v-if="projectSurfaceActive"
            v-model="locationProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
        <WorkspaceRuleProfileDialog
            v-if="projectSurfaceActive"
            v-model="ruleProfileVisible"
            :node="selectedFileNode"
            :issues="workspaceIssues"
            @refresh="void loadWorkspaceTree()"
        />
        </div>
    </div>
</template>

<style scoped>
/*
 * 演示占位块（editor 叶的内容暂由它承担，真视图接入时整块替掉；left / right 叶已换成容器部件）。
 *
 * 属性写成 CSS 而不是原子类：面、描边宽度、字号这三样在原子类的任意值语法里
 * 分辨不出「这是尺寸还是颜色」，写错了**静默不生效**——而静默不生效正是「换主题看不出变化」
 * 的成因（同一判据见 `app/component-lab/LabShell.vue` 顶部那段）。
 *
 * 取值都是 nb-ui 的变量，产品侧不自造：
 *   --panel-surface 面板的面（两个产品主题都取 --bg-panel）
 *   --page-surface  稿面的面，主题包声明的扩展变量；没装该主题时退回 --bg-panel
 * 占位块填满所在叶，所以它自己不再画边界线：相邻容器卡片的描边已由卡片给出。
 */
.workbench-demo-leaf {
    display: flex;
    width: 100%;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    overflow: hidden;
    padding: var(--space-4);
    background: var(--panel-surface);
    text-align: center;
}

.workbench-demo-leaf--page {
    background: var(--page-surface, var(--bg-panel));
}

.workbench-demo-leaf__title {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
}

.workbench-demo-leaf__hint {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-tight);
}

/*
 * 左右容器的**演示文案**（真视图接入时整块替掉，连同这两条规则）：容器部件只提供头部与内容区，
 * 文案的观感不归它管。两档 layout 各自的呈现由容器按合同决定，这里只描述文案自己：
 * `scroll` 档落在留白里（外壳给的内边距就是它的左边）；`fill` 档占满内容区、居中。
 */
.workbench-leaf-placeholder {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    line-height: var(--leading-tight);
}

.workbench-leaf-placeholder--fill {
    display: grid;
    height: 100%;
    place-items: center;
    text-align: center;
}

.plain-text-editor {
    caret-color: var(--accent-main);
}

.project-loading-fill {
    transition: width 240ms ease-out;
}

.project-loading-indeterminate {
    animation: project-loading-slide 1.2s ease-in-out infinite;
}

@keyframes project-loading-slide {
    from { transform: translateX(-110%); }
    to { transform: translateX(310%); }
}

@media (prefers-reduced-motion: reduce) {
    .project-loading-fill {
        transition: none;
    }

    .project-loading-spinner,
    .project-loading-indeterminate {
        animation: none;
    }

    .project-loading-indeterminate {
        width: 100%;
        opacity: 0.55;
    }
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
