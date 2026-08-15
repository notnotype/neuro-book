<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef, watch} from "vue";
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import WorldEnginePreviewActions from "nbook/app/components/novel-ide/world-engine/WorldEnginePreviewActions.vue";
import WorldEnginePreviewProjectPanel from "nbook/app/components/novel-ide/world-engine/WorldEnginePreviewProjectPanel.vue";
import WorldEnginePreviewStatePanel from "nbook/app/components/novel-ide/world-engine/WorldEnginePreviewStatePanel.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {isProjectSessionSupersededError, useProjectSession} from "nbook/app/composables/useProjectSession";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {resolveProjectMutationCommitState} from "nbook/app/utils/project-mutation-error";
import {
    refreshPreviewProjectCreate,
    runPreviewProjectCreate,
    type PreviewCreateRecovery,
    type PreviewCreateSettled,
} from "nbook/app/utils/world-engine-preview-create";
import {
    clampMutationIndex,
    deleteMutationAt,
    duplicateMutationAt,
    filterPreviewProjects,
    formatWorldEngineConflictMessage,
    formatPreviewJson,
    defaultMutationForPreviewAttr,
    defaultMutationForPreviewSubject,
    defaultValueForPreviewAttr,
    isJsonObjectValue,
    insertMutationAfter,
    keepSelectedPreviewProject,
    moveMutationAt,
    opOptionsForPreviewAttr,
    parseCsvList,
    parseLooseJsonValue,
    parseMutationJson,
    parseMutationListJson,
    previewAttrNeedsJsonObject,
    previewAttrValueType,
    replaceMutationAt,
    resolvePreviewAttrPath,
    selectPreviewProjectRoot,
    suggestNextPreviewTime,
    suggestSliceTime,
    type JsonValue,
    type WorldMutationDraft,
    type WorldMutationOp,
    type WorldPreviewSchemaAttr,
} from "nbook/app/utils/world-engine-preview";
import type {ProjectCreateResponseDto, ProjectListResponseDto, ProjectMetadataDto} from "nbook/shared/dto/project.dto";

type WorldSchemaProjectionDto = {
    subjectTypes: Array<{
        type: string;
        desc?: string;
        attrs: WorldPreviewSchemaAttr[];
    }>;
    calendar: {
        format: string;
        examples: string[];
    };
};
type WorldSubjectDto = {
    id: string;
    type: string;
    name: string;
};
type WorldSliceDto = {
    id: string;
    time: string;
    title: string;
    summary: string;
    kind: string;
    patches?: WorldSlicePatchDto[];
    issues?: WorldIssueDto[];
};
type WorldSlicePatchDto = {
    subjectId: string;
    path: string;
    op: WorldMutationOp;
    value?: unknown;
    summary?: string;
};
type SubjectStateDto = {
    subjectId: string;
    type: string;
    attrs: Record<string, JsonValue>;
};
type WorldIssueDto = {
    code: "broken-relative" | "dangling-ref" | "base-shifted" | "masked" | "invalid-path" | "cross-ref" | "embedding-whole-replace";
    label: "E1" | "E2" | "E3" | "E4" | "E5" | "A1" | "A2";
    severity: "error" | "advisory";
    sliceId?: string;
    patchId?: string;
    subjectId: string;
    attr: string;
    path?: string;
    op?: WorldPatchOp;
    title: string;
    message: string;
    explanation: {
        whatHappened: string;
        whyItMatters: string;
        suggestedAction: string;
    };
};
type WorldStateQueryDto = {
    subjects: SubjectStateDto[];
    issues: WorldIssueDto[];
};
type SliceWriteResultDto = {
    sliceId: string;
    issues: WorldIssueDto[];
};
type CreateSubjectResultDto = {
    subjectId: string;
    issues: WorldIssueDto[];
};
type DeleteSliceResultDto = {
    issues: WorldIssueDto[];
};

const route = useRoute();
const {confirm: confirmDialog} = useDialog();
const projectSession = useProjectSession();

const previewProjectListLimit = 80;

const projects = ref<ProjectMetadataDto[]>([]);
const selectedProjectRoot = ref("");
const projectSearch = ref("");
const schema = shallowRef<WorldSchemaProjectionDto | null>(null);
const subjects = ref<WorldSubjectDto[]>([]);
const slices = ref<WorldSliceDto[]>([]);
const stateResult = ref<SubjectStateDto[]>([]);
const stateIssues = ref<WorldIssueDto[]>([]);
const actionIssues = ref<WorldIssueDto[]>([]);
const lastWriteResult = ref<SliceWriteResultDto | null>(null);
const loadingProjects = ref(false);
const loadingWorld = ref(false);
const actionBusy = ref(false);
const error = ref("");
const notice = ref("");
type PreviewCreateRecoveryState = PreviewCreateRecovery & Readonly<{
    attempt: number;
    error: string;
}>;
const createRecovery = ref<PreviewCreateRecoveryState | null>(null);
const editingSliceId = ref("");
const mutationLoadIndex = ref("0");
let suppressProjectSelectionWatcher = false;
let projectSelectionRevision = 0;
let createRecoveryAttempt = 0;
type WorldLoadRequest = {
    key: string;
    promise: Promise<boolean>;
};
let worldLoadRevision = 0;
let worldLoadRequest: WorldLoadRequest | null = null;

/** 显示 Preview 错误，并清理旧成功提示，避免作者同时看到互相冲突的反馈。 */
function setPreviewError(message: string): void {
    error.value = message;
    if (message) {
        notice.value = "";
    }
}

/** 显示 Preview 成功 / 状态提示，并清理旧错误。 */
function setPreviewNotice(message: string): void {
    notice.value = message;
    if (message) {
        error.value = "";
    }
}

/** 格式化 Preview 默认 Project 标题中的本地时间戳。 */
function formatPreviewProjectTitleTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

/** 生成 Preview 新建 Project 表单的默认值。 */
function defaultPreviewProjectTitle(date = new Date()): string {
    return `世界引擎试用 ${formatPreviewProjectTitleTimestamp(date)}`;
}

/** 新建 Project 成功后准备下一条默认表单，避免重复创建同名试用 Project。 */
function resetCreateProjectForm(): void {
    createProjectForm.title = defaultPreviewProjectTitle();
    createProjectForm.summary = "World Engine preview project";
}

const createProjectForm = reactive({
    title: defaultPreviewProjectTitle(),
    summary: "World Engine preview project",
});

const subjectForm = reactive({
    id: "world",
    type: "world",
    name: "世界",
    time: "",
});
const initialPreviewMutation = defaultMutationForPreviewSubject([], [], "world");
let lastAutoSliceMutationDraft = JSON.stringify([initialPreviewMutation], null, 2);

const sliceForm = reactive({
    time: "",
    title: "第一条世界切面",
    summary: "",
    kind: "event",
    mutations: lastAutoSliceMutationDraft,
});

const mutationBuilder = reactive({
    subjectId: "world",
    path: initialPreviewMutation.path,
    op: initialPreviewMutation.op,
    value: formatBuilderValue(initialPreviewMutation.value),
});

const queryForm = reactive({
    subjectIds: "world",
    type: "",
    attrs: "era,events",
    at: "",
    listLimit: 10,
});

const selectedProject = computed(() => projects.value.find((project) => project.projectRoot === selectedProjectRoot.value) ?? null);
const projectOptions = computed(() => keepSelectedPreviewProject(filterPreviewProjects(projects.value, projectSearch.value), selectedProject.value));
const schemaTypes = computed(() => schema.value?.subjectTypes ?? []);
const selectedTypeAttrs = computed(() => schemaTypes.value.find((item) => item.type === subjectForm.type)?.attrs ?? []);
const latestSlice = computed(() => slices.value.at(-1) ?? null);
const projectReady = computed(() => (
    projectSession.state.value.status === "ready"
    && projectSession.state.value.ready.projectRoot === selectedProjectRoot.value
));
const stateJson = computed(() => formatPreviewJson(stateResult.value as unknown as JsonValue[]));
const writeResultJson = computed(() => formatPreviewJson(lastWriteResult.value as unknown as Record<string, JsonValue> | null));
const sliceActionLabel = computed(() => editingSliceId.value ? "保存 Slice 编辑" : "写入 Slice");
const mutationBuilderSubject = computed(() => subjects.value.find((subject) => subject.id === mutationBuilder.subjectId) ?? null);
const mutationBuilderAttrs = computed(() => attrsForSubjectId(mutationBuilder.subjectId));
const mutationBuilderAttr = computed(() => resolvePreviewAttrPath(mutationBuilderAttrs.value, mutationBuilder.path));
const mutationBuilderOpOptions = computed(() => opOptionsForAttr(mutationBuilder.path));
const mutationBuilderNeedsJsonObject = computed(() => previewAttrNeedsJsonObject(mutationBuilderAttr.value, mutationBuilder.op));
const mutationLoadOptions = computed(() => {
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        return [];
    }
    return parsed.value.map((mutation, index) => ({
        label: `${index + 1}. ${mutation.subjectId}${mutation.path} · ${mutation.op}`,
        value: String(index),
    }));
});
const canUseSelectedMutation = computed(() => mutationLoadOptions.value.length > 0);
const previewBuilderDisabled = computed(() => loadingWorld.value || actionBusy.value);
const mutationBuilderValueHint = computed(() => {
    const attr = mutationBuilderAttr.value;
    if (!attr) {
        return "dynamic value";
    }
    const valueType = previewAttrValueType(attr) ?? "object";
    return attr.kind === "list" || attr.kind === "collection" ? `${attr.kind}<${valueType}>` : `${attr.kind}:${valueType}`;
});

/** 请求必须仍属于当前选择的精确 ready generation。 */
function ownsWorldGeneration(projectRoot: string, readyRevision: number): boolean {
    return selectedProjectRoot.value === projectRoot
        && projectSession.state.value.status === "ready"
        && projectSession.state.value.ready.projectRoot === projectRoot
        && projectSession.state.value.ready.revision === readyRevision;
}

/** 离开 ready 后立即撤销全部 Project 数据和在途请求的提交权。 */
function clearPreviewProjectData(): void {
    worldLoadRevision += 1;
    worldLoadRequest = null;
    schema.value = null;
    subjects.value = [];
    slices.value = [];
    stateResult.value = [];
    stateIssues.value = [];
    actionIssues.value = [];
    lastWriteResult.value = null;
}

/** Project 选择只有在 open + presence_ready 后才允许触发 World Engine 数据面。 */
async function activatePreviewProject(projectRoot: string): Promise<boolean> {
    const revision = ++projectSelectionRevision;
    loadingWorld.value = true;
    try {
        resetPreviewProjectSessionState();
        clearPreviewProjectData();
        await projectSession.release();
        if (!projectRoot) {
            return false;
        }
        const ready = await projectSession.open(projectRoot);
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return false;
        const loaded = await loadWorld(projectRoot, ready.revision);
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return false;
        if (loaded) return true;
        await projectSession.release();
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return false;
        suppressProjectSelectionWatcher = true;
        selectedProjectRoot.value = "";
        suppressProjectSelectionWatcher = false;
        return false;
    } catch (activationError) {
        if (isProjectSessionSupersededError(activationError)) return false;
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return false;
        await projectSession.release();
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return false;
        suppressProjectSelectionWatcher = true;
        selectedProjectRoot.value = "";
        suppressProjectSelectionWatcher = false;
        setPreviewError(resolveApiErrorMessage(activationError, `打开 Project 失败：${projectRoot}`));
        return false;
    } finally {
        if (revision === projectSelectionRevision) loadingWorld.value = false;
    }
}

/** 读取 Project 列表并选择当前目标。 */
async function loadProjects(preferredProjectRoot?: string): Promise<Readonly<{
    selectedProjectRoot: string;
    activated: boolean;
}>> {
    loadingProjects.value = true;
    error.value = "";
    try {
        const routeProjectRoot = typeof route.query.projectRoot === "string"
            ? route.query.projectRoot
            : typeof route.query.project === "string" ? route.query.project : "";
        // 列表接口返回 manifest 全量，预览页只负责控制展示数量。
        const allProjects = (await $fetch<ProjectListResponseDto>("/api/projects")).projects;
        projects.value = allProjects.slice(0, previewProjectListLimit);
        const nextProjectRoot = selectPreviewProjectRoot(projects.value, preferredProjectRoot, routeProjectRoot, selectedProjectRoot.value);
        if (selectedProjectRoot.value !== nextProjectRoot) {
            suppressProjectSelectionWatcher = true;
            selectedProjectRoot.value = nextProjectRoot;
            suppressProjectSelectionWatcher = false;
        }
        const activated = await activatePreviewProject(nextProjectRoot);
        return {selectedProjectRoot: nextProjectRoot, activated};
    } finally {
        loadingProjects.value = false;
    }
}

/** 把已刷新 Catalog 的创建事实应用到表单与页面反馈。 */
function applyPreviewCreateSettlement(result: PreviewCreateSettled): void {
    if (result.commitState === true) {
        resetCreateProjectForm();
        if (
            result.preferredProjectRoot
            && result.refresh.activated
            && result.refresh.selectedProjectRoot === result.preferredProjectRoot
        ) {
            setPreviewNotice(`已创建 ${result.preferredProjectRoot}`);
            return;
        }
        if (result.refresh.activated || !error.value) {
            setPreviewNotice("创建操作已经提交，Project 列表已刷新。");
        }
        return;
    }
    if (result.refresh.activated || !error.value) {
        setPreviewNotice("创建结果一度无法确认。列表已刷新，请核对后再决定是否重试。");
    }
}

/** 只刷新 create 的提交事实，不自动重放 POST 或猜测新 Project root。 */
async function refreshCreateRecovery(): Promise<void> {
    const captured = createRecovery.value;
    if (!captured) return;
    actionBusy.value = true;
    try {
        const result = await refreshPreviewProjectCreate(captured, loadProjects);
        if (createRecovery.value?.attempt !== captured.attempt) return;
        if (result.status === "refresh_failed") {
            createRecovery.value = {
                ...captured,
                error: resolveApiErrorMessage(result.error, "重新读取 Project 列表失败"),
            };
            return;
        }
        createRecovery.value = null;
        applyPreviewCreateSettlement(result);
    } finally {
        actionBusy.value = false;
    }
}

/** 用户手动刷新 Project 列表；请求飞行中不切换当前上下文。 */
async function refreshProjects(): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    try {
        await loadProjects();
    } catch (loadError) {
        setPreviewError(resolveApiErrorMessage(loadError, "读取 Project 列表失败"));
    }
}

/** 新建 Project Workspace，并立即选中它。 */
async function createProject(): Promise<void> {
    if (loadingProjects.value) return;
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    if (createRecovery.value) return;
    if (!createProjectForm.title.trim()) {
        setPreviewError("Project 标题不能为空");
        return;
    }
    actionBusy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const result = await runPreviewProjectCreate({
            request: () => $fetch<ProjectCreateResponseDto>("/api/projects", {
                method: "POST",
                body: {
                    title: createProjectForm.title.trim(),
                    summary: createProjectForm.summary.trim(),
                },
            }),
            refresh: loadProjects,
            classifyCommit: (createError) => resolveProjectMutationCommitState(createError, "create"),
        });
        if (result.status === "rejected") {
            setPreviewError(resolveApiErrorMessage(result.error, "创建 Project 失败"));
            return;
        }
        if (result.status === "refresh_failed") {
            createRecoveryAttempt += 1;
            createRecovery.value = {
                attempt: createRecoveryAttempt,
                commitState: result.commitState,
                ...(result.preferredProjectRoot ? {preferredProjectRoot: result.preferredProjectRoot} : {}),
                error: resolveApiErrorMessage(result.error, "重新读取 Project 列表失败"),
            };
            return;
        }
        applyPreviewCreateSettlement(result);
    } finally {
        actionBusy.value = false;
    }
}

/** 读取当前 Project 的世界引擎 schema、subjects 和 timeline。 */
async function loadWorld(
    projectRoot = selectedProjectRoot.value,
    readyRevision: number | null = projectSession.state.value.status === "ready"
        ? projectSession.state.value.ready.revision
        : null,
): Promise<boolean> {
    if (!projectRoot) {
        clearPreviewProjectData();
        return true;
    }
    if (readyRevision === null || !ownsWorldGeneration(projectRoot, readyRevision)) return false;
    const key = `${projectRoot}:${readyRevision}`;
    if (worldLoadRequest?.key === key) return worldLoadRequest.promise;

    const revision = ++worldLoadRevision;
    const request: WorldLoadRequest = {key, promise: Promise.resolve(false)};
    loadingWorld.value = true;
    error.value = "";
    request.promise = (async () => {
        try {
            const query = {projectRoot};
            const [nextSchema, nextSubjects, nextSlices] = await Promise.all([
                $fetch<WorldSchemaProjectionDto>("/api/projects/world-engine/schema", {query}),
                $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
                $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {query: {...query, limit: 12, withPatches: "true"}}),
            ]);
            if (revision !== worldLoadRevision || !ownsWorldGeneration(projectRoot, readyRevision)) return false;
            schema.value = nextSchema;
            subjects.value = nextSubjects;
            slices.value = nextSlices;
            applyWorldDefaults();
            return true;
        } catch (loadError) {
            if (revision === worldLoadRevision && ownsWorldGeneration(projectRoot, readyRevision)) {
                schema.value = null;
                subjects.value = [];
                slices.value = [];
                stateResult.value = [];
                stateIssues.value = [];
                setPreviewError(resolveApiErrorMessage(loadError, "读取 World Engine 数据失败"));
            }
            return false;
        } finally {
            if (worldLoadRequest === request) {
                worldLoadRequest = null;
                loadingWorld.value = false;
            }
        }
    })();
    worldLoadRequest = request;
    return request.promise;
}

/** 用户从 StatePanel 刷新世界数据；请求飞行中不抢当前 Project / action 上下文。 */
async function refreshWorldFromStatePanel(): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    await loadWorld();
}

/** 创建 subject，并刷新 timeline。 */
async function createSubject(): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    if (!projectReady.value) return;
    const subjectId = subjectForm.id.trim();
    const subjectType = subjectForm.type.trim();
    const subjectTime = subjectForm.time.trim();
    if (!subjectId) {
        setPreviewError("subject id 不能为空");
        return;
    }
    if (!subjectType) {
        setPreviewError("subject type 不能为空");
        return;
    }
    if (!subjectTime) {
        setPreviewError("subject time 不能为空");
        return;
    }
    if (subjects.value.some((subject) => subject.id === subjectId)) {
        setPreviewError(`subject ${subjectId} 已存在，请填写新的 id`);
        return;
    }
    actionBusy.value = true;
    error.value = "";
    notice.value = "";
    actionIssues.value = [];
    try {
        const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
            method: "POST",
            query: projectQuery(),
            body: {
                id: subjectId,
                type: subjectType,
                name: subjectForm.name.trim(),
                time: subjectTime,
            },
        });
        actionIssues.value = result.issues;
        setPreviewNotice(result.issues.length
            ? `已创建 subject ${result.subjectId}，返回 ${result.issues.length} 个 issue`
            : `已创建 subject ${result.subjectId}`);
        subjectForm.id = "";
        subjectForm.name = "";
        subjectForm.type = subjectType;
        subjectForm.time = subjectTime;
        queryForm.subjectIds = result.subjectId;
        mutationBuilder.subjectId = result.subjectId;
        if (sliceForm.time.trim() === subjectTime) {
            sliceForm.time = suggestSliceTime(schema.value?.calendar.examples ?? [subjectTime]);
        }
        await loadWorld();
        advanceSliceFormTime();
        if (!editingSliceId.value) {
            applyDefaultSliceMutation(result.subjectId);
        }
        if (queryForm.subjectIds.trim() || queryForm.type.trim()) {
            await queryState({clearActionIssues: false});
        }
    } catch (createError) {
        setPreviewError(formatWorldEngineConflictMessage(resolveApiErrorMessage(createError, "创建 subject 失败")));
    } finally {
        actionBusy.value = false;
    }
}

/** 写入新 slice 或整块替换已有 slice。 */
async function writeSlice(): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    if (!projectReady.value) return;
    if (!sliceForm.time.trim()) {
        setPreviewError("time 不能为空");
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    actionBusy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const editing = Boolean(editingSliceId.value);
        lastWriteResult.value = await $fetch<SliceWriteResultDto>(editing ? `/api/projects/world-engine/slices/${encodeURIComponent(editingSliceId.value)}/edit` : "/api/projects/world-engine/slices", {
            method: "POST",
            query: projectQuery(),
            body: {
                time: sliceForm.time.trim(),
                title: sliceForm.title.trim(),
                summary: sliceForm.summary.trim(),
                kind: sliceForm.kind.trim() || "event",
                patches: parsed.value,
            },
        });
        actionIssues.value = lastWriteResult.value.issues;
        applyWriteResultFeedback(lastWriteResult.value, editing);
        editingSliceId.value = "";
        await loadWorld();
        if (editing) {
            clearSliceEditMode();
        } else {
            advanceSliceFormTime();
        }
        if (queryForm.subjectIds.trim() || queryForm.type.trim()) {
            await queryState({clearActionIssues: false});
        }
    } catch (writeError) {
        setPreviewError(formatWorldEngineConflictMessage(resolveApiErrorMessage(writeError, editingSliceId.value ? "编辑 slice 失败" : "写入 slice 失败")));
    } finally {
        actionBusy.value = false;
    }
}

/** 物理删除 slice；后端返回删后仍显形的持久 issues。 */
async function deleteSlice(sliceId: string): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    if (!projectReady.value) return;
    const slice = slices.value.find((item) => item.id === sliceId);
    if (!slice) {
        setPreviewError("切面不存在，已刷新列表");
        await loadWorld();
        return;
    }
    if (!await confirmDialog(`确定要删除 slice「${slice.title || slice.id}」吗？此操作不可恢复。`, "删除 World Engine Slice")) {
        return;
    }
    actionBusy.value = true;
    error.value = "";
    notice.value = "";
    try {
        const result = await $fetch<DeleteSliceResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}`, {
            method: "DELETE",
            query: projectQuery(),
        });
        const deleteIssues = result.issues;
        lastWriteResult.value = null;
        actionIssues.value = deleteIssues;
        setPreviewNotice(result.issues.length ? `已删除 slice ${slice.id}，删后返回 ${result.issues.length} 个 issue` : `已删除 slice ${slice.id}`);
        if (editingSliceId.value === slice.id) {
            clearSliceEditMode();
        }
        await loadWorld();
        if (queryForm.subjectIds.trim() || queryForm.type.trim()) {
            await queryState({clearActionIssues: false});
        }
    } catch (deleteError) {
        setPreviewError(resolveApiErrorMessage(deleteError, "删除 slice 失败"));
    } finally {
        actionBusy.value = false;
    }
}

/** 查询收窄后的世界状态。 */
async function queryState(options: {clearActionIssues?: boolean} = {}): Promise<void> {
    if (loadingWorld.value && options.clearActionIssues !== false) return;
    if (actionBusy.value && options.clearActionIssues !== false) return;
    if (!projectReady.value) return;
    const subjectIds = parseCsvList(queryForm.subjectIds);
    const attrs = parseCsvList(queryForm.attrs);
    const type = queryForm.type.trim();
    if (!subjectIds.length && !type) {
        setPreviewError("查询必须提供 subjectIds 或 type");
        return;
    }
    actionBusy.value = true;
    error.value = "";
    try {
        const result = await $fetch<WorldStateQueryDto>("/api/projects/world-engine/state/query", {
            method: "POST",
            query: projectQuery(),
            body: {
                ...(subjectIds.length ? {subjectIds} : {}),
                ...(type ? {type} : {}),
                ...(attrs.length ? {attrs} : {}),
                ...(queryForm.at.trim() ? {at: queryForm.at.trim()} : {}),
                listLimit: queryForm.listLimit,
            },
        });
        stateResult.value = result.subjects;
        stateIssues.value = result.issues;
        if (options.clearActionIssues !== false) {
            actionIssues.value = [];
        }
    } catch (queryError) {
        stateResult.value = [];
        stateIssues.value = [];
        setPreviewError(resolveApiErrorMessage(queryError, "查询世界状态失败"));
    } finally {
        actionBusy.value = false;
    }
}

function projectQuery(): {projectRoot: string} {
    return {projectRoot: selectedProjectRoot.value};
}

function applyWorldDefaults(): void {
    const firstTime = schema.value?.calendar.examples[0] ?? "复兴纪元1年 1月1日 00:00:00";
    const sliceTime = suggestSliceTime(schema.value?.calendar.examples ?? [firstTime]);
    subjectForm.time = subjectForm.time || firstTime;
    sliceForm.time = sliceForm.time || sliceTime;
    queryForm.at = queryForm.at || "";
    if (!schemaTypes.value.some((item) => item.type === subjectForm.type)) {
        subjectForm.type = schemaTypes.value[0]?.type ?? "world";
    }
    const firstSubject = subjects.value[0];
    if (firstSubject) {
        const knownSubjectIds = new Set(subjects.value.map((subject) => subject.id));
        const currentSubjectExists = knownSubjectIds.has(subjectForm.id);
        const queryHasKnownSubject = parseCsvList(queryForm.subjectIds).some((subjectId) => knownSubjectIds.has(subjectId));
        if (!currentSubjectExists) {
            subjectForm.id = firstSubject.id;
            subjectForm.type = firstSubject.type;
            subjectForm.name = firstSubject.name;
        }
        if (!queryHasKnownSubject) {
            queryForm.subjectIds = firstSubject.id;
        }
        if (!knownSubjectIds.has(mutationBuilder.subjectId)) {
            mutationBuilder.subjectId = firstSubject.id;
        }
        if (shouldRefreshDefaultSliceMutation()) {
            applyDefaultSliceMutation(mutationBuilder.subjectId);
        }
    }
}

async function loadSubjectIntoQuery(subject: WorldSubjectDto): Promise<void> {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    queryForm.subjectIds = subject.id;
    queryForm.type = "";
    mutationBuilder.subjectId = subject.id;
    subjectForm.id = subject.id;
    subjectForm.type = subject.type;
    subjectForm.name = subject.name;
    if (!editingSliceId.value && shouldRefreshDefaultSliceMutation()) {
        applyDefaultSliceMutation(subject.id);
    }
    await queryState({clearActionIssues: false});
}

function fillMutation(typeName: string, attr: WorldPreviewSchemaAttr): void {
    if (loadingProjects.value) return;
    if (previewBuilderDisabled.value) return;
    const subjectId = subjectIdForSchemaType(typeName);
    const mutation = defaultMutationForPreviewAttr(subjectId, attr, subjects.value);
    sliceForm.mutations = JSON.stringify([mutation], null, 2);
    mutationLoadIndex.value = "0";
    mutationBuilder.subjectId = subjectId;
    mutationBuilder.path = attrToPointer(attr.name);
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = formatBuilderValue(mutation.value);
}

function loadSliceForEdit(sliceId: string): void {
    if (loadingWorld.value) return;
    if (actionBusy.value) return;
    const slice = slices.value.find((item) => item.id === sliceId);
    if (!slice) {
        setPreviewError("切面不存在，已刷新列表");
        void loadWorld();
        return;
    }
    editingSliceId.value = slice.id;
    sliceForm.time = slice.time;
    sliceForm.title = slice.title;
    sliceForm.summary = slice.summary;
    sliceForm.kind = slice.kind;
    sliceForm.mutations = JSON.stringify(slice.patches ?? [], null, 2);
    mutationLoadIndex.value = "0";
    if ((slice.patches ?? []).length) {
        loadMutationToBuilder(0, false);
    }
    setPreviewNotice(`正在编辑 slice ${slice.id}`);
}

function clearSliceEditMode(): void {
    editingSliceId.value = "";
    sliceForm.title = "第一条世界切面";
    sliceForm.summary = "";
    sliceForm.kind = "event";
    advanceSliceFormTime();
    applyDefaultSliceMutation(mutationBuilder.subjectId || subjectForm.id || "world");
}

/** 用户点击取消编辑时走请求飞行 guard；内部保存 / 删除成功后的清理仍可直接调用 clearSliceEditMode。 */
function requestClearSliceEditMode(): void {
    if (previewBuilderDisabled.value) return;
    clearSliceEditMode();
}

function advanceSliceFormTime(): void {
    const examples = schema.value?.calendar.examples ?? [subjectForm.time];
    const usedTimes = slices.value.map((slice) => slice.time);
    sliceForm.time = suggestNextPreviewTime(examples, usedTimes);
}

function applyDefaultSliceMutation(subjectId: string): void {
    const mutation = defaultMutationForPreviewSubject(schema.value?.subjectTypes ?? [], subjects.value, subjectId);
    const nextDraft = JSON.stringify([mutation], null, 2);
    lastAutoSliceMutationDraft = nextDraft;
    sliceForm.mutations = nextDraft;
    mutationLoadIndex.value = "0";
    mutationBuilder.subjectId = mutation.subjectId;
    mutationBuilder.path = mutation.path;
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = formatBuilderValue(mutation.value);
}

function shouldRefreshDefaultSliceMutation(): boolean {
    return !editingSliceId.value && sliceForm.mutations === lastAutoSliceMutationDraft;
}

function applyWriteResultFeedback(result: SliceWriteResultDto, editing: boolean): void {
    setPreviewNotice(result.issues.length
        ? `${editing ? "已更新" : "已写入"} slice ${result.sliceId}，返回 ${result.issues.length} 个 issue`
        : `${editing ? "已更新" : "已写入"} slice ${result.sliceId}`);
}

function buildMutationFromBuilder(): WorldMutationDraft | null {
    if (!mutationBuilder.subjectId.trim()) {
        setPreviewError("patch subjectId 不能为空");
        return null;
    }
    if (!mutationBuilder.path.trim()) {
        setPreviewError("patch path 不能为空");
        return null;
    }
    const mutation: WorldMutationDraft = {
        subjectId: mutationBuilder.subjectId.trim(),
        path: mutationBuilder.path.trim(),
        op: mutationBuilder.op,
    };
    if (mutationBuilder.op !== "remove") {
        const parsedValue = parseLooseJsonValue(mutationBuilder.value);
        if (!parsedValue.ok) {
            setPreviewError(parsedValue.message);
            return null;
        }
        if (mutationBuilderNeedsJsonObject.value && !isJsonObjectValue(parsedValue.value)) {
            setPreviewError("patch value 必须是 JSON object");
            return null;
        }
        mutation.value = parsedValue.value;
    }
    return mutation;
}

function addBuilderMutation(mode: "append" | "replace"): void {
    if (previewBuilderDisabled.value) return;
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const current = parseMutationListJson(sliceForm.mutations);
    const next = mode === "append" && current.ok ? [...current.value, mutation] : [mutation];
    if (mode === "append" && !current.ok && sliceForm.mutations.trim()) {
        setPreviewError(current.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(next, null, 2);
    mutationLoadIndex.value = mode === "append" ? String(next.length - 1) : "0";
    error.value = "";
}

function loadMutationToBuilder(index: number, showNotice = true): void {
    if (previewBuilderDisabled.value) return;
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const safeIndex = clampMutationIndex(parsed.value.length, index);
    const mutation = parsed.value[safeIndex];
    if (!mutation) {
        setPreviewError("请选择要载入的 mutation。");
        return;
    }
    mutationLoadIndex.value = String(safeIndex);
    mutationBuilder.subjectId = mutation.subjectId;
    mutationBuilder.path = mutation.path;
    mutationBuilder.op = mutation.op;
    mutationBuilder.value = formatBuilderValue(mutation.value);
    if (showNotice) {
        setPreviewNotice(`已载入第 ${safeIndex + 1} 条 mutation 到 Builder`);
    }
}

function replaceSelectedBuilderMutation(): void {
    if (previewBuilderDisabled.value) return;
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const result = replaceMutationAt(parsed.value, Number(mutationLoadIndex.value), mutation);
    if (!result.ok) {
        setPreviewError(result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    setPreviewNotice(`已替换第 ${result.value.index + 1} 条 mutation`);
}

function insertAfterSelectedBuilderMutation(): void {
    if (previewBuilderDisabled.value) return;
    const mutation = buildMutationFromBuilder();
    if (!mutation) {
        return;
    }
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const result = insertMutationAfter(parsed.value, Number(mutationLoadIndex.value), mutation);
    if (!result.ok) {
        setPreviewError(result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    setPreviewNotice(`已在第 ${result.value.index} 条 mutation 后插入新 mutation`);
}

function duplicateSelectedBuilderMutation(): void {
    if (previewBuilderDisabled.value) return;
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const result = duplicateMutationAt(parsed.value, Number(mutationLoadIndex.value));
    if (!result.ok) {
        setPreviewError(result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    loadMutationToBuilder(result.value.index, false);
    setPreviewNotice(`已复制所选 mutation 到第 ${result.value.index + 1} 位`);
}

function deleteSelectedBuilderMutation(): void {
    if (previewBuilderDisabled.value) return;
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const deletedIndex = Number(mutationLoadIndex.value);
    const result = deleteMutationAt(parsed.value, deletedIndex);
    if (!result.ok) {
        setPreviewError(result.message);
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    setPreviewNotice(result.value.mutations.length ? `已删除第 ${deletedIndex + 1} 条 mutation` : "已删除最后一条 mutation，保存前请先添加新的 mutation");
}

function moveSelectedBuilderMutation(direction: "up" | "down"): void {
    if (previewBuilderDisabled.value) return;
    const parsed = parseMutationJson(sliceForm.mutations);
    if (!parsed.ok) {
        setPreviewError(parsed.message);
        return;
    }
    const result = moveMutationAt(parsed.value, Number(mutationLoadIndex.value), direction);
    if (!result.ok) {
        setPreviewError(result.message);
        return;
    }
    if (!result.value.changed) {
        setPreviewNotice(result.value.message ?? "所选 mutation 已经在边界");
        return;
    }
    sliceForm.mutations = JSON.stringify(result.value.mutations, null, 2);
    mutationLoadIndex.value = String(result.value.index);
    setPreviewNotice(`已将 mutation 移动到第 ${result.value.index + 1} 位`);
}

/** 更新 Preview Builder 字段；op 字段在父层收窄为 WorldMutationOp。 */
function updateMutationBuilderField(field: "subjectId" | "path" | "op" | "value", value: string): void {
    if (previewBuilderDisabled.value) return;
    if (field === "op") {
        mutationBuilder.op = value as WorldMutationOp;
        return;
    }
    mutationBuilder[field] = value;
}

function updateMutationLoadIndex(value: string): void {
    if (previewBuilderDisabled.value) return;
    mutationLoadIndex.value = value;
}

function attrsForSubjectId(subjectId: string): WorldPreviewSchemaAttr[] {
    const subject = subjects.value.find((item) => item.id === subjectId);
    const type = subject?.type ?? subjectForm.type;
    return schemaTypes.value.find((item) => item.type === type)?.attrs ?? [];
}

function opOptionsForAttr(path: string): WorldMutationOp[] {
    const attr = resolvePreviewAttrPath(mutationBuilderAttrs.value, path);
    return opOptionsForPreviewAttr(attr);
}

function subjectIdForSchemaType(typeName: string): string {
    const currentBuilderSubject = subjects.value.find((subject) => subject.id === mutationBuilder.subjectId);
    if (currentBuilderSubject?.type === typeName) {
        return currentBuilderSubject.id;
    }
    const currentQuerySubjectId = parseCsvList(queryForm.subjectIds)[0] ?? "";
    const currentQuerySubject = subjects.value.find((subject) => subject.id === currentQuerySubjectId);
    if (currentQuerySubject?.type === typeName) {
        return currentQuerySubject.id;
    }
    if (subjectForm.type === typeName && subjectForm.id.trim()) {
        return subjectForm.id.trim();
    }
    const existing = subjects.value.find((subject) => subject.type === typeName);
    if (existing) {
        return existing.id;
    }
    return subjectForm.id.trim() || "world";
}

function refreshBuilderDefaults(): void {
    if (mutationBuilder.op === "remove") {
        mutationBuilder.value = "";
        return;
    }
    const attr = resolvePreviewAttrPath(mutationBuilderAttrs.value, mutationBuilder.path);
    if (!attr) {
        return;
    }
    mutationBuilder.value = formatBuilderValue(defaultValueForPreviewAttr(attr, subjects.value));
}

function formatBuilderValue(value: JsonValue | undefined): string {
    return value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function attrToPointer(attr: string): string {
    return `/${attr.split(".").filter(Boolean).map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

watch(() => mutationBuilder.subjectId, () => {
    const attrs = attrsForSubjectId(mutationBuilder.subjectId);
    if (attrs.length && !attrs.some((attr) => attrToPointer(attr.name) === mutationBuilder.path)) {
        mutationBuilder.path = attrs[0] ? attrToPointer(attrs[0].name) : mutationBuilder.path;
        return;
    }
    refreshBuilderDefaults();
});

watch(() => mutationBuilder.path, () => {
    const options = opOptionsForAttr(mutationBuilder.path);
    if (!options.includes(mutationBuilder.op)) {
        mutationBuilder.op = options[0] ?? "replace";
    }
    refreshBuilderDefaults();
});

watch(() => mutationLoadOptions.value.length, (length) => {
    if (length === 0) {
        mutationLoadIndex.value = "0";
        return;
    }
    const index = Number(mutationLoadIndex.value);
    if (!Number.isInteger(index) || index < 0 || index >= length) {
        mutationLoadIndex.value = String(clampMutationIndex(length, index));
    }
});

function resetPreviewProjectSessionState(): void {
    lastWriteResult.value = null;
    editingSliceId.value = "";
    mutationLoadIndex.value = "0";
    stateResult.value = [];
    stateIssues.value = [];
    actionIssues.value = [];
    notice.value = "";
    error.value = "";
}

/** 离开 ready 立即清空旧世界数据；新 revision 只通过 generation loader 重新发布。 */
watch(projectSession.state, (next, previous) => {
    if (!selectedProjectRoot.value) return;
    if (next.status !== "ready" || next.ready.projectRoot !== selectedProjectRoot.value) {
        clearPreviewProjectData();
        if (next.status === "opening" || next.status === "reconnecting") {
            loadingWorld.value = true;
        }
        if (next.status === "failed" && previous.status === "reconnecting") {
            const projectRoot = selectedProjectRoot.value;
            const revision = ++projectSelectionRevision;
            void (async () => {
                await projectSession.release();
                if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return;
                suppressProjectSelectionWatcher = true;
                selectedProjectRoot.value = "";
                suppressProjectSelectionWatcher = false;
                loadingWorld.value = false;
                setPreviewError(`Project 已不可用：${projectRoot}`);
            })();
        }
        return;
    }
    if (previous.status === "ready" && previous.ready.revision === next.ready.revision) return;
    const projectRoot = next.ready.projectRoot;
    const revision = projectSelectionRevision;
    loadingWorld.value = true;
    void (async () => {
        const loaded = await loadWorld(next.ready.projectRoot, next.ready.revision);
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return;
        if (loaded) {
            loadingWorld.value = false;
            return;
        }
        await projectSession.release();
        if (revision !== projectSelectionRevision || selectedProjectRoot.value !== projectRoot) return;
        suppressProjectSelectionWatcher = true;
        selectedProjectRoot.value = "";
        suppressProjectSelectionWatcher = false;
        loadingWorld.value = false;
    })();
});

watch(selectedProjectRoot, (projectRoot) => {
    if (suppressProjectSelectionWatcher) {
        return;
    }
    void activatePreviewProject(projectRoot);
}, {flush: "sync"});

const themeHostRef = ref<HTMLElement | null>(null);
const {activeThemeId, customThemes, themeVarsSnapshot} = storeToRefs(useNovelIdeStore());
const {mountThemeHost} = useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot);

onMounted(() => {
    void refreshProjects();
    mountThemeHost(themeHostRef.value);
});
</script>

<template>
    <!-- World Engine 调试页 -->
    <div ref="themeHostRef" class="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <!-- 页面头部 -->
        <header class="border-b border-[var(--border-color)] bg-[var(--toolbar-bg)]">
            <div class="mx-auto flex max-w-[1760px] flex-col gap-4 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
                <div class="min-w-0">
                    <div class="text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">World Engine</div>
                    <h1 class="mt-2 text-2xl font-semibold">世界引擎调试台</h1>
                </div>
                <div class="grid w-full gap-2 sm:w-auto sm:min-w-[520px] sm:grid-cols-[minmax(180px,220px)_minmax(260px,1fr)_auto]">
                    <input v-model="projectSearch" class="h-9 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm outline-none focus:border-[var(--accent-main)]" placeholder="搜索 Project">
                    <select v-model="selectedProjectRoot" class="h-9 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="loadingProjects || loadingWorld || actionBusy">
                        <option value="">选择 Project</option>
                        <option v-for="project in projectOptions" :key="project.projectRoot" :value="project.projectRoot">{{ project.title }} · {{ project.projectRoot }}</option>
                    </select>
                    <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="loadingProjects || loadingWorld || actionBusy" @click="void refreshProjects()">
                        <span :class="loadingProjects ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-4 w-4"></span>
                        刷新
                    </button>
                    <div v-if="projectSearch.trim() && projectOptions.length === 0" class="text-xs text-[var(--text-muted)] sm:col-span-3">没有匹配的 Project</div>
                </div>
            </div>
        </header>

        <!-- 主体 -->
        <main class="mx-auto grid max-w-[1760px] gap-4 px-5 py-5 xl:grid-cols-[340px_minmax(0,1fr)_420px]">
            <!-- Project 与 Schema -->
            <WorldEnginePreviewProjectPanel
                :create-project-form="createProjectForm"
                :selected-project="selectedProject"
                :schema="schema"
                :schema-types="schemaTypes"
                :project-ready="projectReady"
                :loading-projects="loadingProjects"
                :loading-world="loadingWorld"
                :action-busy="actionBusy"
                :create-recovery="createRecovery?.error || (createRecovery ? '必须先重新读取 Project 列表，才能再次创建。' : '')"
                @create-project="void createProject()"
                @retry-create-recovery="void refreshCreateRecovery()"
                @fill-mutation="fillMutation"
            />

            <WorldEnginePreviewStatePanel
                :subjects="subjects"
                :slices="slices"
                :latest-slice-time="latestSlice?.time ?? ''"
                :state-json="stateJson"
                :state-issues="stateIssues"
                :action-issues="actionIssues"
                :error="error"
                :notice="notice"
                :loading-world="loadingWorld"
                :project-ready="projectReady"
                :action-busy="actionBusy"
                :editing-slice-id="editingSliceId"
                @refresh="void refreshWorldFromStatePanel()"
                @load-subject="void loadSubjectIntoQuery($event)"
                @load-slice="loadSliceForEdit"
                @delete-slice="void deleteSlice($event)"
            />

            <!-- 写入与查询 -->
            <WorldEnginePreviewActions
                :subject-form="subjectForm"
                :slice-form="sliceForm"
                :query-form="queryForm"
                :schema-types="schemaTypes"
                :selected-type-attrs="selectedTypeAttrs"
                :project-ready="projectReady"
                :loading-world="loadingWorld"
                :action-busy="actionBusy"
                :editing-slice-id="editingSliceId"
                :slice-action-label="sliceActionLabel"
                :write-result-json="writeResultJson"
                :has-write-result="Boolean(lastWriteResult)"
                :mutation-builder="mutationBuilder"
                :subjects="subjects"
                :mutation-builder-subject-type="mutationBuilderSubject?.type ?? subjectForm.type"
                :mutation-builder-attrs="mutationBuilderAttrs"
                :mutation-builder-op-options="mutationBuilderOpOptions"
                :mutation-builder-value-hint="mutationBuilderValueHint"
                :mutation-builder-needs-json-object="mutationBuilderNeedsJsonObject"
                :state-result="stateResult"
                :mutation-load-options="mutationLoadOptions"
                :mutation-load-index="mutationLoadIndex"
                :can-use-selected-mutation="canUseSelectedMutation"
                @create-subject="void createSubject()"
                @clear-slice-edit-mode="requestClearSliceEditMode"
                @update-builder-field="updateMutationBuilderField"
                @add-builder-mutation="addBuilderMutation"
                @update-mutation-load-index="updateMutationLoadIndex"
                @load-mutation="loadMutationToBuilder"
                @insert-after-selected-mutation="insertAfterSelectedBuilderMutation"
                @duplicate-selected-mutation="duplicateSelectedBuilderMutation"
                @replace-selected-mutation="replaceSelectedBuilderMutation"
                @delete-selected-mutation="deleteSelectedBuilderMutation"
                @move-selected-mutation="moveSelectedBuilderMutation"
                @write-slice="void writeSlice()"
                @query-state="void queryState()"
            />
        </main>
    </div>
</template>
