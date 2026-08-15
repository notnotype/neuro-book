<script setup lang="ts">
import {computed, onMounted, ref, shallowRef, watch} from "vue";
import {storeToRefs} from "pinia";
import {useIdeTheme} from "nbook/app/composables/useIdeTheme";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";
import WorldEngineWorkbenchPreviewInspector from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue";
import WorldEngineWorkbenchPreviewMutationEditor from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue";
import WorldEngineWorkbenchPreviewSidebar from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue";
import WorldEngineWorkbenchPreviewSliceList from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue";
import {
    cloneMockWorkbenchSlices,
    cloneMockWorkbenchSnapshots,
    findMockSnapshot,
    mockWorkbenchSchema,
    mockWorkbenchSubjectSystemSummaries,
    mockWorkbenchSubjects,
} from "nbook/app/utils/world-engine-workbench-preview-mock";
import {
    applyWorkbenchPreviewMutationListPatch,
    applyWorkbenchPreviewMutationPatch,
    reduceWorkbenchPreviewSnapshots,
} from "nbook/app/utils/world-engine-workbench-preview-state";
import {buildWorldWorkbenchSubjectFileProposals} from "nbook/app/utils/world-engine-workbench-real";
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
    WorldWorkbenchPreviewSnapshot,
    WorldWorkbenchPreviewSubjectStat,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewValueDraftSummary,
    WorldWorkbenchSubjectFileProposal,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type WorldWorkbenchPreviewLocalDraft = {
    focusedSubjectId: string;
    inspectorVisible: boolean;
    issueTriageStates: WorldWorkbenchPreviewIssueTriageState[];
    inspectorWidth: number;
    mutationEditorHeight: number;
    mutationEditorCollapsed: boolean;
    /** 为空表示旧版草稿，恢复时默认使用 open-only review flow。 */
    reviewQueueMode?: WorldWorkbenchPreviewReviewQueueMode;
    selectedSliceId: string;
    selectedSubjectIds: string[];
    sidebarCollapsed: boolean;
    sidebarWidth: number;
    /** 为空表示旧版草稿，恢复时默认显示全部状态。 */
    sliceHealthFilter?: WorldWorkbenchPreviewSliceHealthFilter;
    /** 为空表示旧版草稿，恢复时默认显示全部 kind。 */
    sliceKindFilter?: string;
    /** 为空表示旧版草稿，恢复时默认无搜索。 */
    sliceSearch?: string;
    slices: WorldWorkbenchPreviewSlice[];
    /** 为空表示旧版草稿，恢复时默认使用 any subject filter。 */
    subjectFilterMode?: WorldWorkbenchPreviewSubjectFilterMode;
    updatedAt: string;
    version: 4;
};

const localDraftStorageKey = "neuro-book:world-engine-workbench-preview:draft:v4";
const defaultSidebarWidth = 320;
const defaultInspectorWidth = 420;
const defaultMutationEditorHeight = 292;
const slices = shallowRef<WorldWorkbenchPreviewSlice[]>(cloneMockWorkbenchSlices());
const snapshots = shallowRef<WorldWorkbenchPreviewSnapshot[]>(cloneMockWorkbenchSnapshots());
const selectedSliceId = ref(slices.value[0]?.id ?? "");
const selectedSubjectIds = ref<string[]>([]);
const subjectFilterMode = ref<WorldWorkbenchPreviewSubjectFilterMode>("any");
const sliceSearch = ref("");
const sliceKindFilter = ref("all");
const sliceHealthFilter = ref<WorldWorkbenchPreviewSliceHealthFilter>("all");
const focusedSubjectId = ref(slices.value[0]?.mutations[0]?.subjectId ?? "");
const highlightedMutationFocus = ref<WorldWorkbenchPreviewMutationFocus | null>(null);
const issueTriageStates = ref<WorldWorkbenchPreviewIssueTriageState[]>([]);
const reviewQueueMode = ref<WorldWorkbenchPreviewReviewQueueMode>("open");
const sidebarCollapsed = ref(false);
const inspectorVisible = ref(true);
const subjectFileProposalFocusVersion = ref(0);
const mutationEditorCollapsed = ref(true);
const sidebarWidth = ref(defaultSidebarWidth);
const inspectorWidth = ref(defaultInspectorWidth);
const mutationEditorHeight = ref(defaultMutationEditorHeight);
const resetVersion = ref(0);
const metadataDraftSummaries = ref<WorldWorkbenchPreviewMetadataDraftSummary[]>([]);
const valueDraftSummaries = ref<WorldWorkbenchPreviewValueDraftSummary[]>([]);
const notice = ref("mock 数据源");
const localDraftReady = ref(false);
const localDraftLoaded = ref(false);
const localDraftSuppressed = ref(false);
const localDraftSavedAt = ref("");
const {t} = useI18n();

const subjectNameMap = new Map(mockWorkbenchSubjects.map((subject) => [subject.id, subject.name || subject.id]));
const selectedSlice = computed(() => slices.value.find((slice) => slice.id === selectedSliceId.value) ?? slices.value[0]);
const selectedSliceIndex = computed(() => selectedSlice.value ? slices.value.findIndex((slice) => slice.id === selectedSlice.value?.id) : -1);
const selectedSnapshotSubjects = computed(() => selectedSlice.value ? findMockSnapshot(selectedSlice.value.id, snapshots.value) : []);
const previousSnapshotSubjects = computed(() => {
    if (selectedSliceIndex.value <= 0) {
        return [];
    }
    const previousSlice = slices.value[selectedSliceIndex.value - 1];
    return previousSlice ? findMockSnapshot(previousSlice.id, snapshots.value) : [];
});
const worldViewFilterParts = computed<string[]>(() => {
    const parts: string[] = [];
    if (selectedSubjectIds.value.length) {
        const subjectLabel = selectedSubjectIds.value.map((subjectId) => subjectNameMap.get(subjectId) ?? subjectId).join(", ");
        const modeLabel = subjectFilterMode.value === "all" ? "全部 subject" : "任一 subject";
        parts.push(`${t("worldEngine.workbenchPreview.subjects")}(${modeLabel}) ${subjectLabel}`);
    }
    if (sliceKindFilter.value !== "all") {
        parts.push(`kind ${sliceKindFilter.value}`);
    }
    if (sliceHealthFilter.value !== "all") {
        parts.push(`${t("worldEngine.workbenchPreview.status")} ${sliceHealthFilterLabel(sliceHealthFilter.value)}`);
    }
    if (sliceSearch.value.trim()) {
        parts.push(`${t("worldEngine.workbenchPreview.search")} ${shortFilterText(sliceSearch.value.trim())}`);
    }
    return parts;
});
const worldViewLabel = computed(() => worldViewFilterParts.value.length ? `当前视角：${worldViewFilterParts.value.join(" · ")}` : "整体世界视角");
const metadataDraftSliceCount = computed(() => metadataDraftSummaries.value.length);
const valueDraftSliceCount = computed(() => new Set(valueDraftSummaries.value.map((draft) => draft.sliceId)).size);
const selectedSliceSubjectFileProposalCount = computed(() => selectedSlice.value ? buildWorldWorkbenchSubjectFileProposals({
    contextSubjectId: focusedSubjectId.value,
    slice: selectedSlice.value,
    subjectNames: subjectNameMap,
    subjectSystemSummaries: mockWorkbenchSubjectSystemSummaries,
}).length : 0);
const inspectorButtonAttentionClass = computed(() => {
    if (metadataDraftSliceCount.value && !inspectorVisible.value) {
        return "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)] hover:bg-[var(--we-bg-hover)]";
    }
    if (selectedSliceSubjectFileProposalCount.value && !inspectorVisible.value) {
        return "border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)] hover:bg-[var(--we-bg-hover)]";
    }
    return "border-[var(--we-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-secondary)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]";
});
const draftSliceIds = computed(() => {
    const draftIds = new Set([
        ...metadataDraftSummaries.value.map((draft) => draft.sliceId),
        ...valueDraftSummaries.value.map((draft) => draft.sliceId),
    ]);
    return slices.value.map((slice) => slice.id).filter((sliceId) => draftIds.has(sliceId));
});
const totalDraftSliceCount = computed(() => draftSliceIds.value.length);
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
const draftSummaryTitle = computed(() => {
    const parts = [];
    if (metadataDraftSliceCount.value) {
        parts.push(`${metadataDraftSliceCount.value} metadata`);
    }
    if (valueDraftSliceCount.value) {
        parts.push(`${valueDraftSliceCount.value} value`);
    }
    return parts.length ? `查看未应用草稿：${parts.join(" / ")}` : "当前没有未应用草稿";
});
const localDraftLabel = computed(() => {
    if (localDraftLoaded.value) {
        return localDraftSavedAt.value ? `浏览器草稿 ${localDraftSavedAt.value}` : "已恢复浏览器草稿";
    }
    return "浏览器临时 mock";
});
const subjectStats = computed<WorldWorkbenchPreviewSubjectStat[]>(() => {
    const statMap = new Map(mockWorkbenchSubjects.map((subject) => [subject.id, {
        confirmedIssueCount: 0,
        doneIssueCount: 0,
        ignoredIssueCount: 0,
        issueCount: 0,
        latestKind: "",
        latestTime: "",
        mutationCount: 0,
        openIssueCount: 0,
        sliceCount: 0,
        subjectId: subject.id,
    }]));
    for (const slice of slices.value) {
        const touchedSubjectIds = new Set(slice.mutations.map((mutation) => mutation.subjectId));
        for (const subjectId of touchedSubjectIds) {
            const stat = statMap.get(subjectId);
            if (!stat) {
                continue;
            }
            stat.sliceCount += 1;
            stat.latestTime = slice.time;
            stat.latestKind = slice.kind;
        }
        for (const mutation of slice.mutations) {
            const stat = statMap.get(mutation.subjectId);
            if (stat) {
                stat.mutationCount += 1;
            }
        }
        for (const [issueIndex, issue] of (slice.issues ?? []).entries()) {
            const stat = statMap.get(issue.subjectId);
            if (stat) {
                stat.issueCount += 1;
                const issueKey = issueTriageKey(slice.id, issueIndex, issue.subjectId, issue.attr, issue.code);
                const issueStatus = issueTriageMap.value.get(issueKey) ?? "open";
                if (issueStatus === "confirmed") {
                    stat.confirmedIssueCount += 1;
                    stat.doneIssueCount += 1;
                } else if (issueStatus === "ignored") {
                    stat.ignoredIssueCount += 1;
                    stat.doneIssueCount += 1;
                } else {
                    stat.openIssueCount += 1;
                }
            }
        }
    }
    return [...statMap.values()];
});
const issueTriageMap = computed(() => new Map(issueTriageStates.value.map((item) => [item.key, item.status])));
const reviewQueueItems = computed<WorldWorkbenchPreviewReviewQueueItem[]>(() => slices.value.flatMap((slice) => (slice.issues ?? []).map((issue, issueIndex) => {
    const key = issueTriageKey(slice.id, issueIndex, issue.subjectId, issue.attr, issue.code);
    return {
        attr: issue.attr,
        code: issue.code,
        explanation: issue.explanation,
        issueIndex,
        key,
        label: issue.label,
        message: issue.message,
        op: issue.op,
        patchId: issue.patchId,
        path: issue.path,
        severity: issue.severity,
        sliceId: slice.id,
        sliceTime: slice.time,
        sliceTitle: slice.title,
        status: issueTriageMap.value.get(key) ?? "open",
        subjectId: issue.subjectId,
        title: issue.title,
    };
})));
const reviewTriageSummary = computed<WorldWorkbenchPreviewIssueTriageSummary>(() => {
    let confirmed = 0;
    let ignored = 0;
    let open = 0;
    for (const item of reviewQueueItems.value) {
        if (item.status === "confirmed") {
            confirmed += 1;
        } else if (item.status === "ignored") {
            ignored += 1;
        } else {
            open += 1;
        }
    }
    return {
        confirmed,
        done: confirmed + ignored,
        ignored,
        open,
        total: reviewQueueItems.value.length,
    };
});
const sliceReviewSummaries = computed<WorldWorkbenchPreviewSliceReviewSummary[]>(() => slices.value.map((slice) => {
    let confirmed = 0;
    let ignored = 0;
    let open = 0;
    for (const [issueIndex, issue] of (slice.issues ?? []).entries()) {
        const key = issueTriageKey(slice.id, issueIndex, issue.subjectId, issue.attr, issue.code);
        const status = issueTriageMap.value.get(key) ?? "open";
        if (status === "confirmed") {
            confirmed += 1;
        } else if (status === "ignored") {
            ignored += 1;
        } else {
            open += 1;
        }
    }
    return {
        confirmed,
        done: confirmed + ignored,
        ignored,
        open,
        sliceId: slice.id,
        total: slice.issues?.length ?? 0,
    };
}));
const currentReviewQueueIndex = computed(() => {
    const sliceId = selectedSlice.value?.id ?? "";
    const focus = highlightedMutationFocus.value;
    if (focus) {
        const focusedIndex = reviewQueueItems.value.findIndex((item) => item.sliceId === sliceId && item.subjectId === focus.subjectId && item.attr === focus.attr);
        if (focusedIndex >= 0) {
            return focusedIndex;
        }
    }
    return reviewQueueItems.value.findIndex((item) => item.sliceId === sliceId);
});
/** 选择新的切片，并让编辑器/Inspector 对齐当前上下文。 */
function selectSlice(sliceId: string): void {
    selectedSliceId.value = sliceId;
    highlightedMutationFocus.value = null;
    alignFocusedSubject(slices.value.find((slice) => slice.id === sliceId));
    openDraftSurfacesForSlice(sliceId);
}

/** 从 draft 时间线定位 slice 时，自动打开真正处理草稿的面板。 */
function openDraftSurfacesForSlice(sliceId: string): void {
    if (sliceHealthFilter.value !== "draft") {
        return;
    }
    if (metadataDraftSummaries.value.some((draft) => draft.sliceId === sliceId)) {
        inspectorVisible.value = true;
    }
    if (valueDraftSummaries.value.some((draft) => draft.sliceId === sliceId)) {
        mutationEditorCollapsed.value = false;
    }
}

/** 将右侧 Inspector / 底部 Editor 的 subject 视角切到指定主体，并展开底部编辑区。 */
function focusSubject(subjectId: string): void {
    focusedSubjectId.value = subjectId;
    highlightedMutationFocus.value = null;
    mutationEditorCollapsed.value = false;
}

/** 只设置主体文件建议语境，不改变中间 timeline 过滤。 */
function focusSubjectContext(subjectId: string): void {
    focusedSubjectId.value = subjectId;
    highlightedMutationFocus.value = null;
    notice.value = `已将 ${subjectNameMap.get(subjectId) ?? subjectId} 设为主体文件建议语境。`;
}

/** 清空主体文件建议语境，不改变中间 timeline 过滤。 */
function clearSubjectContext(): void {
    if (!focusedSubjectId.value) {
        return;
    }
    focusedSubjectId.value = "";
    highlightedMutationFocus.value = null;
    notice.value = "已清空主体文件建议语境。";
}

/** 从 Review Queue 跳转并定位到指定 issue。 */
function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem): void {
    selectedSliceId.value = item.sliceId;
    focusedSubjectId.value = item.subjectId;
    highlightedMutationFocus.value = {
        attr: item.attr,
        subjectId: item.subjectId,
    };
    mutationEditorCollapsed.value = false;
}

/** 打开右侧 Inspector；主体文件入口会额外滚动到 proposal 区域。 */
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

/** 展开底部审查工作台，用于 Draft Queue 直达 value 草稿处理。 */
function expandMutationEditorPanel(): void {
    mutationEditorCollapsed.value = false;
}

/** 顶栏全局草稿入口：清掉阻挡过滤，进入 draft 时间线，并打开首个草稿需要的处理面板。 */
function showAllDraftSlices(): void {
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "draft";
    selectedSubjectIds.value = [];
    const firstDraftSliceId = draftSliceIds.value[0];
    if (firstDraftSliceId) {
        selectSlice(firstDraftSliceId);
        if (metadataDraftSummaries.value.some((draft) => draft.sliceId === firstDraftSliceId)) {
            inspectorVisible.value = true;
        }
        if (valueDraftSummaries.value.some((draft) => draft.sliceId === firstDraftSliceId)) {
            mutationEditorCollapsed.value = false;
        }
    }
}

/** 更新 mock-only issue triage 状态；真实 issue 数据仍保持只读派生。 */
function updateIssueTriage(patch: WorldWorkbenchPreviewIssueTriagePatch): void {
    const updatedAt = new Date().toISOString();
    const nextState = {
        key: patch.key,
        status: patch.status,
        updatedAt,
    };
    issueTriageStates.value = [
        ...issueTriageStates.value.filter((item) => item.key !== patch.key),
        nextState,
    ];
    persistLocalDraft();
    notice.value = `Issue 已标记为 ${issueStatusLabel(patch.status)}`;
}

/** 清除当前 review issue 的 attr 级定位，但保留用户正在看的 subject / slice。 */
function clearMutationFocus(): void {
    highlightedMutationFocus.value = null;
}

/** mock 页面不连接真实文件树，只展示 Inspector 请求打开的 Project Workspace 路径。 */
function openMockWorkspacePath(path: string): void {
    const targetPath = path.trim();
    if (!targetPath) {
        return;
    }
    notice.value = `mock 预览不会打开真实文件：${targetPath}`;
}

/** mock 页面不执行真实 commit，只显示将要追加的目标与内容。 */
function commitMockSubjectEventProposal(proposal: WorldWorkbenchSubjectFileProposal): void {
    notice.value = `mock 预览不会写入 events.jsonl：${proposal.eventsPath} ← ${proposal.eventJsonLine}`;
}

/** 从主画布切到单 subject timeline，同时保持 Inspector / Editor 对齐。 */
function viewSubjectTimeline(subjectId: string): void {
    selectedSubjectIds.value = [subjectId];
    focusSubject(subjectId);
}

/** 将 Inspector 的元信息草稿应用到 mock 切片。 */
function applySlicePatch(patch: WorldWorkbenchPreviewSlicePatch): void {
    const sliceId = selectedSlice.value?.id;
    if (!sliceId) {
        return;
    }
    slices.value = slices.value.map((slice) => slice.id === sliceId ? {...slice, ...patch} : slice);
    persistLocalDraft();
    notice.value = `已应用到预览：${patch.title || sliceId}`;
}

/** 将审查工作台的 value 草稿应用到 mock slice，并重算后续 snapshot。 */
function applyMutationValuePatch(patch: WorldWorkbenchPreviewMutationValuePatch): void {
    const result = applyWorkbenchPreviewMutationPatch({
        patch,
        schema: mockWorkbenchSchema,
        slices: slices.value,
        subjects: mockWorkbenchSubjects,
    });
    if (!result) {
        return;
    }
    slices.value = result.slices;
    snapshots.value = result.snapshots;
    persistLocalDraft();
    notice.value = `已更新 mutation：${result.label}`;
}

/** 将审查工作台的完整 patch 草稿应用到 mock slice，并重算后续 snapshot。 */
function applyMutationListPatch(patch: WorldWorkbenchPreviewMutationListPatch): void {
    const result = applyWorkbenchPreviewMutationListPatch({
        patch,
        schema: mockWorkbenchSchema,
        slices: slices.value,
        subjects: mockWorkbenchSubjects,
    });
    if (!result) {
        return;
    }
    slices.value = result.slices;
    snapshots.value = result.snapshots;
    persistLocalDraft();
    notice.value = `已更新 slice mutations：${result.label}`;
}

/** 批量应用审查工作台的 value 草稿；mock 页面逐条重算即可保持行为直观。 */
function applyMutationValuePatches(patches: WorldWorkbenchPreviewMutationValuePatch[]): void {
    for (const patch of patches) {
        applyMutationValuePatch(patch);
    }
}

/** 重置 mock 数据，方便反复评估 UI 状态。 */
function resetMockData(): void {
    localDraftSuppressed.value = true;
    slices.value = cloneMockWorkbenchSlices();
    snapshots.value = cloneMockWorkbenchSnapshots();
    selectedSliceId.value = slices.value[0]?.id ?? "";
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
    sliceSearch.value = "";
    sliceKindFilter.value = "all";
    sliceHealthFilter.value = "all";
    focusedSubjectId.value = slices.value[0]?.mutations[0]?.subjectId ?? "";
    highlightedMutationFocus.value = null;
    issueTriageStates.value = [];
    reviewQueueMode.value = "open";
    mutationEditorCollapsed.value = true;
    sidebarWidth.value = defaultSidebarWidth;
    inspectorWidth.value = defaultInspectorWidth;
    mutationEditorHeight.value = defaultMutationEditorHeight;
    metadataDraftSummaries.value = [];
    valueDraftSummaries.value = [];
    resetVersion.value += 1;
    localStorage.removeItem(localDraftStorageKey);
    localDraftLoaded.value = false;
    localDraftSavedAt.value = "";
    notice.value = "已重置 mock 世界";
    window.setTimeout(() => {
        localDraftSuppressed.value = false;
    }, 0);
}

/** 清空 subject 过滤，恢复整体世界切片浏览。 */
function clearSubjectFilter(): void {
    selectedSubjectIds.value = [];
    subjectFilterMode.value = "any";
}

/** 移除一个 subject 过滤 chip，用于中间列表快速调整视角。 */
function removeSubjectFilter(subjectId: string): void {
    selectedSubjectIds.value = selectedSubjectIds.value.filter((id) => id !== subjectId);
    if (!selectedSubjectIds.value.length) {
        subjectFilterMode.value = "any";
    }
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
    for (let index = selectedSubjectIds.value.length - 1; index >= 0; index -= 1) {
        const subjectId = selectedSubjectIds.value[index];
        if (subjectId && touched.has(subjectId)) {
            focusedSubjectId.value = subjectId;
            return;
        }
    }
    focusedSubjectId.value = slice.mutations[0]?.subjectId ?? "";
}

/** 从浏览器 localStorage 恢复 preview mock 草稿。 */
function restoreLocalDraft(): void {
    if (!window.localStorage) {
        localDraftReady.value = true;
        return;
    }
    const rawDraft = localStorage.getItem(localDraftStorageKey);
    if (!rawDraft) {
        localDraftReady.value = true;
        return;
    }
    try {
        const draft = JSON.parse(rawDraft) as Partial<WorldWorkbenchPreviewLocalDraft>;
        if (!isLocalDraft(draft)) {
            localStorage.removeItem(localDraftStorageKey);
            notice.value = "浏览器草稿格式已失效，已回到 mock 数据源";
            localDraftReady.value = true;
            return;
        }
        slices.value = draft.slices;
        snapshots.value = reduceSnapshots(draft.slices);
        selectedSliceId.value = draft.slices.some((slice) => slice.id === draft.selectedSliceId) ? draft.selectedSliceId : draft.slices[0]?.id ?? "";
        selectedSubjectIds.value = draft.selectedSubjectIds.filter((subjectId) => mockWorkbenchSubjects.some((subject) => subject.id === subjectId));
        subjectFilterMode.value = selectedSubjectIds.value.length && isSubjectFilterMode(draft.subjectFilterMode) ? draft.subjectFilterMode : "any";
        sliceSearch.value = typeof draft.sliceSearch === "string" ? draft.sliceSearch : "";
        sliceKindFilter.value = typeof draft.sliceKindFilter === "string" && draft.sliceKindFilter ? draft.sliceKindFilter : "all";
        sliceHealthFilter.value = isSliceHealthFilter(draft.sliceHealthFilter) ? draft.sliceHealthFilter : "all";
        focusedSubjectId.value = draft.focusedSubjectId;
        issueTriageStates.value = draft.issueTriageStates.filter((item) => isIssueTriageState(item));
        reviewQueueMode.value = isReviewQueueMode(draft.reviewQueueMode) ? draft.reviewQueueMode : "open";
        sidebarCollapsed.value = draft.sidebarCollapsed;
        inspectorVisible.value = draft.inspectorVisible;
        mutationEditorCollapsed.value = draft.mutationEditorCollapsed;
        sidebarWidth.value = validPanelSize(draft.sidebarWidth, 220, 420, defaultSidebarWidth);
        inspectorWidth.value = validPanelSize(draft.inspectorWidth, 300, 560, defaultInspectorWidth);
        mutationEditorHeight.value = validPanelSize(draft.mutationEditorHeight, 160, 520, defaultMutationEditorHeight);
        localDraftLoaded.value = true;
        localDraftSavedAt.value = formatDraftTime(draft.updatedAt);
        notice.value = "已恢复浏览器草稿";
    } catch {
        localStorage.removeItem(localDraftStorageKey);
        notice.value = "浏览器草稿读取失败，已回到 mock 数据源";
    } finally {
        localDraftReady.value = true;
        alignFocusedSubject(selectedSlice.value);
    }
}

/** 保存当前 preview mock 草稿到浏览器本地，用于刷新后继续评估。 */
function persistLocalDraft(): void {
    if (!window.localStorage || !localDraftReady.value || localDraftSuppressed.value) {
        return;
    }
    const updatedAt = new Date().toISOString();
    const draft: WorldWorkbenchPreviewLocalDraft = {
        focusedSubjectId: focusedSubjectId.value,
        inspectorVisible: inspectorVisible.value,
        issueTriageStates: issueTriageStates.value,
        inspectorWidth: inspectorWidth.value,
        mutationEditorHeight: mutationEditorHeight.value,
        mutationEditorCollapsed: mutationEditorCollapsed.value,
        reviewQueueMode: reviewQueueMode.value,
        selectedSliceId: selectedSlice.value?.id ?? selectedSliceId.value,
        selectedSubjectIds: selectedSubjectIds.value,
        sidebarCollapsed: sidebarCollapsed.value,
        sidebarWidth: sidebarWidth.value,
        sliceHealthFilter: sliceHealthFilter.value,
        sliceKindFilter: sliceKindFilter.value,
        sliceSearch: sliceSearch.value,
        slices: slices.value,
        subjectFilterMode: subjectFilterMode.value,
        updatedAt,
        version: 4,
    };
    localStorage.setItem(localDraftStorageKey, JSON.stringify(draft));
    localDraftLoaded.value = true;
    localDraftSavedAt.value = formatDraftTime(updatedAt);
}

/** 校验浏览器草稿里的面板尺寸，避免异常值撑破工作台布局。 */
function validPanelSize(value: number | undefined, min: number, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

/** 校验浏览器草稿最小结构，避免旧版本 mock 污染当前 UI。 */
function isLocalDraft(draft: Partial<WorldWorkbenchPreviewLocalDraft>): draft is WorldWorkbenchPreviewLocalDraft {
    return draft.version === 4
        && Array.isArray(draft.slices)
        && Array.isArray(draft.issueTriageStates)
        && typeof draft.selectedSliceId === "string"
        && Array.isArray(draft.selectedSubjectIds)
        && typeof draft.focusedSubjectId === "string"
        && typeof draft.sidebarCollapsed === "boolean"
        && typeof draft.sidebarWidth === "number"
        && typeof draft.inspectorVisible === "boolean"
        && typeof draft.inspectorWidth === "number"
        && typeof draft.mutationEditorCollapsed === "boolean"
        && typeof draft.mutationEditorHeight === "number"
        && typeof draft.updatedAt === "string";
}

/** 校验单条 triage 记录，避免 localStorage 中的旧结构污染 UI。 */
function isIssueTriageState(item: WorldWorkbenchPreviewIssueTriageState): item is WorldWorkbenchPreviewIssueTriageState {
    return typeof item.key === "string"
        && isIssueStatus(item.status)
        && typeof item.updatedAt === "string";
}

/** 校验 issue 状态枚举。 */
function isIssueStatus(status: WorldWorkbenchPreviewIssueStatus): status is WorldWorkbenchPreviewIssueStatus {
    return status === "open" || status === "confirmed" || status === "ignored";
}

/** 校验 Review Queue 视图偏好，旧草稿缺省时回到 open-only。 */
function isReviewQueueMode(mode: WorldWorkbenchPreviewReviewQueueMode | undefined): mode is WorldWorkbenchPreviewReviewQueueMode {
    return mode === "open" || mode === "all";
}

/** 校验 Slice List 的 subject 过滤模式，旧草稿缺省时回到 any。 */
function isSubjectFilterMode(mode: WorldWorkbenchPreviewSubjectFilterMode | undefined): mode is WorldWorkbenchPreviewSubjectFilterMode {
    return mode === "any" || mode === "all";
}

/** 校验 Slice List issue 状态过滤，旧草稿缺省时回到 all。 */
function isSliceHealthFilter(filter: WorldWorkbenchPreviewSliceHealthFilter | undefined): filter is WorldWorkbenchPreviewSliceHealthFilter {
    return filter === "all" || filter === "open" || filter === "done" || filter === "clean" || filter === "draft";
}

/** 将 issue 状态过滤压成顶部视角摘要里的短标签。 */
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

/** 避免顶部视角摘要被长搜索词挤爆。 */
function shortFilterText(text: string): string {
    if (text.length <= 18) {
        return text;
    }
    return `${text.slice(0, 18)}...`;
}

/** 为 mock issue 构造跨刷新稳定 key。 */
function issueTriageKey(sliceId: string, issueIndex: number, subjectId: string, attr: string, code: string): string {
    return `${sliceId}:${issueIndex}:${subjectId}:${attr}:${code}`;
}

/** 顶部状态条使用的短文案。 */
function issueStatusLabel(status: WorldWorkbenchPreviewIssueStatus): string {
    if (status === "confirmed") {
        return "已确认";
    }
    if (status === "ignored") {
        return "已忽略";
    }
    return "待处理";
}

/** 根据当前 slices 重新构造 mock snapshots。 */
function reduceSnapshots(nextSlices: WorldWorkbenchPreviewSlice[]): WorldWorkbenchPreviewSnapshot[] {
    return reduceWorkbenchPreviewSnapshots(nextSlices, mockWorkbenchSubjects, mockWorkbenchSchema);
}

/** 将草稿保存时间压成顶部状态条可读文案。 */
function formatDraftTime(isoTime: string): string {
    const date = new Date(isoTime);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

watch(() => selectedSubjectIds.value.join("\u0000"), () => {
    if (!selectedSubjectIds.value.length) {
        return;
    }
    focusedSubjectId.value = selectedSubjectIds.value[selectedSubjectIds.value.length - 1] ?? "";
    highlightedMutationFocus.value = null;
});

watch(() => [
    slices.value,
    selectedSliceId.value,
    selectedSubjectIds.value.join("\u0000"),
    subjectFilterMode.value,
    sliceSearch.value,
    sliceKindFilter.value,
    sliceHealthFilter.value,
    focusedSubjectId.value,
    issueTriageStates.value,
    reviewQueueMode.value,
    sidebarCollapsed.value,
    sidebarWidth.value,
    inspectorVisible.value,
    inspectorWidth.value,
    mutationEditorCollapsed.value,
    mutationEditorHeight.value,
] as const, persistLocalDraft, {deep: true});

const themeHostRef = ref<HTMLElement | null>(null);
const {activeThemeId, customThemes, themeVarsSnapshot} = storeToRefs(useNovelIdeStore());
const {mountThemeHost} = useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot);

onMounted(restoreLocalDraft);
onMounted(() => {
    mountThemeHost(themeHostRef.value);
});
</script>

<template>
    <!-- World Engine Workbench mock preview route -->
    <div ref="themeHostRef" class="world-engine-workbench-preview world-engine-workbench-theme flex h-screen flex-col overflow-hidden bg-[var(--we-bg-canvas)] text-[var(--we-text-main)]">
        <header class="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--we-border)] bg-[var(--we-bg-panel)] px-4 shadow-[0_1px_0_color-mix(in_srgb,var(--shadow-color)_4%,transparent)]">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[12px] font-bold text-[var(--we-accent)]">
                WE
            </span>
            <div class="min-w-0">
                <div class="text-[15px] font-semibold leading-5 text-[var(--we-text-main)]">World Engine Workbench Preview</div>
                <div class="flex min-w-0 items-center gap-2 truncate text-[11px] text-[var(--we-text-muted)]">
                    <span>Project</span>
                    <span class="font-mono text-[var(--we-text-main)]">rain-city-draft / world-engine</span>
                    <span class="hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-secondary)] md:inline">项目日历：复兴纪元</span>
                    <span class="hidden truncate lg:inline">{{ worldViewLabel }}</span>
                </div>
            </div>
            <div class="ml-auto flex items-center gap-2">
                <span class="hidden items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2.5 py-1 text-[11px] text-[var(--we-text-secondary)] md:inline-flex">
                    <span class="h-1.5 w-1.5 rounded-full bg-[var(--we-accent)]"></span>
                    已同步，slice index 新鲜
                </span>
                <span class="hidden items-center gap-1.5 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2.5 py-1 text-[11px] text-[var(--we-accent-strong)] xl:inline-flex">
                    <span class="i-lucide-hard-drive h-3.5 w-3.5"></span>
                    {{ localDraftLabel }}
                </span>
                <span class="hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-muted)] px-2 py-1 text-[11px] text-[var(--we-text-muted)] lg:inline">{{ notice }}</span>
                <button
                    v-if="totalDraftSliceCount"
                    type="button"
                    data-testid="world-workbench-draft-summary"
                    class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2.5 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)]"
                    :title="draftSummaryTitle"
                    @click="showAllDraftSlices"
                >
                    <span class="i-lucide-list-todo h-3.5 w-3.5"></span>
                    {{ t("worldEngine.workbenchPreview.drafts") }}
                    <span class="rounded bg-[var(--we-bg-panel)] px-1.5 font-mono text-[10px]">{{ totalDraftSliceCount }}</span>
                    <span v-if="metadataDraftSliceCount" class="hidden rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] md:inline">meta {{ metadataDraftSliceCount }}</span>
                    <span v-if="valueDraftSliceCount" class="hidden rounded border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[10px] md:inline">value {{ valueDraftSliceCount }}</span>
                </button>
                <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" @click="resetMockData">
                    <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
                    重置 mock
                </button>
                <button
                    type="button"
                    data-testid="world-workbench-inspector-toggle"
                    class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] transition-colors"
                    :class="inspectorButtonAttentionClass"
                    :title="inspectorButtonTitle"
                    @click="toggleInspectorPanel"
                >
                    <span :class="inspectorVisible ? 'i-lucide-panel-right-close' : 'i-lucide-panel-right-open'" class="h-3.5 w-3.5"></span>
                    {{ t("worldEngine.workbenchPreview.inspector") }}
                    <span v-if="metadataDraftSliceCount" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--we-warning)]">meta {{ metadataDraftSliceCount }}</span>
                    <span v-if="selectedSliceSubjectFileProposalCount" data-testid="world-workbench-inspector-proposal-count" class="rounded bg-[var(--we-bg-panel)] px-1.5 font-mono text-[10px]">{{ selectedSliceSubjectFileProposalCount }}</span>
                </button>
            </div>
        </header>

        <div class="flex min-h-0 flex-1">
            <WorldEngineWorkbenchPreviewSidebar
                v-model:selected-subject-ids="selectedSubjectIds"
                :collapsed="sidebarCollapsed"
                :focused-subject-id="focusedSubjectId"
                :reset-key="resetVersion"
                :schema="mockWorkbenchSchema"
                :width="sidebarWidth"
                :subject-stats="subjectStats"
                :subject-system-summaries="mockWorkbenchSubjectSystemSummaries"
                :subjects="mockWorkbenchSubjects"
                :value-draft-summaries="valueDraftSummaries"
                @update:width="sidebarWidth = $event"
                @clear-subject-context="clearSubjectContext"
                @focus-subject-context="focusSubjectContext"
                @open-workspace-path="openMockWorkspacePath"
                @toggle-collapsed="sidebarCollapsed = !sidebarCollapsed"
            />

            <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
                <WorldEngineWorkbenchPreviewSliceList
                    :slices="slices"
                    :subjects="mockWorkbenchSubjects"
                    :focused-subject-id="focusedSubjectId"
                    :reset-key="resetVersion"
                    :selected-slice-id="selectedSlice?.id ?? ''"
                    :selected-subject-ids="selectedSubjectIds"
                    :slice-health-filter="sliceHealthFilter"
                    :slice-kind-filter="sliceKindFilter"
                    :slice-review-summaries="sliceReviewSummaries"
                    :review-queue-items="reviewQueueItems"
                    :slice-search="sliceSearch"
                    :subject-system-summaries="mockWorkbenchSubjectSystemSummaries"
                    :subject-filter-mode="subjectFilterMode"
                    :metadata-draft-summaries="metadataDraftSummaries"
                    :value-draft-summaries="valueDraftSummaries"
                    :open-inspector-panel="openInspectorPanel"
                    :open-draft-inspector="openInspectorPanel"
                    :expand-draft-editor="expandMutationEditorPanel"
                    @clear-subject-filter="clearSubjectFilter"
                    @filter-subject="viewSubjectTimeline"
                    @focus-subject="focusSubject"
                    @focus-review-issue="focusReviewIssue"
                    @remove-subject-filter="removeSubjectFilter"
                    @select-slice="selectSlice"
                    @update-slice-health-filter="sliceHealthFilter = $event"
                    @update-slice-kind-filter="sliceKindFilter = $event"
                    @update-slice-search="sliceSearch = $event"
                    @update-subject-filter-mode="subjectFilterMode = $event"
                />
                <WorldEngineWorkbenchPreviewMutationEditor
                    v-if="selectedSlice"
                    :collapsed="mutationEditorCollapsed"
                    :height="mutationEditorHeight"
                    :focused-subject-id="focusedSubjectId"
                    :highlighted-mutation-focus="highlightedMutationFocus"
                    :current-review-queue-index="currentReviewQueueIndex"
                    :reset-key="resetVersion"
                    :review-queue-items="reviewQueueItems"
                    :review-queue-mode="reviewQueueMode"
                    :review-triage-summary="reviewTriageSummary"
                    :schema="mockWorkbenchSchema"
                    :selected-subject-ids="selectedSubjectIds"
                    :subject-filter-mode="subjectFilterMode"
                    :slice-health-filter="sliceHealthFilter"
                    :slice-kind-filter="sliceKindFilter"
                    :slice-review-summaries="sliceReviewSummaries"
                    :slice-search="sliceSearch"
                    :slice="selectedSlice"
                    :slices="slices"
                    :subjects="mockWorkbenchSubjects"
                    :previous-snapshot-subjects="previousSnapshotSubjects"
                    :snapshot-subjects="selectedSnapshotSubjects"
                    @clear-mutation-focus="clearMutationFocus"
                    @focus-subject="focusSubject"
                    @focus-review-issue="focusReviewIssue"
                    @update-mutation-patches="applyMutationListPatch"
                    @update-mutation-value="applyMutationValuePatch"
                    @update-mutation-values="applyMutationValuePatches"
                    @update-issue-triage="updateIssueTriage"
                    @update-value-drafts="valueDraftSummaries = $event"
                    @update-review-queue-mode="reviewQueueMode = $event"
                    @update:height="mutationEditorHeight = $event"
                    @toggle-collapsed="mutationEditorCollapsed = !mutationEditorCollapsed"
                    @select-slice="selectSlice"
                />
            </main>

            <Transition name="world-inspector">
                <WorldEngineWorkbenchPreviewInspector
                    v-if="selectedSlice"
                    v-show="inspectorVisible"
                    :schema="mockWorkbenchSchema"
                    :focused-subject-id="focusedSubjectId"
                    :reset-key="resetVersion"
                    :slice="selectedSlice"
                    :subject-system-summaries="mockWorkbenchSubjectSystemSummaries"
                    :subject-file-proposal-focus-version="subjectFileProposalFocusVersion"
                    :subjects="mockWorkbenchSubjects"
                    :snapshot-subjects="selectedSnapshotSubjects"
                    :width="inspectorWidth"
                    @close="inspectorVisible = false"
                    @commit-subject-event-proposal="commitMockSubjectEventProposal"
                    @focus-subject="focusSubject"
                    @open-workspace-path="openMockWorkspacePath"
                    @update-metadata-drafts="metadataDraftSummaries = $event"
                    @update:width="inspectorWidth = $event"
                    @apply-patch="applySlicePatch"
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
