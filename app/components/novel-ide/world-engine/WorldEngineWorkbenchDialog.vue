<script setup lang="ts">
import {computed, nextTick, ref, shallowRef, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import {useDialog} from "nbook/app/composables/useDialog";
import {useNotification} from "nbook/app/composables/useNotification";
import WorldEngineMutationEditor from "nbook/app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue";
import WorldEngineSubjectCreator from "nbook/app/components/novel-ide/world-engine/WorldEngineSubjectCreator.vue";
import WorldEngineWorkbenchPreviewInspector from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue";
import WorldEngineWorkbenchPreviewMutationEditor from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue";
import WorldEngineWorkbenchPreviewSidebar from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue";
import WorldEngineWorkbenchPreviewSliceList from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {isWorldWorkbenchSubjectSystemMaintenanceSlice} from "nbook/app/utils/world-engine-workbench-slice-classifier";
import {
    formatWorldEngineConflictMessage,
} from "nbook/app/utils/world-engine-preview";
import {
    buildWorkbenchPreviewFiltersAfterSavedEdit,
} from "nbook/app/utils/world-engine-workbench-preview-filter";
import {
    buildWorldWorkbenchCurrentReviewQueueIndex,
    buildWorldWorkbenchDraftSurfaceState,
    buildWorldWorkbenchEmptySliceState,
    buildWorldWorkbenchSubjectFileProposals,
    buildWorldWorkbenchEditSliceBody,
    buildWorldWorkbenchReviewQueueItems,
    buildWorldWorkbenchSubjectStats,
    buildWorldWorkbenchSubjectSystemInitialAttrs,
    buildWorldWorkbenchSubjectSystemSummariesFromRagOverview,
    buildWorldWorkbenchWorldViewFilterParts,
    collectWorldWorkbenchDraftSliceIds,
    collectWorldWorkbenchSliceTimes,
    findWorldWorkbenchFirstRemainingDraftSliceId,
    findWorldWorkbenchLatestSliceTouchingSubjects,
    isWorldWorkbenchSliceVisibleInSubjectFilter,
    mergeWorldWorkbenchTimelineSlice,
    mergeWorldWorkbenchKnownSliceTimes,
    mergeWorldWorkbenchSubjectsWithSubjectSystem,
    normalizeWorldWorkbenchSlices,
    shouldClearWorldWorkbenchReviewIssueFocus,
    worldWorkbenchIssueLevel,
    worldWorkbenchIssueStatusLabel,
    worldWorkbenchSubjectEventProposalKey,
    buildWorldWorkbenchIssueTriageSummary,
    buildWorldWorkbenchSliceReviewSummaries,
    buildWorldWorkbenchSliceComposerSubjectSelection,
    buildWorldWorkbenchUnsavedDraftLabels,
    type WorldWorkbenchEmptySliceState,
    type WorldWorkbenchTransientIssue,
} from "nbook/app/utils/world-engine-workbench-real";
import type {ProjectRagOverviewDto} from "nbook/shared/dto/project-rag.dto";
import type {
    CreateSubjectResultDto,
    DeleteSliceResultDto,
    SliceWriteResultDto,
    SubjectEventCommitResultDto,
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldIssueDto,
    WorldSchemaProjectionDto,
    WorldSliceDto,
    WorldSlicePatchDto,
    WorldStateDto,
    WorldStateQueryDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewIssueStatus,
    WorldWorkbenchPreviewIssueTriagePatch,
    WorldWorkbenchPreviewIssueTriageState,
    WorldWorkbenchPreviewIssueTriageSummary,
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewMutationFocus,
    WorldWorkbenchPreviewMutationListPatch,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewReviewQueueMode,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSlicePatch,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewSubjectStat,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchSubjectFileProposal,
    WorldWorkbenchPreviewValueDraftSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = defineProps<{
    modelValue: boolean;
    projectRoot: string;
    projectTitle: string;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "hasUnsavedDraftsChange", value: boolean): void;
    (e: "openWorkspacePath", path: string): void;
    (e: "savingChange", value: boolean): void;
}>();

const router = useRouter();
const {t} = useI18n();
const {confirm: confirmDialog} = useDialog();

const defaultSidebarWidth = 320;
const defaultInspectorWidth = 420;
const defaultMutationEditorHeight = 292;
const sliceLimit = 200;
const queryListLimit = 40;
const pendingSubjectTimelineNoticePrefix = "待接入 subject 暂无 World Engine 时间线";
const emptySchema: WorldSchemaProjectionDto = {
    subjectTypes: [],
    calendar: {
        format: "",
        examples: [],
    },
};
type LoadWorldOptions = {
    autoSelectSlice?: boolean;
    preferredSliceId?: string;
    preferredSubjectIds?: string[];
};
type SliceComposerEditorExpose = InstanceType<typeof WorldEngineMutationEditor> & {
    hasUnsavedDraft: () => boolean;
};
type SliceComposerInsertContext = {
    anchorTime: string;
    direction: "before" | "after";
    version: number;
};

const schema = shallowRef<WorldSchemaProjectionDto | null>(null);
const worldSubjects = ref<WorldSubjectDto[]>([]);
const subjects = ref<WorldSubjectDto[]>([]);
const slices = shallowRef<WorldWorkbenchPreviewSlice[]>([]);
const knownSliceTimes = ref<string[]>([]);
const selectedSliceId = ref("");
const selectedSubjectIds = ref<string[]>([]);
const subjectFilterMode = ref<WorldWorkbenchPreviewSubjectFilterMode>("any");
const sliceSearch = ref("");
const sliceKindFilter = ref("all");
const sliceHealthFilter = ref<WorldWorkbenchPreviewSliceHealthFilter>("all");
const focusedSubjectId = ref("");
const highlightedMutationFocus = ref<WorldWorkbenchPreviewMutationFocus | null>(null);
const issueTriageStates = ref<WorldWorkbenchPreviewIssueTriageState[]>([]);
const transientIssues = ref<WorldWorkbenchTransientIssue[]>([]);
const reviewQueueMode = ref<WorldWorkbenchPreviewReviewQueueMode>("open");
const sidebarCollapsed = ref(false);
const subjectCreatorOpen = ref(false);
const inspectorVisible = ref(true);
const subjectFileProposalFocusVersion = ref(0);
const committedSubjectEventKeys = ref<string[]>([]);
const mutationEditorCollapsed = ref(true);
const sliceComposerVisible = ref(false);
const sliceComposerDirty = ref(false);
const sliceComposerSaving = ref(false);
const sliceComposerEditorRef = ref<SliceComposerEditorExpose | null>(null);
const sliceComposerEditorKey = ref(0);
const sliceComposerLoadKey = ref(0);
const sliceComposerNewKey = ref(0);
const sliceComposerInsertContext = ref<SliceComposerInsertContext | null>(null);
const sidebarWidth = ref(defaultSidebarWidth);
const inspectorWidth = ref(defaultInspectorWidth);
const mutationEditorHeight = ref(defaultMutationEditorHeight);
const resetVersion = ref(0);
const metadataDraftSummaries = ref<WorldWorkbenchPreviewMetadataDraftSummary[]>([]);
const valueDraftSummaries = ref<WorldWorkbenchPreviewValueDraftSummary[]>([]);
const draftDiscardSliceId = ref("");
const draftDiscardVersion = ref(0);
const subjectSystemSummaries = ref<WorldWorkbenchPreviewSubjectSystemSummary[]>([]);
const subjectSystemSyncTimeOverride = ref("");
const snapshotSubjects = shallowRef<SubjectStateDto[]>([]);
const previousSnapshotSubjects = shallowRef<SubjectStateDto[]>([]);
const snapshotIssues = ref<WorldIssueDto[]>([]);
const fullSnapshotSubjects = shallowRef<SubjectStateDto[] | null>(null);
const fullSnapshotIssues = ref<WorldIssueDto[] | null>(null);
const fullSnapshotError = ref("");
const loading = ref(false);
const timelineLoading = ref(false);
const snapshotLoading = ref(false);
const fullSnapshotLoading = ref(false);
const actionBusy = ref(false);
const error = ref("");
const notice = ref("");
const notification = useNotification();
let snapshotRequestId = 0;
let fullSnapshotRequestId = 0;
let timelineRequestId = 0;
let transientIssueSerial = 0;
let preserveMutationFocusOnSubjectFilterChange = false;

/** 显示 Workbench 错误，并清掉旧成功提示，避免作者同时看到互相冲突的状态。 */
function setWorkbenchError(message: string): void {
    error.value = message;
    if (message) {
        notice.value = "";
    }
}

/** 显示 Workbench 成功 / 提示，并清掉旧错误提示，避免连续操作后误判当前状态。 */
function setWorkbenchNotice(message: string): void {
    notice.value = message;
    if (message) {
        error.value = "";
    }
}

/** 保存请求飞行中阻止用户切换上下文或触发其它写入。 */
function blockSliceComposerSaving(message = "Slice Composer 正在保存，请稍候再切换工作台上下文。"): boolean {
    if (!sliceComposerSaving.value) {
        return false;
    }
    setWorkbenchNotice(message);
    return true;
}

/** 工作台数据回流中阻止用户触发会切换上下文的动作。 */
function blockWorkbenchActionBusy(message = "World Engine 工作台正在同步，请稍候再操作。"): boolean {
    if (!workbenchActionBusy.value) {
        return false;
    }
    setWorkbenchNotice(message);
    return true;
}

const workbenchSchema = computed(() => schema.value ?? emptySchema);
const selectedSlice = computed(() => slices.value.find((slice) => slice.id === selectedSliceId.value) ?? null);
const selectedSliceIndex = computed(() => selectedSlice.value ? slices.value.findIndex((slice) => slice.id === selectedSlice.value?.id) : -1);
const subjectNameMap = computed(() => new Map(subjects.value.map((subject) => [subject.id, subject.name || subject.id])));
const worldSubjectIdSet = computed(() => new Set(worldSubjects.value.map((subject) => subject.id)));
const previewHref = computed(() => router.resolve(`/world-engine.preview?${new URLSearchParams({projectRoot: props.projectRoot}).toString()}`).href);
const issueTriageMap = computed(() => {
    const map = new Map<string, WorldWorkbenchPreviewIssueStatus>();
    for (const item of issueTriageStates.value) {
        map.set(item.key, item.status);
        if (item.identity) {
            map.set(item.identity, item.status);
        }
    }
    return map;
});
const reviewQueueItems = computed<WorldWorkbenchPreviewReviewQueueItem[]>(() => buildWorldWorkbenchReviewQueueItems({
    slices: slices.value,
    transientIssues: transientIssues.value,
    triageStatus: issueTriageMap.value,
}));
const reviewTriageSummary = computed<WorldWorkbenchPreviewIssueTriageSummary>(() => buildWorldWorkbenchIssueTriageSummary(reviewQueueItems.value));
const sliceReviewSummaries = computed<WorldWorkbenchPreviewSliceReviewSummary[]>(() => buildWorldWorkbenchSliceReviewSummaries({
    reviewQueueItems: reviewQueueItems.value,
    slices: slices.value,
}));
const subjectStats = computed<WorldWorkbenchPreviewSubjectStat[]>(() => buildWorldWorkbenchSubjectStats({
    reviewQueueItems: reviewQueueItems.value,
    slices: slices.value,
    subjects: subjects.value,
}));
const currentReviewQueueIndex = computed(() => buildWorldWorkbenchCurrentReviewQueueIndex({
    focus: highlightedMutationFocus.value,
    reviewQueueItems: reviewQueueItems.value,
    selectedSliceId: selectedSlice.value?.id ?? "",
}));
const emptyReviewQueueItems = computed(() => reviewQueueItems.value.slice(0, 3));
const hiddenEmptyReviewItemCount = computed(() => Math.max(0, reviewQueueItems.value.length - emptyReviewQueueItems.value.length));
const metadataDraftSliceCount = computed(() => metadataDraftSummaries.value.length);
const valueDraftSliceCount = computed(() => new Set(valueDraftSummaries.value.map((draft) => draft.sliceId)).size);
const selectedSliceSubjectFileProposalCount = computed(() => {
    const slice = selectedSlice.value;
    if (!slice) {
        return 0;
    }
    return buildWorldWorkbenchSubjectFileProposals({
        contextSubjectId: focusedSubjectId.value,
        slice,
        subjectNames: subjectNameMap.value,
        subjectSystemSummaries: subjectSystemSummaries.value,
    }).length;
});
const inspectorButtonAttentionClass = computed(() => {
    if (metadataDraftSliceCount.value && !inspectorVisible.value) {
        return "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)] hover:bg-[var(--we-bg-hover)]";
    }
    if (selectedSliceSubjectFileProposalCount.value && !inspectorVisible.value) {
        return "border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)] hover:bg-[var(--we-bg-hover)]";
    }
    return "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]";
});
const pendingSubjectSystemSummaries = computed(() => subjectSystemSummaries.value.filter((summary) => summary.syncStatus === "pending-world-subject"));
const subjectSystemDefaultSyncTime = computed(() => schema.value?.calendar.examples[0] ?? selectedSlice.value?.time ?? "");
const subjectSystemSyncTime = computed(() => subjectSystemSyncTimeOverride.value.trim() || subjectSystemDefaultSyncTime.value);
const worldSubjectDefaultTime = computed(() => schema.value?.calendar.examples[0] ?? selectedSlice.value?.time ?? "");
const hasWorldSchemaType = computed(() => Boolean(schema.value?.subjectTypes.some((type) => type.type === "world")));
const hasWorldSubject = computed(() => worldSubjects.value.some((subject) => subject.id === "world"));
const canCreateWorldSubject = computed(() => hasWorldSchemaType.value && !hasWorldSubject.value);
const workbenchBusy = computed(() => loading.value || timelineLoading.value || actionBusy.value || sliceComposerSaving.value || snapshotLoading.value || fullSnapshotLoading.value);
const workbenchActionBusy = computed(() => loading.value || timelineLoading.value || actionBusy.value || sliceComposerSaving.value);
const syncStatusDotClass = computed(() => {
    if (error.value) {
        return "bg-[var(--we-danger)]";
    }
    if (workbenchBusy.value) {
        return "bg-[var(--we-warning)]";
    }
    return "bg-[var(--we-success)]";
});
const draftSliceIds = computed(() => collectDraftSliceIds());
const totalDraftSliceCount = computed(() => draftSliceIds.value.length);

/** 汇总当前会话里所有未应用草稿 slice，并优先按当前 timeline 顺序展示。 */
function collectDraftSliceIds(): string[] {
    return collectWorldWorkbenchDraftSliceIds({
        metadataDraftSliceIds: metadataDraftSummaries.value.map((draft) => draft.sliceId),
        slices: slices.value,
        valueDraftSliceIds: valueDraftSummaries.value.map((draft) => draft.sliceId),
    });
}
const draftSummaryTitle = computed(() => {
    const parts: string[] = [];
    if (metadataDraftSliceCount.value) {
        parts.push(`${metadataDraftSliceCount.value} metadata`);
    }
    if (valueDraftSliceCount.value) {
        parts.push(`${valueDraftSliceCount.value} value`);
    }
    return parts.length ? `查看未应用草稿：${parts.join(" / ")}` : "当前没有未应用草稿";
});
const inspectorButtonTitle = computed(() => {
    const pendingParts: string[] = [];
    if (metadataDraftSliceCount.value) {
        pendingParts.push(`${metadataDraftSliceCount.value} 个 metadata 草稿`);
    }
    if (selectedSliceSubjectFileProposalCount.value) {
        pendingParts.push(`${selectedSliceSubjectFileProposalCount.value} 个主体文件建议`);
    }
    if (!pendingParts.length) {
        return inspectorVisible.value ? "隐藏检查器" : "打开检查器";
    }
    return inspectorVisible.value
        ? `隐藏检查器；${pendingParts.join("、")}仍会保留`
        : `打开检查器处理 ${pendingParts.join("、")}`;
});
const worldViewFilterParts = computed<string[]>(() => buildWorldWorkbenchWorldViewFilterParts({
    focusedSubjectHasSystemSummary: Boolean(focusedSubjectId.value && hasSubjectSystemSummary(focusedSubjectId.value)),
    focusedSubjectId: focusedSubjectId.value,
    labels: {
        search: t("worldEngine.workbenchPreview.search"),
        status: t("worldEngine.workbenchPreview.status"),
        subjects: t("worldEngine.workbenchPreview.subjects"),
    },
    selectedSubjectIds: selectedSubjectIds.value,
    sliceHealthFilter: sliceHealthFilter.value,
    sliceHealthFilterLabel: sliceHealthFilterLabel(sliceHealthFilter.value),
    sliceKindFilter: sliceKindFilter.value,
    sliceSearch: sliceSearch.value,
    subjectFilterMode: subjectFilterMode.value,
    subjectNames: subjectNameMap.value,
}));
const worldViewLabel = computed(() => worldViewFilterParts.value.length ? `当前视角：${worldViewFilterParts.value.join(" · ")}` : "整体世界视角");
const selectedSubjectLabel = computed(() => selectedSubjectIds.value.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", "));
const emptySliceState = computed<WorldWorkbenchEmptySliceState>(() => buildWorldWorkbenchEmptySliceState({
    canCreateWorldSubject: canCreateWorldSubject.value,
    hasSlices: slices.value.length > 0,
    hasWorldViewFilters: worldViewFilterParts.value.length > 0,
    pendingSubjectSystemCount: pendingSubjectSystemSummaries.value.length,
    selectedSubjectIds: selectedSubjectIds.value,
    subjectLabel: selectedSubjectLabel.value,
    worldSubjectCount: worldSubjects.value.length,
    worldSubjectIds: worldSubjectIdSet.value,
}));
const sliceComposerSubjectSelection = computed(() => buildWorldWorkbenchSliceComposerSubjectSelection({
    focusedSubjectId: focusedSubjectId.value,
    selectedSubjectIds: selectedSubjectIds.value,
    worldSubjectIds: worldSubjects.value.map((subject) => subject.id),
}));
const sliceComposerRequestedSubjectId = computed(() => sliceComposerSubjectSelection.value.requestedSubjectId);
const sliceComposerSubjectId = computed(() => sliceComposerSubjectSelection.value.subjectId);
const sliceComposerUsedTimes = computed(() => [...new Set([...knownSliceTimes.value, ...sliceTimesFromSlices(slices.value)])]);

/** 从切片列表抽取非空时间字符串，供 Composer 避开已知 instant。 */
function sliceTimesFromSlices(sourceSlices: WorldWorkbenchPreviewSlice[]): string[] {
    return collectWorldWorkbenchSliceTimes(sourceSlices);
}

/** 用完整 timeline 刷新已知时间窗口。 */
function replaceKnownSliceTimes(sourceSlices: WorldWorkbenchPreviewSlice[]): void {
    knownSliceTimes.value = sliceTimesFromSlices(sourceSlices);
}

/** 把局部 timeline 或懒加载切片并入已知时间窗口。 */
function mergeKnownSliceTimes(sourceSlices: WorldWorkbenchPreviewSlice[]): void {
    knownSliceTimes.value = mergeWorldWorkbenchKnownSliceTimes(knownSliceTimes.value, sourceSlices);
}

/** 读取当前 Project 的真实 World Engine 数据。 */
async function loadWorld(options: LoadWorldOptions = {}): Promise<void> {
    if (!props.projectRoot) {
        resetWorkbenchSessionState();
        setWorkbenchError("当前没有 Project Workspace。");
        return;
    }
    loading.value = true;
    timelineRequestId += 1;
    timelineLoading.value = false;
    error.value = "";
    try {
        const query = projectQuery();
        const [nextSchema, nextSubjects, nextSlices, subjectSystemOverview] = await Promise.all([
            $fetch<WorldSchemaProjectionDto>("/api/projects/world-engine/schema", {query}),
            $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
            $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {query: {...query, limit: sliceLimit, withPatches: "true"}}),
            $fetch<ProjectRagOverviewDto>("/api/projects/rag/overview", {query}),
        ]);
        schema.value = nextSchema;
        worldSubjects.value = nextSubjects;
        subjects.value = mergeWorldWorkbenchSubjectsWithSubjectSystem({overview: subjectSystemOverview, worldSubjects: nextSubjects});
        const normalizedSlices = normalizeWorldWorkbenchSlices(nextSlices);
        slices.value = normalizedSlices;
        replaceKnownSliceTimes(normalizedSlices);
        subjectSystemSummaries.value = buildWorldWorkbenchSubjectSystemSummariesFromRagOverview({
            overview: subjectSystemOverview,
            worldSubjects: nextSubjects,
        });
        applyDefaults(options);
        await loadSelectedSliceSnapshots();
    } catch (loadError) {
        schema.value = null;
        worldSubjects.value = [];
        subjects.value = [];
        slices.value = [];
        knownSliceTimes.value = [];
        selectedSliceId.value = "";
        selectedSubjectIds.value = [];
        focusedSubjectId.value = "";
        subjectSystemSummaries.value = [];
        snapshotSubjects.value = [];
        previousSnapshotSubjects.value = [];
        snapshotIssues.value = [];
        fullSnapshotSubjects.value = null;
        fullSnapshotIssues.value = null;
        setWorkbenchError(resolveApiErrorMessage(loadError, "读取 World Engine 数据失败"));
    } finally {
        loading.value = false;
    }
}

/** 只刷新主体系统 discovery / RAG overview；用于六文件 commit 后回流 dirty/count 状态。 */
async function refreshSubjectSystemOverview(): Promise<void> {
    const query = projectQuery();
    const [nextSubjects, subjectSystemOverview] = await Promise.all([
        $fetch<WorldSubjectDto[]>("/api/projects/world-engine/subjects", {query}),
        $fetch<ProjectRagOverviewDto>("/api/projects/rag/overview", {query}),
    ]);
    worldSubjects.value = nextSubjects;
    subjects.value = mergeWorldWorkbenchSubjectsWithSubjectSystem({overview: subjectSystemOverview, worldSubjects: nextSubjects});
    subjectSystemSummaries.value = buildWorldWorkbenchSubjectSystemSummariesFromRagOverview({
        overview: subjectSystemOverview,
        worldSubjects: nextSubjects,
    });
}

/** 刷新基础数据；若作者正在 subject 视角，随后继续使用服务端 subject timeline。 */
async function refreshWorldForCurrentTimeline(options: LoadWorldOptions = {}): Promise<void> {
    const preferredSliceId = options.preferredSliceId ?? selectedSliceId.value;
    const preferredSubjectIds = options.preferredSubjectIds ?? selectedSubjectIds.value;
    await loadWorld({...options, preferredSliceId, preferredSubjectIds});
    if (!schema.value || !selectedSubjectIds.value.some((subjectId) => worldSubjectIdSet.value.has(subjectId))) {
        return;
    }
    await reloadTimelineForCurrentSubjectFilter({
        autoSelectSlice: options.autoSelectSlice,
        preferredSliceId,
        preferredSubjectIds: selectedSubjectIds.value,
    });
}

/** 只刷新 timeline slices，用于 subject 过滤后的真实时间线查询。 */
async function reloadTimelineForCurrentSubjectFilter(options: LoadWorldOptions = {}): Promise<void> {
    if (!props.modelValue || !props.projectRoot || loading.value) {
        return;
    }
    const requestId = ++timelineRequestId;
    timelineLoading.value = true;
    error.value = "";
    try {
        const nextSlices = await $fetch<WorldSliceDto[]>("/api/projects/world-engine/slices", {
            query: {
                ...projectQuery(),
                limit: sliceLimit,
                withPatches: "true",
                ...sliceSubjectFilterQuery(),
            },
        });
        if (requestId !== timelineRequestId) {
            return;
        }
        const normalizedSlices = normalizeWorldWorkbenchSlices(nextSlices);
        slices.value = normalizedSlices;
        mergeKnownSliceTimes(normalizedSlices);
        applyDefaults({
            autoSelectSlice: options.autoSelectSlice,
            preferredSliceId: options.preferredSliceId ?? selectedSliceId.value,
            preferredSubjectIds: options.preferredSubjectIds ?? selectedSubjectIds.value,
        });
        await loadSelectedSliceSnapshots();
    } catch (timelineError) {
        if (requestId === timelineRequestId) {
            setWorkbenchError(resolveApiErrorMessage(timelineError, "刷新 subject 时间线失败"));
        }
    } finally {
        if (requestId === timelineRequestId) {
            timelineLoading.value = false;
        }
    }
}

/** 选中 slice 后读取触及主体的当前 / 前一切片状态。 */
async function loadSelectedSliceSnapshots(): Promise<void> {
    const slice = selectedSlice.value;
    const requestId = ++snapshotRequestId;
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
    if (!slice || !props.projectRoot) {
        snapshotSubjects.value = [];
        previousSnapshotSubjects.value = [];
        snapshotIssues.value = [];
        return;
    }
    snapshotLoading.value = true;
    try {
        const snapshotSlice = slice.previousTime === undefined || !slice.mutations.length ? await loadSliceDetailForSnapshot(slice) : slice;
        if (requestId !== snapshotRequestId) {
            return;
        }
        const subjectIds = Array.from(new Set(snapshotSlice.mutations.map((mutation) => mutation.subjectId))).filter(Boolean);
        if (!subjectIds.length) {
            snapshotSubjects.value = [];
            previousSnapshotSubjects.value = [];
            snapshotIssues.value = [];
            return;
        }
        const previousSnapshotTime = snapshotSlice.previousTime ?? "";
        const [currentResult, previousResult] = await Promise.all([
            querySubjectsAt(subjectIds, snapshotSlice.time),
            previousSnapshotTime ? querySubjectsAt(subjectIds, previousSnapshotTime) : Promise.resolve({subjects: [], issues: []} satisfies WorldStateQueryDto),
        ]);
        if (requestId !== snapshotRequestId) {
            return;
        }
        snapshotSubjects.value = currentResult.subjects;
        previousSnapshotSubjects.value = previousResult.subjects;
        snapshotIssues.value = currentResult.issues;
    } catch (snapshotError) {
        if (requestId === snapshotRequestId) {
            snapshotSubjects.value = [];
            previousSnapshotSubjects.value = [];
            snapshotIssues.value = [];
            setWorkbenchError(resolveApiErrorMessage(snapshotError, "读取切片状态失败"));
        }
    } finally {
        if (requestId === snapshotRequestId) {
            snapshotLoading.value = false;
        }
    }
}

/** 按需读取 slice detail，确保 State Snapshot 使用真实全局 previousTime，而不是当前过滤列表的前一项。 */
async function loadSliceDetailForSnapshot(slice: WorldWorkbenchPreviewSlice): Promise<WorldWorkbenchPreviewSlice> {
    const result = await $fetch<WorldSliceDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}`, {
        query: projectQuery(),
    });
    const loadedSlice = normalizeWorldWorkbenchSlices([result])[0] ?? null;
    if (!loadedSlice) {
        return slice;
    }
    const existingIndex = slices.value.findIndex((item) => item.id === loadedSlice.id);
    slices.value = existingIndex >= 0
        ? slices.value.map((item, index) => index === existingIndex ? loadedSlice : item)
        : mergeWorldWorkbenchTimelineSlice(slices.value, loadedSlice);
    mergeKnownSliceTimes([loadedSlice]);
    return loadedSlice;
}

/** 按需读取当前 slice 的完整世界状态。 */
async function loadFullSnapshot(): Promise<void> {
    const slice = selectedSlice.value;
    if (!slice || !props.projectRoot || fullSnapshotLoading.value) {
        return;
    }
    const requestId = ++fullSnapshotRequestId;
    fullSnapshotLoading.value = true;
    fullSnapshotError.value = "";
    try {
        const result = await $fetch<WorldStateDto>("/api/projects/world-engine/state", {
            query: {...projectQuery(), at: slice.time},
        });
        if (requestId === fullSnapshotRequestId && selectedSlice.value?.id === slice.id) {
            fullSnapshotSubjects.value = result.subjects;
            fullSnapshotIssues.value = result.issues;
        }
    } catch (fullError) {
        if (requestId === fullSnapshotRequestId) {
            fullSnapshotSubjects.value = null;
            fullSnapshotIssues.value = null;
            fullSnapshotError.value = resolveApiErrorMessage(fullError, "读取完整世界状态失败");
        }
    } finally {
        if (requestId === fullSnapshotRequestId) {
            fullSnapshotLoading.value = false;
        }
    }
}

/** 查询一批 subject 在指定时间的状态。 */
async function querySubjectsAt(subjectIds: string[], at: string): Promise<WorldStateQueryDto> {
    return $fetch<WorldStateQueryDto>("/api/projects/world-engine/state/query", {
        method: "POST",
        query: projectQuery(),
        body: {subjectIds, at, listLimit: queryListLimit},
    });
}

/** 保存 Inspector metadata 草稿到真实 slice。 */
async function saveMetadataPatch(patch: WorldWorkbenchPreviewSlicePatch): Promise<void> {
    const slice = selectedSlice.value;
    if (!slice) {
        return;
    }
    await saveSliceEdit(slice, buildWorldWorkbenchEditSliceBody(slice, patch), "已保存 slice 元信息");
}

/** 保存单条 mutation value 草稿。 */
async function saveMutationValuePatch(patch: WorldWorkbenchPreviewMutationValuePatch): Promise<void> {
    await saveMutationValuePatches([patch]);
}

/** 保存审查工作台里的完整 patch 列表草稿。 */
async function saveMutationListPatch(patch: WorldWorkbenchPreviewMutationListPatch): Promise<void> {
    const slice = slices.value.find((item) => item.id === patch.sliceId) ?? null;
    if (!slice) {
        return;
    }
    await saveSliceEdit(slice, {
        time: slice.time,
        title: slice.title,
        summary: slice.summary,
        kind: slice.kind,
        patches: patch.patches,
    }, `已保存 ${patch.patches.length} 个 mutation`);
}

/** 批量保存 mutation value 草稿，真实 API 只调用一次 editSlice。 */
async function saveMutationValuePatches(patches: WorldWorkbenchPreviewMutationValuePatch[]): Promise<void> {
    const slice = selectedSlice.value;
    const slicePatches = patches.filter((patch) => patch.sliceId === slice?.id);
    if (!slice || !slicePatches.length) {
        return;
    }
    await saveSliceEdit(slice, buildWorldWorkbenchEditSliceBody(slice, {}, slicePatches), `已保存 ${slicePatches.length} 个 mutation value`);
}

/** 调用真实 editSlice，并刷新 timeline / snapshot / issue。 */
async function saveSliceEdit(slice: WorldWorkbenchPreviewSlice, body: ReturnType<typeof buildWorldWorkbenchEditSliceBody>, successMessage: string): Promise<void> {
    actionBusy.value = true;
    error.value = "";  // 清空工作台级加载错误（操作级错误已迁移到 notification）
    try {
        const result = await $fetch<SliceWriteResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}/edit`, {
            method: "POST",
            query: projectQuery(),
            body,
        });
        notification.success(
            result.issues.length ? `${successMessage}，返回 ${result.issues.length} 个 issue。` : successMessage,
            { title: "保存 Slice 成功" }
        );
        clearFiltersIfSavedEditWouldBeHidden({
            ...slice,
            kind: body.kind,
            mutations: body.patches,
            summary: body.summary,
            time: body.time,
            title: body.title,
        });
        await refreshWorldForCurrentTimeline({preferredSliceId: result.sliceId || slice.id});
        recordTransientIssues(result.issues, result.sliceId || slice.id);
    } catch (saveError) {
        notification.error(
            formatWorldEngineConflictMessage(resolveApiErrorMessage(saveError, "保存 slice 失败")),
            { title: "保存 Slice 失败" }
        );
    } finally {
        actionBusy.value = false;
    }
}

/** 保存编辑后保持当前 slice 可见，避免过滤器把刚保存的内容挡出主画布。 */
function clearFiltersIfSavedEditWouldBeHidden(editedSlice: WorldWorkbenchPreviewSlice): void {
    const nextFilters = buildWorkbenchPreviewFiltersAfterSavedEdit({
        editedSlice,
        selectedSubjectIds: selectedSubjectIds.value,
        sliceHealthFilter: sliceHealthFilter.value,
        sliceKindFilter: sliceKindFilter.value,
        sliceSearch: sliceSearch.value,
        subjectFilterMode: subjectFilterMode.value,
    });
    selectedSubjectIds.value = nextFilters.selectedSubjectIds;
    subjectFilterMode.value = nextFilters.subjectFilterMode;
    sliceKindFilter.value = nextFilters.sliceKindFilter;
    sliceSearch.value = nextFilters.sliceSearch;
    sliceHealthFilter.value = nextFilters.sliceHealthFilter;
}

/** 创建 subject 后刷新当前工作台，并选中新 subject。 */
async function handleSubjectCreated(payload: {subject: WorldSubjectDto; issues: WorldIssueDto[]}): Promise<void> {
    notification.success(
        payload.issues.length ? `已创建 subject ${payload.subject.id}，返回 ${payload.issues.length} 个 issue。` : `已创建 subject ${payload.subject.id}`,
        { title: "创建 Subject 成功" }
    );
    selectedSubjectIds.value = [payload.subject.id];
    focusedSubjectId.value = payload.subject.id;
    await refreshWorldForCurrentTimeline({preferredSubjectIds: [payload.subject.id]});
    recordTransientIssues(payload.issues, selectedSlice.value?.id ?? "");
}

/** 显式创建 world subject，用于承载 world.events 等全局世界切面。 */
async function createWorldSubject(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再创建 world subject。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再创建 world subject。")) {
        return;
    }
    if (!props.projectRoot || !schema.value) {
        setWorkbenchError("Schema 未加载，无法创建 world subject。");
        return;
    }
    if (!hasWorldSchemaType.value) {
        setWorkbenchError("当前 schema 没有 world subject type，不能创建 world subject。");
        return;
    }
    const selectedBeforeCreate = [...selectedSubjectIds.value];
    const preservedSubjectContextId = focusedSubjectId.value && hasSubjectSystemSummary(focusedSubjectId.value)
        ? focusedSubjectId.value
        : [...selectedBeforeCreate].reverse().find((subjectId) => hasSubjectSystemSummary(subjectId)) ?? "";
    const nextSelectedSubjectIds = preservedSubjectContextId ? selectedBeforeCreate : ["world"];
    const nextFocusedSubjectId = preservedSubjectContextId || "world";
    if (hasWorldSubject.value) {
        setWorkbenchNotice("world subject 已存在。");
        selectedSubjectIds.value = nextSelectedSubjectIds;
        focusedSubjectId.value = nextFocusedSubjectId;
        return;
    }
    const time = worldSubjectDefaultTime.value.trim();
    if (!time) {
        setWorkbenchError("创建 world subject 需要可解析的初始化时间。请先配置 world-engine/calendar.ts。");
        return;
    }

    actionBusy.value = true;
    error.value = "";  // 清空工作台级加载错误（操作级错误已迁移到 notification）
    try {
        const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
            method: "POST",
            query: projectQuery(),
            body: {
                id: "world",
                type: "world",
                name: "世界",
                time,
            },
        });
        selectedSubjectIds.value = nextSelectedSubjectIds;
        notification.success(
            result.issues.length
                ? `已创建 world subject，返回 ${result.issues.length} 个 issue。`
                : "已创建 world subject。",
            { title: "创建 World Subject 成功" }
        );
        await refreshWorldForCurrentTimeline({preferredSubjectIds: nextSelectedSubjectIds});
        focusedSubjectId.value = nextFocusedSubjectId;
        recordTransientIssues(result.issues, selectedSlice.value?.id ?? "");
    } catch (createError) {
        notification.error(
            formatWorldEngineConflictMessage(resolveApiErrorMessage(createError, "创建 world subject 失败")),
            { title: "创建 World Subject 失败" }
        );
    } finally {
        actionBusy.value = false;
    }
}

/** 把真实 simulation/subjects 中尚未注册的主体同步为 World Engine subject 身份。 */
async function syncPendingSubjectSystemSubjects(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再同步主体系统。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再同步主体系统。")) {
        return;
    }
    const pending = pendingSubjectSystemSummaries.value;
    const time = subjectSystemSyncTime.value.trim();
    if (!pending.length) {
        setWorkbenchNotice("当前没有待接入主体。");
        return;
    }
    if (!time) {
        setWorkbenchError("同步主体系统需要可解析的初始化时间。请先配置 world-engine/calendar.ts。");
        return;
    }
    actionBusy.value = true;
    error.value = "";  // 清空工作台级加载错误（操作级错误已迁移到 notification）
    const created: string[] = [];
    const issues: WorldIssueDto[] = [];
    try {
        for (const summary of pending) {
            const subject = subjects.value.find((item) => item.id === summary.subjectId);
            const subjectType = subject?.type ?? "character";
            const result = await $fetch<CreateSubjectResultDto>("/api/projects/world-engine/subjects", {
                method: "POST",
                query: projectQuery(),
                body: {
                    id: summary.subjectId,
                    type: subjectType,
                    name: subject?.name || summary.subjectId,
                    time,
                    attrs: declaredSubjectSystemInitialAttrs(summary, subjectType),
                },
            });
            created.push(result.subjectId);
            issues.push(...result.issues);
        }
        notification.success(
            issues.length
                ? `已接入 ${created.length} 个主体系统 subject，返回 ${issues.length} 个 issue。`
                : `已接入 ${created.length} 个主体系统 subject。`,
            { title: "同步主体系统成功" }
        );
        selectedSubjectIds.value = created;
        focusedSubjectId.value = created[0] ?? focusedSubjectId.value;
        await refreshWorldForCurrentTimeline({preferredSubjectIds: created});
        recordTransientIssues(issues, selectedSlice.value?.id ?? "");
    } catch (syncError) {
        const message = formatWorldEngineConflictMessage(resolveApiErrorMessage(syncError, "同步主体系统失败"));
        if (!created.length) {
            notification.error(message, { title: "同步主体系统失败" });
            return;
        }
        selectedSubjectIds.value = created;
        focusedSubjectId.value = created[0] ?? focusedSubjectId.value;
        await refreshWorldForCurrentTimeline({preferredSubjectIds: created});
        recordTransientIssues(issues, selectedSlice.value?.id ?? "");
        notification.warning(
            `已接入 ${created.length} 个主体系统 subject，但后续同步失败：\n${message}`,
            { title: "主体系统部分同步成功" }
        );
    } finally {
        actionBusy.value = false;
    }
}

/** 只同步当前 schema 已声明的主体系统映射字段，避免通用 schema 项目因为额外字段失败。 */
function declaredSubjectSystemInitialAttrs(summary: WorldWorkbenchPreviewSubjectSystemSummary, subjectType: string): Record<string, WorkbenchJsonValue> {
    const attrNames = new Set(schema.value?.subjectTypes.find((item) => item.type === subjectType)?.attrs.map((attr) => attr.name) ?? []);
    const initialAttrs = buildWorldWorkbenchSubjectSystemInitialAttrs(summary);
    const declared: Record<string, WorkbenchJsonValue> = {};
    for (const [attr, value] of Object.entries(initialAttrs)) {
        if (attrNames.has(attr)) {
            declared[attr] = value;
        }
    }
    return declared;
}

/** 删除当前选中的 slice，并刷新真实 timeline。 */
async function deleteSelectedSlice(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再删除 Slice。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再删除 Slice。")) {
        return;
    }
    const slice = selectedSlice.value;
    if (!slice) {
        setWorkbenchError("请先选择一个 slice。");
        return;
    }
    if (!await confirmDialog(`确定要删除 slice「${slice.title || slice.id}」吗？此操作不可恢复。`, "删除 World Engine Slice")) {
        return;
    }
    actionBusy.value = true;
    error.value = "";  // 清空工作台级加载错误（操作级错误已迁移到 notification）
    try {
        const nextDraftSliceId = firstRemainingDraftSliceId(slice.id);
        const result = await $fetch<DeleteSliceResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}`, {
            method: "DELETE",
            query: projectQuery(),
        });
        notification.success(
            result.issues.length ? `已删除 slice ${slice.id}，删后返回 ${result.issues.length} 个 issue。` : `已删除 slice ${slice.id}`,
            { title: "删除 Slice 成功" }
        );
        clearSessionStateForDeletedSlice(slice.id);
        if (nextDraftSliceId) {
            enterDraftViewForSlice(nextDraftSliceId);
        }
        await refreshWorldForCurrentTimeline({autoSelectSlice: false, preferredSliceId: nextDraftSliceId || undefined});
        if (nextDraftSliceId && selectedSliceId.value === nextDraftSliceId) {
            openDraftSurfacesForSlice(nextDraftSliceId);
        }
        recordTransientIssues(result.issues, slice.id, slice);
    } catch (deleteError) {
        notification.error(
            resolveApiErrorMessage(deleteError, "删除 slice 失败"),
            { title: "删除 Slice 失败" }
        );
    } finally {
        actionBusy.value = false;
    }
}

/** 返回删除当前 slice 后还需要保留的第一个草稿 slice。 */
function firstRemainingDraftSliceId(deletedSliceId: string): string {
    return findWorldWorkbenchFirstRemainingDraftSliceId(draftSliceIds.value, deletedSliceId);
}

/** 进入草稿视角并先选中指定 slice，避免删除当前 slice 时卸载编辑器丢掉其它草稿。 */
function enterDraftViewForSlice(sliceId: string): void {
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "draft";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    selectedSliceId.value = sliceId;
    openDraftSurfacesForSlice(sliceId);
}

/** 删除 slice 后清理只属于该 slice 的前端会话态，避免 Drafts / Review / Snapshot 指向已删除记录。 */
function clearSessionStateForDeletedSlice(sliceId: string): void {
    discardSessionDraftsForSlice(sliceId);
    transientIssues.value = transientIssues.value.filter((issue) => issue.sliceId !== sliceId);
    highlightedMutationFocus.value = null;
    snapshotSubjects.value = [];
    previousSnapshotSubjects.value = [];
    snapshotIssues.value = [];
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
}

/** 清理某个 slice 的 metadata/value 会话草稿；Composer 整块保存后也复用，避免旧草稿覆盖新结果。 */
function discardSessionDraftsForSlice(sliceId: string): void {
    draftDiscardSliceId.value = sliceId;
    draftDiscardVersion.value += 1;
    metadataDraftSummaries.value = metadataDraftSummaries.value.filter((draft) => draft.sliceId !== sliceId);
    valueDraftSummaries.value = valueDraftSummaries.value.filter((draft) => draft.sliceId !== sliceId);
}

/** 把本次操作返回的 transient issue 加入当前会话 review queue。 */
function recordTransientIssues(issues: WorldIssueDto[], fallbackSliceId: string, fallbackSlice?: Pick<WorldWorkbenchPreviewSlice, "id" | "time" | "title">): void {
    if (!issues.length) {
        return;
    }
    const nextIssues = issues.map((issue, index): WorldWorkbenchTransientIssue => {
        const sliceId = issue.sliceId || fallbackSliceId || selectedSlice.value?.id || "";
        const slice = slices.value.find((item) => item.id === sliceId)
            ?? (fallbackSlice?.id === sliceId ? fallbackSlice : null)
            ?? (selectedSlice.value?.id === sliceId ? selectedSlice.value : null);
        const key = `transient:${transientIssueSerial++}:${sliceId}:${index}:${issue.subjectId}:${issue.attr}:${issue.code}`;
        return {
            attr: issue.attr,
            code: issue.code,
            explanation: issue.explanation,
            issueIndex: index,
            key,
            label: issue.label,
            message: issue.message,
            op: issue.op,
            patchId: issue.patchId,
            path: issue.path,
            severity: issue.severity,
            sliceId,
            sliceTime: slice?.time ?? "",
            sliceTitle: slice?.title ?? sliceId,
            subjectId: issue.subjectId,
            title: issue.title,
        };
    });
    transientIssues.value = [
        ...transientIssues.value.filter((issue) => !nextIssues.some((nextIssue) => nextIssue.sliceId === issue.sliceId && nextIssue.subjectId === issue.subjectId && nextIssue.attr === issue.attr && nextIssue.code === issue.code)),
        ...nextIssues,
    ];
}

/** 选择新的切片，并让编辑器/Inspector 对齐当前上下文。 */
function selectSlice(sliceId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy()) {
        return;
    }
    selectedSliceId.value = sliceId;
    highlightedMutationFocus.value = null;
    alignFocusedSubject(slices.value.find((slice) => slice.id === sliceId));
    openDraftSurfacesForSlice(sliceId);
}

/** 从 draft 时间线定位 slice 时，自动打开真正处理草稿的面板。 */
function openDraftSurfacesForSlice(sliceId: string): void {
    const surfaces = buildWorldWorkbenchDraftSurfaceState({
        metadataDraftSliceIds: metadataDraftSummaries.value.map((draft) => draft.sliceId),
        sliceHealthFilter: sliceHealthFilter.value,
        sliceId,
        valueDraftSliceIds: valueDraftSummaries.value.map((draft) => draft.sliceId),
    });
    if (surfaces.openInspector) {
        inspectorVisible.value = true;
    }
    if (surfaces.expandMutationEditor) {
        mutationEditorCollapsed.value = false;
    }
}

/** 将右侧 Inspector / 底部审查工作台的 subject 视角切到指定主体。 */
function focusSubject(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    focusedSubjectId.value = subjectId;
    highlightedMutationFocus.value = null;
    mutationEditorCollapsed.value = false;
}

/** 只设置主体文件建议语境，不改变 timeline 过滤或自动展开底部编辑器。 */
function focusSubjectContext(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换主体语境。")) {
        return;
    }
    if (!hasSubjectSystemSummary(subjectId)) {
        setWorkbenchError("该 subject 没有关联的主体系统文件，不能作为主体文件建议语境。");
        return;
    }
    focusedSubjectId.value = subjectId;
    highlightedMutationFocus.value = null;
    notification.success(`已将 ${subjectNameMap.value.get(subjectId) ?? subjectId} 设为主体文件建议语境。`);
}

/** 清空主体文件建议语境，不改变 timeline 过滤。 */
function clearSubjectContext(): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再清空主体语境。")) {
        return;
    }
    if (!focusedSubjectId.value) {
        return;
    }
    focusedSubjectId.value = "";
    highlightedMutationFocus.value = null;
    notification.success("已清空主体文件建议语境。");
}

/** 读取一个未加载的切面并放入当前 timeline，用于 Review Queue 精确定位。 */
async function loadSliceIntoTimeline(sliceId: string): Promise<WorldWorkbenchPreviewSlice | null> {
    if (!sliceId) {
        return null;
    }
    const existing = slices.value.find((slice) => slice.id === sliceId);
    if (existing) {
        return existing;
    }
    timelineLoading.value = true;
    error.value = "";  // 清空工作台级加载错误（操作级错误已迁移到 notification）
    try {
        const result = await $fetch<WorldSliceDto>(`/api/projects/world-engine/slices/${encodeURIComponent(sliceId)}`, {
            query: projectQuery(),
        });
        const loadedSlice = normalizeWorldWorkbenchSlices([result])[0] ?? null;
        if (!loadedSlice) {
            return null;
        }
        slices.value = mergeWorldWorkbenchTimelineSlice(slices.value, loadedSlice);
        mergeKnownSliceTimes([loadedSlice]);
        return loadedSlice;
    } catch (loadError) {
        notification.error(
            resolveApiErrorMessage(loadError, "读取 issue 所属 slice 失败"),
            { title: "读取 Slice 失败" }
        );
        return null;
    } finally {
        timelineLoading.value = false;
    }
}

/** 从 Review Queue 跳转并定位到指定 issue。 */
async function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再定位 issue。")) {
        return;
    }
    const targetSlice = await loadSliceIntoTimeline(item.sliceId);
    if (!targetSlice) {
        setWorkbenchNotice(`Issue 所属 slice ${item.sliceId || "(未知)"} 当前未加载，无法定位到时间线。`);
        focusedSubjectId.value = item.subjectId;
        highlightedMutationFocus.value = null;
        mutationEditorCollapsed.value = false;
        return;
    }
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    setSubjectFilterForReviewIssue(item.subjectId);
    await reloadTimelineForCurrentSubjectFilter({preferredSliceId: item.sliceId, preferredSubjectIds: [item.subjectId]});
    if (!slices.value.some((slice) => slice.id === targetSlice.id)) {
        slices.value = mergeWorldWorkbenchTimelineSlice(slices.value, targetSlice);
    }
    selectedSliceId.value = item.sliceId;
    focusedSubjectId.value = item.subjectId;
    highlightedMutationFocus.value = {attr: item.attr, issueKey: item.key, subjectId: item.subjectId};
    mutationEditorCollapsed.value = false;
}

/** Review Queue 自动切换 subject 过滤时保留 issue focus，避免 watcher 误清空刚定位的 issue。 */
function setSubjectFilterForReviewIssue(subjectId: string): void {
    const alreadySelected = selectedSubjectIds.value.length === 1 && selectedSubjectIds.value[0] === subjectId;
    if (!alreadySelected) {
        preserveMutationFocusOnSubjectFilterChange = true;
        selectedSubjectIds.value = [subjectId];
    }
    subjectFilterMode.value = "any";
}

function clearMutationFocus(): void {
    highlightedMutationFocus.value = null;
}

/** 当前 issue 被保存 / 刷新移除后，清掉旧高亮，避免底部审查区退化成误导性的 manual-focus。 */
function clearMissingReviewIssueFocus(): void {
    if (shouldClearWorldWorkbenchReviewIssueFocus({
        focus: highlightedMutationFocus.value,
        reviewQueueItems: reviewQueueItems.value,
    })) {
        highlightedMutationFocus.value = null;
    }
}

function viewSubjectTimeline(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换 subject 时间线。")) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline([subjectId]);
    focusSubject(subjectId);
}

function clearSubjectFilter(): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再清除 subject 过滤。")) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline([]);
}

function updateSliceSearchForTimeline(value: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再搜索时间线。")) {
        return;
    }
    sliceSearch.value = value;
}

function updateSliceKindFilterForTimeline(filter: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换 kind 过滤。")) {
        return;
    }
    sliceKindFilter.value = filter;
}

function updateSliceHealthFilterForTimeline(filter: WorldWorkbenchPreviewSliceHealthFilter): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换状态过滤。")) {
        return;
    }
    sliceHealthFilter.value = filter;
}

function removeSubjectFilter(subjectId: string): void {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再移除 subject 过滤。")) {
        return;
    }
    void updateSelectedSubjectIdsForTimeline(selectedSubjectIds.value.filter((id) => id !== subjectId));
}

async function updateSelectedSubjectIdsForTimeline(subjectIds: string[]): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换 subject 过滤。")) {
        return;
    }
    if (!subjectIds.length && subjectFilterMode.value !== "any") {
        subjectFilterMode.value = "any";
    }
    const pendingSubjectIds = subjectIds.filter((subjectId) => !worldSubjectIdSet.value.has(subjectId));
    const registeredSubjectIds = subjectIds.filter((subjectId) => worldSubjectIdSet.value.has(subjectId));
    const switchedSubjectFilterMode = pendingSubjectIds.length > 0 && subjectFilterMode.value === "all";
    if (switchedSubjectFilterMode) {
        subjectFilterMode.value = "any";
    }
    if (pendingSubjectIds.length) {
        const labels = pendingSubjectIds.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", ");
        setWorkbenchNotice(switchedSubjectFilterMode
            ? `${pendingSubjectTimelineNoticePrefix}：${labels}。包含待接入 subject 时已切回“任一 subject”过滤；请先使用左侧“同步主体系统”，或选择已注册 subject。`
            : `${pendingSubjectTimelineNoticePrefix}：${labels}。请先使用左侧“同步主体系统”，或选择已注册 subject。`);
    } else if (notice.value.startsWith(pendingSubjectTimelineNoticePrefix)) {
        notice.value = "";
    }
    selectedSubjectIds.value = subjectIds;
    await reloadTimelineForCurrentSubjectFilter({preferredSubjectIds: subjectIds});
    if (subjectIds.length && !registeredSubjectIds.length) {
        selectedSliceId.value = "";
        focusedSubjectId.value = subjectIds.at(-1) ?? "";
        highlightedMutationFocus.value = null;
    }
}

async function updateSubjectFilterModeForTimeline(mode: WorldWorkbenchPreviewSubjectFilterMode): Promise<void> {
    if (blockSliceComposerSaving()) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再切换 subject 模式。")) {
        return;
    }
    const pendingSubjectIds = selectedSubjectIds.value.filter((subjectId) => !worldSubjectIdSet.value.has(subjectId));
    if (mode === "all" && pendingSubjectIds.length) {
        const labels = pendingSubjectIds.map((subjectId) => subjectNameMap.value.get(subjectId) ?? subjectId).join(", ");
        subjectFilterMode.value = "any";
        setWorkbenchNotice(`${pendingSubjectTimelineNoticePrefix}：${labels}。待接入 subject 还没有 World Engine 切片，暂不能使用“全部 subject”过滤。`);
        return;
    }
    if (mode !== subjectFilterMode.value) {
        highlightedMutationFocus.value = null;
    }
    subjectFilterMode.value = mode;
    if (selectedSubjectIds.value.length) {
        await reloadTimelineForCurrentSubjectFilter({preferredSubjectIds: selectedSubjectIds.value});
    }
}

function openInspectorPanel(target?: "subject-file-proposals"): void {
    inspectorVisible.value = true;
    if (target === "subject-file-proposals") {
        subjectFileProposalFocusVersion.value += 1;
    }
}

/** 顶栏 / 恢复 rail 打开 Inspector；若当前 slice 有主体文件建议，直达建议区。 */
function toggleInspectorPanel(): void {
    if (inspectorVisible.value) {
        inspectorVisible.value = false;
        return;
    }
    openInspectorPanel(selectedSliceSubjectFileProposalCount.value ? "subject-file-proposals" : undefined);
}

function expandMutationEditorPanel(): void {
    mutationEditorCollapsed.value = false;
}

function openSliceComposer(): void {
    openSliceComposerForInsert(null);
}

/** 打开新建 Slice Composer；传入上下文时按目标 slice 前后预填时间。 */
function openSliceComposerForInsert(context: Omit<SliceComposerInsertContext, "version"> | null): void {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再新建 Slice。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再新建 Slice。")) {
        return;
    }
    const requestedSubjectId = sliceComposerRequestedSubjectId.value;
    if (requestedSubjectId && !worldSubjectIdSet.value.has(requestedSubjectId)) {
        const subjectName = subjectNameMap.value.get(requestedSubjectId) ?? requestedSubjectId;
        setWorkbenchNotice(`主体 ${subjectName} 尚未接入 World Engine。请先同步主体系统，或选择已注册 subject 后再新建 Slice。`);
        return;
    }
    if (!worldSubjects.value.length) {
        setWorkbenchNotice("当前 Project 还没有 World Engine subject。请先创建 subject 或同步主体系统。");
        return;
    }
    const wasVisible = sliceComposerVisible.value;
    if (!wasVisible) {
        sliceComposerDirty.value = false;
    }
    sliceComposerInsertContext.value = context
        ? {
            ...context,
            version: (sliceComposerInsertContext.value?.version ?? 0) + 1,
        }
        : null;
    sliceComposerVisible.value = true;
    if (wasVisible) {
        sliceComposerNewKey.value += 1;
    }
}

/** 从 SliceCard 工具组打开相邻插入草稿。 */
function openSliceComposerAroundSlice(sliceId: string, direction: "before" | "after"): void {
    const slice = slices.value.find((item) => item.id === sliceId);
    if (!slice) {
        setWorkbenchNotice("目标 slice 已不在当前时间线中。");
        return;
    }
    selectedSliceId.value = slice.id;
    alignFocusedSubject(slice);
    openSliceComposerForInsert({
        anchorTime: slice.time,
        direction,
    });
}

/** 从空状态把作者带到左侧创建 Subject 面板。 */
function openSubjectCreatorPanel(): void {
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再创建 Subject。")) {
        return;
    }
    sidebarCollapsed.value = false;
    subjectCreatorOpen.value = true;
}

/** 同步原生 details 展开状态，保留用户手动折叠 / 展开选择。 */
function updateSubjectCreatorOpen(event: Event): void {
    subjectCreatorOpen.value = (event.currentTarget as HTMLDetailsElement | null)?.open ?? false;
}

async function openSelectedSliceComposer(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再编辑其它 Slice。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再编辑其它 Slice。")) {
        return;
    }
    if (!selectedSlice.value) {
        setWorkbenchNotice("请先选择要编辑的 slice。");
        return;
    }
    if (!worldSubjects.value.length) {
        setWorkbenchNotice("当前 Project 还没有 World Engine subject。请先创建 subject 或同步主体系统。");
        return;
    }
    if (!sliceComposerVisible.value) {
        sliceComposerDirty.value = false;
    }
    sliceComposerInsertContext.value = null;
    sliceComposerVisible.value = true;
    await nextTick();
    sliceComposerLoadKey.value += 1;
}

async function closeSliceComposer(): Promise<void> {
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再关闭。");
        return;
    }
    if (sliceComposerHasUnsavedDraft() && !await confirmDialog("当前 Slice Composer 有未保存草稿，确定关闭吗？", "Slice Composer 草稿未保存")) {
        return;
    }
    sliceComposerVisible.value = false;
    sliceComposerDirty.value = false;
}

/** 同步读取 Slice Composer 是否有未保存草稿，事件状态和子组件实时状态二者取其一。 */
function sliceComposerHasUnsavedDraft(): boolean {
    return sliceComposerDirty.value || sliceComposerEditorRef.value?.hasUnsavedDraft() === true;
}

/** 接收 Slice Composer 的草稿状态，供关闭 Workbench / Composer 时统一确认。 */
function updateSliceComposerDirty(dirty: boolean): void {
    sliceComposerDirty.value = dirty;
}

/** 捕获 Composer 内原生输入变更，兜底保护 title/time/kind/summary/mutations 等表单草稿。 */
function markSliceComposerDirtyFromInput(): void {
    sliceComposerDirty.value = true;
}

/** 接收 Slice Composer 的保存状态，避免保存中关闭或跳转丢失结果。 */
function updateSliceComposerSaving(saving: boolean): void {
    sliceComposerSaving.value = saving;
}

async function requestWorkbenchClose(): Promise<void> {
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再关闭 Workbench。");
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再关闭 Workbench。")) {
        return;
    }
    const unsavedLabels = workbenchUnsavedDraftLabels();
    if (unsavedLabels.length && !await confirmDialog(`当前 Workbench 有未保存内容：${unsavedLabels.join("、")}。确定关闭并放弃吗？`, "World Engine 草稿未保存")) {
        return;
    }
    emit("update:modelValue", false);
}

/** 从 Workbench 打开 Project Workspace 文件；有草稿时先沿用 Workbench 关闭确认。 */
async function openWorkspacePathFromWorkbench(path: string): Promise<void> {
    const targetPath = path.trim();
    if (!targetPath) {
        return;
    }
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再打开工作区文件。");
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再打开工作区文件。")) {
        return;
    }
    const unsavedLabels = workbenchUnsavedDraftLabels();
    if (unsavedLabels.length && !await confirmDialog(`当前 Workbench 有未保存内容：${unsavedLabels.join("、")}。打开工作区文件会关闭 Workbench 并放弃这些会话草稿，确定继续吗？`, "World Engine 草稿未保存")) {
        return;
    }
    emit("update:modelValue", false);
    await nextTick();
    emit("openWorkspacePath", targetPath);
}

/** 把单条 Subject file proposal 追加到 events.jsonl，并刷新主体系统状态。 */
async function commitSubjectEventProposal(proposal: WorldWorkbenchSubjectFileProposal): Promise<void> {
    if (sliceComposerSaving.value) {
        setWorkbenchNotice("Slice Composer 正在保存，请稍候再追加 events.jsonl。");
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再追加 events.jsonl。")) {
        return;
    }
    const confirmed = await confirmDialog(`确认追加到 ${proposal.eventsPath}？目标主体：${proposal.subjectName}。JSONL：${proposal.eventJsonLine}`, "追加 events.jsonl");
    if (!confirmed) {
        return;
    }
    actionBusy.value = true;
    try {
        const result = await $fetch<SubjectEventCommitResultDto>("/api/projects/world-engine/subject-file-proposals/events/commit", {
            method: "POST",
            query: projectQuery(),
            body: {
                subjectId: proposal.subjectId,
                subjectPath: proposal.subjectPath,
                eventsPath: proposal.eventsPath,
                sliceId: proposal.sliceId,
                eventJsonLine: proposal.eventJsonLine,
            },
        });
        if (result.status === "already-exists") {
            notification.info(`${proposal.subjectName} 的 events.jsonl 已存在相同经历。`);
        } else {
            notification.success(`已追加到 ${proposal.subjectName} 的 events.jsonl，并标记 events RAG dirty。`);
        }
        markSubjectEventProposalCommitted(proposal);
        try {
            await refreshSubjectSystemOverview();
        } catch (refreshError) {
            const fallback = result.status === "already-exists"
                ? "events.jsonl 已存在相同经历，但刷新主体系统状态失败"
                : "events.jsonl 已追加，但刷新主体系统状态失败";
            setWorkbenchError(resolveApiErrorMessage(refreshError, fallback));
        }
    } catch (commitError) {
        setWorkbenchError(resolveApiErrorMessage(commitError, "追加 events.jsonl 失败"));
    } finally {
        actionBusy.value = false;
    }
}

/** 记录当前 Workbench 会话已经处理过的 event proposal，避免作者重复点击同一条追加。 */
function markSubjectEventProposalCommitted(proposal: WorldWorkbenchSubjectFileProposal): void {
    const key = worldWorkbenchSubjectEventProposalKey(proposal);
    if (!committedSubjectEventKeys.value.includes(key)) {
        committedSubjectEventKeys.value = [...committedSubjectEventKeys.value, key];
    }
}

/** 统一处理 Dialog 的 v-model 更新，避免直接关闭绕过 Workbench 草稿确认。 */
async function handleWorkbenchModelUpdate(value: boolean): Promise<void> {
    if (value) {
        emit("update:modelValue", true);
        return;
    }
    await requestWorkbenchClose();
}

/** 汇总关闭 Workbench 时会丢弃的会话态草稿。 */
function workbenchUnsavedDraftLabels(): string[] {
    return buildWorldWorkbenchUnsavedDraftLabels({
        hasSliceComposerDraft: sliceComposerHasUnsavedDraft(),
        metadataDraftCount: metadataDraftSummaries.value.length,
        valueDraftSliceCount: valueDraftSliceCount.value,
    });
}

/** Slice Composer 写入/编辑成功后回到真实时间线，并把 issues 接入当前会话审查队列。 */
async function handleSliceComposerSaved(payload: {result: SliceWriteResultDto; time: string; editing: boolean; continueAfterSave: boolean; contextSubjectId: string; mutations: WorldSlicePatchDto[]}): Promise<void> {
    const messagePrefix = payload.editing ? "已更新 slice" : "已写入 slice";
    const continueSuffix = payload.continueAfterSave ? "，已准备下一步草稿" : "";
    const savedNotice = payload.result.issues.length
        ? `${messagePrefix} ${payload.result.sliceId}，返回 ${payload.result.issues.length} 个 issue${continueSuffix}。`
        : `${messagePrefix} ${payload.result.sliceId}${continueSuffix}`;
    sliceComposerVisible.value = payload.continueAfterSave;
    sliceComposerDirty.value = false;
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    clearSubjectFilterIfSavedSliceWouldBeHidden(payload.mutations);
    const continueSubjectId = payload.continueAfterSave ? payload.contextSubjectId : "";
    if (continueSubjectId && worldSubjectIdSet.value.has(continueSubjectId)) {
        focusedSubjectId.value = continueSubjectId;
    }
    if (payload.editing) {
        discardSessionDraftsForSlice(payload.result.sliceId);
    }
    await refreshWorldForCurrentTimeline({preferredSliceId: payload.result.sliceId});
    const savedSlice = slices.value.find((slice) => slice.id === payload.result.sliceId) ?? null;
    if (savedSlice) {
        const proposalContextSubjectId = payload.contextSubjectId || focusedSubjectId.value;
        const proposalCount = buildWorldWorkbenchSubjectFileProposals({
            contextSubjectId: proposalContextSubjectId,
            slice: savedSlice,
            subjectNames: subjectNameMap.value,
            subjectSystemSummaries: subjectSystemSummaries.value,
        }).length;
        if (proposalCount) {
            if (proposalContextSubjectId && worldSubjectIdSet.value.has(proposalContextSubjectId)) {
                focusedSubjectId.value = proposalContextSubjectId;
            }
            notification.success(
                `${savedNotice} 可在右侧 Inspector 查看 ${proposalCount} 个主体文件建议。`,
                { title: payload.editing ? "更新 Slice 成功" : "写入 Slice 成功" }
            );
        } else {
            notification.success(
                savedNotice,
                { title: payload.editing ? "更新 Slice 成功" : "写入 Slice 成功" }
            );
        }
    } else {
        notification.success(
            savedNotice,
            { title: payload.editing ? "更新 Slice 成功" : "写入 Slice 成功" }
        );
    }
    recordTransientIssues(payload.result.issues, payload.result.sliceId);
    if (!payload.continueAfterSave) {
        sliceComposerEditorKey.value += 1;
    }
}

/** 保存后的切片如果不命中当前 subject 过滤，先切回整体视角，避免时间线立刻跳走。 */
function clearSubjectFilterIfSavedSliceWouldBeHidden(mutations: WorldSlicePatchDto[]): void {
    if (isWorldWorkbenchSliceVisibleInSubjectFilter({
        mutations,
        selectedSubjectIds: selectedSubjectIds.value,
        subjectFilterMode: subjectFilterMode.value,
    })) {
        return;
    }
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
}

/** 顶栏全局草稿入口：清掉阻挡过滤，进入 draft 时间线。 */
async function showAllDraftSlices(): Promise<void> {
    if (blockSliceComposerSaving("Slice Composer 正在保存，请稍候再查看草稿。")) {
        return;
    }
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再查看草稿。")) {
        return;
    }
    const targetDraftSliceIds = draftSliceIds.value;
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "draft";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    await reloadTimelineForCurrentSubjectFilter();
    for (const sliceId of targetDraftSliceIds) {
        if (!slices.value.some((slice) => slice.id === sliceId)) {
            await loadSliceIntoTimeline(sliceId);
        }
    }
    const firstDraftSliceId = targetDraftSliceIds.find((sliceId) => slices.value.some((slice) => slice.id === sliceId));
    if (firstDraftSliceId) {
        selectSlice(firstDraftSliceId);
        return;
    }
    setWorkbenchNotice("当前草稿所在 slice 未能重新载入，请刷新后再试。");
}

/** 更新前端会话态 issue triage；不回写后端。 */
function updateIssueTriage(patch: WorldWorkbenchPreviewIssueTriagePatch): void {
    issueTriageStates.value = [
        ...issueTriageStates.value.filter((item) => item.key !== patch.key),
        {identity: patch.identity, key: patch.key, status: patch.status, updatedAt: new Date().toISOString()},
    ];
    notification.success(`Issue 已标记为 ${issueStatusLabel(patch.status)}`);
}

/** 当前 focused subject 不属于 slice 时，回落到过滤 subject 或 slice 首个触及主体。 */
function alignFocusedSubject(slice: WorldWorkbenchPreviewSlice | undefined): void {
    if (!slice) {
        focusedSubjectId.value = "";
        return;
    }
    const touched = new Set(slice.mutations.map((mutation) => mutation.subjectId));
    if (focusedSubjectId.value && touched.has(focusedSubjectId.value)) {
        return;
    }
    if (slice.mutations.some((mutation) => mutation.subjectId === "world")) {
        if (focusedSubjectId.value && hasSubjectSystemSummary(focusedSubjectId.value)) {
            return;
        }
        for (let index = selectedSubjectIds.value.length - 1; index >= 0; index -= 1) {
            const subjectId = selectedSubjectIds.value[index];
            if (subjectId && hasSubjectSystemSummary(subjectId)) {
                focusedSubjectId.value = subjectId;
                return;
            }
        }
    }
    for (let index = selectedSubjectIds.value.length - 1; index >= 0; index -= 1) {
        const subjectId = selectedSubjectIds.value[index];
        if (subjectId && touched.has(subjectId)) {
            focusedSubjectId.value = subjectId;
            return;
        }
    }
    focusedSubjectId.value = slice.mutations[0]?.subjectId ?? "";
}

/** 当前主体是否能生成 simulation/subjects 六文件建议。 */
function hasSubjectSystemSummary(subjectId: string): boolean {
    return subjectSystemSummaries.value.some((summary) => summary.subjectId === subjectId);
}

function applyDefaults(options: {autoSelectSlice?: boolean; preferredSliceId?: string; preferredSubjectIds?: string[]} = {}): void {
    const subjectIdSet = new Set(subjects.value.map((subject) => subject.id));
    selectedSubjectIds.value = selectedSubjectIds.value.filter((subjectId) => subjectIdSet.has(subjectId));
    if (!selectedSubjectIds.value.length) {
        subjectFilterMode.value = "any";
    }
    const preferredSubjectIds = (options.preferredSubjectIds ?? []).filter((subjectId) => subjectIdSet.has(subjectId));
    const preferredSlice = slices.value.find((slice) => slice.id === options.preferredSliceId);
    const preferredSubjectSlice = latestSliceTouchingSubjects(preferredSubjectIds);
    const keptSlice = slices.value.find((slice) => slice.id === selectedSliceId.value);
    const keepEmptyPreferredSubjectView = preferredSubjectIds.length > 0 && !preferredSlice && !preferredSubjectSlice;
    const fallbackSlice = options.autoSelectSlice === false || keepEmptyPreferredSubjectView
        ? null
        : [...slices.value].reverse().find((slice) => !isWorldWorkbenchSubjectSystemMaintenanceSlice(slice)) ?? slices.value.at(-1) ?? null;
    const nextSlice = preferredSlice ?? preferredSubjectSlice ?? keptSlice ?? fallbackSlice;
    selectedSliceId.value = nextSlice?.id ?? "";
    if (!nextSlice && preferredSubjectIds.length) {
        focusedSubjectId.value = preferredSubjectIds.at(-1) ?? "";
        return;
    }
    alignFocusedSubject(nextSlice ?? undefined);
}

/** 创建 / 同步 subject 后，优先定位到刚生成或追加的初始化切片。 */
function latestSliceTouchingSubjects(subjectIds: string[]): WorldWorkbenchPreviewSlice | null {
    return findWorldWorkbenchLatestSliceTouchingSubjects(slices.value, subjectIds);
}

/** 切换 Project 或关闭 Dialog 时清空会话态草稿和选择。 */
function resetWorkbenchSessionState(): void {
    schema.value = null;
    worldSubjects.value = [];
    subjects.value = [];
    slices.value = [];
    knownSliceTimes.value = [];
    selectedSliceId.value = "";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    focusedSubjectId.value = "";
    highlightedMutationFocus.value = null;
    issueTriageStates.value = [];
    transientIssues.value = [];
    reviewQueueMode.value = "open";
    committedSubjectEventKeys.value = [];
    subjectCreatorOpen.value = false;
    mutationEditorCollapsed.value = true;
    sliceComposerVisible.value = false;
    sliceComposerDirty.value = false;
    sliceComposerSaving.value = false;
    sliceComposerEditorKey.value += 1;
    sliceComposerLoadKey.value = 0;
    sliceComposerNewKey.value = 0;
    sliceComposerInsertContext.value = null;
    metadataDraftSummaries.value = [];
    valueDraftSummaries.value = [];
    draftDiscardSliceId.value = "";
    draftDiscardVersion.value = 0;
    subjectSystemSummaries.value = [];
    subjectSystemSyncTimeOverride.value = "";
    snapshotSubjects.value = [];
    previousSnapshotSubjects.value = [];
    snapshotIssues.value = [];
    fullSnapshotSubjects.value = null;
    fullSnapshotIssues.value = null;
    fullSnapshotError.value = "";
    notice.value = "";
    error.value = "";
    resetVersion.value += 1;
}

function projectQuery(): {projectRoot: string} {
    return {projectRoot: props.projectRoot};
}

function sliceSubjectFilterQuery(): {subjectIds?: string; subjectMode?: WorldWorkbenchPreviewSubjectFilterMode} {
    const registeredSubjectIds = selectedSubjectIds.value.filter((subjectId) => worldSubjectIdSet.value.has(subjectId));
    if (!registeredSubjectIds.length) {
        return {};
    }
    return {
        subjectIds: registeredSubjectIds.join(","),
        subjectMode: subjectFilterMode.value,
    };
}

function openPreview(): void {
    if (blockWorkbenchActionBusy("World Engine 工作台正在同步，请稍候再打开 Preview。")) {
        return;
    }
    if (import.meta.client) {
        window.open(previewHref.value, "_blank", "noopener,noreferrer");
    }
}

function sliceHealthFilterLabel(filter: WorldWorkbenchPreviewSliceHealthFilter): string {
    if (filter === "open") {
        return t("worldEngine.workbenchPreview.openIssues");
    }
    if (filter === "done") {
        return t("worldEngine.workbenchPreview.reviewDone");
    }
    if (filter === "clean") {
        return t("worldEngine.workbenchPreview.clean");
    }
    if (filter === "draft") {
        return t("worldEngine.workbenchPreview.drafts");
    }
    return t("worldEngine.workbenchPreview.all");
}

function issueStatusLabel(status: WorldWorkbenchPreviewIssueStatus): string {
    return worldWorkbenchIssueStatusLabel(status);
}

function issueLevel(severity: WorldWorkbenchPreviewReviewQueueItem["severity"]): "A" | "E" {
    return worldWorkbenchIssueLevel(severity);
}

watch(() => props.modelValue, (visible) => {
    if (visible) {
        void loadWorld();
    } else {
        resetWorkbenchSessionState();
    }
});

watch(() => props.projectRoot, () => {
    resetWorkbenchSessionState();
    if (props.modelValue) {
        void loadWorld();
    }
});

watch(() => workbenchUnsavedDraftLabels().length > 0, (hasUnsavedDrafts) => {
    emit("hasUnsavedDraftsChange", hasUnsavedDrafts);
}, {immediate: true});

watch(() => sliceComposerSaving.value, (saving) => {
    emit("savingChange", saving);
}, {immediate: true});

watch(() => selectedSliceId.value, () => {
    if (props.modelValue) {
        void loadSelectedSliceSnapshots();
    }
});

watch(() => selectedSubjectIds.value.join("\u0000"), () => {
    if (!selectedSubjectIds.value.length) {
        highlightedMutationFocus.value = null;
        return;
    }
    focusedSubjectId.value = selectedSubjectIds.value[selectedSubjectIds.value.length - 1] ?? "";
    if (preserveMutationFocusOnSubjectFilterChange) {
        preserveMutationFocusOnSubjectFilterChange = false;
        return;
    }
    highlightedMutationFocus.value = null;
});

watch(() => reviewQueueItems.value.map((item) => item.key).join("\u0000"), clearMissingReviewIssueFocus);
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="full"
        overlay-type="opaque"
        :show-footer="false"
        :close-on-overlay="false"
        :teleport-target="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="void handleWorkbenchModelUpdate($event)"
        @request-close="void requestWorkbenchClose()"
    >
        <template #header>
            <!-- World Engine 真实工作台顶部栏 -->
            <div class="world-engine-workbench-theme flex min-w-0 flex-1 items-center gap-3">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent-main)_58%,var(--border-color))] bg-[color-mix(in_srgb,var(--accent-main)_18%,var(--bg-panel))] text-[12px] font-bold text-[var(--accent-main)]">WE</span>
                <div class="min-w-0">
                    <div class="text-[16px] font-semibold text-[var(--text-main)]">World Engine Workbench</div>
                    <div class="flex min-w-0 items-center gap-2 truncate text-[12px] text-[var(--text-muted)]">
                        <span class="truncate">{{ props.projectTitle || props.projectRoot || "未选择 Project" }}</span>
                        <span v-if="workbenchSchema.calendar.format" class="hidden rounded-md border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] md:inline">{{ workbenchSchema.calendar.format }}</span>
                        <span class="hidden truncate lg:inline">{{ worldViewLabel }}</span>
                    </div>
                </div>
                <div class="ml-auto flex items-center gap-2">
                    <span class="hidden items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] md:inline-flex">
                        <span class="h-1.5 w-1.5 rounded-full" :class="syncStatusDotClass"></span>
                        {{ error ? "需要处理" : workbenchBusy ? "同步中" : "已同步" }}
                    </span>
                    <button
                        v-if="totalDraftSliceCount"
                        type="button"
                        data-testid="world-workbench-draft-summary"
                        class="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50"
                        :disabled="workbenchActionBusy"
                        :title="draftSummaryTitle"
                        :aria-label="t('worldEngine.workbenchPreview.drafts')"
                        @click="void showAllDraftSlices()"
                    >
                        <span class="i-lucide-list-todo h-3.5 w-3.5"></span>
                        <span class="rounded bg-[var(--we-bg-panel)] px-1 font-mono text-[10px]">{{ totalDraftSliceCount }}</span>
                    </button>
                    <button type="button" title="刷新" aria-label="刷新" class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="void refreshWorldForCurrentTimeline()">
                        <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" title="新建 Slice" aria-label="新建 Slice" class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy || !schema" @click="openSliceComposer">
                        <span class="i-lucide-file-plus-2 h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" title="编辑 Slice" aria-label="编辑 Slice" class="hidden h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50 lg:inline-flex" :disabled="workbenchActionBusy || !schema || !selectedSlice" @click="void openSelectedSliceComposer()">
                        <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" title="删除 Slice" aria-label="删除 Slice" class="hidden h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:border-[var(--we-danger-border)] hover:bg-[var(--we-danger-soft)] hover:text-[var(--we-danger)] disabled:opacity-50 xl:inline-flex" :disabled="workbenchActionBusy || !selectedSlice" @click="void deleteSelectedSlice()">
                        <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'" class="h-3.5 w-3.5"></span>
                    </button>
                    <button
                        type="button"
                        data-testid="world-workbench-inspector-toggle"
                        class="inline-flex h-8 items-center gap-1 rounded-md border px-1.5 transition-colors"
                        :class="inspectorButtonAttentionClass"
                        :title="inspectorButtonTitle"
                        :aria-label="t('worldEngine.workbenchPreview.inspector')"
                        @click="toggleInspectorPanel"
                    >
                        <span :class="inspectorVisible ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" class="h-3.5 w-3.5"></span>
                        <span v-if="selectedSliceSubjectFileProposalCount" data-testid="world-workbench-inspector-proposal-count" class="rounded bg-[var(--we-bg-panel)] px-1 font-mono text-[10px]">{{ selectedSliceSubjectFileProposalCount }}</span>
                    </button>
                    <button type="button" title="Preview" aria-label="Preview" class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="openPreview">
                        <span class="i-lucide-external-link h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" data-testid="world-workbench-close" aria-label="关闭 World Engine Workbench" title="关闭 World Engine Workbench" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="void requestWorkbenchClose()">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
            </div>
        </template>

        <!-- World Engine 真实工作台主体 -->
        <div class="world-engine-workbench-dialog world-engine-workbench-theme relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--we-bg-canvas)] text-[var(--we-text-main)]">
            <!-- 工作台级加载错误 banner（操作级错误已迁移到 notification） -->
            <div v-if="error" class="border-b border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] px-4 py-2 text-[13px] text-[var(--we-danger)]">{{ error }}</div>

            <div v-if="sliceComposerVisible" data-testid="world-slice-composer" class="absolute inset-3 z-30 flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] shadow-2xl" @input.capture="markSliceComposerDirtyFromInput" @change.capture="markSliceComposerDirtyFromInput">
                <div class="flex h-11 shrink-0 items-center justify-between border-b border-[var(--we-border)] px-4">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-file-plus-2 h-4 w-4 text-[var(--we-accent)]"></span>
                        <div class="truncate text-[13px] font-semibold text-[var(--we-text-main)]">新建 / 编辑 Slice</div>
                    </div>
                    <button type="button" data-testid="world-slice-composer-close" aria-label="关闭 Slice Composer" title="关闭 Slice Composer" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" @click="void closeSliceComposer()">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
                <div class="min-h-0 flex-1 overflow-auto">
                    <WorldEngineMutationEditor
                        ref="sliceComposerEditorRef"
                        :key="sliceComposerEditorKey"
                        :project-root="props.projectRoot"
                        :schema="schema"
                        :subjects="worldSubjects"
                        :selected-subject-id="sliceComposerSubjectId"
                        :selected-slice="selectedSlice"
                        :load-slice-key="sliceComposerLoadKey"
                        :new-slice-key="sliceComposerNewKey"
                        :insert-slice-context="sliceComposerInsertContext"
                        :state-result="snapshotSubjects"
                        :used-times="sliceComposerUsedTimes"
                        :busy="workbenchActionBusy"
                        @dirty-change="updateSliceComposerDirty"
                        @saving-change="updateSliceComposerSaving"
                        @saved="void handleSliceComposerSaved($event)"
                        @error="setWorkbenchError"
                        @notice="setWorkbenchNotice"
                    />
                </div>
            </div>

            <div class="flex min-h-0 flex-1">
                <WorldEngineWorkbenchPreviewSidebar
                    :busy="workbenchActionBusy"
                    :selected-subject-ids="selectedSubjectIds"
                    :collapsed="sidebarCollapsed"
                    :focused-subject-id="focusedSubjectId"
                    :reset-key="resetVersion"
                    :schema="workbenchSchema"
                    :width="sidebarWidth"
                    :subject-stats="subjectStats"
                    :subject-system-summaries="subjectSystemSummaries"
                    :subjects="subjects"
                    :value-draft-summaries="valueDraftSummaries"
                    @update:selected-subject-ids="void updateSelectedSubjectIdsForTimeline($event)"
                    @update:width="sidebarWidth = $event"
                    @clear-subject-context="clearSubjectContext"
                    @focus-subject-context="focusSubjectContext"
                    @open-workspace-path="void openWorkspacePathFromWorkbench($event)"
                    @toggle-collapsed="sidebarCollapsed = !sidebarCollapsed"
                >
                    <template #actions>
                        <section v-if="pendingSubjectSystemSummaries.length" data-testid="subject-system-sync-panel" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] p-2.5">
                            <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <div class="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--we-warning)]">主体系统待接入</div>
                                    <div class="mt-1 text-[11px] text-[var(--we-text-secondary)]">{{ pendingSubjectSystemSummaries.length }} 个 simulation/subjects 主体还没有 World Engine subject 身份。</div>
                                    <div class="mt-1 text-[11px] text-[var(--we-text-secondary)]">同步只注册身份，不复制或改写六文件正文。</div>
                                </div>
                                <span class="rounded bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ pendingSubjectSystemSummaries.length }}</span>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-1">
                                <span v-for="summary in pendingSubjectSystemSummaries.slice(0, 4)" :key="`pending-subject:${summary.subjectId}`" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ summary.subjectId }}</span>
                                <span v-if="pendingSubjectSystemSummaries.length > 4" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">+{{ pendingSubjectSystemSummaries.length - 4 }}</span>
                            </div>
                            <div class="mt-2 rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] p-2 text-[11px]">
                                <div class="mb-1 flex min-w-0 items-center justify-between gap-2">
                                    <span class="shrink-0 text-[var(--we-text-muted)]">初始化时间</span>
                                    <span class="min-w-0 truncate font-mono text-[var(--we-warning)]">{{ subjectSystemDefaultSyncTime || "未配置" }}</span>
                                </div>
                                <input v-model.trim="subjectSystemSyncTimeOverride" type="text" class="h-7 w-full rounded border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 font-mono text-[11px] text-[var(--we-text-main)] outline-none transition-colors placeholder:text-[var(--we-text-muted)] focus:border-[var(--we-warning-border)] disabled:opacity-50" :placeholder="subjectSystemDefaultSyncTime || '未配置'" :disabled="workbenchActionBusy" aria-label="同步主体系统初始化时间">
                            </div>
                            <button type="button" class="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !subjectSystemSyncTime" @click="void syncPendingSubjectSystemSubjects()">
                                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link-2'" class="h-3.5 w-3.5"></span>
                                同步主体系统
                            </button>
                        </section>
                        <details class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)]" :open="subjectCreatorOpen" @toggle="updateSubjectCreatorOpen">
                            <summary class="cursor-pointer px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--we-text-secondary)]">创建 Subject</summary>
                            <WorldEngineSubjectCreator
                                :project-root="props.projectRoot"
                                :schema="schema"
                                :busy="workbenchActionBusy"
                                @created="void handleSubjectCreated($event)"
                                @error="setWorkbenchError"
                                @notice="setWorkbenchNotice"
                            />
                        </details>
                    </template>
                </WorldEngineWorkbenchPreviewSidebar>

                <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <WorldEngineWorkbenchPreviewSliceList
                        :slices="slices"
                        :subjects="subjects"
                        :focused-subject-id="focusedSubjectId"
                        :reset-key="resetVersion"
                        :selected-slice-id="selectedSlice?.id ?? ''"
                        :selected-subject-ids="selectedSubjectIds"
                        :slice-health-filter="sliceHealthFilter"
                        :slice-kind-filter="sliceKindFilter"
                        :slice-review-summaries="sliceReviewSummaries"
                        :review-queue-items="reviewQueueItems"
                        :slice-search="sliceSearch"
                        :subject-system-summaries="subjectSystemSummaries"
                        :subject-filter-mode="subjectFilterMode"
                        :metadata-draft-summaries="metadataDraftSummaries"
                        :value-draft-summaries="valueDraftSummaries"
                        :open-inspector-panel="openInspectorPanel"
                        :open-draft-inspector="openInspectorPanel"
                        :expand-draft-editor="expandMutationEditorPanel"
                        :busy="workbenchActionBusy"
                        @clear-subject-filter="clearSubjectFilter"
                        @filter-subject="viewSubjectTimeline"
                        @focus-subject="focusSubject"
                        @focus-review-issue="void focusReviewIssue($event)"
                        @insert-slice-before="openSliceComposerAroundSlice($event, 'before')"
                        @insert-slice-after="openSliceComposerAroundSlice($event, 'after')"
                        @remove-subject-filter="removeSubjectFilter"
                        @select-slice="selectSlice"
                        @update-slice-health-filter="updateSliceHealthFilterForTimeline"
                        @update-slice-kind-filter="updateSliceKindFilterForTimeline"
                        @update-slice-search="updateSliceSearchForTimeline"
                        @update-subject-filter-mode="void updateSubjectFilterModeForTimeline($event)"
                    />
                    <WorldEngineWorkbenchPreviewMutationEditor
                        v-if="selectedSlice"
                        :busy="workbenchActionBusy"
                        :collapsed="mutationEditorCollapsed"
                        :discard-draft-slice-id="draftDiscardSliceId"
                        :discard-draft-version="draftDiscardVersion"
                        :height="mutationEditorHeight"
                        :focused-subject-id="focusedSubjectId"
                        :highlighted-mutation-focus="highlightedMutationFocus"
                        :current-review-queue-index="currentReviewQueueIndex"
                        :reset-key="resetVersion"
                        :review-queue-items="reviewQueueItems"
                        :review-queue-mode="reviewQueueMode"
                        :review-triage-summary="reviewTriageSummary"
                        :schema="workbenchSchema"
                        :selected-subject-ids="selectedSubjectIds"
                        :subject-filter-mode="subjectFilterMode"
                        :slice-health-filter="sliceHealthFilter"
                        :slice-kind-filter="sliceKindFilter"
                        :slice-review-summaries="sliceReviewSummaries"
                        :slice-search="sliceSearch"
                        :slice="selectedSlice"
                        :slices="slices"
                        :subjects="subjects"
                        :previous-snapshot-subjects="previousSnapshotSubjects"
                        :snapshot-subjects="snapshotSubjects"
                        @clear-mutation-focus="clearMutationFocus"
                        @focus-subject="focusSubject"
                        @focus-review-issue="void focusReviewIssue($event)"
                        @update-mutation-patches="void saveMutationListPatch($event)"
                        @update-mutation-value="void saveMutationValuePatch($event)"
                        @update-mutation-values="void saveMutationValuePatches($event)"
                        @update-issue-triage="updateIssueTriage"
                        @update-value-drafts="valueDraftSummaries = $event"
                        @update-review-queue-mode="reviewQueueMode = $event"
                        @update:height="mutationEditorHeight = $event"
                        @toggle-collapsed="mutationEditorCollapsed = !mutationEditorCollapsed"
                        @select-slice="selectSlice"
                    />
                    <div v-else class="flex min-h-0 flex-1 items-center justify-center border-t border-[var(--we-border)] bg-[var(--we-bg-panel)] px-6 text-center">
                        <div class="max-w-xl">
                            <div class="text-[15px] font-semibold text-[var(--we-text-main)]">{{ emptySliceState.title }}</div>
                            <div class="mt-2 text-[13px] text-[var(--we-text-muted)]">{{ emptySliceState.description }}</div>
                            <div v-if="reviewQueueItems.length" data-testid="empty-slice-review-issues" class="mt-4 space-y-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] p-2.5 text-left">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-[var(--we-warning)]">
                                        <span class="i-lucide-circle-alert h-3.5 w-3.5 shrink-0"></span>
                                        <span>待处理 issues</span>
                                    </div>
                                    <span class="rounded bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ reviewTriageSummary.open }}/{{ reviewTriageSummary.total }}</span>
                                </div>
                                <button
                                    v-for="item in emptyReviewQueueItems"
                                    :key="`empty-review-issue:${item.key}`"
                                    type="button"
                                    class="grid w-full grid-cols-[28px_minmax(88px,0.65fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--we-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)] disabled:opacity-45"
                                    :disabled="workbenchActionBusy"
                                    :title="`${item.sliceTime || item.sliceId} · ${item.message}`"
                                    @click="void focusReviewIssue(item)"
                                >
                                    <span class="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevel(item.severity) === 'E' ? 'border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] text-[var(--we-danger)]' : 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]'">{{ issueLevel(item.severity) }}</span>
                                    <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ item.code }}</span>
                                    <span class="min-w-0 truncate text-[var(--we-text-secondary)]">
                                        <span class="font-mono text-[var(--we-text-muted)]">{{ item.sliceTime || item.sliceId || "-" }}</span>
                                        · {{ subjectNameMap.get(item.subjectId) ?? item.subjectId }}
                                        <span class="font-mono text-[var(--we-text-muted)]">· {{ item.attr }}</span>
                                    </span>
                                    <span class="shrink-0 rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--we-warning)]">{{ issueStatusLabel(item.status) }}</span>
                                </button>
                                <div v-if="hiddenEmptyReviewItemCount" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 py-1 text-[11px] text-[var(--we-text-muted)]">+{{ hiddenEmptyReviewItemCount }} issues</div>
                            </div>
                            <button v-if="emptySliceState.action === 'create-subject'" type="button" class="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="openSubjectCreatorPanel">
                                <span class="i-lucide-user-plus h-4 w-4"></span>
                                创建 Subject
                            </button>
                            <button v-else-if="emptySliceState.action === 'create-world-subject'" type="button" class="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] font-medium text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !worldSubjectDefaultTime" @click="void createWorldSubject()">
                                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-globe-2'" class="h-4 w-4"></span>
                                创建 world subject
                            </button>
                            <button v-else-if="emptySliceState.action === 'sync-subject-system'" type="button" class="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !subjectSystemSyncTime" @click="void syncPendingSubjectSystemSubjects()">
                                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link-2'" class="h-4 w-4"></span>
                                同步主体系统
                            </button>
                            <div v-else-if="emptySliceState.action === 'new-slice'" class="mt-4 flex flex-wrap items-center justify-center gap-2">
                                <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[13px] text-[var(--we-text-main)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="workbenchActionBusy || !schema" @click="openSliceComposer">
                                    <span class="i-lucide-file-plus-2 h-4 w-4"></span>
                                    新建 Slice
                                </button>
                                <button v-if="selectedSubjectIds.length" type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--we-border)] px-3 text-[13px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-50" :disabled="workbenchActionBusy" @click="clearSubjectFilter">
                                    <span class="i-lucide-filter-x h-4 w-4"></span>
                                    清空 subject 过滤
                                </button>
                            </div>
                        </div>
                    </div>
                </main>

                <Transition name="world-inspector">
                    <WorldEngineWorkbenchPreviewInspector
                        v-if="selectedSlice"
                        v-show="inspectorVisible"
                        :apply-button-label="'保存到世界'"
                        :busy="workbenchActionBusy"
                        :committed-subject-event-keys="committedSubjectEventKeys"
                        :discard-draft-slice-id="draftDiscardSliceId"
                        :discard-draft-version="draftDiscardVersion"
                        :metadata-status-suffix="'真实 API 会话草稿'"
                        :full-snapshot-mode="'remote'"
                        :full-snapshot-subjects="fullSnapshotSubjects"
                        :full-snapshot-issues="fullSnapshotIssues"
                        :full-snapshot-loading="fullSnapshotLoading"
                        :full-snapshot-error="fullSnapshotError"
                        :schema="workbenchSchema"
                        :focused-subject-id="focusedSubjectId"
                        :reset-key="resetVersion"
                        :slice="selectedSlice"
                        :subjects="subjects"
                        :subject-system-summaries="subjectSystemSummaries"
                        :subject-file-proposal-focus-version="subjectFileProposalFocusVersion"
                        :snapshot-subjects="snapshotSubjects"
                        :snapshot-issues="snapshotIssues"
                        :width="inspectorWidth"
                        @close="inspectorVisible = false"
                        @commit-subject-event-proposal="void commitSubjectEventProposal($event)"
                        @focus-subject="focusSubject"
                        @open-workspace-path="void openWorkspacePathFromWorkbench($event)"
                        @request-full-snapshot="void loadFullSnapshot()"
                        @update-metadata-drafts="metadataDraftSummaries = $event"
                        @update:width="inspectorWidth = $event"
                        @apply-patch="void saveMetadataPatch($event)"
                    />
                </Transition>
                <aside v-if="selectedSlice && !inspectorVisible" data-testid="world-inspector-restore-rail" class="flex w-10 shrink-0 flex-col items-center border-l border-[var(--we-border)] bg-[var(--we-bg-panel)] py-2">
                    <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" :title="selectedSliceSubjectFileProposalCount ? '展开检查器并定位主体文件建议' : '展开检查器'" @click="toggleInspectorPanel">
                        <span class="i-lucide-panel-right-open h-4 w-4"></span>
                    </button>
                    <span v-if="selectedSliceSubjectFileProposalCount" data-testid="world-inspector-restore-proposal-count" class="mt-2 rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--we-accent-strong)]" title="当前切片有主体文件建议">{{ selectedSliceSubjectFileProposalCount }}</span>
                    <span class="mt-3 [writing-mode:vertical-rl] text-[11px] tracking-[0.16em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.inspector") }}</span>
                </aside>
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.world-inspector-enter-active,
.world-inspector-leave-active {
    transition: margin-right 0.25s ease, transform 0.25s ease, opacity 0.25s ease;
}

.world-inspector-enter-from,
.world-inspector-leave-to {
    margin-right: -400px;
    transform: translateX(18px);
    opacity: 0;
}
</style>
