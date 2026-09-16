<script setup lang="ts">
import {computed, reactive, ref, shallowRef, watch} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import SegmentedControl from "nbook/app/components/common/form/SegmentedControl.vue";
import type {SegmentedControlOption, SegmentedControlValue} from "nbook/app/components/common/form/SegmentedControl.vue";
import WorldEngineWorkbenchPreviewPatchEditor from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewPatchEditor.vue";
import WorldEngineWorkbenchPreviewValueInput from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewValueInput.vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldIssueDto,
    WorldSlicePatchDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import {
    formatWorkbenchPreviewValue,
    parseWorkbenchPreviewMutationValue,
} from "nbook/app/utils/world-engine-workbench-preview-value";
import {matchesWorkbenchPreviewSliceFilter} from "nbook/app/utils/world-engine-workbench-preview-filter";
import {
    defaultMutationForPreviewSubject,
    defaultValueForPreviewAttr,
    opOptionsForPreviewAttr,
    parseMutationJson,
    resolvePreviewAttrPath,
    type WorldPatchOp,
    type WorldPreviewSchemaAttr,
} from "nbook/app/utils/world-engine-preview";
import {
    worldWorkbenchIssueLevel,
    worldWorkbenchIssueStatusLabel,
} from "nbook/app/utils/world-engine-workbench-real";
import type {
    WorldWorkbenchPreviewIssueStatus,
    WorldWorkbenchPreviewIssueTriagePatch,
    WorldWorkbenchPreviewIssueTriageSummary,
    WorldWorkbenchPreviewMutationFocus,
    WorldWorkbenchPreviewMutationListPatch,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewReviewQueueMode,
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewValueDraftSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type EditorView = "review" | "subject" | "all";
type SubjectNavigationScope = "subject" | "filter";
type MutationEditorRow = {
    index: number;
    mutation: WorldSlicePatchDto;
};
type MutationContextItem = {
    index: number;
    isCurrent: boolean;
    mutation: WorldSlicePatchDto;
    slice: WorldWorkbenchPreviewSlice;
};
type MutationContextTriple = {
    current: MutationContextItem | null;
    next: MutationContextItem | null;
    previous: MutationContextItem | null;
};
type IssueExplanation = {
    action: string;
    detail: string;
    impact: string;
    title: string;
};
type MutationContextExplanation = {
    action: string;
    confirmation: string;
    relation: string;
    relevance: string;
    valueLabel: string;
};
type ParsedValueDraft = {
    index: number;
    value: WorkbenchJsonValue;
};
type ParsedPatchDraft = {
    error: string;
    ok: false;
} | {
    ok: true;
    patches: WorldSlicePatchDto[];
};
type ReviewFocusContext = {
    attr: string;
    code: WorldIssueDto["code"] | "manual-focus";
    explanation: WorldIssueDto["explanation"];
    identity?: string;
    key: string;
    label: WorldIssueDto["label"] | "manual";
    message: string;
    op?: WorldIssueDto["op"];
    patchId?: string;
    path?: string;
    severity: WorldIssueDto["severity"] | "manual";
    status: WorldWorkbenchPreviewIssueStatus | "manual";
    subjectId: string;
    subjectLabel: string;
    title: string;
};
type IssueTriageOption = {
    icon: string;
    label: string;
    status: WorldWorkbenchPreviewIssueStatus;
};

const props = defineProps<{
    busy?: boolean;
    collapsed: boolean;
    /** 尺寸记录还没读到分类：调整控件在此前不可用。 */
    resizeDisabled?: boolean;
    discardDraftSliceId?: string;
    discardDraftVersion?: number;
    focusedSubjectId: string;
    height: number;
    highlightedMutationFocus: WorldWorkbenchPreviewMutationFocus | null;
    currentReviewQueueIndex: number;
    resetKey: number;
    reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[];
    reviewQueueMode: WorldWorkbenchPreviewReviewQueueMode;
    reviewTriageSummary: WorldWorkbenchPreviewIssueTriageSummary;
    selectedSubjectIds: string[];
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceReviewSummaries: WorldWorkbenchPreviewSliceReviewSummary[];
    sliceSearch: string;
    schema: WorldWorkbenchPreviewSchema;
    slice: WorldWorkbenchPreviewSlice;
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldWorkbenchPreviewSubject[];
    previousSnapshotSubjects: SubjectStateDto[];
    snapshotSubjects: SubjectStateDto[];
}>();

const emit = defineEmits<{
    (e: "clearMutationFocus"): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "focusReviewIssue", item: WorldWorkbenchPreviewReviewQueueItem): void;
    (e: "toggleCollapsed"): void;
    (e: "update:height", value: number): void;
    (e: "selectSlice", sliceId: string): void;
    (e: "updateIssueTriage", patch: WorldWorkbenchPreviewIssueTriagePatch): void;
    (e: "updateMutationPatches", patch: WorldWorkbenchPreviewMutationListPatch): void;
    (e: "updateMutationValue", patch: WorldWorkbenchPreviewMutationValuePatch): void;
    (e: "updateMutationValues", patches: WorldWorkbenchPreviewMutationValuePatch[]): void;
    (e: "updateReviewQueueMode", mode: WorldWorkbenchPreviewReviewQueueMode): void;
    (e: "updateValueDrafts", drafts: WorldWorkbenchPreviewValueDraftSummary[]): void;
}>();

const view = ref<EditorView>("subject");
const activeSubjectId = ref("");
const subjectNavigationScope = ref<SubjectNavigationScope>("subject");
const valueDrafts = reactive<Record<string, string>>({});
const valueDraftErrors = reactive<Record<string, string>>({});
const valueDraftIdentities = reactive<Record<string, string>>({});
const patchDrafts = shallowRef<WorldSlicePatchDto[]>([]);
const patchValueDrafts = shallowRef<string[]>([]);
const patchDraftError = ref("");
const patchDraftSliceId = ref("");
const patchDraftSourceIdentity = ref("");
const resizeHandleRef = ref<HTMLElement | null>(null);
const {t} = useI18n();
const issueTriageOptions: IssueTriageOption[] = [
    {status: "open", label: "待处理", icon: "i-lucide-circle-dot"},
    {status: "confirmed", label: "确认", icon: "i-lucide-check"},
    {status: "ignored", label: "忽略", icon: "i-lucide-eye-off"},
];
const editorViewOptions: SegmentedControlOption[] = [
    {value: "review", label: "问题处理", tone: "warning"},
    {value: "subject", label: "Subject 视图", tone: "accent"},
    {value: "all", label: "总变更", tone: "accent"},
];

const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const sliceReviewSummaryMap = computed(() => new Map(props.sliceReviewSummaries.map((summary) => [summary.sliceId, summary])));
const reviewQueueMode = computed({
    get: () => props.reviewQueueMode,
    set: (mode: WorldWorkbenchPreviewReviewQueueMode) => emit("updateReviewQueueMode", mode),
});
const touchedSubjectIds = computed(() => Array.from(new Set(props.slice.mutations.map((mutation) => mutation.subjectId))));
const editorSummary = computed(() => t("worldEngine.workbenchPreview.editorSummary", {
    mutations: props.slice.mutations.length,
    subjects: touchedSubjectIds.value.length,
}));
const filteredTouchedSubjectIds = computed(() => props.selectedSubjectIds.filter((subjectId) => touchedSubjectIds.value.includes(subjectId)));
const activeSubject = computed(() => subjectMap.value.get(activeSubjectId.value) ?? null);
const activeSubjectSummary = computed(() => {
    if (!activeSubjectId.value) {
        return "no subject";
    }
    const subject = activeSubject.value;
    return subject ? `${subject.name || subject.id} · ${subject.type}` : activeSubjectId.value;
});
const allMutationRows = computed<MutationEditorRow[]>(() => props.slice.mutations.map((mutation, index) => ({index, mutation})));
const activeSubjectMutationRows = computed<MutationEditorRow[]>(() => allMutationRows.value.filter((row) => row.mutation.subjectId === activeSubjectId.value));
const patchDraftRows = computed<MutationEditorRow[]>(() => patchDrafts.value.map((mutation, index) => ({index, mutation})));
const activeSubjectPatchDraftRows = computed<MutationEditorRow[]>(() => patchDraftRows.value.filter((row) => row.mutation.subjectId === activeSubjectId.value));
const activeSubjectPatchEditorRows = computed(() => activeSubjectPatchDraftRows.value.map((row) => ({
    canMoveDown: canMovePatchDraft(row.index, "down"),
    canMoveUp: canMovePatchDraft(row.index, "up"),
    dirty: isPatchDraftRowDirty(row.index),
    highlighted: isHighlightedMutation(row.mutation),
    index: row.index,
    mutation: row.mutation,
    opOptions: patchOpOptions(row.mutation),
    rowKey: patchDraftRowKey(row),
    valueDraft: patchValueDraft(row.index),
})));
const activeSubjectPreviousState = computed(() => props.previousSnapshotSubjects.find((state) => state.subjectId === activeSubjectId.value) ?? null);
const activeSubjectState = computed(() => props.snapshotSubjects.find((state) => state.subjectId === activeSubjectId.value) ?? null);
const activeSubjectAttrs = computed(() => attrsForSubjectId(activeSubjectId.value));
const activeSubjectPathOptions = computed<SelectOption[]>(() => activeSubjectAttrs.value.map((attr) => ({
    label: attrToPointer(attr.name),
    value: attrToPointer(attr.name),
    description: attr.type ?? attr.kind,
})));
const patchDraftIdentity = computed(() => patchListDraftIdentity(patchDrafts.value, patchValueDrafts.value));
const currentSlicePatchIdentity = computed(() => patchListDraftIdentity(props.slice.mutations, props.slice.mutations.map((mutation) => formatValue(mutation.value))));
const patchDraftDirty = computed(() => patchDraftIdentity.value !== currentSlicePatchIdentity.value);
const allDirtyValueDrafts = computed<WorldWorkbenchPreviewValueDraftSummary[]>(() => {
    const drafts: WorldWorkbenchPreviewValueDraftSummary[] = [];
    for (const slice of props.slices) {
        for (const [index, mutation] of slice.mutations.entries()) {
            const key = valueDraftKeyForSlice(slice.id, index);
            if (!hasValueDraft(key)) {
                continue;
            }
            if (valueDraftIdentities[key] !== mutationDraftIdentity(mutation)) {
                continue;
            }
            if ((valueDrafts[key] ?? "") === formatValue(mutation.value)) {
                continue;
            }
            drafts.push({
                attr: mutation.path,
                mutationIndex: index,
                sliceId: slice.id,
                sliceTitle: slice.title || slice.id,
                subjectId: mutation.subjectId,
            });
        }
    }
    return drafts;
});
const allDirtyValueDraftCount = computed(() => allDirtyValueDrafts.value.length);
const dirtyMutationRows = computed<MutationEditorRow[]>(() => allMutationRows.value.filter((row) => isValueDraftDirty(row.index, row.mutation)));
const dirtyValueDraftCount = computed(() => dirtyMutationRows.value.length);
const otherSliceDirtyDrafts = computed(() => allDirtyValueDrafts.value.filter((draft) => draft.sliceId !== props.slice.id));
const otherSliceDirtyDraftCount = computed(() => otherSliceDirtyDrafts.value.length);
const nextOtherSliceDraft = computed(() => otherSliceDirtyDrafts.value[0] ?? null);
const valueDraftErrorCount = computed(() => dirtyMutationRows.value.filter((row) => Boolean(valueDraftErrors[valueDraftKey(row.index)])).length);
const valueDraftStatusLabel = computed(() => {
    if (dirtyValueDraftCount.value && otherSliceDirtyDraftCount.value) {
        return `未应用 ${dirtyValueDraftCount.value} · 其他 ${otherSliceDirtyDraftCount.value}`;
    }
    if (dirtyValueDraftCount.value) {
        return `未应用 ${dirtyValueDraftCount.value}`;
    }
    if (otherSliceDirtyDraftCount.value) {
        return `其他 ${otherSliceDirtyDraftCount.value}`;
    }
    return "已同步";
});
const relatedSlices = computed(() => props.slices.filter((slice) => slice.mutations.some((mutation) => mutation.subjectId === activeSubjectId.value) && matchesNavigationScope(slice)));
const currentRelatedIndex = computed(() => relatedSlices.value.findIndex((slice) => slice.id === props.slice.id));
const previousRelatedSlice = computed(() => currentRelatedIndex.value > 0 ? relatedSlices.value[currentRelatedIndex.value - 1] ?? null : null);
const nextRelatedSlice = computed(() => currentRelatedIndex.value >= 0 && currentRelatedIndex.value < relatedSlices.value.length - 1 ? relatedSlices.value[currentRelatedIndex.value + 1] ?? null : null);
const relatedSlicePosition = computed(() => currentRelatedIndex.value >= 0 ? `${currentRelatedIndex.value + 1} / ${relatedSlices.value.length}` : `- / ${relatedSlices.value.length}`);
const subjectNavigationScopeLabel = computed(() => {
    if (subjectNavigationScope.value === "filter" && props.selectedSubjectIds.length) {
        const modeLabel = props.subjectFilterMode === "all" ? "全部 subject" : "任一 subject";
        return `过滤组合：${modeLabel} · kind ${props.sliceKindFilter} · status ${props.sliceHealthFilter}${props.sliceSearch.trim() ? ` · search ${props.sliceSearch.trim()}` : ""}`;
    }
    return "当前 subject 全量轨迹";
});
const currentSliceReviewItems = computed(() => props.reviewQueueItems.filter((item) => item.sliceId === props.slice.id));
const visibleReviewQueueItems = computed(() => reviewQueueMode.value === "open" ? props.reviewQueueItems.filter((item) => item.status === "open") : props.reviewQueueItems);
const currentReviewQueueItem = computed(() => props.currentReviewQueueIndex >= 0 ? props.reviewQueueItems[props.currentReviewQueueIndex] ?? null : null);
const currentIssueOutsideVisibleQueue = computed(() => reviewQueueMode.value === "open" && Boolean(currentReviewQueueItem.value) && currentReviewQueueItem.value?.status !== "open");
const reviewQueueModeOptions = computed<SegmentedControlOption[]>(() => [
    {value: "open", label: t("worldEngine.workbenchPreview.onlyOpen"), tone: "warning"},
    {value: "all", label: t("worldEngine.workbenchPreview.allIssues"), tone: "accent"},
]);
const subjectNavigationScopeOptions = computed<SegmentedControlOption[]>(() => [
    {value: "subject", label: "subject 轨迹", tone: "accent", title: "在当前 subject 的所有相关切片中跳转"},
    {value: "filter", label: "过滤组合", tone: "accent", disabled: !props.selectedSubjectIds.length, title: "在当前 subject 过滤组合中跳转"},
]);
const reviewQueuePosition = computed(() => {
    const currentItem = currentReviewQueueItem.value;
    if (!currentItem) {
        return 0;
    }
    const visibleIndex = visibleReviewQueueItems.value.findIndex((item) => item.key === currentItem.key);
    return visibleIndex >= 0 ? visibleIndex + 1 : 0;
});
const previousReviewQueueItem = computed(() => {
    const visibleIndex = activeVisibleQueueIndex();
    if (visibleIndex > 0) {
        return visibleReviewQueueItems.value[visibleIndex - 1] ?? null;
    }
    if (visibleIndex === 0 || props.currentReviewQueueIndex < 0) {
        return null;
    }
    return [...visibleReviewQueueItems.value].reverse().find((item) => reviewQueueOrder(item) < props.currentReviewQueueIndex) ?? null;
});
const nextReviewQueueItem = computed(() => {
    const visibleIndex = activeVisibleQueueIndex();
    if (visibleIndex >= 0) {
        return visibleReviewQueueItems.value[visibleIndex + 1] ?? null;
    }
    if (props.currentReviewQueueIndex < 0) {
        return visibleReviewQueueItems.value[0] ?? null;
    }
    return visibleReviewQueueItems.value.find((item) => reviewQueueOrder(item) > props.currentReviewQueueIndex) ?? null;
});
const reviewFocusContext = computed<ReviewFocusContext | null>(() => {
    const focus = props.highlightedMutationFocus;
    if (!focus) {
        return null;
    }
    const subject = subjectMap.value.get(focus.subjectId);
    const issue = focus.issueKey
        ? currentSliceReviewItems.value.find((item) => item.key === focus.issueKey)
        : currentSliceReviewItems.value.find((item) => item.subjectId === focus.subjectId && item.attr === focus.attr);
    return {
        attr: focus.attr,
        code: issue?.code ?? "manual-focus",
        explanation: issue?.explanation ?? {
            whatHappened: "当前 patch 行来自审查工作台或外部检查入口定位。",
            whyItMatters: "这不是后端 issue，只是当前工作台的定位状态。",
            suggestedAction: "可继续查看三联上下文，或清除定位回到普通浏览。",
        },
        identity: issue?.identity,
        key: issue?.key ?? `manual:${props.slice.id}:${focus.subjectId}:${focus.attr}`,
        label: issue?.label ?? "manual",
        message: issue?.message ?? "当前 mutation 行来自审查工作台或外部检查入口定位。",
        op: issue?.op,
        patchId: issue?.patchId,
        path: issue?.path,
        severity: issue?.severity ?? "manual",
        status: issue?.status ?? "manual",
        subjectId: focus.subjectId,
        subjectLabel: subject?.name ?? focus.subjectId,
        title: issue?.title ?? `手动定位：正在查看 ${subject?.name ?? focus.subjectId} / ${focus.attr}`,
    };
});
const reviewMutationContext = computed<MutationContextTriple>(() => {
    const context = reviewFocusContext.value;
    if (!context) {
        return {previous: null, current: null, next: null};
    }
    const timeline = mutationTimelineForIssue(context);
    const current = findCurrentMutationContext(timeline, context);
    if (!current) {
        return {previous: null, current: null, next: null};
    }
    const currentIndex = timeline.findIndex((item) => item.slice.id === current.slice.id && item.index === current.index);
    const previousItem = currentIndex > 0 ? timeline[currentIndex - 1] ?? null : null;
    const nextItem = currentIndex >= 0 && currentIndex < timeline.length - 1 ? timeline[currentIndex + 1] ?? null : null;
    return {
        previous: previousItem ? {...previousItem, isCurrent: false} : null,
        current: {...current, isCurrent: true},
        next: nextItem ? {...nextItem, isCurrent: false} : null,
    };
});
const reviewIssueExplanation = computed<IssueExplanation | null>(() => {
    const context = reviewFocusContext.value;
    if (!context) {
        return null;
    }
    return {
        title: context.title,
        detail: context.explanation.whatHappened,
        impact: context.explanation.whyItMatters,
        action: context.explanation.suggestedAction,
    };
});
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.height),
    minSize: 160,
    maxSize: 520,
    edge: "top",
    enabled: computed(() => !props.collapsed && !props.resizeDisabled),
    // 拖拽期间只更新面板自己的预览；结束才提交一次。
    onResizeEnd: (height) => emit("update:height", height),
});
const reviewPanelStyle = computed(() => props.collapsed ? {height: "40px"} : panelStyle.value);

/** 设置当前 subject 视图的 subject，优先跟随外部 subject 过滤。 */
function ensureActiveSubject(): void {
    if (props.focusedSubjectId && touchedSubjectIds.value.includes(props.focusedSubjectId)) {
        activeSubjectId.value = props.focusedSubjectId;
        return;
    }
    if (filteredTouchedSubjectIds.value.includes(activeSubjectId.value)) {
        return;
    }
    if (filteredTouchedSubjectIds.value.length) {
        activeSubjectId.value = filteredTouchedSubjectIds.value[0] ?? "";
        return;
    }
    if (touchedSubjectIds.value.includes(activeSubjectId.value)) {
        return;
    }
    activeSubjectId.value = touchedSubjectIds.value[0] ?? "";
}

/** 手动聚焦某个 subject，并把该选择同步给外层上下文。 */
function setActiveSubject(subjectId: string): void {
    activeSubjectId.value = subjectId;
    emit("focusSubject", subjectId);
}

/** 清除当前 issue target 高亮，保留 subject 视角，便于继续浏览同一切片。 */
function clearReviewFocus(): void {
    emit("clearMutationFocus");
}

/** 从底部问题处理区或 compact list 定位到指定 issue。 */
function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem | null): void {
    if (props.busy || !item) {
        return;
    }
    emit("focusReviewIssue", item);
}

/** 当前 issue 在可见队列里的位置；-1 表示当前没有聚焦 issue 或被 open-only 模式排除。 */
function activeVisibleQueueIndex(): number {
    const currentItem = currentReviewQueueItem.value;
    if (!currentItem) {
        return -1;
    }
    return visibleReviewQueueItems.value.findIndex((item) => item.key === currentItem.key);
}

/** 返回 issue 在全量队列中的顺序，用于 open-only 模式下跳过已处理项。 */
function reviewQueueOrder(item: WorldWorkbenchPreviewReviewQueueItem): number {
    return props.reviewQueueItems.findIndex((queueItem) => queueItem.key === item.key);
}

/** 更新单条 issue 的 mock-only triage 状态。 */
function updateIssueTriage(item: ReviewFocusContext | WorldWorkbenchPreviewReviewQueueItem, status: WorldWorkbenchPreviewIssueStatus): void {
    emit("updateIssueTriage", {
        identity: item.identity,
        key: item.key,
        status,
    });
}

/** 将 World Engine issue severity 映射成 A/E。 */
function issueLevel(severity: WorldIssueDto["severity"] | "manual"): "A" | "E" | "manual" {
    if (severity === "manual") {
        return "manual";
    }
    return worldWorkbenchIssueLevel(severity);
}

/** issue 级别视觉样式。 */
function issueLevelClass(severity: WorldIssueDto["severity"] | "manual"): string {
    const level = issueLevel(severity);
    if (level === "E") {
        return "border-[var(--we-danger)] bg-[var(--we-danger-soft)] text-[var(--we-danger)]";
    }
    if (level === "A") {
        return "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
    }
    return "border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]";
}

/** issue triage 状态短文案。 */
function issueStatusLabel(status: WorldWorkbenchPreviewIssueStatus | "manual"): string {
    if (status === "manual") {
        return "定位";
    }
    return worldWorkbenchIssueStatusLabel(status);
}

/** issue triage 状态视觉样式。 */
function issueStatusClass(status: WorldWorkbenchPreviewIssueStatus | "manual"): string {
    if (status === "confirmed") {
        return "border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]";
    }
    if (status === "ignored" || status === "manual") {
        return "border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]";
    }
    return "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
}

/** 当前 issue 的同 subject + path 路径相关 patch 时间线。 */
function mutationTimelineForIssue(context: ReviewFocusContext): MutationContextItem[] {
    return props.slices.flatMap((slice) => slice.mutations.flatMap((mutation, index) => {
        if (mutation.subjectId !== context.subjectId || !attrPathRelated(mutation.path, context.attr)) {
            return [];
        }
        return [{
            index,
            isCurrent: false,
            mutation,
            slice,
        }];
    }));
}

/** 在当前 slice 内选择 issue 的目标 patch，精确 path 优先。 */
function findCurrentMutationContext(timeline: MutationContextItem[], context: ReviewFocusContext): MutationContextItem | null {
    const currentSliceItems = timeline.filter((item) => item.slice.id === props.slice.id);
    return currentSliceItems.find((item) => attrPathRelated(item.mutation.path, context.attr)) ?? currentSliceItems[0] ?? null;
}

/** 判断两个 attr/path 是否属于同一属性链路。 */
function attrPathRelated(left: string, right: string): boolean {
    const normalizedLeft = pathToAttr(left);
    const normalizedRight = pathToAttr(right);
    if (normalizedLeft === normalizedRight) {
        return true;
    }
    return normalizedLeft.startsWith(`${normalizedRight}.`) || normalizedRight.startsWith(`${normalizedLeft}.`);
}

function pathToAttr(path: string): string {
    if (!path.startsWith("/")) {
        return path;
    }
    return path.slice(1).split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~")).join(".");
}

/** 生成三联卡里的使用者视角说明，而不是暴露底层 before / after。 */
function buildMutationContextExplanation(item: MutationContextItem, context: ReviewFocusContext): MutationContextExplanation {
    return {
        action: mutationActionPhrase(item.mutation),
        confirmation: mutationConfirmationText(item, context),
        relation: mutationRelationText(item.mutation),
        relevance: item.isCurrent
            ? "这是当前 issue 命中的 mutation。"
            : `它和当前 issue 同属 ${subjectLabel(item.mutation.subjectId)} / ${context.attr} 的属性链路，用来判断前后基准或覆盖关系。`,
        valueLabel: mutationValueLabel(item.mutation),
    };
}

/** 按 op 把 patch value 转成自然语言动作。 */
function mutationActionPhrase(mutation: WorldSlicePatchDto): string {
    const target = `${subjectLabel(mutation.subjectId)} / ${mutation.path}`;
    if (mutation.op === "replace") {
        return `使用 replace 设置 ${target} 为 ${readableValue(mutation.value)}`;
    }
    if (mutation.op === "remove") {
        return `使用 remove 移除 ${target}`;
    }
    if (mutation.op === "increment") {
        return `使用 increment ${incrementValuePhrase(mutation.value)} ${target}`;
    }
    return `使用 append 向 ${target} 追加 ${readableValue(mutation.value)}`;
}

/** 解释 op 对前后链路的依赖或覆盖关系。 */
function mutationRelationText(mutation: WorldSlicePatchDto): string {
    if (mutation.op === "replace") {
        return "绝对 op：replace 会重新定义这个路径，并截断更早的同路径改动。";
    }
    if (mutation.op === "remove") {
        return "绝对 op：remove 会移除这个路径；后续相对 op 可能因此失去基准。";
    }
    if (mutation.op === "increment") {
        return "相对 op：increment 需要前面已经有有限数字，它是在旧值上增减。";
    }
    return "相对 op：append 需要前面已经有数组，它是在旧数组后追加；集合语义数组会自动去重。";
}

/** 根据 issue 与 op 给出需要用户确认的检查点。 */
function mutationConfirmationText(item: MutationContextItem, context: ReviewFocusContext): string {
    if (item.isCurrent) {
        return context.explanation.suggestedAction;
    }
    if (item.mutation.op === "replace") {
        return "确认这个重设是否故意覆盖前面的设定；如果后面还有 replace / remove，也要确认当前值是否只是过渡。";
    }
    if (item.mutation.op === "remove") {
        return "确认删除这个值后，后续相对变更不会悬空。";
    }
    if (item.mutation.op === "increment") {
        return "确认它前面已经有数字基准，并且这次增减量符合当前时间线。";
    }
    return "确认它前面已经有数组，并且这条追加记录属于这个时间点。";
}

/** 三联卡里展示的 value 摘要。 */
function mutationValueLabel(mutation: WorldSlicePatchDto): string {
    if (mutation.op === "remove") {
        return "不需要 value";
    }
    if (mutation.op === "increment") {
        return incrementValuePhrase(mutation.value);
    }
    if (mutation.op === "replace") {
        return `设置为 ${readableValue(mutation.value)}`;
    }
    return `追加 ${readableValue(mutation.value)}`;
}

/** increment 的正负值需要用人能直接读懂的动词。 */
function incrementValuePhrase(value: WorkbenchJsonValue | undefined): string {
    if (typeof value === "number") {
        if (value < 0) {
            return `扣减 ${Math.abs(value)}`;
        }
        return `增加 ${value}`;
    }
    return `累加 ${readableValue(value)}`;
}

/** subject id 在解释文案里尽量显示用户能识别的名字。 */
function subjectLabel(subjectId: string): string {
    return subjectMap.value.get(subjectId)?.name ?? subjectId;
}

/** 将 JSON value 转为自然语言片段。 */
function readableValue(value: WorkbenchJsonValue | undefined): string {
    if (value === undefined) {
        return "空值";
    }
    if (typeof value === "string") {
        const subjectId = value.startsWith("subject://") ? value.slice("subject://".length) : "";
        if (subjectId) {
            return `${subjectLabel(subjectId)}（${value}）`;
        }
        return `“${value}”`;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
        return String(value);
    }
    return formatValue(value);
}

/** 跳转到当前 subject 的上一个或下一个相关切片。 */
function navigateSubjectSlice(direction: "previous" | "next"): void {
    if (props.busy) {
        return;
    }
    const target = direction === "previous" ? previousRelatedSlice.value : nextRelatedSlice.value;
    if (!target) {
        return;
    }
    emit("selectSlice", target.id);
}

/** 跳转到下一个不在当前 slice 的未应用 value 草稿。 */
function navigateToOtherDraft(): void {
    if (props.busy || !nextOtherSliceDraft.value) {
        return;
    }
    emit("selectSlice", nextOtherSliceDraft.value.sliceId);
}

/** 判断一个切片是否落在当前 subject 导航范围内。 */
function matchesNavigationScope(slice: WorldWorkbenchPreviewSlice): boolean {
    if (subjectNavigationScope.value === "subject" || !props.selectedSubjectIds.length) {
        return true;
    }
    return matchesWorkbenchPreviewSliceFilter({
        selectedSubjectIds: props.selectedSubjectIds,
        slice,
        sliceHealthFilter: props.sliceHealthFilter,
        sliceKindFilter: props.sliceKindFilter,
        sliceReviewSummary: sliceReviewSummaryMap.value.get(slice.id),
        sliceSearch: props.sliceSearch,
        subjectFilterMode: props.subjectFilterMode,
        valueDraftCount: allDirtyValueDrafts.value.filter((draft) => draft.sliceId === slice.id).length,
    });
}

/** 切换 subject 视图左右导航的切片范围。 */
function setSubjectNavigationScope(scope: SubjectNavigationScope): void {
    subjectNavigationScope.value = scope;
}

/** 从通用 segmented 控件接回底部工作台视图。 */
function updateEditorView(value: SegmentedControlValue): void {
    if (value === "review" || value === "subject" || value === "all") {
        view.value = value;
    }
}

/** 从通用 segmented 控件接回 issue 队列范围。 */
function updateReviewQueueMode(value: SegmentedControlValue): void {
    if (value === "open" || value === "all") {
        reviewQueueMode.value = value;
    }
}

/** 从通用 segmented 控件接回 subject 导航范围。 */
function updateSubjectNavigationScope(value: SegmentedControlValue): void {
    if (value === "subject" || value === "filter") {
        setSubjectNavigationScope(value);
    }
}

/** 读取 subject 对应 schema attr 列表。 */
function attrsForSubjectId(subjectId: string): WorldPreviewSchemaAttr[] {
    const subject = subjectMap.value.get(subjectId);
    const typeName = subject?.type ?? "";
    return props.schema.subjectTypes.find((item) => item.type === typeName)?.attrs ?? [];
}

/** schema attr name 转成 JSON Pointer path。 */
function attrToPointer(attr: string): string {
    return `/${attr.split(".").filter(Boolean).map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

/** 同步当前 slice patches 到本地 patch 编辑草稿。 */
function syncPatchDrafts(force = false): void {
    const sourceIdentity = currentSlicePatchIdentity.value;
    const shouldReset = force || patchDraftSliceId.value !== props.slice.id || patchDraftSourceIdentity.value !== sourceIdentity;
    if (!shouldReset && patchDraftDirty.value) {
        return;
    }
    patchDrafts.value = clonePatchList(props.slice.mutations);
    patchValueDrafts.value = props.slice.mutations.map((mutation) => formatValue(mutation.value));
    patchDraftSliceId.value = props.slice.id;
    patchDraftSourceIdentity.value = sourceIdentity;
    patchDraftError.value = "";
}

/** 保存本地完整 patch 草稿。 */
function savePatchDrafts(): void {
    if (props.busy) {
        return;
    }
    const parsed = parsePatchDrafts();
    if (!parsed.ok) {
        patchDraftError.value = parsed.error;
        return;
    }
    patchDraftError.value = "";
    emit("updateMutationPatches", {
        sliceId: props.slice.id,
        patches: parsed.patches,
    });
}

/** 放弃本地完整 patch 草稿。 */
function resetPatchDrafts(): void {
    if (props.busy) {
        return;
    }
    syncPatchDrafts(true);
}

/** 新增一条绑定当前 subject 的 patch 草稿。 */
function appendPatchDraft(): void {
    if (props.busy || !activeSubjectId.value) {
        return;
    }
    const patch = defaultPatchForSubject(activeSubjectId.value);
    patchDrafts.value = [...patchDrafts.value, patch];
    patchValueDrafts.value = [...patchValueDrafts.value, formatValue(patch.value)];
    patchDraftError.value = "";
}

/** 复制当前 patch 到下一行。 */
function duplicatePatchDraft(index: number): void {
    if (props.busy) {
        return;
    }
    const patch = patchDrafts.value[index];
    if (!patch) {
        return;
    }
    const nextPatch = clonePatch(patch);
    patchDrafts.value = [
        ...patchDrafts.value.slice(0, index + 1),
        nextPatch,
        ...patchDrafts.value.slice(index + 1),
    ];
    patchValueDrafts.value = [
        ...patchValueDrafts.value.slice(0, index + 1),
        patchValueDrafts.value[index] ?? formatValue(patch.value),
        ...patchValueDrafts.value.slice(index + 1),
    ];
    patchDraftError.value = "";
}

/** 删除当前 patch；slice 至少保留一条 patch。 */
function deletePatchDraft(index: number): void {
    if (props.busy) {
        return;
    }
    if (patchDrafts.value.length <= 1) {
        patchDraftError.value = "slice 至少需要保留 1 条 patch。";
        return;
    }
    patchDrafts.value = patchDrafts.value.filter((_, rowIndex) => rowIndex !== index);
    patchValueDrafts.value = patchValueDrafts.value.filter((_, rowIndex) => rowIndex !== index);
    patchDraftError.value = "";
}

/** 在当前 subject 的可见 patch 顺序内上移或下移。 */
function movePatchDraft(index: number, direction: "up" | "down"): void {
    if (props.busy) {
        return;
    }
    const targetIndex = siblingPatchDraftIndex(index, direction);
    if (targetIndex < 0) {
        return;
    }
    const nextPatches = [...patchDrafts.value];
    const nextValues = [...patchValueDrafts.value];
    const currentPatch = nextPatches[index];
    const targetPatch = nextPatches[targetIndex];
    const currentValue = nextValues[index] ?? "";
    const targetValue = nextValues[targetIndex] ?? "";
    if (!currentPatch || !targetPatch) {
        return;
    }
    nextPatches[index] = targetPatch;
    nextPatches[targetIndex] = currentPatch;
    nextValues[index] = targetValue;
    nextValues[targetIndex] = currentValue;
    patchDrafts.value = nextPatches;
    patchValueDrafts.value = nextValues;
    patchDraftError.value = "";
}

/** 判断当前 patch 是否还能在同 subject 可见序列内移动。 */
function canMovePatchDraft(index: number, direction: "up" | "down"): boolean {
    return siblingPatchDraftIndex(index, direction) >= 0;
}

/** 更新 patch path，并按 schema 修正不再可用的 op。 */
function updatePatchDraftPath(index: number, path: string): void {
    const patch = patchDrafts.value[index];
    if (!patch) {
        return;
    }
    const nextPatch = {...patch, path: path.trim()};
    const options = patchOpOptions(nextPatch);
    if (!options.includes(nextPatch.op)) {
        nextPatch.op = options[0] ?? "replace";
    }
    patchDrafts.value = replacePatchDraft(index, nextPatch);
    ensurePatchValueDraft(index, nextPatch, true);
    patchDraftError.value = "";
}

/** 更新 patch op，并同步 remove / 非 remove 的 value 草稿。 */
function updatePatchDraftOp(index: number, op: string): void {
    if (!isPatchOp(op)) {
        return;
    }
    const patch = patchDrafts.value[index];
    if (!patch) {
        return;
    }
    const nextPatch: WorldSlicePatchDto = {...patch, op};
    patchDrafts.value = replacePatchDraft(index, nextPatch);
    ensurePatchValueDraft(index, nextPatch, patch.op === "remove");
    patchDraftError.value = "";
}

/** 更新 patch value 文本草稿。 */
function updatePatchValueDraft(index: number, value: string): void {
    patchValueDrafts.value = patchValueDrafts.value.map((item, rowIndex) => rowIndex === index ? value : item);
    patchDraftError.value = "";
}

/** 更新 patch summary。空字符串会在保存时省略。 */
function updatePatchDraftSummary(index: number, summary: string): void {
    const patch = patchDrafts.value[index];
    if (!patch) {
        return;
    }
    const nextPatch = {...patch};
    const text = summary.trim();
    if (text) {
        nextPatch.summary = text;
    } else {
        delete nextPatch.summary;
    }
    patchDrafts.value = replacePatchDraft(index, nextPatch);
    patchDraftError.value = "";
}

/** 读取 patch value 文本草稿。 */
function patchValueDraft(index: number): string {
    return patchValueDrafts.value[index] ?? "";
}

/** 当前 patch 对应 schema 推导出的 op 选项；保留当前 op 避免旧草稿瞬间丢选项。 */
function patchOpOptions(patch: WorldSlicePatchDto): WorldPatchOp[] {
    const options = opOptionsForPreviewAttr(resolvePreviewAttrPath(attrsForSubjectId(patch.subjectId), patch.path));
    return options.includes(patch.op) ? options : [patch.op, ...options];
}

/** 当前 patch 是否有未保存改动。 */
function isPatchDraftRowDirty(index: number): boolean {
    const draft = patchDrafts.value[index];
    const source = props.slice.mutations[index];
    if (!draft || !source) {
        return Boolean(draft || source);
    }
    return patchListDraftIdentity([draft], [patchValueDraft(index)]) !== patchListDraftIdentity([source], [formatValue(source.value)]);
}

/** 用于 v-for 的本地 patch 草稿稳定 key。 */
function patchDraftRowKey(row: MutationEditorRow): string {
    return `${row.index}:${row.mutation.subjectId}:${row.mutation.path}:${row.mutation.op}:${row.mutation.summary ?? ""}:${patchValueDraft(row.index)}`;
}

/** 按当前本地草稿生成可保存的 patch 列表。 */
function parsePatchDrafts(): ParsedPatchDraft {
    if (!patchDrafts.value.length) {
        return {ok: false, error: "patches 不能为空"};
    }
    const patches: WorldSlicePatchDto[] = [];
    for (const [index, patch] of patchDrafts.value.entries()) {
        const nextPatch: WorldSlicePatchDto = {
            subjectId: patch.subjectId.trim(),
            path: patch.path.trim(),
            op: patch.op,
        };
        const summary = patch.summary?.trim() ?? "";
        if (summary) {
            nextPatch.summary = summary;
        }
        if (patch.op !== "remove") {
            const parsedValue = parseWorkbenchPreviewMutationValue(patchValueDraft(index));
            if (!parsedValue.ok) {
                return {ok: false, error: `第 ${index + 1} 条 patch value 解析失败：${parsedValue.error}`};
            }
            nextPatch.value = parsedValue.value;
        }
        patches.push(nextPatch);
    }
    const validation = parseMutationJson(JSON.stringify(patches));
    if (!validation.ok) {
        return {ok: false, error: validation.message};
    }
    return {
        ok: true,
        patches: validation.value.map((patch) => ({...patch})),
    };
}

/** 创建当前 subject 的默认 patch。 */
function defaultPatchForSubject(subjectId: string): WorldSlicePatchDto {
    const draft = defaultMutationForPreviewSubject(props.schema.subjectTypes, props.subjects, subjectId);
    return {
        subjectId: draft.subjectId,
        path: draft.path,
        op: draft.op,
        ...(draft.value === undefined ? {} : {value: draft.value}),
        ...(draft.summary ? {summary: draft.summary} : {}),
    };
}

/** 根据 op/path 确保 value 文本与 patch 结构一致。 */
function ensurePatchValueDraft(index: number, patch: WorldSlicePatchDto, preferDefault: boolean): void {
    if (patch.op === "remove") {
        const nextPatch = {...patch};
        delete nextPatch.value;
        patchDrafts.value = replacePatchDraft(index, nextPatch);
        updatePatchValueDraft(index, "");
        return;
    }
    const currentValue = patchValueDraft(index);
    if (!preferDefault && currentValue.trim()) {
        return;
    }
    const attr = resolvePreviewAttrPath(attrsForSubjectId(patch.subjectId), patch.path);
    const value = attr ? defaultValueForPreviewAttr(attr, props.subjects) : "";
    const nextPatch = {...patch, value};
    patchDrafts.value = replacePatchDraft(index, nextPatch);
    updatePatchValueDraft(index, formatValue(value));
}

/** 返回同 subject 可见序列内的相邻全局 index。 */
function siblingPatchDraftIndex(index: number, direction: "up" | "down"): number {
    const patch = patchDrafts.value[index];
    if (!patch) {
        return -1;
    }
    const subjectIndexes = patchDrafts.value
        .map((item, itemIndex) => ({item, itemIndex}))
        .filter((entry) => entry.item.subjectId === patch.subjectId)
        .map((entry) => entry.itemIndex);
    const visibleIndex = subjectIndexes.indexOf(index);
    if (visibleIndex < 0) {
        return -1;
    }
    return direction === "up" ? subjectIndexes[visibleIndex - 1] ?? -1 : subjectIndexes[visibleIndex + 1] ?? -1;
}

/** 替换本地 patch 草稿里的单行。 */
function replacePatchDraft(index: number, patch: WorldSlicePatchDto): WorldSlicePatchDto[] {
    return patchDrafts.value.map((item, rowIndex) => rowIndex === index ? patch : item);
}

/** 深拷贝 patch 列表，避免本地草稿污染 props。 */
function clonePatchList(patches: WorldSlicePatchDto[]): WorldSlicePatchDto[] {
    return patches.map(clonePatch);
}

/** 深拷贝单条 patch。 */
function clonePatch(patch: WorldSlicePatchDto): WorldSlicePatchDto {
    return JSON.parse(JSON.stringify(patch)) as WorldSlicePatchDto;
}

/** patch 草稿身份；value 使用输入文本，避免未解析时也能判断 dirty。 */
function patchListDraftIdentity(patches: WorldSlicePatchDto[], values: string[]): string {
    return JSON.stringify(patches.map((patch, index) => ({
        subjectId: patch.subjectId,
        path: patch.path,
        op: patch.op,
        summary: patch.summary ?? "",
        value: patch.op === "remove" ? "" : values[index] ?? "",
    })));
}

/** 校验 op 字符串。 */
function isPatchOp(value: string): value is WorldPatchOp {
    return value === "replace" || value === "increment" || value === "remove" || value === "append";
}

/** 同步当前 slice 的 mutation value 到本地编辑草稿。 */
function syncValueDrafts(): void {
    const currentKeys = new Set<string>();
    for (const [index, mutation] of props.slice.mutations.entries()) {
        const key = valueDraftKey(index);
        const value = formatValue(mutation.value);
        const identity = mutationDraftIdentity(mutation);
        currentKeys.add(key);
        if (!hasValueDraft(key) || valueDraftIdentities[key] !== identity || valueDrafts[key] === value) {
            valueDrafts[key] = value;
            valueDraftIdentities[key] = identity;
            delete valueDraftErrors[key];
        }
    }
    discardStaleValueDraftRows(props.slice.id, currentKeys);
}

/** 重置 mock 数据时清空所有跨 slice value 草稿。 */
function resetAllValueDrafts(): void {
    for (const key of Object.keys(valueDrafts)) {
        delete valueDrafts[key];
    }
    for (const key of Object.keys(valueDraftErrors)) {
        delete valueDraftErrors[key];
    }
    for (const key of Object.keys(valueDraftIdentities)) {
        delete valueDraftIdentities[key];
    }
    syncValueDrafts();
}

/** 清理某个 slice 的内部 value 草稿；删除 slice 时由真实 Dialog 精确触发。 */
function discardValueDraftsForSlice(sliceId: string): void {
    const prefix = `${sliceId}:`;
    for (const key of Object.keys(valueDrafts)) {
        if (key.startsWith(prefix)) {
            delete valueDrafts[key];
        }
    }
    for (const key of Object.keys(valueDraftErrors)) {
        if (key.startsWith(prefix)) {
            delete valueDraftErrors[key];
        }
    }
    for (const key of Object.keys(valueDraftIdentities)) {
        if (key.startsWith(prefix)) {
            delete valueDraftIdentities[key];
        }
    }
    if (props.slice.id === sliceId) {
        syncValueDrafts();
    }
}

/** 用户手动清空所有 value 草稿；保存中不允许清理即将被外部刷新同步的草稿。 */
function requestResetAllValueDrafts(): void {
    if (props.busy) {
        return;
    }
    resetAllValueDrafts();
}

/** 应用某条 mutation value 草稿。 */
function applyValueDraft(index: number): void {
    if (props.busy) {
        return;
    }
    const key = valueDraftKey(index);
    const parsed = parseWorkbenchPreviewMutationValue(valueDrafts[key] ?? "");
    if (!parsed.ok) {
        valueDraftErrors[key] = parsed.error;
        return;
    }
    delete valueDraftErrors[key];
    emit("updateMutationValue", {
        sliceId: props.slice.id,
        mutationIndex: index,
        value: parsed.value,
    });
}

/** 放弃某条 mutation value 草稿，回到当前 slice 值。 */
function resetValueDraft(index: number): void {
    if (props.busy) {
        return;
    }
    const mutation = props.slice.mutations[index];
    if (!mutation) {
        return;
    }
    const key = valueDraftKey(index);
    valueDrafts[key] = formatValue(mutation.value);
    valueDraftIdentities[key] = mutationDraftIdentity(mutation);
    delete valueDraftErrors[key];
}

/** 批量应用当前切片下所有已修改 value 草稿；若任一行解析失败，则全部停留在草稿态。 */
function applyDirtyValueDrafts(): void {
    if (props.busy) {
        return;
    }
    const parsedDrafts = parseDirtyValueDrafts();
    if (!parsedDrafts) {
        return;
    }
    emit("updateMutationValues", parsedDrafts.map((draft) => ({
        sliceId: props.slice.id,
        mutationIndex: draft.index,
        value: draft.value,
    })));
}

/** 批量还原当前切片下所有已修改 value 草稿。 */
function resetDirtyValueDrafts(): void {
    if (props.busy) {
        return;
    }
    for (const row of dirtyMutationRows.value) {
        resetValueDraft(row.index);
    }
}

/** 先完整解析所有 dirty value，避免批量应用时出现一半成功一半失败。 */
function parseDirtyValueDrafts(): ParsedValueDraft[] | null {
    const parsedDrafts: ParsedValueDraft[] = [];
    let hasError = false;
    for (const row of dirtyMutationRows.value) {
        const key = valueDraftKey(row.index);
        const parsed = parseWorkbenchPreviewMutationValue(valueDrafts[key] ?? "");
        if (!parsed.ok) {
            valueDraftErrors[key] = parsed.error;
            hasError = true;
            continue;
        }
        delete valueDraftErrors[key];
        parsedDrafts.push({
            index: row.index,
            value: parsed.value,
        });
    }
    return hasError ? null : parsedDrafts;
}

/** 判断某条 mutation value 草稿是否已修改。 */
function isValueDraftDirty(index: number, mutation: WorldSlicePatchDto): boolean {
    const key = valueDraftKey(index);
    if (!hasValueDraft(key) || valueDraftIdentities[key] !== mutationDraftIdentity(mutation)) {
        return false;
    }
    return (valueDrafts[key] ?? "") !== formatValue(mutation.value);
}

/** 当前 slice 下 mutation value 草稿的稳定 key。 */
function valueDraftKey(index: number): string {
    return valueDraftKeyForSlice(props.slice.id, index);
}

/** 为指定 slice / mutation index 生成稳定草稿 key。 */
function valueDraftKeyForSlice(sliceId: string, index: number): string {
    return `${sliceId}:${index}`;
}

/** 判断某个稳定 key 是否已有草稿，避免切换 slice 时覆盖未应用 value。 */
function hasValueDraft(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(valueDrafts, key);
}

/** 读取指定 mutation 的 value 草稿，保证输入组件拿到稳定字符串。 */
function valueDraft(index: number): string {
    return valueDrafts[valueDraftKey(index)] ?? "";
}

/** 写入指定 mutation 的 value 草稿。 */
function setValueDraft(index: number, value: string): void {
    const mutation = props.slice.mutations[index];
    const key = valueDraftKey(index);
    valueDrafts[key] = value;
    if (mutation) {
        valueDraftIdentities[key] = mutationDraftIdentity(mutation);
    }
}

/** 清理当前 slice 已不存在的 mutation 行草稿，避免缩短 mutations 后留下悬空 index。 */
function discardStaleValueDraftRows(sliceId: string, currentKeys: Set<string>): void {
    const prefix = `${sliceId}:`;
    const keys = new Set([
        ...Object.keys(valueDrafts),
        ...Object.keys(valueDraftErrors),
        ...Object.keys(valueDraftIdentities),
    ]);
    for (const key of keys) {
        if (key.startsWith(prefix) && !currentKeys.has(key)) {
            delete valueDrafts[key];
            delete valueDraftErrors[key];
            delete valueDraftIdentities[key];
        }
    }
}

/** 展示某条 mutation 在本 slice 前的 attr 值。 */
function mutationBeforeValue(mutation: WorldSlicePatchDto): string {
    const subject = mutation.subjectId === activeSubjectId.value ? activeSubjectPreviousState.value : props.previousSnapshotSubjects.find((state) => state.subjectId === mutation.subjectId) ?? null;
    return formatStateValue(readStateAttrValue(subject, mutation.path));
}

/** 展示某条 mutation 在本 slice reduce 后的 attr 值。 */
function mutationAfterValue(mutation: WorldSlicePatchDto): string {
    const subject = mutation.subjectId === activeSubjectId.value ? activeSubjectState.value : props.snapshotSubjects.find((state) => state.subjectId === mutation.subjectId) ?? null;
    return formatStateValue(readStateAttrValue(subject, mutation.path));
}

/** 读取 attr/path 路径，用于 UI 层做切片前后值对照。 */
function readStateAttrValue(subject: SubjectStateDto | null, attr: string): WorkbenchJsonValue | undefined {
    if (!subject) {
        return undefined;
    }
    let cursor: WorkbenchJsonValue | undefined = subject.attrs;
    for (const part of pathToAttr(attr).split(".").filter(Boolean)) {
        if (!isJsonObject(cursor)) {
            return undefined;
        }
        cursor = cursor[part];
    }
    return cursor;
}

/** 将缺失状态与 JSON 状态压成统一展示值。 */
function formatStateValue(value: WorkbenchJsonValue | undefined): string {
    return value === undefined ? "missing" : formatValue(value);
}

/** 判断 JSON 值是否为可继续读取字段的对象。 */
function isJsonObject(value: WorkbenchJsonValue | undefined): value is Record<string, WorkbenchJsonValue> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 将 mutation value 或 state value 压成单行。 */
function formatValue(value: WorkbenchJsonValue | undefined): string {
    return formatWorkbenchPreviewValue(value);
}

/** 返回 mutation 的稳定展示 key。 */
function mutationKey(mutation: WorldSlicePatchDto, index: number): string {
    return `${index}:${mutation.subjectId}:${mutation.path}:${mutation.op}:${formatValue(mutation.value)}`;
}

/** 返回 mutation 草稿绑定身份；value 也参与身份，防止同 index 替换后草稿串行。 */
function mutationDraftIdentity(mutation: WorldSlicePatchDto): string {
    return [mutation.subjectId, mutation.path, mutation.op, formatValue(mutation.value)].join("\u0000");
}

/** 判断当前 mutation 是否处在 issue 定位的 attr 链路上。 */
function isHighlightedMutation(mutation: WorldSlicePatchDto): boolean {
    return props.highlightedMutationFocus?.subjectId === mutation.subjectId && attrPathRelated(props.highlightedMutationFocus.attr, mutation.path);
}

watch(() => [props.slice.id, props.selectedSubjectIds.join("\u0000"), props.focusedSubjectId] as const, ensureActiveSubject, {immediate: true});
watch(() => [props.slice.id, props.slice.mutations.map(mutationDraftIdentity).join("\u0000")] as const, syncValueDrafts, {immediate: true});
watch(() => [props.slice.id, props.slice.mutations.map(mutationDraftIdentity).join("\u0000")] as const, () => syncPatchDrafts(), {immediate: true});
watch(() => reviewFocusContext.value?.key ?? "", (key) => {
    if (key) {
        view.value = "review";
    }
});
watch(allDirtyValueDrafts, (drafts) => {
    emit("updateValueDrafts", drafts);
}, {immediate: true});
watch(() => [props.discardDraftSliceId ?? "", props.discardDraftVersion ?? 0] as const, ([sliceId]) => {
    if (sliceId) {
        discardValueDraftsForSlice(sliceId);
    }
});
watch(() => props.resetKey, resetAllValueDrafts);
watch(() => props.selectedSubjectIds.length, (count) => {
    if (!count && subjectNavigationScope.value === "filter") {
        subjectNavigationScope.value = "subject";
    }
});
</script>

<template>
    <!-- World Engine 审查工作台：问题处理 / Subject 视图 / 总变更 -->
    <section
        data-testid="world-review-panel"
        class="relative flex shrink-0 flex-col overflow-hidden border-t border-[var(--we-border)] bg-[var(--we-bg-panel)] transition-[height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="isResizing ? 'select-none transition-none' : ''"
        :style="reviewPanelStyle"
    >
        <!-- 审查工作台高度拖拽手柄 -->
        <div v-if="!props.collapsed" ref="resizeHandleRef" class="group absolute -top-1 left-0 right-0 z-20 h-2 cursor-row-resize">
            <div class="mt-[3px] h-[2px] w-full bg-[var(--we-accent)] opacity-0 transition-opacity group-hover:opacity-100" :class="isResizing ? 'opacity-100' : ''"></div>
        </div>
        <div class="flex h-10 items-center justify-between gap-3 border-b border-[var(--we-border)] px-3">
            <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <span class="i-lucide-list-checks h-4 w-4 shrink-0 text-[var(--we-text-secondary)]"></span>
                <span class="shrink-0 whitespace-nowrap text-[13px] font-semibold text-[var(--we-text-main)]">{{ t("worldEngine.workbenchPreview.reviewWorkbench") }}</span>
                <span class="min-w-0 max-w-[160px] truncate font-mono text-[11px] text-[var(--we-text-muted)]">{{ props.slice.id }}</span>
                <span class="hidden shrink-0 whitespace-nowrap rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-0.5 text-[11px] text-[var(--we-text-secondary)] xl:inline">{{ editorSummary }}</span>
                <span class="hidden min-w-0 max-w-[160px] truncate rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 py-0.5 text-[11px] text-[var(--we-accent-strong)] xl:inline">{{ activeSubjectSummary }}</span>
                <span class="hidden shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] xl:inline" :class="dirtyValueDraftCount || otherSliceDirtyDraftCount ? 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : 'border-[var(--we-border)] bg-[var(--we-bg-subtle)] text-[var(--we-text-muted)]'">{{ valueDraftStatusLabel }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <button v-if="nextOtherSliceDraft" data-testid="mutation-editor-next-draft-toolbar" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 text-[11px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy" :title="`跳到 ${nextOtherSliceDraft.sliceTitle} 的未应用草稿`" @click="navigateToOtherDraft">
                    <span class="i-lucide-arrow-right-from-line h-3.5 w-3.5"></span>
                    <span class="hidden xl:inline">跳到草稿</span>
                </button>
                <button v-if="allDirtyValueDraftCount" data-testid="mutation-editor-clear-all-drafts-toolbar" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="放弃所有 slice 的未应用 value 草稿" @click="requestResetAllValueDrafts">
                    <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                    <span class="hidden xl:inline">清空草稿</span>
                </button>
                <button v-if="!props.collapsed" data-testid="mutation-editor-apply-all-toolbar" type="button" class="hidden h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-accent-strong)] disabled:opacity-45 lg:inline-flex" :disabled="props.busy || !dirtyValueDraftCount" title="应用当前切片所有未应用 value 草稿" @click="applyDirtyValueDrafts">
                    <span class="i-lucide-check-check h-3.5 w-3.5"></span>
                    应用全部
                </button>
                <button v-if="!props.collapsed" data-testid="mutation-editor-reset-all-toolbar" type="button" class="hidden h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45 lg:inline-flex" :disabled="props.busy || !dirtyValueDraftCount" title="还原当前切片所有未应用 value 草稿" @click="resetDirtyValueDrafts">
                    <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                    还原全部
                </button>
                <SegmentedControl v-if="!props.collapsed" :model-value="view" :options="editorViewOptions" :wrap="false" @update:model-value="updateEditorView" />
                <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" :title="props.collapsed ? '展开审查工作台' : '收起审查工作台'" @click="emit('toggleCollapsed')">
                    <span :class="props.collapsed ? 'i-lucide-panel-bottom-open' : 'i-lucide-panel-bottom-close'" class="h-4 w-4"></span>
                </button>
            </div>
        </div>

        <Transition name="world-review-panel-body">
        <div v-if="!props.collapsed" class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
            <div v-if="dirtyValueDraftCount || otherSliceDirtyDraftCount || valueDraftErrorCount" class="mb-3 shrink-0 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-3 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-pencil-line h-4 w-4 shrink-0 text-[var(--we-warning)]"></span>
                            <span class="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-warning)]">{{ t("worldEngine.workbenchPreview.draftChanges") }}</span>
                        <span class="min-w-0 truncate text-[11px] text-[var(--we-text-secondary)]">
                            当前切片 {{ dirtyValueDraftCount }} 个<span v-if="otherSliceDirtyDraftCount"> · 其他切片 {{ otherSliceDirtyDraftCount }} 个</span><span v-if="nextOtherSliceDraft"> · {{ nextOtherSliceDraft.sliceTitle }} / {{ nextOtherSliceDraft.subjectId }}.{{ nextOtherSliceDraft.attr }}</span><span v-if="valueDraftErrorCount"> · {{ valueDraftErrorCount }} 个解析错误</span>
                        </span>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button v-if="nextOtherSliceDraft" data-testid="mutation-editor-next-draft-slice" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy" :title="`跳到 ${nextOtherSliceDraft.sliceTitle} 的未应用草稿`" @click="navigateToOtherDraft">
                            <span class="i-lucide-arrow-right-from-line h-3.5 w-3.5"></span>
                            跳到草稿
                        </button>
                        <button v-if="allDirtyValueDraftCount" data-testid="mutation-editor-clear-all-drafts" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy" title="放弃所有 slice 的未应用 value 草稿" @click="requestResetAllValueDrafts">
                            <span class="i-lucide-eraser h-3.5 w-3.5"></span>
                            清空草稿
                        </button>
                        <button data-testid="mutation-editor-apply-all-banner" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !dirtyValueDraftCount" @click="applyDirtyValueDrafts">
                            <span class="i-lucide-check-check h-3.5 w-3.5"></span>
                            应用全部
                        </button>
                        <button data-testid="mutation-editor-reset-all-banner" type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !dirtyValueDraftCount" @click="resetDirtyValueDrafts">
                            <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                            还原全部
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="view === 'review'" class="min-h-0 flex-1 space-y-3 overflow-y-auto custom-scrollbar">
            <div v-if="reviewFocusContext && reviewIssueExplanation" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-3 py-2">
                <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2">
                            <span class="i-lucide-crosshair h-4 w-4 shrink-0 text-[var(--we-warning)]"></span>
                            <span class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevelClass(reviewFocusContext.severity)">{{ reviewFocusContext.label }}</span>
                            <span class="min-w-0 truncate font-mono text-[11px] text-[var(--we-code-text)]">{{ reviewFocusContext.code }}</span>
                            <span class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="issueStatusClass(reviewFocusContext.status)">{{ issueStatusLabel(reviewFocusContext.status) }}</span>
                        </div>
                        <div class="mt-1 text-[13px] font-semibold text-[var(--we-text-main)]">{{ reviewIssueExplanation.title }}</div>
                        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-[var(--we-text-secondary)]">
                            <span class="font-semibold text-[var(--we-text-main)]">{{ reviewFocusContext.subjectLabel }}</span>
                            <span class="font-mono text-[var(--we-text-muted)]">{{ reviewFocusContext.subjectId }}</span>
                            <span class="text-[var(--we-text-muted)]">/</span>
                            <span class="font-mono text-[var(--we-code-text)]">{{ reviewFocusContext.attr }}</span>
                            <span class="min-w-0 truncate text-[var(--we-text-secondary)]">{{ reviewFocusContext.message }}</span>
                        </div>
                        <div class="mt-2 grid gap-1.5 text-[11px] leading-5 md:grid-cols-3">
                            <div class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2.5 py-1.5">
                                <div class="font-semibold text-[var(--we-warning)]">发生了什么</div>
                                <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ reviewIssueExplanation.detail }}</div>
                            </div>
                            <div class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2.5 py-1.5">
                                <div class="font-semibold text-[var(--we-warning)]">为什么要看</div>
                                <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ reviewIssueExplanation.impact }}</div>
                            </div>
                            <div class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2.5 py-1.5">
                                <div class="font-semibold text-[var(--we-warning)]">建议处理</div>
                                <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ reviewIssueExplanation.action }}</div>
                            </div>
                        </div>
                        <div v-if="reviewFocusContext.status !== 'manual'" class="mt-2 flex flex-wrap items-center gap-2">
                            <div class="inline-flex rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] p-0.5 text-[11px]">
                                <button
                                    v-for="option in issueTriageOptions"
                                    :key="`editor-issue-triage:${reviewFocusContext.key}:${option.status}`"
                                    type="button"
                                    class="inline-flex h-6 items-center gap-1 rounded border px-2 transition-colors"
                                    :aria-label="`标记为${option.label}`"
                                    :aria-pressed="reviewFocusContext.status === option.status"
                                    :class="reviewFocusContext.status === option.status ? issueStatusClass(option.status) : 'border-transparent text-[var(--we-text-muted)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]'"
                                    @click="updateIssueTriage(reviewFocusContext, option.status)"
                                >
                                    <span :class="option.icon" class="h-3.5 w-3.5"></span>
                                    {{ option.label }}
                                </button>
                            </div>
                            <SegmentedControl :model-value="reviewQueueMode" :options="reviewQueueModeOptions" size="xs" @update:model-value="updateReviewQueueMode" />
                            <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--we-text-muted)]">{{ reviewQueuePosition || "-" }} / {{ visibleReviewQueueItems.length }}</span>
                            <span v-if="currentIssueOutsideVisibleQueue" class="text-[11px] text-[var(--we-accent-strong)]">当前 issue 已处理</span>
                            <span class="text-[11px] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.triageProgress") }}</span>
                            <span class="text-[11px] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.reviewQueueSummary", {done: props.reviewTriageSummary.done, total: props.reviewTriageSummary.total, confirmed: props.reviewTriageSummary.confirmed, ignored: props.reviewTriageSummary.ignored}) }}</span>
                        </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button v-if="reviewFocusContext.status !== 'manual'" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !previousReviewQueueItem" :title="previousReviewQueueItem ? `${previousReviewQueueItem.sliceTime} · ${previousReviewQueueItem.sliceTitle}` : '没有上一个可见 issue'" @click="focusReviewIssue(previousReviewQueueItem)">
                            <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
                            {{ reviewQueueMode === "open" ? t("worldEngine.workbenchPreview.previousOpen") : t("worldEngine.workbenchPreview.previousIssue") }}
                        </button>
                        <button v-if="reviewFocusContext.status !== 'manual'" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy || !nextReviewQueueItem" :title="nextReviewQueueItem ? `${nextReviewQueueItem.sliceTime} · ${nextReviewQueueItem.sliceTitle}` : '没有下一个可见 issue'" @click="focusReviewIssue(nextReviewQueueItem)">
                            {{ reviewQueueMode === "open" ? t("worldEngine.workbenchPreview.nextOpen") : t("worldEngine.workbenchPreview.nextIssue") }}
                            <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
                        </button>
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)]" @click="clearReviewFocus">
                            <span class="i-lucide-x h-3.5 w-3.5"></span>
                            清除定位
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="reviewFocusContext" data-testid="mutation-context" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2">
                        <span class="i-lucide-git-compare-arrows h-4 w-4 text-[var(--we-warning)]"></span>
                        <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">Mutation Context</span>
                    </div>
                    <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-0.5 text-[10px] text-[var(--we-text-muted)]">same subject + attr path</span>
                </div>
                <div class="grid gap-2 xl:grid-cols-3">
                    <div
                        v-for="contextItem in [
                            {slot: 'previous', label: '前一个 mutation', empty: '没有更早的相关 mutation', item: reviewMutationContext.previous},
                            {slot: 'current', label: '当前 mutation', empty: '当前切片没有命中 mutation', item: reviewMutationContext.current},
                            {slot: 'next', label: '后一个 mutation', empty: '没有更晚的相关 mutation', item: reviewMutationContext.next},
                        ]"
                        :key="`mutation-context:${contextItem.slot}`"
                        data-testid="mutation-context-card"
                        class="min-w-0 rounded-md border bg-[var(--we-bg-panel)] p-2"
                        :class="contextItem.item?.isCurrent ? 'border-[var(--we-warning-border)] shadow-[inset_3px_0_0_var(--we-warning)]' : 'border-[var(--we-border)]'"
                    >
                        <div class="mb-2 flex items-center justify-between gap-2">
                            <span class="text-[11px] font-semibold text-[var(--we-text-main)]">{{ contextItem.label }}</span>
                            <span v-if="contextItem.item" class="rounded bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">#{{ contextItem.item.index + 1 }}</span>
                        </div>
                        <div v-if="contextItem.item" class="space-y-2 text-[11px]">
                            <div class="min-w-0">
                                <div class="truncate font-semibold text-[var(--we-text-main)]" :title="contextItem.item.slice.title">{{ contextItem.item.slice.time }} · {{ contextItem.item.slice.title }}</div>
                                <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--we-text-muted)]">{{ contextItem.item.slice.kind }} · {{ contextItem.item.slice.id }}</div>
                            </div>
                            <div class="grid grid-cols-[minmax(0,1fr)_52px] gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                <div class="min-w-0">
                                    <div class="truncate font-mono font-semibold text-[var(--we-code-text)]">{{ contextItem.item.mutation.path }}</div>
                                    <div class="mt-0.5 truncate text-[var(--we-text-secondary)]">{{ subjectMap.get(contextItem.item.mutation.subjectId)?.name ?? contextItem.item.mutation.subjectId }}</div>
                                </div>
                                <span class="justify-self-end rounded bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-accent-strong)]">{{ contextItem.item.mutation.op }}</span>
                            </div>
                            <div class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--we-text-muted)]">value</div>
                                <div class="mt-0.5 truncate text-[11px] text-[var(--we-text-main)]" :title="buildMutationContextExplanation(contextItem.item, reviewFocusContext).valueLabel">{{ buildMutationContextExplanation(contextItem.item, reviewFocusContext).valueLabel }}</div>
                            </div>
                            <div class="grid gap-1.5 text-[11px]">
                                <div class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                    <div class="font-semibold text-[var(--we-text-main)]">动作</div>
                                    <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ buildMutationContextExplanation(contextItem.item, reviewFocusContext).action }}</div>
                                </div>
                                <div class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                    <div class="font-semibold text-[var(--we-text-main)]">依赖/覆盖关系</div>
                                    <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ buildMutationContextExplanation(contextItem.item, reviewFocusContext).relation }}</div>
                                </div>
                                <div class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                    <div class="font-semibold text-[var(--we-text-main)]">为什么相关</div>
                                    <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ buildMutationContextExplanation(contextItem.item, reviewFocusContext).relevance }}</div>
                                </div>
                                <div class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] px-2 py-1.5">
                                    <div class="font-semibold text-[var(--we-text-main)]">需要确认</div>
                                    <div class="mt-0.5 text-[var(--we-text-secondary)]">{{ buildMutationContextExplanation(contextItem.item, reviewFocusContext).confirmation }}</div>
                                </div>
                            </div>
                        </div>
                        <div v-else class="rounded-md border border-dashed border-[var(--we-border)] bg-[var(--we-bg-muted)] px-3 py-6 text-center text-[12px] text-[var(--we-text-muted)]">{{ contextItem.empty }}</div>
                    </div>
                </div>
            </div>

            <div v-else-if="currentSliceReviewItems.length" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 py-2">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-list-checks h-4 w-4 shrink-0 text-[var(--we-warning)]"></span>
                        <span class="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.reviewIssues") }}</span>
                        <span class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--we-warning)]">{{ t("worldEngine.workbenchPreview.openCountShort", {count: currentSliceReviewItems.filter((item) => item.status === "open").length}) }}</span>
                    </div>
                    <span class="text-[11px] text-[var(--we-text-muted)]">点击 issue 进入问题处理</span>
                </div>
                <div class="grid gap-1.5 xl:grid-cols-2">
                    <button
                        v-for="item in currentSliceReviewItems"
                        :key="`editor-slice-issue:${item.key}`"
                        type="button"
                        data-testid="mutation-editor-issue-row"
                        class="grid min-w-0 grid-cols-[28px_minmax(72px,0.65fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1.5 text-left text-[11px] transition-colors hover:border-[var(--we-warning-border)] hover:bg-[var(--we-warning-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)] disabled:opacity-45"
                        :title="item.message"
                        :disabled="props.busy"
                        @click="focusReviewIssue(item)"
                    >
                        <span class="rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevelClass(item.severity)">{{ item.label }}</span>
                        <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ item.code }}</span>
                        <span class="min-w-0 truncate text-[var(--we-text-secondary)]">{{ subjectMap.get(item.subjectId)?.name ?? item.subjectId }} <span class="font-mono text-[var(--we-text-muted)]">· {{ item.attr }}</span></span>
                        <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="issueStatusClass(item.status)">{{ issueStatusLabel(item.status) }}</span>
                    </button>
                </div>
            </div>
            <div v-else class="rounded-md border border-dashed border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 py-8 text-center text-[12px] text-[var(--we-text-muted)]">当前切片没有审查问题</div>
            </div>

            <div v-else-if="view === 'subject'" class="grid min-h-0 flex-1 gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
                <aside class="flex min-h-0 flex-col overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-2.5">
                    <div class="mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.touchedSubjects") }}</div>
                    <div class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
                        <button
                            v-for="subjectId in touchedSubjectIds"
                            :key="`editor-subject:${subjectId}`"
                            type="button"
                            class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                            :aria-pressed="activeSubjectId === subjectId"
                            :class="activeSubjectId === subjectId ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] shadow-[inset_3px_0_0_var(--we-accent)]' : 'border-[var(--we-border)] bg-[var(--we-bg-panel)] hover:bg-[var(--we-bg-hover)]'"
                            @click="setActiveSubject(subjectId)"
                        >
                            <div class="truncate text-[12px] font-semibold text-[var(--we-text-main)]">{{ subjectMap.get(subjectId)?.name ?? subjectId }}</div>
                            <div class="mt-0.5 truncate font-mono text-[10px] text-[var(--we-text-muted)]">{{ subjectId }} · {{ subjectMap.get(subjectId)?.type ?? "unknown" }}</div>
                        </button>
                    </div>
                </aside>

                <main class="flex min-w-0 min-h-0 flex-col overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-3">
                    <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                        <div class="min-w-0">
                            <div class="truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ activeSubject?.name ?? (activeSubjectId || "未选择 subject") }}</div>
                            <div class="mt-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ activeSubjectId }}</div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <SegmentedControl :model-value="subjectNavigationScope" :options="subjectNavigationScopeOptions" size="xs" @update:model-value="updateSubjectNavigationScope" />
                            <span class="hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--we-text-muted)] 2xl:inline" :title="subjectNavigationScopeLabel">{{ relatedSlicePosition }}</span>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="props.busy || !previousRelatedSlice" @click="navigateSubjectSlice('previous')">
                                <span class="i-lucide-arrow-left h-3.5 w-3.5"></span>
                                上一个
                            </button>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="props.busy || !nextRelatedSlice" @click="navigateSubjectSlice('next')">
                                下一个
                                <span class="i-lucide-arrow-right h-3.5 w-3.5"></span>
                            </button>
                        </div>
                    </div>

                    <div class="grid min-h-0 flex-1 gap-3 2xl:grid-cols-2">
                        <section class="flex min-h-0 flex-col">
                            <div class="mb-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">此时状态</div>
                            <div class="flex min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)]">
                                <JsonViewer v-if="activeSubjectState" class="min-h-0 flex-1" :value="activeSubjectState.attrs" :main-menu-bar="false" :max-height="0" />
                                <div v-else class="flex min-h-0 flex-1 items-center justify-center px-3 py-6 text-center text-[12px] text-[var(--we-text-muted)]">当前 snapshot 没有状态</div>
                            </div>
                        </section>

                        <section class="flex min-h-0 flex-col">
                            <WorldEngineWorkbenchPreviewPatchEditor
                                :busy="props.busy"
                                :can-add="!!activeSubjectId"
                                :dirty="patchDraftDirty"
                                :error="patchDraftError"
                                :path-options="activeSubjectPathOptions"
                                :rows="activeSubjectPatchEditorRows"
                                :schema="props.schema"
                                :snapshot-subjects="props.snapshotSubjects"
                                :subjects="props.subjects"
                                :total-patch-count="patchDrafts.length"
                                @append="appendPatchDraft"
                                @delete="deletePatchDraft"
                                @duplicate="duplicatePatchDraft"
                                @move="movePatchDraft"
                                @reset="resetPatchDrafts"
                                @save="savePatchDrafts"
                                @submit="savePatchDrafts"
                                @update-op="updatePatchDraftOp"
                                @update-path="updatePatchDraftPath"
                                @update-summary="updatePatchDraftSummary"
                                @update-value="updatePatchValueDraft"
                            />
                        </section>
                    </div>
                </main>
            </div>

            <div v-else class="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] custom-scrollbar">
                <div class="grid grid-cols-[42px_150px_minmax(0,1fr)_92px_58px] gap-2 border-b border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--we-text-muted)]">
                    <span>#</span>
                    <span>subject</span>
                    <span>attr / value</span>
                    <span>op</span>
                    <span class="text-right">edit</span>
                </div>
                <div
                    v-for="row in allMutationRows"
                    :key="mutationKey(row.mutation, row.index)"
                    :data-mutation-index="row.index"
                    data-testid="mutation-editor-row"
                    class="border-b border-[var(--we-border)] px-2.5 py-1.5 text-[12px] last:border-b-0"
                    :class="isHighlightedMutation(row.mutation) ? 'bg-[var(--we-warning-soft)] shadow-[inset_3px_0_0_var(--we-warning)]' : ''"
                >
                    <div class="grid grid-cols-[42px_150px_minmax(0,1fr)_92px_58px] items-center gap-2">
                        <span class="font-mono text-[var(--we-text-muted)]">#{{ row.index + 1 }}</span>
                        <span class="min-w-0 truncate text-[var(--we-text-main)]">{{ subjectMap.get(row.mutation.subjectId)?.name ?? row.mutation.subjectId }}</span>
                        <label class="grid min-w-0 grid-cols-[minmax(72px,0.5fr)_minmax(0,1fr)] items-center gap-2">
                            <span class="min-w-0">
                                <span class="block truncate font-mono text-[var(--we-code-text)]">{{ row.mutation.path }}</span>
                                <span v-if="isValueDraftDirty(row.index, row.mutation)" class="mt-1 inline-flex rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--we-warning)]">dirty</span>
                                <span v-if="isHighlightedMutation(row.mutation)" class="mt-1 inline-flex rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--we-warning)]">issue target</span>
                            </span>
                            <span class="min-w-0">
                                <WorldEngineWorkbenchPreviewValueInput
                                    :model-value="valueDraft(row.index)"
                                    :mutation="row.mutation"
                                    :schema="props.schema"
                                    :snapshot-subjects="props.snapshotSubjects"
                                    :subjects="props.subjects"
                                    @update:model-value="setValueDraft(row.index, $event)"
                                    @submit="applyValueDraft(row.index)"
                                />
                                <span class="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 font-mono text-[10px] text-[var(--we-text-muted)]">
                                    <span class="truncate" :title="`切片前：${mutationBeforeValue(row.mutation)}`">{{ mutationBeforeValue(row.mutation) }}</span>
                                    <span class="i-lucide-arrow-right h-3 w-3 text-[var(--we-accent)]"></span>
                                    <span class="truncate text-[var(--we-text-secondary)]" :title="`切片后：${mutationAfterValue(row.mutation)}`">{{ mutationAfterValue(row.mutation) }}</span>
                                </span>
                            </span>
                        </label>
                        <span class="justify-self-start rounded bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-accent-strong)]">{{ row.mutation.op }}</span>
                        <span class="flex justify-end gap-1">
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-accent-strong)] disabled:opacity-40" title="应用 value" :disabled="props.busy || !isValueDraftDirty(row.index, row.mutation)" @click="applyValueDraft(row.index)">
                                <span class="i-lucide-check h-3.5 w-3.5"></span>
                            </button>
                            <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-40" title="还原 value" :disabled="props.busy || !isValueDraftDirty(row.index, row.mutation)" @click="resetValueDraft(row.index)">
                                <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                            </button>
                        </span>
                    </div>
                    <div v-if="valueDraftErrors[valueDraftKey(row.index)]" class="mt-1 rounded bg-[var(--we-danger-soft)] px-2 py-1 text-[11px] text-[var(--we-danger)]">{{ valueDraftErrors[valueDraftKey(row.index)] }}</div>
                </div>
            </div>
        </div>
        </Transition>
    </section>
</template>

<style scoped>
.world-review-panel-body-enter-active,
.world-review-panel-body-leave-active {
    transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.world-review-panel-body-enter-from,
.world-review-panel-body-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
