<script setup lang="ts">
import type {Data} from "@dnd-kit/abstract";
import {defaultPreset} from "@dnd-kit/dom";
import {DragDropProvider, KeyboardSensor, PointerSensor} from "@dnd-kit/vue";
import type {DragDropProviderEmits} from "@dnd-kit/vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import ProfileTemplateCanvasPanel from "nbook/app/components/profile-template-editor/ProfileTemplateCanvasPanel.vue";
import ProfileTemplateComponentLibraryPanel from "nbook/app/components/profile-template-editor/ProfileTemplateComponentLibraryPanel.vue";
import ProfileTemplateHeader from "nbook/app/components/profile-template-editor/ProfileTemplateHeader.vue";
import ProfileTemplateInspectorPanel from "nbook/app/components/profile-template-editor/ProfileTemplateInspectorPanel.vue";
import ProfileTemplatePreviewDialog from "nbook/app/components/profile-template-editor/ProfileTemplatePreviewDialog.vue";
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import {
    componentGroupTabs,
    componentLibrary,
    groupLabels,
    inspectorTabs,
    roleOptions,
    sourceEditorPreferences,
    sourceOptions,
    toolStatusOptions,
} from "nbook/app/components/profile-template-editor/profile-template-editor-config";
import type {
    ComponentLibraryGroup,
    ComponentLibraryGroupView,
    ComponentLibraryItem,
    InspectorTab,
    PreviewVariableGroup,
    PreviewVariableItem,
} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";
import {
    filterVariableGroups,
    formatVariableSchema,
    formatVariableValue,
    mapPreviewVariableGroups,
    shouldShowVariableValue,
} from "nbook/app/components/profile-template-editor/profile-template-variable-utils";
import {
    describeFetchError,
    issueDetail,
    propInputValue,
    propLabel,
} from "nbook/app/components/profile-template-editor/profile-template-form-utils";
import {
    generateFullTemplateSource,
    generatePreviewNodeSource,
    indentPreviewSource,
    publicRuntimeProps,
    renderPreviewNodeText,
} from "nbook/app/components/profile-template-editor/profile-template-source-utils";
import {resolveRefreshedTemplateSelection} from "nbook/app/components/profile-template-editor/profile-template-selection-utils";
import {
    canHaveChildren,
    canInsertNodeIntoParent,
    canInsertNodeIntoParentInTree,
    cloneNode,
    cloneNodeWithNewIds,
    collectNodeIds,
    containsNode,
    countNodes,
    createNode,
    createNodeId,
    createNodeWithId,
    findFirstEditableNodeId,
    findNode,
    findParentOfNode,
    insertAfterNode,
    isExpressionValue,
    nodeTitle,
    reconcileNodeIds,
    removeNode,
    removeNodeById,
} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";
import {buildNovelIdeClientVariables} from "nbook/app/components/novel-ide/agent/client-variables";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {
    AgentProfileCatalogItemDto,
    AgentProfileCompileResultDto,
    AgentProfileDetailDto,
    AgentProfileFileItemDto,
    AgentProfileIssueDto,
    AgentProfilePreparePreviewDto,
    AgentProfileSchemaFieldDto,
} from "nbook/shared/dto/agent-profile.dto";
import type {
    ProfileTemplateDetailDto,
    ProfileTemplateIssueDto,
    ProfileTemplateNodeDto,
    ProfileTemplateNodeType,
    ProfileTemplatePropValue,
    ProfileTemplatePreviewDto,
    ProfileTemplatePreviewMessageDto,
    ProfileTemplateSummaryDto,
} from "nbook/shared/dto/profile-template.dto";

type DragStartPayload = DragDropProviderEmits["dragStart"][0];
type DragOverPayload = DragDropProviderEmits["dragOver"][0];
type DragEndPayload = DragDropProviderEmits["dragEnd"][0];
type ProfileTemplateDropPosition = "before" | "after" | "inside" | "root";

type ProfileTemplateNodeDragData = {
    kind: "profile-template-node";
    nodeId: string;
    parentId: string;
};

type ProfileTemplateLibraryDragData = {
    kind: "library-node";
    type: ProfileTemplateNodeType;
};

type ProfileTemplateDropData = {
    kind: "profile-template-drop";
    parentId: string;
    targetId: string | null;
    position: ProfileTemplateDropPosition;
};

type ProfileTemplateDropState = {
    parentId: string;
    targetId: string | null;
    position: ProfileTemplateDropPosition;
} | null;

type ActiveDragSource = ProfileTemplateNodeDragData | (ProfileTemplateLibraryDragData & {previewNodeId: string}) | null;

type HistoryEntry = {
    sourceText: string;
    selectedNodeId: string;
};

type NewProfileForm = {
    profileKey: string;
    kind: "basic" | "report";
    name: string;
    description: string;
    prompt: string;
};

type ProfileValidationResult = {
    detail: AgentProfileDetailDto;
    preview: AgentProfilePreparePreviewDto | null;
};

type ProfileCompileState = "never" | "stale" | "running" | "passed" | "failed";

const props = withDefaults(defineProps<{
    mode?: "system-template" | "user-profile";
    preferredTemplate?: string;
    threadProfileKey?: string;
    closable?: boolean;
}>(), {
    mode: "system-template",
    preferredTemplate: "",
    threadProfileKey: "leader.default",
    closable: false,
});

const emit = defineEmits<{
    (e: "close"): void;
}>();

const themeHostRef = ref<HTMLElement | null>(null);
const novelIdeStore = useNovelIdeStore();
const theme = computed<string>({
    get: () => novelIdeStore.theme,
    set: (value) => {
        novelIdeStore.applyThemeSelection(value);
    },
});
const customThemes = computed(() => novelIdeStore.customThemes);
const themeVarsSnapshot = computed(() => novelIdeStore.themeVarsSnapshot);
const {mountThemeHost} = useIdeTheme(theme, customThemes, themeVarsSnapshot);

const templates = ref<ProfileTemplateSummaryDto[]>([]);
const profileCatalog = ref<AgentProfileCatalogItemDto[]>([]);
const profileFiles = ref<AgentProfileFileItemDto[]>([]);
const selectedTemplate = ref(props.preferredTemplate || (props.mode === "user-profile" ? "builtin/leader-default.profile.tsx" : "leader-runtime"));
const detail = ref<ProfileTemplateDetailDto | null>(null);
const profileDetail = ref<AgentProfileDetailDto | null>(null);
const sourceText = ref("");
const root = ref<ProfileTemplateNodeDto | null>(null);
const selectedNodeId = ref("");
const previewMessages = ref<ProfileTemplatePreviewMessageDto[]>([]);
const issues = ref<ProfileTemplateIssueDto[]>([]);
const loading = ref(false);
const saving = ref(false);
const autosaving = ref(false);
const validating = ref(false);
const restoring = ref(false);
const creating = ref(false);
const compilingAll = ref(false);
const createDialogOpen = ref(false);
const newProfileForm = ref<NewProfileForm>(createDefaultProfileForm());
const previewing = ref(false);
const previewDialogOpen = ref(false);
const previewUpdatedAt = ref("");
const statusText = ref("");
const threads = ref<AgentSessionSummaryDto[]>([]);
const selectedThreadId = ref("");
const loadingThreads = ref(false);
const previewVariableGroups = ref<PreviewVariableGroup[]>([]);
const componentSearch = ref("");
const variableSearch = ref("");
const collapsedVariableGroups = ref<Record<string, boolean>>({});
const activeComponentGroup = ref<ComponentLibraryGroup>("all");
const inspectorTab = ref<InspectorTab>("source");
const libraryPanelCollapsed = ref(false);
const inspectorPanelCollapsed = ref(false);
const dragSnapshot = ref<ProfileTemplateNodeDto | null>(null);
const dragVisualRoot = ref<ProfileTemplateNodeDto | null>(null);
const activeDragSource = ref<ActiveDragSource>(null);
const lastValidDropState = ref<ProfileTemplateDropState>(null);
const dropState = ref<ProfileTemplateDropState>(null);
const undoStack = ref<HistoryEntry[]>([]);
const redoStack = ref<HistoryEntry[]>([]);
const dirty = ref(false);
const lastSavedAt = ref("");
const lastSaveError = ref("");
const parsingSource = ref(false);
const compileState = ref<ProfileCompileState>("never");
const compiledSourceText = ref("");
const pendingMessageTextNodeId = ref("");
let sourceParseTimer: number | null = null;
let sourceHistoryTimer: number | null = null;
let autosaveTimer: number | null = null;
let sourceEditHistoryOpen = false;
let syncingSourceFromCanvas = false;
let sourceParseVersion = 0;
let keyboardListener: ((event: KeyboardEvent) => void) | null = null;

const selectedNode = computed(() => root.value ? findNode(root.value, selectedNodeId.value) : null);
const selectedPropEntries = computed(() => selectedNode.value ? Object.entries(selectedNode.value.props) : []);
const templateOptions = computed(() => templates.value.map((template) => ({
    value: props.mode === "user-profile" ? template.fileName : template.name,
    label: props.mode === "user-profile" && template.profileKey ? `${template.profileKey} · ${template.fileName}` : template.fileName,
    description: props.mode === "user-profile"
        ? formatCatalogDescription(profileCatalog.value.find((item) => item.fileName === template.fileName))
        : undefined,
    meta: props.mode === "user-profile" ? profileCatalog.value.find((item) => item.fileName === template.fileName) : undefined,
})));
const profileKindOptions = [
    {
        value: "basic",
        label: "basic-agent",
        description: "普通 Agent，默认只给读取能力",
    },
    {
        value: "report",
        label: "report-agent",
        description: "通用报告模式，允许 report_result",
    },
];
const threadOptions = computed(() => threads.value.map((thread) => ({
    value: String(thread.sessionId),
    label: thread.title || `Session #${thread.sessionId}`,
    description: thread.summary || thread.lastMessagePreview || thread.status,
})));
const issueCount = computed(() => issues.value.filter((issue) => issue.severity === "error").length);
const canEditDerivedTree = computed(() => Boolean(root.value) && !parsingSource.value && issueCount.value === 0);
const autosaveEnabled = computed(() => props.mode === "system-template");
const sourceLineCount = computed(() => sourceText.value ? sourceText.value.split("\n").length : 0);
const selectedTemplateFileName = computed(() => {
    const matched = templates.value.find((item) => props.mode === "user-profile"
        ? item.fileName === selectedTemplate.value
        : item.name === selectedTemplate.value);
    return matched?.fileName ?? selectedTemplate.value;
});
const canRestoreSelectedTemplate = computed(() => {
    if (props.mode !== "user-profile") {
        return false;
    }
    return Boolean(selectedTemplate.value && profileFiles.value.some((item) => item.fileName === selectedTemplate.value));
});
const selectedTextLength = computed(() => selectedNode.value?.text?.length ?? 0);
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const nodeCount = computed(() => root.value ? countNodes(root.value) - 1 : 0);
const displayRoot = computed(() => dragVisualRoot.value ?? root.value);
const profileCompileReady = computed(() => props.mode !== "user-profile" || (compileState.value === "passed" && compiledSourceText.value === sourceText.value));
const selectedProfileCatalogItem = computed(() => profileCatalog.value.find((item) => item.fileName === selectedTemplate.value));
const selectedProfileKey = computed(() => profileDetail.value?.manifest?.key
    ?? selectedProfileCatalogItem.value?.profileKey
    ?? detail.value?.name
    ?? "");
const editorStatusText = computed(() => {
    if (props.mode === "user-profile" && compileState.value === "running") {
        return "编译中...";
    }
    if (saving.value) {
        return "保存中...";
    }
    if (autosaving.value) {
        return "自动保存中...";
    }
    if (lastSaveError.value) {
        return `保存失败：${lastSaveError.value}`;
    }
    if (dirty.value) {
        return parsingSource.value
            ? (autosaveEnabled.value ? "源码解析中，等待自动保存" : "源码解析中")
            : "有未保存更改";
    }
    if (props.mode === "user-profile") {
        if (compileState.value === "passed" && compiledSourceText.value === sourceText.value) {
            return "编译通过";
        }
        if (compileState.value === "failed") {
            return "编译失败";
        }
        if (compileState.value === "stale" || (compileState.value === "passed" && compiledSourceText.value !== sourceText.value)) {
            return "源码已修改，需重新编译";
        }
        return statusText.value || "未编译";
    }
    return statusText.value || "等待操作";
});
const disabledDropNodeIds = computed(() => {
    const source = activeDragSource.value;
    const snapshot = dragSnapshot.value;
    if (!source || !snapshot) {
        return [];
    }
    if (source.kind === "library-node") {
        return [source.previewNodeId];
    }
    const sourceNode = findNode(snapshot, source.nodeId);
    return sourceNode ? collectNodeIds(sourceNode) : [source.nodeId];
});

const filteredComponentGroups = computed<ComponentLibraryGroupView[]>(() => {
    const keyword = componentSearch.value.trim().toLowerCase();
    const groups = new Map<ComponentLibraryGroup, ComponentLibraryItem[]>();
    for (const item of componentLibrary) {
        if (activeComponentGroup.value !== "all" && item.group !== activeComponentGroup.value) {
            continue;
        }
        if (keyword && !`${item.label} ${item.description}`.toLowerCase().includes(keyword)) {
            continue;
        }
        const current = groups.get(item.group) ?? [];
        current.push(item);
        groups.set(item.group, current);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({
        group,
        label: groupLabels[group],
        items,
    }));
});

const variableGroups = computed<PreviewVariableGroup[]>(() => {
    if (previewVariableGroups.value.length > 0) {
        return previewVariableGroups.value;
    }
    return mapPreviewVariableGroups(detail.value?.variables ?? []);
});
const compactComponentGroups = computed<ComponentLibraryGroupView[]>(() => {
    const groups = new Map<ComponentLibraryGroup, ComponentLibraryItem[]>();
    for (const item of componentLibrary) {
        const current = groups.get(item.group) ?? [];
        current.push(item);
        groups.set(item.group, current);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({
        group,
        label: groupLabels[group],
        items,
    }));
});
const runtimeVariableGroups = computed<PreviewVariableGroup[]>(() => {
    return variableGroups.value.filter((group) => ["Input", "IDE", "Studio", "Agent", "Skills", "Runtime", "input", "scope", "skill", "runtime"].includes(group.group));
});
const filteredVariableGroups = computed<PreviewVariableGroup[]>(() => filterVariableGroups(variableGroups.value, variableSearch.value));
const filteredRuntimeVariableGroups = computed<PreviewVariableGroup[]>(() => filterVariableGroups(runtimeVariableGroups.value, variableSearch.value));
const dndSensors = [
    PointerSensor,
    KeyboardSensor,
];
const agentApi = useAgentSessionApi();
const notification = useNotification();

/**
 * 新建 profile 表单默认值。
 */
function createDefaultProfileForm(): NewProfileForm {
    return {
        profileKey: "agent.custom",
        kind: "basic",
        name: "Custom Agent",
        description: "",
        prompt: "你是一个自定义 Agent。根据用户输入完成任务，必要时使用工具。",
    };
}

/**
 * 构造用于同步线程 scope 的 IDE 客户端变量。
 */
function buildClientVariables() {
    return buildNovelIdeClientVariables({
        activePanel: novelIdeStore.activeLeftTab,
        theme: theme.value,
        novelId: novelIdeStore.currentProjectRoot,
        workspace: novelIdeStore.currentWorkspaceRoot || null,
        workspaceKind: novelIdeStore.workspaceKind,
        selectedFilePath: novelIdeStore.selectedFilePath || null,
        selectedStoryThreadId: novelIdeStore.selectedStoryThreadId,
        selectedStorySceneId: novelIdeStore.selectedStorySceneId,
        previousSelectedFilePath: null,
        fileChangedSinceLastSend: false,
        selectionVersion: 0,
    });
}

/**
 * 下拉项展示 profile 来源与加载状态。
 */
function formatCatalogDescription(item: AgentProfileCatalogItemDto | undefined): string {
    if (!item) {
        return "";
    }
    const sourceText = item.overrideState === "project_only"
        ? "项目覆盖"
        : item.source === "install"
            ? "已安装"
            : item.source === "project"
                ? "项目覆盖"
                : "内存契约";
    const statusText = formatLoadStatus(item.loadStatus);
    return `${sourceText} · ${item.kind ?? "unknown"} · ${statusText}`;
}

function formatLoadStatus(loadStatus: AgentProfileCatalogItemDto["loadStatus"]): string {
    switch (loadStatus) {
        case "loaded": return "已加载";
        case "not_compiled": return "未编译";
        case "compile_stale": return "需重新编译";
        case "compiled_load_failed": return "编译产物加载失败";
        case "source_error": return "源码错误";
        case "missing": return "缺失";
        default: return loadStatus;
    }
}

/**
 * 加载模板列表。
 */
async function loadTemplates(): Promise<void> {
    if (props.mode === "user-profile") {
        const files = await $fetch<AgentProfileFileItemDto[]>("/api/agent/profiles/files");
        profileCatalog.value = files.map((item) => fileItemToCatalogItem(item));
        profileFiles.value = files;
        templates.value = profileFiles.value
            .map((item) => ({
                name: item.profileKey ?? item.fileName,
                fileName: item.fileName,
                profileKey: item.profileKey,
            }));
    } else {
        templates.value = await $fetch<ProfileTemplateSummaryDto[]>("/api/agent/profile-templates");
    }
    selectedTemplate.value = resolveRefreshedTemplateSelection({
        mode: props.mode,
        templates: templates.value,
        currentTemplate: selectedTemplate.value,
        preferredTemplate: props.preferredTemplate,
    });
}

/**
 * 读取当前模式的模板详情。
 */
async function fetchTemplateDetail(): Promise<ProfileTemplateDetailDto> {
    if (props.mode === "user-profile") {
        const nextDetail = await $fetch<ProfileTemplateDetailDto>("/api/agent/profiles/source-draft", {
            method: "POST",
            body: {fileName: selectedTemplate.value},
        });
        profileDetail.value = null;
        return nextDetail;
    }
    profileDetail.value = null;
    return await $fetch<ProfileTemplateDetailDto>(`/api/agent/profile-templates/${selectedTemplate.value}`);
}

/**
 * 加载 leader 线程，默认选择最近一条用于预览变量。
 */
async function loadThreads(): Promise<void> {
    loadingThreads.value = true;
    try {
        const page = await agentApi.listSessions({
            ...(novelIdeStore.workspaceKind === "novel" && novelIdeStore.currentProjectRoot
                ? {scope: "project" as const, projectRoot: novelIdeStore.currentProjectRoot}
                : {scope: "workspace-root" as const}),
            limit: 200,
        });
        threads.value = page.items
            .filter((session) => session.profileKey === currentThreadProfileKey());
        if (!selectedThreadId.value || !threads.value.some((thread) => String(thread.sessionId) === selectedThreadId.value)) {
            selectedThreadId.value = threads.value[0]?.sessionId ? String(threads.value[0].sessionId) : "";
        }
    } finally {
        loadingThreads.value = false;
    }
}

/**
 * 加载当前模板详情。
 */
async function loadTemplate(): Promise<void> {
    if (!selectedTemplate.value) {
        return;
    }
    loading.value = true;
    try {
        const nextDetail = await fetchTemplateDetail();
        applyTemplateDetail(nextDetail, props.mode === "user-profile" ? "已加载用户 profile" : "已加载模板");
    } finally {
        loading.value = false;
    }
}

/**
 * 请求预览并同步规范化源码。
 */
async function previewTemplate(): Promise<void> {
    if (!sourceText.value) {
        return;
    }
    previewing.value = true;
    statusText.value = "正在生成 Prompt 预览...";
    try {
        const result = props.mode === "user-profile"
            ? await previewPreparedProfile()
            : await $fetch<ProfileTemplatePreviewDto>("/api/agent/profile-templates/preview", {
                method: "POST",
                headers: buildAgentPreviewHeaders(),
                body: {
                    source: sourceText.value,
                    sessionId: selectedThreadId.value || undefined,
                },
            });
        issues.value = result.issues;
        if (result.root && !result.issues.some((issue) => issue.severity === "error")) {
            root.value = reconcileNodeIds(root.value, result.root);
            if (root.value && !findNode(root.value, selectedNodeId.value)) {
                selectedNodeId.value = findFirstEditableNodeId(root.value);
            }
        }
        previewMessages.value = result.messages;
        previewVariableGroups.value = mapPreviewVariableGroups(result.variables);
        const timeText = new Date().toLocaleTimeString("zh-CN", {hour12: false});
        previewUpdatedAt.value = timeText;
        statusText.value = result.issues.some((issue) => issue.severity === "error")
            ? `预览存在错误 · ${timeText}`
            : `预览已更新：${result.messages.length} 条消息 · ${timeText}`;
    } catch (error) {
        const message = describeFetchError(error);
        issues.value = [{
            severity: "error",
            message: `预览失败：${message}`,
        }];
        previewMessages.value = [];
        statusText.value = "预览失败，详情见右侧问题面板";
    } finally {
        previewing.value = false;
    }
}

/**
 * 用户 profile 模式下用后台 worker dry-run 当前源码，不写 runtime `.compiled`。
 */
async function previewPreparedProfile(): Promise<ProfileTemplatePreviewDto> {
    return (await previewPreparedProfileResult()).previewResult;
}

/**
 * 用户 profile 模式下执行 dry-run，并返回本次 dry-run 对应的 runtime detail。
 */
async function previewPreparedProfileResult(): Promise<{
    previewResult: ProfileTemplatePreviewDto;
    detailResult: AgentProfileDetailDto | null;
}> {
    const submittedFileName = selectedTemplate.value;
    const submittedSource = sourceText.value;
    try {
        const result = await $fetch<AgentProfileCompileResultDto>("/api/agent/profiles/compile", {
            method: "POST",
            headers: buildAgentPreviewHeaders(),
            body: {
                fileName: submittedFileName,
                source: submittedSource,
                dryRun: true,
                preview: true,
                sessionId: selectedThreadId.value || undefined,
            },
        });
        if (selectedTemplate.value !== submittedFileName || sourceText.value !== submittedSource) {
            return {
                previewResult: {
                    source: sourceText.value,
                    root: root.value,
                    issues: [],
                    messages: [],
                    variables: [],
                },
                detailResult: null,
            };
        }
        if (result.detail) {
            detail.value = templateDetailFromProfile(result.detail);
            profileDetail.value = result.detail;
        }
        return {
            previewResult: {
                source: submittedSource,
                root: result.detail?.root ?? root.value,
                issues: profileIssuesToTemplate(result.issues),
                messages: result.preview?.messages ?? [],
                variables: profileVariablesToTemplate(result.preview?.variables ?? result.detail?.variables ?? []),
            },
            detailResult: result.detail,
        };
    } catch (error) {
        return {
            previewResult: {
                source: sourceText.value,
                root: root.value,
                issues: [{
                    severity: "error",
                    message: describeFetchError(error),
                }],
                messages: [],
                variables: [],
            },
            detailResult: null,
        };
    }
}

/**
 * 轻量文件列表项转成下拉展示元数据，不触发 runtime catalog。
 */
function fileItemToCatalogItem(item: AgentProfileFileItemDto): AgentProfileCatalogItemDto {
    return {
        profileKey: item.profileKey ?? item.fileName,
        kind: "agent",
        name: item.name,
        description: null,
        fileName: item.fileName,
        source: "project",
        overrideState: "project_only",
        creationMode: "public",
        loadStatus: item.loadStatus,
        schemaLocked: false,
        canEdit: true,
        canRestore: true,
        issues: item.issues,
    };
}

/**
 * 构造 profile 预览请求头。
 */
function buildAgentPreviewHeaders(): HeadersInit {
    return {};
}

/**
 * 打开独立预览调试弹窗。
 */
async function openPreviewDialog(): Promise<void> {
    previewDialogOpen.value = true;
    await previewTemplate();
}

/**
 * 校验当前模板树。
 */
async function validateTemplate(): Promise<void> {
    if (!sourceText.value) {
        return;
    }
    validating.value = true;
    try {
        const result = props.mode === "user-profile"
            ? await validateUserProfile()
            : await $fetch<ProfileTemplateDetailDto>("/api/agent/profile-templates/validate", {
                method: "POST",
                body: {source: sourceText.value},
            });
        const resultIssues = props.mode === "user-profile"
            ? [
                ...profileIssuesToTemplate((result as ProfileValidationResult).detail.issues),
                ...profileIssuesToTemplate((result as ProfileValidationResult).preview?.issues ?? []),
            ]
            : (result as ProfileTemplateDetailDto).issues;
        issues.value = resultIssues;
        const resultRoot = props.mode === "user-profile"
            ? (result as ProfileValidationResult).detail.root
            : (result as ProfileTemplateDetailDto).root;
        if (resultRoot && !resultIssues.some((issue) => issue.severity === "error")) {
            root.value = reconcileNodeIds(root.value, resultRoot);
            if (root.value && !findNode(root.value, selectedNodeId.value)) {
                selectedNodeId.value = findFirstEditableNodeId(root.value);
            }
        }
        statusText.value = resultIssues.some((issue) => issue.severity === "error") ? "校验未通过" : validationSuccessText(result);
    } finally {
        validating.value = false;
    }
}

/**
 * 顶部“编译”按钮的真实入口，只编译当前选中的用户 profile。
 */
async function compileSelectedProfile(): Promise<void> {
    if (props.mode !== "user-profile" || !sourceText.value || compileState.value === "running") {
        return;
    }
    const result = await compileUserProfile({notify: true});
    const resultIssues = profileIssuesToTemplate(result.issues);
    issues.value = resultIssues;
    if (result.detail) {
        detail.value = templateDetailFromProfile(result.detail);
        profileDetail.value = result.detail;
        if (result.detail.root && !resultIssues.some((issue) => issue.severity === "error")) {
            root.value = reconcileNodeIds(root.value, result.detail.root);
            if (root.value && !findNode(root.value, selectedNodeId.value)) {
                selectedNodeId.value = findFirstEditableNodeId(root.value);
            }
        }
        previewVariableGroups.value = mapPreviewVariableGroups(detail.value.variables);
    }
    if (result.preview) {
        previewMessages.value = result.preview.messages;
        previewVariableGroups.value = mapPreviewVariableGroups(profileVariablesToTemplate(result.preview.variables));
    }
    if (result.ok) {
        notification.success("当前 profile 编译通过");
    }
}

/**
 * 顶部“编译全部”入口，编译 user-assets 下全部用户 profile。
 */
async function compileAllProfiles(): Promise<void> {
    if (props.mode !== "user-profile" || compilingAll.value || compileState.value === "running") {
        return;
    }
    const submittedFileName = selectedTemplate.value;
    const submittedSource = sourceText.value;
    await persistTemplate(false);
    if (lastSaveError.value) {
        const message = `保存失败，无法编译全部：${lastSaveError.value}`;
        statusText.value = message;
        notification.error(message, {title: "编译全部失败"});
        return;
    }
    if (selectedTemplate.value !== submittedFileName || sourceText.value !== submittedSource || dirty.value) {
        const message = "源码仍在解析或保存后又发生变化，请等待源码同步后重新编译全部。";
        statusText.value = message;
        notification.error(message, {title: "编译全部未开始"});
        return;
    }
    compilingAll.value = true;
    statusText.value = "编译全部中...";
    try {
        const result = await $fetch<AgentProfileCompileResultDto>("/api/agent/profiles/compile-all", {
            method: "POST",
            headers: buildAgentPreviewHeaders(),
            body: {},
        });
        await loadTemplates();
        const currentItem = profileFiles.value.find((item) => item.fileName === selectedTemplate.value);
        if (currentItem?.loadStatus === "loaded") {
            const nextDetail = await fetchTemplateDetail();
            applyTemplateDetail(nextDetail, "编译全部完成");
            compileState.value = "passed";
            compiledSourceText.value = sourceText.value;
        }
        issues.value = profileIssuesToTemplate(result.issues);
        statusText.value = result.ok
            ? `编译全部完成：${String(result.compiledCount ?? 0)} 个 profile`
            : "编译全部完成，但存在错误";
        if (result.ok) {
            notification.success(`已编译 ${String(result.compiledCount ?? 0)} 个 profile`);
        } else {
            notification.error(result.issues[0]?.message ?? "部分 profile 编译失败", {title: "编译全部失败"});
        }
    } catch (error) {
        const message = describeFetchError(error);
        issues.value = [{
            severity: "error",
            message,
        }];
        statusText.value = `编译全部失败：${message}`;
        notification.error(message, {title: "编译全部失败"});
    } finally {
        compilingAll.value = false;
    }
}

/**
 * user-profile 显式验证：当前源码契约、真实 prepare 和 report_result schema 一起跑。
 */
async function validateUserProfile(): Promise<ProfileValidationResult> {
    const {previewResult, detailResult} = await previewPreparedProfileResult();
    if (!detailResult) {
        previewMessages.value = [];
        return {
            detail: emptyProfileDetail(templateIssuesToProfile(previewResult.issues)),
            preview: null,
        };
    }
    detail.value = templateDetailFromProfile(detailResult);
    previewVariableGroups.value = mapPreviewVariableGroups(detail.value.variables);
    if (previewResult.messages.length === 0) {
        previewMessages.value = [];
        return {
            detail: detailResult,
            preview: null,
        };
    }
    previewMessages.value = previewResult.messages;
    previewVariableGroups.value = mapPreviewVariableGroups(previewResult.variables);
    return {
        detail: detailResult,
        preview: {
            ok: !previewResult.issues.some((issue) => issue.severity === "error"),
            profileKey: detailResult.manifest?.key ?? detailResult.catalogItem.profileKey,
            messages: previewResult.messages,
            variables: templateVariablesToProfile(previewResult.variables),
            issues: templateIssuesToProfile(previewResult.issues),
            persistedMessageCount: 0,
            reportResultSchema: detailResult.reportResultSchema,
        },
    };
}

/**
 * 根据验证结果生成简短状态。
 */
function validationSuccessText(result: ProfileTemplateDetailDto | ProfileValidationResult): string {
    if (props.mode !== "user-profile") {
        return "校验通过";
    }
    const validation = result as ProfileValidationResult;
    const hasReportSchema = Boolean(validation.detail.reportResultSchema || validation.preview?.reportResultSchema);
    const reportSchemaText = hasReportSchema ? "report_result schema 已生成" : "无 report_result";
    const messageCount = validation.preview?.messages.length ?? 0;
    return `校验通过 · prepare ${messageCount} 条消息 · ${reportSchemaText}`;
}

/**
 * 手动编译当前用户 profile。真实 TSX loader 在后端 worker 中执行并写 `.compiled`。
 */
async function compileUserProfile(options: {notify?: boolean} = {}): Promise<AgentProfileCompileResultDto> {
    const submittedFileName = selectedTemplate.value;
    const submittedSource = sourceText.value;
    await persistTemplate(false);
    if (lastSaveError.value) {
        compileState.value = "failed";
        const message = `保存失败，无法编译：${lastSaveError.value}`;
        statusText.value = message;
        if (options.notify) {
            notification.error(message, {title: "编译失败"});
        }
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [{
                severity: "error",
                message,
                code: "compile_failed",
                fileName: submittedFileName,
            }],
        };
    }
    if (selectedTemplate.value !== submittedFileName || sourceText.value !== submittedSource || dirty.value) {
        compileState.value = "stale";
        const message = "源码仍在解析或保存后又发生变化，请等待源码同步后重新编译。";
        statusText.value = message;
        if (options.notify) {
            notification.error(message, {title: "编译未开始"});
        }
        return staleCompileResult();
    }
    compileState.value = "running";
    statusText.value = "编译中...";
    try {
        const result = await $fetch<AgentProfileCompileResultDto>("/api/agent/profiles/compile", {
            method: "POST",
            headers: buildAgentPreviewHeaders(),
            body: {
                fileName: submittedFileName,
                preview: true,
                sessionId: selectedThreadId.value || undefined,
            },
        });
        if (result.stale || selectedTemplate.value !== submittedFileName || sourceText.value !== submittedSource) {
            compileState.value = "stale";
            statusText.value = "源码已修改，需重新编译";
            return staleCompileResult(result);
        }
        profileDetail.value = result.detail;
        compiledSourceText.value = submittedSource;
        compileState.value = result.ok ? "passed" : "failed";
        statusText.value = result.ok ? "编译通过" : "编译失败";
        await loadTemplates();
        return result;
    } catch (error) {
        if (selectedTemplate.value !== submittedFileName || sourceText.value !== submittedSource) {
            compileState.value = "stale";
            statusText.value = "源码已修改，需重新编译";
            return staleCompileResult();
        }
        compileState.value = "failed";
        const message = describeFetchError(error);
        statusText.value = `编译失败：${message}`;
        if (options.notify) {
            notification.error(message, {title: "编译失败"});
        }
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [{
                severity: "error",
                message,
                code: "compile_failed",
                fileName: submittedFileName,
            }],
        };
    }
}

/**
 * 编译结果已不再对应当前源码时，不把旧 detail/preview 写回 UI。
 */
function staleCompileResult(result?: AgentProfileCompileResultDto): AgentProfileCompileResultDto {
    return {
        ok: false,
        stale: true,
        detail: null,
        preview: null,
        issues: [],
        elapsedMs: result?.elapsedMs,
    };
}

/**
 * 画布辅助编辑后只做轻量 DSL 解析，不自动触发真实 prepare 或写 `.compiled`。
 */
function refreshDraftAfterCanvasEdit(): void {
    if (props.mode === "user-profile") {
        void validateSourceTextNow("源码已同步");
        return;
    }
    void previewTemplate();
}

/**
 * 编译完全失败时给旧验证返回一个占位 detail，避免 UI 需要处理 null。
 */
function emptyProfileDetail(compileIssues: AgentProfileIssueDto[]): AgentProfileDetailDto {
    return {
        catalogItem: {
            profileKey: `invalid:${selectedTemplate.value}`,
            kind: "agent",
            name: selectedTemplate.value,
            description: null,
            fileName: selectedTemplate.value,
            source: "project",
            overrideState: "project_only",
            creationMode: "public",
            loadStatus: "source_error",
            schemaLocked: false,
            canEdit: true,
            canRestore: true,
            issues: compileIssues,
        },
        manifest: null,
        fileName: selectedTemplate.value,
        source: sourceText.value,
        issues: compileIssues,
        variables: [],
        toolKeys: [],
        initialSchema: {
            jsonSchema: null,
            editMode: "source",
            reason: "编译失败，无法读取 InitialSchema。",
            sourceRange: null,
        },
        payloadSchema: {
            jsonSchema: null,
            editMode: "source",
            reason: "编译失败，无法读取 PayloadSchema。",
            sourceRange: null,
        },
        outputSchema: {
            jsonSchema: null,
            editMode: "source",
            reason: "编译失败，无法读取 OutputSchema。",
            sourceRange: null,
        },
        reportResultSchema: null,
        root: root.value,
    };
}

/**
 * 保存当前模板。
 */
async function saveTemplate(): Promise<void> {
    await persistTemplate(false);
}

/**
 * 用户 assets 模式下恢复系统同路径 profile。
 */
async function restoreTemplate(): Promise<void> {
    if (props.mode !== "user-profile" || !selectedTemplate.value || restoring.value) {
        return;
    }
    restoring.value = true;
    try {
        await $fetch("/api/agent/profiles/delete", {
            method: "POST",
            body: {fileName: selectedTemplate.value},
        });
        await loadTemplates();
        const result = await fetchTemplateDetail();
        applyTemplateDetail(result, "已恢复系统版本");
        notification.success("已恢复系统 profile");
    } catch (error) {
        lastSaveError.value = describeFetchError(error);
        statusText.value = `恢复失败：${lastSaveError.value}`;
        notification.error(lastSaveError.value, {title: "恢复系统版本失败"});
    } finally {
        restoring.value = false;
    }
}

/**
 * 打开新建 profile 弹窗。
 */
function openCreateProfileDialog(): void {
    newProfileForm.value = createDefaultProfileForm();
    createDialogOpen.value = true;
}

/**
 * 同步 profile kind 与 key 前缀。
 */
function updateNewProfileKind(value: string): void {
    const kind = value === "report" ? "report" : "basic";
    const currentKey = newProfileForm.value.profileKey.trim();
    newProfileForm.value = {
        ...newProfileForm.value,
        kind,
        prompt: kind === "report"
            ? "你是一个自定义报告 Agent。完成任务后调用 report_result，并在 walkthrough 中总结过程和结论。"
            : "你是一个自定义 Agent。根据用户输入完成任务，必要时使用工具。",
        profileKey: currentKey || "agent.custom",
    };
}

/**
 * 创建用户 assets profile。
 */
async function createUserProfile(): Promise<void> {
    if (props.mode !== "user-profile" || creating.value) {
        return;
    }
    creating.value = true;
    try {
        const created = await $fetch<ProfileTemplateDetailDto>("/api/agent/profiles/create", {
            method: "POST",
            body: {
                profileKey: newProfileForm.value.profileKey,
                templateName: newProfileForm.value.kind === "report" ? "report-agent" : "basic-agent",
                name: newProfileForm.value.name,
                description: newProfileForm.value.description || undefined,
                systemPrompt: newProfileForm.value.prompt,
            },
        });
        createDialogOpen.value = false;
        selectedTemplate.value = created.fileName;
        await loadTemplates();
        const result = await fetchTemplateDetail();
        applyTemplateDetail(result, "已创建用户 profile");
        notification.success("已创建用户 profile");
    } catch (error) {
        notification.error(describeFetchError(error), {title: "创建 profile 失败"});
    } finally {
        creating.value = false;
    }
}

/**
 * 用当前 profile 创建真实 Agent session，但不自动 invoke。
 */
async function createSessionForProfile(): Promise<void> {
    if (props.mode !== "user-profile" || !profileCompileReady.value || !selectedProfileKey.value) {
        notification.error("当前 profile 需要先编译通过，才能创建 session。", {title: "创建 Session 失败"});
        return;
    }
    try {
        const created = await agentApi.createSession({
            profileKey: selectedProfileKey.value,
            initial: {},
            currentProjectRoot: novelIdeStore.workspaceKind === "novel" ? novelIdeStore.currentProjectRoot || undefined : undefined,
        });
        notification.success(`已创建 session #${created.sessionId}`);
        await loadThreads();
        selectedThreadId.value = String(created.sessionId);
    } catch (error) {
        notification.error(describeFetchError(error), {title: "创建 Session 失败"});
    }
}

/**
 * 低代码保存用户 profile 的 InitialSchema、PayloadSchema 或 OutputSchema。
 */
async function saveProfileSchema(payload: {schemaName: "InitialSchema" | "PayloadSchema" | "OutputSchema"; fields: AgentProfileSchemaFieldDto[]}): Promise<void> {
    if (props.mode !== "user-profile" || !selectedTemplate.value || saving.value) {
        return;
    }
    void payload;
    notification.error("TypeBox Schema Builder 第一版暂不开放写回，请在源码中编辑 InitialSchema / PayloadSchema / OutputSchema。", {title: "请使用源码编辑"});
}

/**
 * 保存当前源码到模板文件。
 */
async function persistTemplate(silent: boolean): Promise<void> {
    if (!sourceText.value || !selectedTemplate.value || parsingSource.value) {
        return;
    }
    if (props.mode !== "user-profile" && issueCount.value > 0) {
        return;
    }
    const savedSourceText = sourceText.value;
    if (silent) {
        autosaving.value = true;
    } else {
        clearAutosaveTimer();
        saving.value = true;
    }
    try {
        const result = await saveTemplateSource(savedSourceText);
        detail.value = result;
        if (sourceText.value === savedSourceText) {
            root.value = result.root ? reconcileNodeIds(root.value, result.root) : null;
            issues.value = result.issues;
            const currentRoot = root.value;
            if (currentRoot && !findNode(currentRoot, selectedNodeId.value)) {
                selectedNodeId.value = findFirstEditableNodeId(currentRoot);
            }
            dirty.value = false;
        } else {
            dirty.value = true;
            scheduleAutosave();
        }
        lastSaveError.value = "";
        lastSavedAt.value = new Date().toLocaleTimeString("zh-CN", {hour12: false});
        statusText.value = silent ? `已自动保存 · ${lastSavedAt.value}` : `已保存模板 · ${lastSavedAt.value}`;
    } catch (error) {
        lastSaveError.value = describeFetchError(error);
        statusText.value = silent ? `自动保存失败：${lastSaveError.value}` : `保存失败：${lastSaveError.value}`;
    } finally {
        if (silent) {
            autosaving.value = false;
        } else {
            saving.value = false;
        }
    }
}

/**
 * 应用服务端返回的模板详情并重置编辑状态。
 */
function applyTemplateDetail(nextDetail: ProfileTemplateDetailDto, status: string): void {
    detail.value = nextDetail;
    sourceText.value = nextDetail.source;
    root.value = nextDetail.root ? cloneNode(nextDetail.root) : null;
    issues.value = nextDetail.issues;
    previewVariableGroups.value = mapPreviewVariableGroups(nextDetail.variables);
    selectedNodeId.value = nextDetail.root ? findFirstEditableNodeId(nextDetail.root) : "";
    previewMessages.value = [];
    undoStack.value = [];
    redoStack.value = [];
    dirty.value = false;
    lastSaveError.value = "";
    lastSavedAt.value = "";
    const selectedCatalogItem = selectedProfileCatalogItem.value;
    compileState.value = props.mode === "user-profile" && selectedCatalogItem?.loadStatus === "loaded" ? "passed" : props.mode === "user-profile" ? "never" : compileState.value;
    compiledSourceText.value = props.mode === "user-profile" && selectedCatalogItem?.loadStatus === "loaded" ? nextDetail.source : "";
    clearAutosaveTimer();
    clearSourceEditHistory();
    resetDragState();
    statusText.value = status;
}

/**
 * 保存当前模式的完整源码。
 */
async function saveTemplateSource(source: string): Promise<ProfileTemplateDetailDto> {
    if (props.mode === "user-profile") {
        const saved = await $fetch<ProfileTemplateDetailDto>("/api/agent/profiles/save", {
            method: "POST",
            body: {
                fileName: selectedTemplate.value,
                source,
            },
        });
        await loadTemplates();
        return saved;
    }
    return await $fetch<ProfileTemplateDetailDto>(`/api/agent/profile-templates/${selectedTemplate.value}`, {
        method: "PUT",
        body: {source},
    });
}

/**
 * 当前选中 profile key。
 */
function currentThreadProfileKey(): string {
    if (props.mode !== "user-profile") {
        return props.threadProfileKey;
    }
    if (detail.value?.name && detail.value.name !== selectedTemplate.value) {
        return detail.value.name;
    }
    const selected = profileCatalog.value.find((item) => item.fileName === selectedTemplate.value);
    return selected?.profileKey ?? profileDetail.value?.manifest?.key ?? profileDetail.value?.catalogItem.profileKey ?? props.threadProfileKey;
}

/**
 * 将 runtime profile 变量 DTO 转成旧模板编辑器变量 DTO。
 */
function profileVariablesToTemplate(groups: AgentProfileDetailDto["variables"]): ProfileTemplateDetailDto["variables"] {
    return groups.map((group) => ({
        group: group.group,
        items: group.items.map((item) => ({
            label: item.label,
            value: item.value,
            path: item.path,
            editable: item.editable,
            valueType: item.valueType ?? "unknown",
            source: item.source ?? "profile",
            schema: item.schema ?? null,
        })),
    }));
}

/**
 * 将旧三栏 UI 的变量 DTO 转回 runtime preview DTO。
 */
function templateVariablesToProfile(groups: ProfileTemplateDetailDto["variables"]): AgentProfileDetailDto["variables"] {
    return groups.map((group) => ({
        group: group.group,
        items: group.items.map((item) => ({
            label: item.label,
            value: item.value,
            path: item.path,
            editable: item.editable,
            valueType: item.valueType ?? null,
            source: item.source ?? null,
            schema: (item.schema ?? null) as AgentProfileDetailDto["variables"][number]["items"][number]["schema"],
        })),
    }));
}

/**
 * 添加组件到当前选中节点。
 */
function addNode(type: ProfileTemplateNodeType): void {
    if (!ensureDerivedTreeEditable()) {
        return;
    }
    if (!root.value) {
        root.value = createNode("ProfilePrompt");
        selectedNodeId.value = root.value.id;
    }
    const parent = selectedNode.value && canHaveChildren(selectedNode.value.type)
        ? selectedNode.value
        : root.value;
    const node = createNode(type);
    if (!canInsertNodeIntoParentInTree(root.value, parent, node)) {
        statusText.value = `${node.type} 不能放到当前容器`;
        return;
    }
    pushHistory();
    parent.children.push(node);
    selectedNodeId.value = node.id;
    syncSourceTextFromRoot();
    inspectorTab.value = "props";
    refreshDraftAfterCanvasEdit();
}

/**
 * 删除指定节点。
 */
function deleteNode(id: string = selectedNodeId.value): void {
    if (!ensureDerivedTreeEditable()) {
        return;
    }
    if (!root.value || id === root.value.id) {
        return;
    }
    pushHistory();
    removeNode(root.value, id);
    selectedNodeId.value = findFirstEditableNodeId(root.value);
    syncSourceTextFromRoot();
    refreshDraftAfterCanvasEdit();
}

/**
 * 复制指定节点到同级后方。
 */
function duplicateNode(id: string): void {
    if (!ensureDerivedTreeEditable()) {
        return;
    }
    if (!root.value || id === root.value.id) {
        return;
    }
    const node = findNode(root.value, id);
    if (!node) {
        return;
    }
    const copy = cloneNodeWithNewIds(node);
    const parent = findParentOfNode(root.value, id);
    if (!parent || !canInsertNodeIntoParentInTree(root.value, parent, copy)) {
        statusText.value = `${copy.type} 不能复制到当前容器`;
        return;
    }
    pushHistory();
    if (!insertAfterNode(root.value, id, copy)) {
        statusText.value = "无法复制到当前节点位置";
        return;
    }
    selectedNodeId.value = copy.id;
    syncSourceTextFromRoot();
    refreshDraftAfterCanvasEdit();
}

/**
 * 更新节点属性。
 */
function updateProp(key: string, value: ProfileTemplatePropValue): void {
    if (!ensureDerivedTreeEditable() || !selectedNode.value) {
        return;
    }
    pushHistory();
    selectedNode.value.props[key] = value;
    refreshRootView();
    refreshDraftAfterCanvasEdit();
}

/**
 * 更新表达式属性，保留 TSX 源码而不是转成普通字符串。
 */
function updateExpressionProp(key: string, code: string): void {
    if (!ensureDerivedTreeEditable() || !selectedNode.value) {
        return;
    }
    pushHistory();
    selectedNode.value.props[key] = {
        kind: "expression",
        code,
    };
    refreshRootView();
    refreshDraftAfterCanvasEdit();
}

/**
 * 更新节点文本。
 */
function updateText(value: string): void {
    if (!ensureDerivedTreeEditable() || !selectedNode.value) {
        return;
    }
    if (pendingMessageTextNodeId.value !== selectedNode.value.id) {
        pushHistory();
    }
    selectedNode.value.text = value;
    pendingMessageTextNodeId.value = selectedNode.value.id;
}

/**
 * Message 正文失焦后再提交到源码和自动保存，避免每个字符触发 API。
 */
function commitMessageText(): void {
    if (!ensureDerivedTreeEditable() || !root.value || !pendingMessageTextNodeId.value) {
        return;
    }
    const pendingNode = findNode(root.value, pendingMessageTextNodeId.value);
    pendingMessageTextNodeId.value = "";
    if (!pendingNode) {
        return;
    }
    refreshRootView();
    refreshDraftAfterCanvasEdit();
}

/**
 * 确保当前源码已经成功解析，避免用旧画布树覆盖正在修复的源码。
 */
function ensureDerivedTreeEditable(): boolean {
    if (canEditDerivedTree.value) {
        return true;
    }
    statusText.value = parsingSource.value
        ? "源码解析中，暂不能编辑画布"
        : "源码存在错误，修复后才能编辑画布";
    return false;
}

/**
 * 切换变量分组折叠态。
 */
function toggleVariableGroup(group: string): void {
    collapsedVariableGroups.value = {
        ...collapsedVariableGroups.value,
        [group]: !collapsedVariableGroups.value[group],
    };
}

/**
 * 判断变量分组是否折叠；搜索时自动展开命中结果。
 */
function isVariableGroupCollapsed(group: string): boolean {
    return !variableSearch.value.trim() && Boolean(collapsedVariableGroups.value[group]);
}

/**
 * 处理节点拖拽开始，保存回滚快照。
 */
function handleNodeDragStart(event: DragStartPayload): void {
    const source = event.operation.source;
    if (!canEditDerivedTree.value || !root.value || !source || !isSupportedDragData(source.data)) {
        resetDragState(false);
        return;
    }

    dragSnapshot.value = cloneNode(root.value);
    dragVisualRoot.value = null;
    dropState.value = null;
    lastValidDropState.value = null;
    activeDragSource.value = isProfileTemplateLibraryDragData(source.data)
        ? {
            ...source.data,
            previewNodeId: createNodeId(source.data.type),
        }
        : source.data;

    if (isProfileTemplateNodeDragData(source.data)) {
        selectedNodeId.value = source.data.nodeId;
    }
}

/**
 * 拖拽前先选中节点，保证操作反馈和属性面板同步。
 */
function prepareNodeDrag(nodeId: string): void {
    if (!canEditDerivedTree.value) {
        return;
    }
    selectedNodeId.value = nodeId;
}

/**
 * 处理节点拖拽经过，仅拦截非法排序目标。
 */
function handleNodeDragOver(event: DragOverPayload): void {
    if (!canEditDerivedTree.value) {
        event.preventDefault();
        return;
    }
    const source = activeDragSource.value;
    const snapshot = dragSnapshot.value;
    if (!snapshot || !source) {
        event.preventDefault();
        return;
    }

    const nextDropState = readDropState(event, snapshot);
    if (!nextDropState) {
        event.preventDefault();
        return;
    }

    if (!isSameDropState(lastValidDropState.value, nextDropState)) {
        const nextRoot = buildDragVisualRoot(snapshot, source, nextDropState);
        if (!nextRoot) {
            event.preventDefault();
            return;
        }
        dragVisualRoot.value = nextRoot.root;
        selectedNodeId.value = nextRoot.selectedNodeId;
    }

    lastValidDropState.value = nextDropState;
    dropState.value = nextDropState;
}

/**
 * 处理节点拖拽结束，提交当前预览位置，取消时回滚。
 */
function handleNodeDragEnd(event: DragEndPayload): void {
    if (!canEditDerivedTree.value) {
        resetDragState(false);
        return;
    }
    const snapshot = dragSnapshot.value;
    const source = activeDragSource.value;
    const finalDropState = lastValidDropState.value;
    dropState.value = null;

    if (event.canceled || !snapshot || !source || !finalDropState) {
        resetDragState(false);
        return;
    }

    const nextRoot = buildDragVisualRoot(snapshot, source, finalDropState);
    if (!nextRoot) {
        resetDragState(false);
        return;
    }

    pushHistory();
    root.value = nextRoot.root;
    selectedNodeId.value = nextRoot.selectedNodeId;
    syncSourceTextFromRoot();
    resetDragState(false);
    refreshDraftAfterCanvasEdit();
}

/**
 * 撤销最近一次编辑。
 */
function undoEdit(): void {
    const entry = undoStack.value.pop();
    if (!entry) {
        return;
    }
    redoStack.value.push({
        sourceText: sourceText.value,
        selectedNodeId: selectedNodeId.value,
    });
    applySourceSnapshot(entry);
}

/**
 * 重做最近一次撤销。
 */
function redoEdit(): void {
    const entry = redoStack.value.pop();
    if (!entry) {
        return;
    }
    undoStack.value.push({
        sourceText: sourceText.value,
        selectedNodeId: selectedNodeId.value,
    });
    applySourceSnapshot(entry);
}

/**
 * 记录编辑前快照。
 */
function pushHistory(snapshot: string | undefined = sourceText.value): void {
    if (!snapshot) {
        return;
    }
    undoStack.value.push({
        sourceText: snapshot,
        selectedNodeId: selectedNodeId.value,
    });
    if (undoStack.value.length > 80) {
        undoStack.value.shift();
    }
    redoStack.value = [];
}

/**
 * 应用 sourceText 历史快照，并重新解析出画布结构。
 */
function applySourceSnapshot(entry: HistoryEntry): void {
    sourceText.value = entry.sourceText;
    selectedNodeId.value = entry.selectedNodeId;
    clearSourceEditHistory();
    markDirtyAndScheduleAutosave();
    void validateSourceTextNow("历史已回退");
}

/**
 * 画布结构编辑完成后，以完整 TSX 文本刷新页面真相源。
 */
function syncSourceTextFromRoot(): void {
    if (!root.value) {
        return;
    }
    const previousSourceText = sourceText.value;
    syncingSourceFromCanvas = true;
    sourceText.value = props.mode === "user-profile"
        ? replacePromptRootSource(previousSourceText, root.value)
        : generateFullTemplateSource(selectedTemplate.value || "profile-template", root.value);
    markDirtyAndScheduleAutosave();
    queueMicrotask(() => {
        syncingSourceFromCanvas = false;
    });
}

/**
 * 用户 profile 是完整 TSX 文件，画布编辑只替换已解析的 ProfilePrompt 片段。
 */
function replacePromptRootSource(source: string, nextRoot: ProfileTemplateNodeDto): string {
    const range = editablePromptRange(nextRoot) ?? editablePromptRange(detail.value?.root ?? null);
    if (!range) {
        return source;
    }
    const nextSource = editablePromptText(nextRoot, source, range.start);
    return `${source.slice(0, range.start)}${nextSource}${source.slice(range.end)}`;
}

function editablePromptRange(node: ProfileTemplateNodeDto | null): ProfileTemplateNodeDto["sourceRange"] | undefined {
    if (!node || node.type !== "ProfilePrompt") {
        return undefined;
    }
    return node.sourceRange;
}

/**
 * 从画布树生成新的 ProfilePrompt JSX 片段。
 */
function editablePromptText(node: ProfileTemplateNodeDto, source: string, start: number): string {
    const lineStart = Math.max(source.lastIndexOf("\n", Math.max(0, start - 1)) + 1, 0);
    const linePrefix = source.slice(lineStart, start).match(/^[\t ]*/)?.[0] ?? "";
    return generateProfilePromptSource(node)
        .split("\n")
        .map((line, index) => index === 0 ? line : `${linePrefix}${line}`)
        .join("\n");
}

/**
 * 生成 Workbench 写回源码使用的 TSX 片段；复杂 source Text 保留为原表达式源码。
 */
function generateProfilePromptSource(node: ProfileTemplateNodeDto): string {
    if (node.type === "Text") {
        return renderPreviewNodeText(node);
    }
    if (node.type === "ToolCall") {
        return generateToolCallSource(node);
    }
    const props = generateProfilePromptProps(publicRuntimeProps(node));
    if (node.children.length === 0 && !node.text) {
        return `<${node.type}${props} />`;
    }
    const childLines = [
        node.text ? renderPreviewNodeText(node) : "",
        ...node.children.map((child) => generateProfilePromptSource(child)),
    ].filter(Boolean);
    return [
        `<${node.type}${props}>`,
        ...childLines.map((line) => indentPreviewSource(line, 1)),
        `</${node.type}>`,
    ].join("\n");
}

/**
 * ToolCall 的正文编辑区对应 runtime DSL 的 args 参数。
 */
function generateToolCallSource(node: ProfileTemplateNodeDto): string {
    const props = generateProfilePromptProps(publicRuntimeProps(node));
    const argsText = node.text?.trim();
    if (!argsText) {
        return `<ToolCall${props} />`;
    }
    return `<ToolCall${props} args={${argsText}} />`;
}

/**
 * 生成 TSX 属性源码。
 */
function generateProfilePromptProps(props: ProfileTemplateNodeDto["props"]): string {
    const chunks: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === "") {
            continue;
        }
        if (isExpressionValue(value)) {
            chunks.push(`${key}={${value.code}}`);
            continue;
        }
        if (typeof value === "string") {
            chunks.push(`${key}=${JSON.stringify(value)}`);
        } else {
            chunks.push(`${key}={${String(value)}}`);
        }
    }
    return chunks.length > 0 ? ` ${chunks.join(" ")}` : "";
}

/**
 * 源码编辑器内容变化后，延迟解析并同步画布。
 */
function handleSourceTextChange(value: string): void {
    if (value === sourceText.value) {
        return;
    }
    if (!syncingSourceFromCanvas && !sourceEditHistoryOpen) {
        pushHistory(sourceText.value);
        sourceEditHistoryOpen = true;
    }
    sourceText.value = value;
    parsingSource.value = true;
    markDirtyAndScheduleAutosave();
    scheduleSourceParse();
    if (sourceHistoryTimer) {
        window.clearTimeout(sourceHistoryTimer);
    }
    sourceHistoryTimer = window.setTimeout(() => {
        sourceEditHistoryOpen = false;
        sourceHistoryTimer = null;
    }, 1200);
}

/**
 * 源码编辑防抖解析。
 */
function scheduleSourceParse(): void {
    if (sourceParseTimer) {
        window.clearTimeout(sourceParseTimer);
    }
    sourceParseTimer = window.setTimeout(() => {
        sourceParseTimer = null;
        void validateSourceTextNow("源码已同步");
    }, 500);
}

/**
 * 立即用服务端受限 DSL 解析当前源码。
 */
async function validateSourceTextNow(successText: string): Promise<void> {
    if (!sourceText.value) {
        root.value = null;
        issues.value = [];
        return;
    }
    const version = ++sourceParseVersion;
    parsingSource.value = true;
    try {
        const result = props.mode === "user-profile"
            ? await $fetch<ProfileTemplateDetailDto>("/api/agent/profiles/source-draft", {
                method: "POST",
                body: {
                    fileName: selectedTemplate.value,
                    source: sourceText.value,
                },
            })
            : await $fetch<ProfileTemplateDetailDto>("/api/agent/profile-templates/validate", {
                method: "POST",
                body: {source: sourceText.value},
            });
        if (version !== sourceParseVersion) {
            return;
        }
        const nextDetail: ProfileTemplateDetailDto = props.mode === "user-profile"
            ? result as ProfileTemplateDetailDto
            : result as ProfileTemplateDetailDto;
        detail.value = nextDetail;
        issues.value = nextDetail.issues;
        previewVariableGroups.value = mapPreviewVariableGroups(nextDetail.variables);
        if (nextDetail.root && !nextDetail.issues.some((issue) => issue.severity === "error")) {
            root.value = reconcileNodeIds(root.value, nextDetail.root);
            if (root.value && !findNode(root.value, selectedNodeId.value)) {
                selectedNodeId.value = findFirstEditableNodeId(root.value);
            }
            statusText.value = successText;
            if (dirty.value && autosaveEnabled.value) {
                scheduleAutosave();
            }
        } else {
            statusText.value = "源码未解析，画布显示上一份可用结构";
        }
    } catch (error) {
        if (version !== sourceParseVersion) {
            return;
        }
        issues.value = [{
            severity: "error",
            message: `源码解析失败：${describeFetchError(error)}`,
        }];
        statusText.value = "源码未解析，画布显示上一份可用结构";
    } finally {
        if (version === sourceParseVersion) {
            parsingSource.value = false;
        }
    }
}

/**
 * 将 runtime profile detail 转成旧三栏 UI 使用的模板 detail。
 */
function templateDetailFromProfile(profile: AgentProfileDetailDto): ProfileTemplateDetailDto {
    return {
        name: profile.catalogItem.profileKey,
        fileName: profile.fileName ?? selectedTemplate.value,
        source: profile.source,
        root: profile.root ?? null,
        issues: profileIssuesToTemplate(profile.issues),
        variables: profileVariablesToTemplate(profile.variables),
    };
}

/**
 * 将 runtime profile diagnostics 映射到旧三栏 UI 使用的问题 DTO。
 */
function profileIssuesToTemplate(profileIssues: AgentProfileIssueDto[]): ProfileTemplateIssueDto[] {
    return profileIssues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        path: [
            issue.code ? `code=${issue.code}` : "",
            issue.fileName ? `file=${issue.fileName}` : "",
            issue.profileKey ? `profile=${issue.profileKey}` : "",
        ].filter(Boolean).join(" "),
    }));
}

/**
 * 将旧三栏 UI 的问题 DTO 转回 runtime preview issue。
 */
function templateIssuesToProfile(templateIssues: ProfileTemplateIssueDto[]): AgentProfileIssueDto[] {
    return templateIssues.map((issue) => ({
        severity: issue.severity,
        message: issue.message,
        code: issue.path,
        fileName: selectedTemplate.value || undefined,
    }));
}

/**
 * 清理源码编辑批次状态。
 */
function clearSourceEditHistory(): void {
    sourceEditHistoryOpen = false;
    if (sourceHistoryTimer) {
        window.clearTimeout(sourceHistoryTimer);
        sourceHistoryTimer = null;
    }
}

/**
 * 标记模板源码已变更，并安排自动保存。
 */
function markDirtyAndScheduleAutosave(): void {
    dirty.value = true;
    if (props.mode === "user-profile") {
        compileState.value = compiledSourceText.value ? "stale" : "never";
    }
    lastSaveError.value = "";
    statusText.value = parsingSource.value
        ? (autosaveEnabled.value ? "源码解析中，等待自动保存" : "源码解析中")
        : "有未保存更改";
    if (autosaveEnabled.value) {
        scheduleAutosave();
    }
}

/**
 * 延迟自动保存，避免每次输入都写模板文件。
 */
function scheduleAutosave(delayMs: number = 1000): void {
    if (!autosaveEnabled.value) {
        return;
    }
    clearAutosaveTimer();
    autosaveTimer = window.setTimeout(() => {
        autosaveTimer = null;
        void runAutosave();
    }, delayMs);
}

/**
 * 尝试执行自动保存；源码未稳定时延后，源码有错误时保留 dirty。
 */
async function runAutosave(): Promise<void> {
    if (!dirty.value) {
        return;
    }
    if (parsingSource.value || saving.value || autosaving.value) {
        scheduleAutosave(800);
        return;
    }
    if (issueCount.value > 0) {
        statusText.value = "源码存在错误，已暂停自动保存";
        return;
    }
    await persistTemplate(true);
}

/**
 * 清理待执行的自动保存。
 */
function clearAutosaveTimer(): void {
    if (autosaveTimer) {
        window.clearTimeout(autosaveTimer);
        autosaveTimer = null;
    }
}

/**
 * 页面级撤销/重做快捷键，文本编辑器内部优先处理自己的 history。
 */
function handleEditorKeydown(event: KeyboardEvent): void {
    if ((!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== "z" || isTextEditingTarget(event.target)) {
        return;
    }
    if (event.shiftKey) {
        if (!canRedo.value) {
            return;
        }
        event.preventDefault();
        redoEdit();
        return;
    }
    if (!canUndo.value) {
        return;
    }
    event.preventDefault();
    undoEdit();
}

/**
 * 判断快捷键是否应交给当前文本编辑控件。
 */
function isTextEditingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return Boolean(target.closest([
        "input",
        "textarea",
        "select",
        "[contenteditable='true']",
        ".monaco-editor",
        ".ProseMirror",
        ".structured-text-editor",
    ].join(",")));
}

/**
 * 替换根引用，保证深层属性编辑后画布和 dnd 节点实时刷新。
 */
function refreshRootView(): void {
    if (!root.value) {
        return;
    }
    root.value = cloneNode(root.value);
    syncSourceTextFromRoot();
}

/**
 * 根据拖拽落点插入节点。
 */
function insertNodeAtDrop(rootNode: ProfileTemplateNodeDto, node: ProfileTemplateNodeDto, state: NonNullable<ProfileTemplateDropState>): boolean {
    const parent = findNode(rootNode, state.parentId);
    if (!parent) {
        return false;
    }
    if (!canInsertNodeIntoParentInTree(rootNode, parent, node)) {
        return false;
    }
    if (state.position === "inside") {
        parent.children.push(node);
        return true;
    }
    if (state.position === "root" || !state.targetId) {
        parent.children.push(node);
        return true;
    }
    const targetIndex = parent.children.findIndex((child) => child.id === state.targetId);
    if (targetIndex < 0) {
        return false;
    }
    parent.children.splice(state.position === "before" ? targetIndex : targetIndex + 1, 0, node);
    return true;
}

/**
 * 读取当前拖拽落点。
 */
function readDropState(event: DragOverPayload | DragEndPayload, baseRoot: ProfileTemplateNodeDto | null = dragSnapshot.value ?? root.value): ProfileTemplateDropState {
    const source = activeDragSource.value ?? event.operation.source?.data;
    const target = event.operation.target;
    if (!baseRoot || !source || !target || !isSupportedDragData(source) || !isProfileTemplateDropData(target.data)) {
        return null;
    }
    if (!findNode(baseRoot, target.data.parentId)) {
        return null;
    }
    if (target.data.targetId && !findNode(baseRoot, target.data.targetId)) {
        return null;
    }
    if (source.kind === "profile-template-node" && !canMoveNodeToDrop(baseRoot, source.nodeId, target.data)) {
        return null;
    }
    if (target.data.position === "inside") {
        const targetParent = findNode(baseRoot, target.data.parentId);
        if (!targetParent || !canHaveChildren(targetParent.type)) {
            return null;
        }
    }
    const sourceNode = source.kind === "library-node"
        ? createNode(source.type)
        : findNode(baseRoot, source.nodeId);
    const targetParent = findNode(baseRoot, target.data.parentId);
    if (!sourceNode || !targetParent || !canInsertNodeIntoParentInTree(baseRoot, targetParent, sourceNode)) {
        return null;
    }
    return {
        parentId: target.data.parentId,
        targetId: target.data.targetId,
        position: target.data.position,
    };
}

/**
 * 判断节点能否移动到目标落点。
 */
function canMoveNodeToDrop(rootNode: ProfileTemplateNodeDto, sourceId: string, target: ProfileTemplateDropData): boolean {
    if (sourceId === rootNode.id || sourceId === target.targetId || sourceId === target.parentId) {
        return false;
    }
    const sourceNode = findNode(rootNode, sourceId);
    if (!sourceNode) {
        return false;
    }
    return !containsNode(sourceNode, target.parentId);
}

/**
 * 判断 dnd-kit data 是否为支持的拖拽源。
 */
function isSupportedDragData(data: Data | undefined): data is ProfileTemplateNodeDragData | ProfileTemplateLibraryDragData {
    return isProfileTemplateNodeDragData(data) || isProfileTemplateLibraryDragData(data);
}

/**
 * 判断 dnd-kit data 是否为 profile 节点拖拽数据。
 */
function isProfileTemplateNodeDragData(data: Data | undefined): data is ProfileTemplateNodeDragData {
    return data?.kind === "profile-template-node"
        && typeof data.nodeId === "string"
        && typeof data.parentId === "string";
}

/**
 * 判断 dnd-kit data 是否为组件库拖拽数据。
 */
function isProfileTemplateLibraryDragData(data: Data | undefined): data is ProfileTemplateLibraryDragData {
    return data?.kind === "library-node" && isProfileTemplateNodeType(data.type);
}

/**
 * 判断 dnd-kit data 是否为 profile drop 落点数据。
 */
function isProfileTemplateDropData(data: Data | undefined): data is ProfileTemplateDropData {
    return data?.kind === "profile-template-drop"
        && typeof data.parentId === "string"
        && (typeof data.targetId === "string" || data.targetId === null)
        && ["before", "after", "inside", "root"].includes(String(data.position));
}

/**
 * 判断是否为可创建的节点类型。
 */
function isProfileTemplateNodeType(value: unknown): value is ProfileTemplateNodeType {
    return typeof value === "string" && componentLibrary.some((item) => item.type === value);
}

/**
 * 判断根落点是否激活。
 */
function isRootDropActive(): boolean {
    return Boolean(dropState.value && displayRoot.value && dropState.value.parentId === displayRoot.value.id && dropState.value.position === "root");
}

/**
 * 清理拖拽过程状态。
 */
function resetDragState(clearVisualRoot: boolean = true): void {
    if (clearVisualRoot) {
        dragVisualRoot.value = null;
    }
    dragSnapshot.value = null;
    activeDragSource.value = null;
    lastValidDropState.value = null;
    dropState.value = null;
}

/**
 * 对比两个落点是否一致。
 */
function isSameDropState(left: ProfileTemplateDropState, right: ProfileTemplateDropState): boolean {
    if (!left || !right) {
        return left === right;
    }
    return left.parentId === right.parentId
        && left.targetId === right.targetId
        && left.position === right.position;
}

/**
 * 根据当前拖拽源和落点生成视觉树或提交树。
 */
function buildDragVisualRoot(snapshot: ProfileTemplateNodeDto, source: NonNullable<ActiveDragSource>, state: NonNullable<ProfileTemplateDropState>): {root: ProfileTemplateNodeDto; selectedNodeId: string} | null {
    const nextRoot = cloneNode(snapshot);
    const insertedNode = source.kind === "library-node"
        ? createNodeWithId(source.type, source.previewNodeId)
        : removeNodeById(nextRoot, source.nodeId);
    if (!insertedNode || !insertNodeAtDrop(nextRoot, insertedNode, state)) {
        return null;
    }
    return {
        root: nextRoot,
        selectedNodeId: insertedNode.id,
    };
}

watch(selectedTemplate, () => {
    if (props.mode === "user-profile") {
        selectedThreadId.value = "";
        void loadThreads();
    }
    void loadTemplate();
});

watch(selectedThreadId, async () => {
    if (previewDialogOpen.value) {
        await previewTemplate();
    }
});

onMounted(async () => {
    // 已处于既有主题宿主内（如工作台 Dialog 内嵌场景）时不重复创建嵌套宿主；
    // 否则 Tooltip 等 fixed 浮层会被 Teleport 进 transform 容器内的嵌套宿主，fixed 定位基准失效。
    if (!themeHostRef.value?.closest(`.${IDE_THEME_HOST_CLASS}`)) {
        mountThemeHost(themeHostRef.value);
    }
    keyboardListener = handleEditorKeydown;
    window.addEventListener("keydown", keyboardListener);
    await Promise.all([
        loadTemplates(),
        loadThreads(),
    ]);
    await loadTemplate();
});

onBeforeUnmount(() => {
    if (keyboardListener) {
        window.removeEventListener("keydown", keyboardListener);
        keyboardListener = null;
    }
    if (sourceParseTimer) {
        window.clearTimeout(sourceParseTimer);
        sourceParseTimer = null;
    }
    clearAutosaveTimer();
    clearSourceEditHistory();
});
</script>

<template>
    <div ref="themeHostRef" class="tsx-profile-editor-page flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)] transition-colors duration-300" :class="props.mode === 'system-template' ? 'h-screen' : ''">
        <ProfileTemplateHeader
            v-model:selected-template="selectedTemplate"
            :title="props.mode === 'user-profile' ? 'TSX Profile 工作台' : 'TSX Profile 可视化编辑器'"
            :subtitle="props.mode === 'user-profile' ? '用户资产' : ''"
            :template-options="templateOptions"
            :editor-status-text="editorStatusText"
            :can-undo="canUndo"
            :can-redo="canRedo"
            :previewing="previewing"
            :validating="validating"
            :saving="saving"
            :restoring="restoring"
            :compiling="compileState === 'running'"
            :compiling-all="compilingAll"
            :parsing-source="parsingSource"
            :source-text="sourceText"
            :issue-count="issueCount"
            :restore-enabled="canRestoreSelectedTemplate"
            :create-enabled="props.mode === 'user-profile'"
            :run-enabled="props.mode === 'user-profile'"
            :compile-enabled="props.mode === 'user-profile'"
            :compile-all-enabled="props.mode === 'user-profile'"
            :run-disabled="!profileCompileReady"
            :allow-save-with-issues="props.mode === 'user-profile'"
            :validate-label="props.mode === 'user-profile' ? '编译' : '验证'"
            :closable="props.closable"
            @undo="undoEdit"
            @redo="redoEdit"
            @preview="void openPreviewDialog()"
            @validate="void validateTemplate()"
            @compile="void compileSelectedProfile()"
            @compile-all="void compileAllProfiles()"
            @restore="void restoreTemplate()"
            @create="openCreateProfileDialog"
            @run="void createSessionForProfile()"
            @save="void saveTemplate()"
            @close="emit('close')"
        />

        <DragDropProvider
            :plugins="defaultPreset.plugins"
            :sensors="dndSensors"
            @drag-start="handleNodeDragStart"
            @drag-over="handleNodeDragOver"
            @drag-end="handleNodeDragEnd"
        >
            <main
                class="grid min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3"
                :class="[
                    libraryPanelCollapsed ? 'grid-cols-[52px_minmax(560px,1fr)_minmax(360px,30vw)]' : 'grid-cols-[290px_minmax(560px,1fr)_minmax(360px,30vw)]',
                    inspectorPanelCollapsed ? (libraryPanelCollapsed ? '!grid-cols-[52px_minmax(560px,1fr)_52px]' : '!grid-cols-[290px_minmax(560px,1fr)_52px]') : '',
                ]"
            >
            <aside v-if="libraryPanelCollapsed" class="component-rail">
                <Tooltip text="展开组件库" placement="right">
                    <button type="button" class="rail-icon-btn" @click="libraryPanelCollapsed = false">
                        <span class="i-lucide-panel-left-open h-4 w-4"></span>
                    </button>
                </Tooltip>
                <div class="rail-divider"></div>
                <div class="component-rail-scroll custom-scrollbar">
                    <template v-for="group in compactComponentGroups" :key="group.group">
                        <div class="rail-group-divider" :title="group.label"></div>
                        <Tooltip
                            v-for="item in group.items"
                            :key="item.type"
                            :text="`${group.label} / ${item.label}：${item.description}`"
                            placement="right"
                        >
                            <button
                                type="button"
                                class="rail-icon-btn"
                                :class="`library-node-${item.type}`"
                                @click="addNode(item.type)"
                            >
                                <span :class="item.iconClass" class="h-4 w-4"></span>
                            </button>
                        </Tooltip>
                    </template>
                </div>
            </aside>
            <ProfileTemplateComponentLibraryPanel
                v-else
                v-model:search="componentSearch"
                v-model:active-group="activeComponentGroup"
                :group-tabs="componentGroupTabs"
                :component-groups="filteredComponentGroups"
                @collapse="libraryPanelCollapsed = true"
                @add-node="addNode"
            />

            <ProfileTemplateCanvasPanel
                :loading="loading"
                :display-root="displayRoot"
                :selected-node-id="selectedNodeId"
                :node-count="nodeCount"
                :disabled-drop-node-ids="disabledDropNodeIds"
                :can-have-children="canHaveChildren"
                :is-root-drop-active="isRootDropActive"
                @select="selectedNodeId = $event"
                @prepare-drag="prepareNodeDrag"
                @duplicate="duplicateNode"
                @delete="deleteNode"
                @add-message="addNode('Message')"
            />

            <!-- 右侧源码、属性与变量面板 -->
            <Tooltip v-if="inspectorPanelCollapsed" text="展开右侧面板" placement="bottom">
                <aside class="panel-rail" @click="inspectorPanelCollapsed = false">
                    <span class="i-lucide-panel-right-open h-4 w-4"></span>
                    <span class="rail-label">面板</span>
                </aside>
            </Tooltip>
            <aside v-else class="flex min-w-0 min-h-0 flex-col">
                <ProfileTemplateInspectorPanel
                    v-model:active-tab="inspectorTab"
                    v-model:variable-search="variableSearch"
                    :tabs="inspectorTabs"
                    :selected-node="selectedNode"
                    :selected-prop-entries="selectedPropEntries"
                    :selected-text-length="selectedTextLength"
                    :source-text="sourceText"
                    :source-line-count="sourceLineCount"
                    :parsing-source="parsingSource"
                    :selected-template-file-name="selectedTemplateFileName"
                    :issues="issues"
                    :variable-groups="variableGroups"
                    :filtered-variable-groups="filteredVariableGroups"
                    :filtered-runtime-variable-groups="filteredRuntimeVariableGroups"
                    :role-options="roleOptions"
                    :tool-status-options="toolStatusOptions"
                    :source-options="sourceOptions"
                    :theme="theme"
                    :monaco-preferences="sourceEditorPreferences"
                    :is-expression-value="isExpressionValue"
                    :prop-input-value="propInputValue"
                    :prop-label="propLabel"
                    :node-title="nodeTitle"
                    :issue-detail="issueDetail"
                    :format-variable-value="formatVariableValue"
                    :is-variable-group-collapsed="isVariableGroupCollapsed"
                    :profile-detail="profileDetail"
                    @collapse="inspectorPanelCollapsed = true"
                    @source-change="handleSourceTextChange"
                    @source-save-request="void saveTemplate()"
                    @update-prop="updateProp"
                    @update-expression-prop="updateExpressionProp"
                    @update-text="updateText"
                    @commit-message-text="commitMessageText"
                    @toggle-variable-group="toggleVariableGroup"
                    @save-schema="saveProfileSchema"
                />
            </aside>
            </main>
        </DragDropProvider>

        <ProfileTemplatePreviewDialog
            v-model="previewDialogOpen"
            v-model:selected-thread-id="selectedThreadId"
            v-model:variable-search="variableSearch"
            :preview-updated-at="previewUpdatedAt"
            :previewing="previewing"
            :has-root="Boolean(root)"
            :preview-messages="previewMessages"
            :issues="issues"
            :selected-template-file-name="selectedTemplateFileName"
            :thread-options="threadOptions"
            :loading-threads="loadingThreads"
            :filtered-runtime-variable-groups="filteredRuntimeVariableGroups"
            :theme="theme"
            :is-variable-group-collapsed="isVariableGroupCollapsed"
            :format-variable-schema="formatVariableSchema"
            :format-variable-value="formatVariableValue"
            :should-show-variable-value="shouldShowVariableValue"
            :issue-detail="issueDetail"
            @refresh-preview="void previewTemplate()"
            @toggle-variable-group="toggleVariableGroup"
        />

        <Dialog
            v-model="createDialogOpen"
            title="新建 TSX Profile"
            width="560px"
            overlay-type="opaque"
            :busy="creating"
            @confirm="void createUserProfile()"
        >
            <div class="space-y-3">
                <label class="form-row">
                    <span class="form-label">类型</span>
                    <FormSelect
                        :model-value="newProfileForm.kind"
                        :options="profileKindOptions"
                        dropdown-direction="down"
                        @update:model-value="updateNewProfileKind"
                    />
                </label>
                <label class="form-row">
                    <span class="form-label">Profile Key</span>
                    <FormInput v-model="newProfileForm.profileKey" placeholder="agent.custom" />
                </label>
                <label class="form-row">
                    <span class="form-label">名称</span>
                    <FormInput v-model="newProfileForm.name" placeholder="Custom Agent" />
                </label>
                <label class="form-row">
                    <span class="form-label">描述</span>
                    <FormInput v-model="newProfileForm.description" placeholder="可选，用于 catalog 展示" />
                </label>
                <label class="form-row">
                    <span class="form-label">初始提示词</span>
                    <FormTextarea v-model="newProfileForm.prompt" :rows="7" placeholder="写入这个 profile 的系统提示词" />
                </label>
                <p class="text-[11px] leading-5 text-[var(--text-muted)]">
                    将创建到用户 assets 的 <code>agent/profiles/...</code> 下，并生成标准 defineAgentProfile TSX 骨架。
                </p>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.panel-rail {
    display: flex;
    width: 100%;
    min-height: 0;
    cursor: pointer;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-panel);
    padding: 14px 4px 12px;
    color: var(--text-muted);
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
    transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}

.component-rail {
    display: flex;
    width: 100%;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-panel);
    padding: 8px 3px;
    box-shadow: 0 16px 44px color-mix(in srgb, var(--shadow-color) 5%, transparent);
}

.component-rail-scroll {
    display: flex;
    min-height: 0;
    width: 100%;
    flex: 1;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-inline: 1px;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: none;
    scrollbar-color: transparent transparent;
    -ms-overflow-style: none;
}

.component-rail-scroll::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

.rail-icon-btn {
    --component-accent: var(--accent-main);
    --component-bg: color-mix(in srgb, var(--component-accent) 8%, var(--bg-panel));
    --component-border: color-mix(in srgb, var(--component-accent) 34%, var(--border-color));
    --component-icon-color: color-mix(in srgb, var(--component-accent) 80%, var(--text-main));
    display: inline-flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--component-border);
    border-radius: 7px;
    background: var(--component-bg);
    color: var(--component-icon-color);
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.rail-icon-btn:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--accent-text);
    transform: translateY(-1px);
}

.rail-divider {
    align-self: center;
    height: 1px;
    width: 24px;
    flex-shrink: 0;
    background: var(--border-color);
}

.rail-group-divider {
    align-self: center;
    height: 1px;
    width: 18px;
    flex-shrink: 0;
    margin: 4px 0 2px;
    background: color-mix(in srgb, var(--border-color) 78%, transparent);
}

.rail-group-divider:first-child {
    display: none;
}

.library-node-ProfilePrompt {
    --component-accent: var(--accent-main);
}

.library-node-System {
    --component-accent: #5f70a5;
}

.library-node-HistorySet {
    --component-accent: #3f7f72;
}

.library-node-ModelContext {
    --component-accent: #47799a;
}

.library-node-AppendingSet {
    --component-accent: #6f6aa8;
}

.library-node-Compaction,
.library-node-CompactionPrompt,
.library-node-CompactionSummaryPrefix {
    --component-accent: #7a7f4e;
}

.library-node-Text,
.library-node-Message {
    --component-accent: #c2693c;
}

.library-node-AIMessage {
    --component-accent: #7b68b3;
}

.library-node-ToolCall {
    --component-accent: #4f8c8f;
}

.library-node-ToolResult {
    --component-accent: #4b9272;
}

.library-node-Reminder {
    --component-accent: #b65f5b;
}

.library-node-Watch {
    --component-accent: #b1843e;
}

.library-node-If {
    --component-accent: #64895f;
}

.library-node-SystemReminder,
.library-node-LinkedAgentsReminder {
    --component-accent: #b65f5b;
}

.library-node-LinkedAgentsSummary {
    --component-accent: #4f8c8f;
}

.library-node-WorkspaceFocusReminder,
.library-node-ModeAvailabilityReminder {
    --component-accent: #b65f5b;
}

.library-node-TaskReminder,
.library-node-ModeReminder,
.library-node-ModeSlot {
    --component-accent: #8a639e;
}

.library-node-MentionedSkillsReminder {
    --component-accent: #b1843e;
}

.library-node-FileChangeNotice {
    --component-accent: #4f8c8f;
}

.library-node-ActivatedSkills {
    --component-accent: #8a639e;
}

.library-node-AgentCatalog {
    --component-accent: #4e7f9f;
}

.library-node-SkillCatalog {
    --component-accent: #5f70a5;
}

.library-node-SqlSchemaSummary {
    --component-accent: #4f8a8b;
}

.library-node-Import {
    --component-accent: #5c7f67;
}

.panel-rail:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
    color: var(--accent-text);
}

.rail-label {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
}

.form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-label {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
}
</style>
