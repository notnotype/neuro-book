import type {
    SubjectStateDto,
    WorkbenchJsonValue,
    WorldIssueDto,
    WorldSliceDto,
    WorldSlicePatchDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewIssueStatus,
    WorldWorkbenchPreviewIssueTriageSummary,
    WorldWorkbenchPreviewMutationFocus,
    WorldWorkbenchPreviewMutationValuePatch,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchSubjectFileProposal,
    WorldWorkbenchPreviewSubjectStat,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewSubjectSystemPath,
    WorldWorkbenchPreviewSubjectSystemSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";
import type {ProjectRagOverviewDto, ProjectRagSubjectSummaryDto} from "nbook/shared/dto/project-rag.dto";
import {isWorldWorkbenchSubjectSystemMaintenanceSlice} from "nbook/app/utils/world-engine-workbench-slice-classifier";

export type WorldWorkbenchEditSliceBody = {
    time: string;
    title: string;
    summary: string;
    kind: string;
    patches: WorldSlicePatchDto[];
};

export type WorldWorkbenchTransientIssue = {
    attr: string;
    code: WorldIssueDto["code"];
    explanation: WorldIssueDto["explanation"];
    issueIndex: number;
    key: string;
    label: WorldIssueDto["label"];
    message: string;
    op?: WorldIssueDto["op"];
    patchId?: string;
    path?: string;
    severity: WorldIssueDto["severity"];
    sliceId: string;
    sliceTime: string;
    sliceTitle: string;
    subjectId: string;
    title: string;
};

export type WorldWorkbenchSubjectFileProposalInput = {
    contextSubjectId?: string;
    slice: WorldWorkbenchPreviewSlice;
    subjectNames?: Map<string, string>;
    subjectSystemSummaries: WorldWorkbenchPreviewSubjectSystemSummary[];
};

export type WorldWorkbenchEmptySliceAction = "create-subject" | "create-world-subject" | "new-slice" | "sync-subject-system" | "";

export type WorldWorkbenchEmptySliceState = {
    action: WorldWorkbenchEmptySliceAction;
    description: string;
    title: string;
};

export type WorldWorkbenchWorldViewFilterLabels = {
    search: string;
    status: string;
    subjects: string;
};

export type WorldWorkbenchSliceComposerSubjectSelection = {
    requestedSubjectId: string;
    subjectId: string;
};

export type WorldWorkbenchUnsavedDraftCounts = {
    hasSliceComposerDraft: boolean;
    metadataDraftCount: number;
    valueDraftSliceCount: number;
};

export type WorldWorkbenchDraftSurfaceState = {
    expandMutationEditor: boolean;
    openInspector: boolean;
};

export type WorldWorkbenchIssueLevel = "A" | "E";

export const worldWorkbenchSubjectSystemAttrs = [
    "sourcePath",
    "legacyKind",
    "controlledBy",
    "profile",
    "canonicalSource",
    "subjectFiles",
    "actorImportPath",
    "leaderOnlyPath",
    "directStatePath",
    "ragIndexSources",
    "eventCount",
    "memoryCount",
    "subjectSystemVersion",
];

/** 把主体系统摘要转换成可写入 World Engine init slice 的 schema attrs。 */
export function buildWorldWorkbenchSubjectSystemInitialAttrs(summary: WorldWorkbenchPreviewSubjectSystemSummary): Record<string, WorkbenchJsonValue> {
    return {
        actorImportPath: summary.actorImportPath,
        canonicalSource: summary.canonicalSource,
        controlledBy: summary.controlledBy,
        directStatePath: summary.directStatePath,
        eventCount: summary.eventCount,
        leaderOnlyPath: summary.leaderOnlyPath,
        legacyKind: summary.legacyKind,
        memoryCount: summary.memoryCount,
        profile: summary.profile,
        ragIndexSources: pathEntriesRecord(summary.ragIndexSources),
        sourcePath: summary.sourcePath,
        subjectFiles: pathEntriesRecord(summary.subjectFiles),
        subjectSystemVersion: summary.subjectSystemVersion,
    };
}

const ignoredSubjectSystemIds = new Set(["sample-npc"]);
const stateReviewAttrRoots = new Set([
    "appearance",
    "body",
    "equipment",
    "exp",
    "faction",
    "goal",
    "goals",
    "hp",
    "inventory",
    "location",
    "maxHp",
    "maxMp",
    "maxSp",
    "mp",
    "posture",
    "relationship",
    "relationships",
    "shortTermGoal",
    "shortTermGoals",
    "sp",
    "state",
    "status",
]);

/** 将真实 API slice 规范成 Workbench 组件需要的强数组结构。 */
export function normalizeWorldWorkbenchSlices(slices: WorldSliceDto[]): WorldWorkbenchPreviewSlice[] {
    return slices.map((slice) => ({
        ...slice,
        issues: slice.issues ?? [],
        mutations: slice.patches ?? [],
    }));
}

/** 从切片列表抽取非空时间字符串，供 Composer 避开已知 instant。 */
export function collectWorldWorkbenchSliceTimes(slices: Pick<WorldWorkbenchPreviewSlice, "time">[]): string[] {
    return slices.map((slice) => slice.time.trim()).filter(Boolean);
}

/** 把局部 timeline 或懒加载切片并入已知时间窗口，新的时间排在前面。 */
export function mergeWorldWorkbenchKnownSliceTimes(existingTimes: string[], slices: Pick<WorldWorkbenchPreviewSlice, "time">[]): string[] {
    const existing = new Set(existingTimes);
    const nextTimes = collectWorldWorkbenchSliceTimes(slices).filter((time) => !existing.has(time));
    return [...nextTimes, ...existingTimes];
}

/** 汇总当前会话里所有未应用草稿 slice，并优先按当前 timeline 顺序展示。 */
export function collectWorldWorkbenchDraftSliceIds(input: {
    metadataDraftSliceIds: string[];
    slices: Pick<WorldWorkbenchPreviewSlice, "id">[];
    valueDraftSliceIds: string[];
}): string[] {
    const draftIds = new Set([
        ...input.metadataDraftSliceIds,
        ...input.valueDraftSliceIds,
    ].filter(Boolean));
    const timelineIds = input.slices
        .map((slice) => slice.id)
        .filter((sliceId) => {
            const matched = draftIds.has(sliceId);
            if (matched) {
                draftIds.delete(sliceId);
            }
            return matched;
        });
    return [...timelineIds, ...draftIds];
}

/** 删除当前 slice 后，从会话草稿列表中找出仍需保留并打开的第一个草稿 slice。 */
export function findWorldWorkbenchFirstRemainingDraftSliceId(draftSliceIds: string[], deletedSliceId: string): string {
    return draftSliceIds.find((sliceId) => sliceId !== deletedSliceId) ?? "";
}

/** 汇总关闭 Workbench 时会丢弃的会话态草稿标签。 */
export function buildWorldWorkbenchUnsavedDraftLabels(input: WorldWorkbenchUnsavedDraftCounts): string[] {
    const labels: string[] = [];
    if (input.hasSliceComposerDraft) {
        labels.push("Slice Composer 草稿");
    }
    if (input.metadataDraftCount) {
        labels.push(`${input.metadataDraftCount} 个 metadata 草稿`);
    }
    if (input.valueDraftSliceCount) {
        labels.push(`${input.valueDraftSliceCount} 个 value 草稿`);
    }
    return labels;
}

/** 从 draft 时间线定位 slice 时，决定需要自动打开哪些草稿处理面板。 */
export function buildWorldWorkbenchDraftSurfaceState(input: {
    metadataDraftSliceIds: string[];
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceId: string;
    valueDraftSliceIds: string[];
}): WorldWorkbenchDraftSurfaceState {
    if (input.sliceHealthFilter !== "draft") {
        return {expandMutationEditor: false, openInspector: false};
    }
    return {
        expandMutationEditor: input.valueDraftSliceIds.includes(input.sliceId),
        openInspector: input.metadataDraftSliceIds.includes(input.sliceId),
    };
}

/** 决定主时间线空状态给作者展示的下一步动作，避免入口文案规则散落在 Dialog 模板附近。 */
export function buildWorldWorkbenchEmptySliceState(input: {
    canCreateWorldSubject: boolean;
    hasSlices: boolean;
    hasWorldViewFilters: boolean;
    pendingSubjectSystemCount: number;
    selectedSubjectIds: string[];
    subjectLabel: string;
    worldSubjectIds: Set<string>;
    worldSubjectCount: number;
}): WorldWorkbenchEmptySliceState {
    if (input.selectedSubjectIds.length && input.selectedSubjectIds.every((subjectId) => !input.worldSubjectIds.has(subjectId))) {
        return {
            action: input.pendingSubjectSystemCount ? "sync-subject-system" : "",
            description: input.subjectLabel
                ? `${input.subjectLabel} 暂无 World Engine 时间线。请先同步主体系统注册身份；同步不会复制或改写 simulation/subjects 六文件正文。`
                : "当前 subject 暂无 World Engine 时间线。请先同步主体系统注册身份；同步不会复制或改写 simulation/subjects 六文件正文。",
            title: "当前 subject 尚未接入 World Engine",
        };
    }
    if (input.selectedSubjectIds.length) {
        return {
            action: "new-slice",
            description: input.subjectLabel
                ? `${input.subjectLabel} 在当前视角下暂无 slice。可以新建 Slice 写入第一条变更，或清空 subject 过滤回到整体世界。`
                : "当前 subject 时间线暂无 slice。可以新建 Slice 写入第一条变更，或清空 subject 过滤回到整体世界。",
            title: "当前 subject 时间线暂无 slice",
        };
    }
    if (input.hasSlices || input.hasWorldViewFilters) {
        return {
            action: "new-slice",
            description: "可以选择一条 slice 继续检查，或新建 Slice 推演下一步。",
            title: "当前未选择 slice",
        };
    }
    if (input.pendingSubjectSystemCount) {
        return {
            action: "sync-subject-system",
            description: "可以先同步主体系统，把 simulation/subjects 注册为 World Engine subject；同步只注册身份，不复制或改写六文件正文。",
            title: "当前 Project 还没有 World Engine slice",
        };
    }
    return {
        action: input.canCreateWorldSubject ? "create-world-subject" : input.worldSubjectCount ? "new-slice" : "create-subject",
        description: input.worldSubjectCount
            ? "可以直接新建 Slice 推演当前世界。"
            : input.canCreateWorldSubject
                ? "可以先创建 world subject，承载全局世界事件。"
                : "请先创建 subject，再写入第一条 slice。",
        title: "当前 Project 还没有 slice",
    };
}

/** 选择 Slice Composer 默认 subject，同时保留未注册 subject 作为提示上下文。 */
export function buildWorldWorkbenchSliceComposerSubjectSelection(input: {
    focusedSubjectId: string;
    selectedSubjectIds: string[];
    worldSubjectIds: string[];
}): WorldWorkbenchSliceComposerSubjectSelection {
    const worldSubjectIdSet = new Set(input.worldSubjectIds);
    const selectedRegisteredSubjectId = input.selectedSubjectIds.filter((subjectId) => worldSubjectIdSet.has(subjectId)).at(-1);
    const requestedSubjectId = input.focusedSubjectId && worldSubjectIdSet.has(input.focusedSubjectId)
        ? input.focusedSubjectId
        : selectedRegisteredSubjectId ?? input.focusedSubjectId ?? input.selectedSubjectIds.at(-1) ?? "";
    const subjectId = requestedSubjectId && worldSubjectIdSet.has(requestedSubjectId)
        ? requestedSubjectId
        : input.worldSubjectIds[0] ?? "world";
    return {requestedSubjectId, subjectId};
}

/** 构造 Workbench 顶部“当前视角”标签片段，集中处理 subject / kind / status / search 的展示顺序。 */
export function buildWorldWorkbenchWorldViewFilterParts(input: {
    focusedSubjectHasSystemSummary: boolean;
    focusedSubjectId: string;
    labels: WorldWorkbenchWorldViewFilterLabels;
    sliceHealthFilterLabel: string;
    selectedSubjectIds: string[];
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceSearch: string;
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
    subjectNames: Map<string, string>;
}): string[] {
    const parts: string[] = [];
    if (input.focusedSubjectId && !input.selectedSubjectIds.includes(input.focusedSubjectId) && input.focusedSubjectHasSystemSummary) {
        parts.push(`主体语境 ${input.subjectNames.get(input.focusedSubjectId) ?? input.focusedSubjectId}`);
    }
    if (input.selectedSubjectIds.length) {
        const label = input.selectedSubjectIds.map((subjectId) => input.subjectNames.get(subjectId) ?? subjectId).join(", ");
        const modeLabel = input.subjectFilterMode === "all" ? "全部 subject" : "任一 subject";
        parts.push(`${input.labels.subjects}(${modeLabel}) ${label}`);
    }
    if (input.sliceKindFilter !== "all") {
        parts.push(`kind ${input.sliceKindFilter}`);
    }
    if (input.sliceHealthFilter !== "all") {
        parts.push(`${input.labels.status} ${input.sliceHealthFilterLabel}`);
    }
    const search = input.sliceSearch.trim();
    if (search) {
        parts.push(`${input.labels.search} ${shortWorldWorkbenchFilterText(search)}`);
    }
    return parts;
}

/** 汇总 review issue 的处理状态，供顶部队列和空状态提示共用。 */
export function buildWorldWorkbenchIssueTriageSummary(reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[]): WorldWorkbenchPreviewIssueTriageSummary {
    return summarizeWorldWorkbenchReviewItems(reviewQueueItems);
}

/** 将后端 issue severity 映射成作者可扫读的 A/E 等级。 */
export function worldWorkbenchIssueLevel(severity: WorldIssueDto["severity"]): WorldWorkbenchIssueLevel {
    return severity === "advisory" ? "A" : "E";
}

/** 将 issue triage 状态映射成用户可见短文案。 */
export function worldWorkbenchIssueStatusLabel(status: WorldWorkbenchPreviewIssueStatus): string {
    if (status === "confirmed") {
        return "已确认";
    }
    if (status === "ignored") {
        return "已忽略";
    }
    return "待处理";
}

/** 计算 review 队列当前高亮项，优先沿用 issue key，其次回落到当前 slice 的 subject/attr。 */
export function buildWorldWorkbenchCurrentReviewQueueIndex(input: {
    focus: WorldWorkbenchPreviewMutationFocus | null;
    reviewQueueItems: Pick<WorldWorkbenchPreviewReviewQueueItem, "attr" | "key" | "sliceId" | "subjectId">[];
    selectedSliceId: string;
}): number {
    const focus = input.focus;
    if (focus) {
        if (focus.issueKey) {
            const issueIndex = input.reviewQueueItems.findIndex((item) => item.key === focus.issueKey);
            if (issueIndex >= 0) {
                return issueIndex;
            }
        }
        const focusedIndex = input.reviewQueueItems.findIndex((item) => item.sliceId === input.selectedSliceId && item.subjectId === focus.subjectId && item.attr === focus.attr);
        if (focusedIndex >= 0) {
            return focusedIndex;
        }
    }
    return input.reviewQueueItems.findIndex((item) => item.sliceId === input.selectedSliceId);
}

/** 判断 issue key 指向的 review item 是否已消失，需要清理旧高亮。 */
export function shouldClearWorldWorkbenchReviewIssueFocus(input: {
    focus: WorldWorkbenchPreviewMutationFocus | null;
    reviewQueueItems: Pick<WorldWorkbenchPreviewReviewQueueItem, "key">[];
}): boolean {
    const issueKey = input.focus?.issueKey ?? "";
    if (!issueKey) {
        return false;
    }
    return !input.reviewQueueItems.some((item) => item.key === issueKey);
}

/** 判断保存后的 slice 是否仍命中当前 subject 过滤，避免保存后时间线突然隐藏目标切片。 */
import {checkSubjectFilter} from "nbook/app/utils/world-engine-workbench-preview-filter";

export function isWorldWorkbenchSliceVisibleInSubjectFilter(input: {
    mutations: Pick<WorldSlicePatchDto, "subjectId">[];
    selectedSubjectIds: string[];
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
}): boolean {
    const mutationSubjectIds = input.mutations.map((m) => m.subjectId);
    return checkSubjectFilter(mutationSubjectIds, input.selectedSubjectIds, input.subjectFilterMode);
}

/** 按 slice 汇总 review issue 状态，供 timeline 和 mutation editor 标记切片健康度。 */
export function buildWorldWorkbenchSliceReviewSummaries(input: {
    reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[];
    slices: Pick<WorldWorkbenchPreviewSlice, "id">[];
}): WorldWorkbenchPreviewSliceReviewSummary[] {
    const itemsBySliceId = new Map<string, WorldWorkbenchPreviewReviewQueueItem[]>();
    for (const item of input.reviewQueueItems) {
        const items = itemsBySliceId.get(item.sliceId) ?? [];
        items.push(item);
        itemsBySliceId.set(item.sliceId, items);
    }
    return input.slices.map((slice) => ({
        ...summarizeWorldWorkbenchReviewItems(itemsBySliceId.get(slice.id) ?? []),
        sliceId: slice.id,
    }));
}

/** 统计左栏 subject 的世界事件、mutation 和 review issue 概览，项目级维护 slice 不计入作者浏览时间线。 */
export function buildWorldWorkbenchSubjectStats(input: {
    reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[];
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldSubjectDto[];
}): WorldWorkbenchPreviewSubjectStat[] {
    const statMap = new Map(input.subjects.map((subject) => [subject.id, {
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
    for (const slice of input.slices) {
        if (isWorldWorkbenchSubjectSystemMaintenanceSlice(slice)) {
            continue;
        }
        const touchedSubjectIds = new Set(slice.mutations.map((mutation) => mutation.subjectId));
        for (const subjectId of touchedSubjectIds) {
            const stat = statMap.get(subjectId);
            if (stat) {
                stat.sliceCount += 1;
                stat.latestTime = slice.time;
                stat.latestKind = slice.kind;
            }
        }
        for (const mutation of slice.mutations) {
            const stat = statMap.get(mutation.subjectId);
            if (stat) {
                stat.mutationCount += 1;
            }
        }
    }
    for (const item of input.reviewQueueItems) {
        const stat = statMap.get(item.subjectId);
        if (!stat) {
            continue;
        }
        stat.issueCount += 1;
        if (item.status === "confirmed") {
            stat.confirmedIssueCount += 1;
            stat.doneIssueCount += 1;
        } else if (item.status === "ignored") {
            stat.ignoredIssueCount += 1;
            stat.doneIssueCount += 1;
        } else {
            stat.openIssueCount += 1;
        }
    }
    return [...statMap.values()];
}

function summarizeWorldWorkbenchReviewItems(reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[]): WorldWorkbenchPreviewIssueTriageSummary {
    let confirmed = 0;
    let ignored = 0;
    let open = 0;
    for (const item of reviewQueueItems) {
        if (item.status === "confirmed") {
            confirmed += 1;
        } else if (item.status === "ignored") {
            ignored += 1;
        } else {
            open += 1;
        }
    }
    return {confirmed, done: confirmed + ignored, ignored, open, total: reviewQueueItems.length};
}

function shortWorldWorkbenchFilterText(text: string): string {
    return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

/** 把懒加载的 slice 合并进当前时间线，尽量保留可见时间顺序。 */
export function mergeWorldWorkbenchTimelineSlice(slices: WorldWorkbenchPreviewSlice[], loadedSlice: WorldWorkbenchPreviewSlice): WorldWorkbenchPreviewSlice[] {
    const withoutLoaded = slices.filter((slice) => slice.id !== loadedSlice.id);
    if (!loadedSlice.previousTime) {
        return [loadedSlice, ...withoutLoaded];
    }
    const previousIndex = withoutLoaded.findIndex((slice) => slice.time === loadedSlice.previousTime);
    if (previousIndex < 0) {
        return [...withoutLoaded, loadedSlice];
    }
    return [
        ...withoutLoaded.slice(0, previousIndex + 1),
        loadedSlice,
        ...withoutLoaded.slice(previousIndex + 1),
    ];
}

/** 从时间线末尾向前找出最新触及任一目标 subject 的 slice。 */
export function findWorldWorkbenchLatestSliceTouchingSubjects(slices: WorldWorkbenchPreviewSlice[], subjectIds: string[]): WorldWorkbenchPreviewSlice | null {
    const subjectIdSet = new Set(subjectIds.filter(Boolean));
    if (!subjectIdSet.size) {
        return null;
    }
    return [...slices].reverse().find((slice) => slice.mutations.some((mutation) => subjectIdSet.has(mutation.subjectId))) ?? null;
}

/** 构造 editSlice body：metadata 和 value patch 都必须保留完整 mutations。 */
export function buildWorldWorkbenchEditSliceBody(
    slice: WorldWorkbenchPreviewSlice,
    metadata: Partial<Pick<WorldWorkbenchPreviewSlice, "time" | "title" | "summary" | "kind">> = {},
    valuePatches: WorldWorkbenchPreviewMutationValuePatch[] = [],
): WorldWorkbenchEditSliceBody {
    const patchMap = new Map(valuePatches.map((patch) => [patch.mutationIndex, patch.value]));
    return {
        time: metadata.time ?? slice.time,
        title: metadata.title ?? slice.title,
        summary: metadata.summary ?? slice.summary,
        kind: metadata.kind ?? slice.kind,
        patches: slice.mutations.map((mutation, index) => patchMap.has(index) ? {
            ...mutation,
            value: patchMap.get(index),
        } : {...mutation}),
    };
}

/** 从当前 state attrs 提取主体系统摘要；不读取 subject 源文件全文。 */
export function buildWorldWorkbenchSubjectSystemSummaries(subjects: SubjectStateDto[]): WorldWorkbenchPreviewSubjectSystemSummary[] {
    return subjects.map((subject) => ({
        actorImportPath: stringAttr(subject.attrs.actorImportPath),
        canonicalSource: stringAttr(subject.attrs.canonicalSource),
        controlledBy: stringAttr(subject.attrs.controlledBy),
        directStatePath: stringAttr(subject.attrs.directStatePath),
        displayName: "",
        eventCount: intAttr(subject.attrs.eventCount),
        leaderOnlyPath: stringAttr(subject.attrs.leaderOnlyPath),
        legacyKind: stringAttr(subject.attrs.legacyKind),
        memoryCount: intAttr(subject.attrs.memoryCount),
        mindFileExists: false,
        profile: stringAttr(subject.attrs.profile),
        ragIndexSources: objectPathEntries(subject.attrs.ragIndexSources),
        sourcePath: stringAttr(subject.attrs.sourcePath),
        sourceStatuses: [],
        stateFileExists: Boolean(stringAttr(subject.attrs.directStatePath)),
        subjectFileExists: Boolean(stringAttr(subject.attrs.leaderOnlyPath)),
        subjectFiles: objectPathEntries(subject.attrs.subjectFiles),
        subjectId: subject.subjectId,
        subjectSystemVersion: stringAttr(subject.attrs.subjectSystemVersion),
        syncStatus: "orphan-world-subject" as const,
        soulFileExists: Boolean(stringAttr(subject.attrs.actorImportPath)),
    })).filter((summary) => Boolean(summary.subjectFiles.length || summary.actorImportPath || summary.leaderOnlyPath || summary.ragIndexSources.length));
}

/** 从真实 simulation/subjects overview 构造主体系统摘要；这是 Workbench 的主体系统事实源。 */
export function buildWorldWorkbenchSubjectSystemSummariesFromRagOverview(input: {
    overview: ProjectRagOverviewDto;
    worldSubjects: WorldSubjectDto[];
}): WorldWorkbenchPreviewSubjectSystemSummary[] {
    const worldSubjectIds = new Set(input.worldSubjects.map((subject) => subject.id));
    return visibleRagSubjects(input.overview.subjects).map((subject) => ({
        actorImportPath: `${subject.subjectPath}/soul.md`,
        canonicalSource: subject.metadata.canonicalSource ?? "",
        controlledBy: subject.metadata.controlledBy ?? "",
        directStatePath: `${subject.subjectPath}/state.md`,
        displayName: subject.metadata.name ?? "",
        eventCount: subject.eventCount,
        leaderOnlyPath: `${subject.subjectPath}/subject.md`,
        legacyKind: subject.metadata.kind ?? "",
        memoryCount: subject.memoryCount,
        mindFileExists: subject.mindFileExists,
        profile: subject.metadata.profile ?? "",
        ragIndexSources: [
            {label: "events", path: `${subject.subjectPath}/events.jsonl`},
            {label: "memory", path: `${subject.subjectPath}/memory.jsonl`},
        ],
        sourcePath: subject.subjectPath,
        sourceStatuses: subject.sourceStatuses,
        stateFileExists: subject.stateFileExists,
        subjectFileExists: subject.subjectFileExists,
        subjectFiles: [
            {label: "subject", path: `${subject.subjectPath}/subject.md`},
            {label: "soul", path: `${subject.subjectPath}/soul.md`},
            {label: "mind", path: `${subject.subjectPath}/mind.md`},
            {label: "state", path: `${subject.subjectPath}/state.md`},
            {label: "events", path: `${subject.subjectPath}/events.jsonl`},
            {label: "memory", path: `${subject.subjectPath}/memory.jsonl`},
        ],
        subjectId: subject.metadata.id ?? subject.subjectId,
        subjectSystemVersion: "simulation-subjects-overview",
        syncStatus: worldSubjectIds.has(subject.metadata.id ?? subject.subjectId) ? "linked" : "pending-world-subject",
        soulFileExists: subject.soulFileExists,
    }));
}

/** 左栏 subject 列表以 World Engine subjects 为底，并补上尚未注册到 World Engine 的 simulation subjects。 */
export function mergeWorldWorkbenchSubjectsWithSubjectSystem(input: {
    overview: ProjectRagOverviewDto | null;
    worldSubjects: WorldSubjectDto[];
}): WorldSubjectDto[] {
    if (!input.overview) {
        return input.worldSubjects;
    }
    const merged = new Map(input.worldSubjects.map((subject) => [subject.id, {...subject}]));
    for (const subject of visibleRagSubjects(input.overview.subjects)) {
        const id = subject.metadata.id ?? subject.subjectId;
        const existing = merged.get(id);
        if (existing) {
            merged.set(id, {
                ...existing,
                name: subject.metadata.name ?? existing.name,
            });
            continue;
        }
        merged.set(id, {
            id,
            name: subject.metadata.name ?? id,
            type: "character",
        });
    }
    return [...merged.values()];
}

/** 为 slice 生成主体六文件后续维护建议；只提示，不自动写 simulation/subjects。 */
export function buildWorldWorkbenchSubjectFileProposals(input: WorldWorkbenchSubjectFileProposalInput): WorldWorkbenchSubjectFileProposal[] {
    if (input.slice.kind === "init") {
        return [];
    }
    const summaryMap = new Map(input.subjectSystemSummaries.map((summary) => [summary.subjectId, summary]));
    const subjectIds = subjectFileProposalSubjectIds(input.slice, input.contextSubjectId, summaryMap);
    return subjectIds.map((subjectId) => {
        const summary = summaryMap.get(subjectId);
        if (!summary) {
            return null;
        }
        const subjectMutations = input.slice.mutations.filter((mutation) => mutation.subjectId === subjectId);
        const contextMutations = subjectMutations.length ? subjectMutations : input.slice.mutations;
        const eventContextMutations = eventContextMutationsForSubject(input.slice.mutations, subjectId, contextMutations);
        const sourceKind = subjectMutations.length ? "direct-mutation" : "focused-world-context";
        const subjectName = input.subjectNames?.get(subjectId) || summary.displayName || subjectId;
        const eventDraft = buildSubjectEventDraft(input.slice, subjectName, eventContextMutations);
        const eventText = buildSubjectEventText(input.slice, subjectName, eventContextMutations);
        return {
            eventDraft,
            eventJsonLine: JSON.stringify({text: eventText, time: input.slice.time}),
            eventsPath: subjectSystemPath(summary, "events", `${summary.sourcePath}/events.jsonl`),
            memoryFacts: buildSubjectMemoryFacts(contextMutations, input.slice),
            memoryJsonLines: buildSubjectMemoryJsonLines(contextMutations, input.slice),
            memoryPath: subjectSystemPath(summary, "memory", `${summary.sourcePath}/memory.jsonl`),
            statePath: summary.directStatePath || `${summary.sourcePath}/state.md`,
            stateReviewReasons: buildStateReviewReasons(contextMutations, input.slice),
            subjectId,
            subjectName,
            subjectPath: summary.sourcePath || subjectId,
            sliceId: input.slice.id,
            sliceKind: input.slice.kind,
            sliceTime: input.slice.time,
            sliceTitle: input.slice.title,
            sourceKind,
            sourceLabel: sourceKind === "direct-mutation" ? "直接触及该主体" : "当前主体语境下的 world 事件建议",
        };
    }).filter((proposal): proposal is WorldWorkbenchSubjectFileProposal => Boolean(proposal));
}

/** 格式化主体文件建议，供作者复制到审查 / Agent 任务中手动使用。 */
export function formatWorldWorkbenchSubjectFileProposal(proposal: WorldWorkbenchSubjectFileProposal): string {
    const lines = [
        `# Subject file proposal: ${proposal.subjectName} (${proposal.subjectId})`,
        "",
        `sliceId: ${proposal.sliceId}`,
        `sliceTime: ${proposal.sliceTime}`,
        `sliceTitle: ${proposal.sliceTitle || "-"}`,
        `sliceKind: ${proposal.sliceKind || "-"}`,
        `subjectPath: ${proposal.subjectPath}`,
        `source: ${proposal.sourceLabel}`,
        "",
        "## events.jsonl draft",
        `path: ${proposal.eventsPath}`,
        "jsonl:",
        proposal.eventJsonLine,
        "review: 写入前确认第一人称口吻、角色当时知道什么，以及这条经历是否应追加到 events.jsonl。",
        "",
        "readable:",
        proposal.eventDraft,
    ];
    if (proposal.memoryFacts.length) {
        lines.push("", "## memory.jsonl candidates", `path: ${proposal.memoryPath}`, "jsonl:");
        lines.push(...proposal.memoryJsonLines);
        lines.push("review: memory.jsonl 是当前认知快照；写入前确认是追加新 topic，还是改写已有 topic。");
        lines.push("", "readable:", ...proposal.memoryFacts.map((fact) => `- ${fact}`));
    }
    if (proposal.stateReviewReasons.length) {
        lines.push("", "## state.md review", `path: ${proposal.statePath}`, ...proposal.stateReviewReasons.map((reason) => `- ${reason}`));
    }
    lines.push("", "注意：这是 World Engine 生成的建议，不会自动写入 simulation/subjects。");
    return lines.join("\n");
}

/** 标识当前会话内已经显式处理过的 event proposal。 */
export function worldWorkbenchSubjectEventProposalKey(proposal: Pick<WorldWorkbenchSubjectFileProposal, "eventJsonLine" | "eventsPath">): string {
    return `${proposal.eventsPath}\n${proposal.eventJsonLine}`;
}

function visibleRagSubjects(subjects: ProjectRagSubjectSummaryDto[]): ProjectRagSubjectSummaryDto[] {
    return subjects.filter((subject) => !ignoredSubjectSystemIds.has(subject.subjectId));
}

function pathEntriesRecord(entries: WorldWorkbenchPreviewSubjectSystemPath[]): Record<string, WorkbenchJsonValue> {
    const record: Record<string, WorkbenchJsonValue> = {};
    for (const entry of entries) {
        record[entry.label] = entry.path;
    }
    return record;
}

function subjectFileProposalSubjectIds(
    slice: WorldWorkbenchPreviewSlice,
    contextSubjectId: string | undefined,
    summaryMap: Map<string, WorldWorkbenchPreviewSubjectSystemSummary>,
): string[] {
    const ids = new Set(slice.mutations.map((mutation) => mutation.subjectId).filter((subjectId) => summaryMap.has(subjectId)));
    const contextId = contextSubjectId?.trim() ?? "";
    if (contextId && summaryMap.has(contextId) && (ids.size === 0 || slice.mutations.some((mutation) => mutation.subjectId === "world"))) {
        ids.add(contextId);
    }
    return [...ids];
}

function buildSubjectEventDraft(slice: WorldWorkbenchPreviewSlice, subjectName: string, mutations: WorldSlicePatchDto[]): string {
    return `${slice.time}｜${buildSubjectEventText(slice, subjectName, mutations)}`;
}

function buildSubjectEventText(slice: WorldWorkbenchPreviewSlice, subjectName: string, mutations: WorldSlicePatchDto[]): string {
    const title = stripAcceptanceEventPrefix(slice.title.trim() || slice.kind || "未命名切片");
    const summary = eventMutationNarrative(mutations) || stripAcceptanceEventPrefix(slice.summary.trim()) || mutations.map(formatMutationSummary).join("；") || "发生了新的世界状态变化。";
    const titleText = subjectVoiceText(title, subjectName);
    const summaryText = subjectVoiceText(summary, subjectName);
    if (normalizedSubjectEventText(titleText) === normalizedSubjectEventText(summaryText)) {
        return `我经历了这件事：${titleText}。`;
    }
    return `我经历了这件事：${titleText}。${summaryText}`;
}

function eventContextMutationsForSubject(
    mutations: WorldSlicePatchDto[],
    subjectId: string,
    fallbackMutations: WorldSlicePatchDto[],
): WorldSlicePatchDto[] {
    const eventMutations = mutations.filter((mutation) => (mutation.subjectId === subjectId || mutation.subjectId === "world")
        && attrRoot(mutation.path) === "events"
        && typeof mutation.value === "string"
        && mutation.value.trim());
    return eventMutations.length ? eventMutations : fallbackMutations;
}

function eventMutationNarrative(mutations: WorldSlicePatchDto[]): string {
    return mutations
        .filter((mutation) => attrRoot(mutation.path) === "events" && typeof mutation.value === "string" && mutation.value.trim())
        .map((mutation) => stripAcceptanceEventPrefix((mutation.value as string).trim()))
        .join("；");
}

/** 去掉真实浏览器验收写入的内部标记，避免复制到角色 events.jsonl。 */
function stripAcceptanceEventPrefix(text: string): string {
    return text.replace(/^\s*\[验收(?:-[^\]]+)?\]\s*/, "");
}

function normalizedSubjectEventText(text: string): string {
    return text.replace(/[，。！？、；：,.!?:;\s]/g, "");
}

function subjectVoiceText(text: string, subjectName: string): string {
    const name = subjectName.trim();
    if (!name) {
        return text;
    }
    return normalizeSubjectVoicePronouns(text.split(name).join("我"));
}

/** 收敛常见“主体名已替换为我，但后续仍残留他/她”的事件草稿。 */
function normalizeSubjectVoicePronouns(text: string): string {
    return text
        .replace(/([给让使令])([了过]?)(?:他|她|它)(?=[^，。！？、；：,.!?:;]*?(?:机会|理由|空间|时间|可能|余地|压力|警觉|信心|怀疑|判断|决定|选择|意识|感觉|想法|念头|目标|继续))/g, "$1$2我")
        .replace(/(^|[。！？；;]\s*)(?:他|她|它)(?=(?:决定|选择|意识到|发现|判断|认为|知道|明白|继续|暂时|没有|未|不会|不能|可以|需要|想|打算|准备|保持|开始|转而|感到|觉得))/g, "$1我");
}

function buildSubjectMemoryFacts(mutations: WorldSlicePatchDto[], slice: WorldWorkbenchPreviewSlice): string[] {
    return mutations
        .filter((mutation) => isMemoryMutation(mutation))
        .map((mutation) => `${slice.time} ${formatMutationSummary(mutation)}`);
}

function buildSubjectMemoryJsonLines(mutations: WorldSlicePatchDto[], slice: WorldWorkbenchPreviewSlice): string[] {
    return mutations
        .filter((mutation) => isMemoryMutation(mutation))
        .map((mutation) => JSON.stringify({
            topic: memoryProposalTopic(mutation.path, slice),
            view: memoryProposalView(mutation, slice),
        }));
}

function buildStateReviewReasons(mutations: WorldSlicePatchDto[], slice: WorldWorkbenchPreviewSlice): string[] {
    const reasons = mutations
        .filter((mutation) => stateReviewAttrRoots.has(attrRoot(mutation.path)))
        .map((mutation) => `检查 state.md「${stateReviewSection(mutation.path)}」：${formatMutationSummary(mutation)}`);
    if (!reasons.length && slice.summary.trim()) {
        return ["slice summary 可能包含位置、关系压力、短期目标或可见状态变化，需要人工确认 state.md 是否要更新。"];
    }
    return reasons;
}

function stateReviewSection(attr: string): string {
    const root = attrRoot(attr);
    if (root === "location") {
        return "当前位置";
    }
    if (root === "hp" || root === "maxHp" || root === "mp" || root === "maxMp" || root === "sp" || root === "maxSp" || root === "exp") {
        return "资源";
    }
    if (root === "inventory" || root === "equipment") {
        return "持有物品";
    }
    if (root === "appearance" || root === "body" || root === "posture" || root === "state" || root === "status") {
        return "身体与姿态";
    }
    if (root === "relationship" || root === "relationships" || root === "faction") {
        return "关系压力";
    }
    if (root === "goal" || root === "goals" || root === "shortTermGoal" || root === "shortTermGoals") {
        return "短期目标";
    }
    return "可见状态";
}

function isMemoryMutation(mutation: WorldSlicePatchDto): boolean {
    const root = attrRoot(mutation.path);
    return root === "memory" || root === "relationship" || root === "relationships";
}

function memoryProposalTopic(path: string, slice: WorldWorkbenchPreviewSlice): string {
    const parts = attrParts(path);
    return parts.slice(1).join(".") || slice.title.trim() || patchAttr(path);
}

function memoryProposalView(mutation: WorldSlicePatchDto, slice: WorldWorkbenchPreviewSlice): string {
    if (mutation.op !== "remove" && typeof mutation.value === "string" && mutation.value.trim()) {
        return mutation.value.trim();
    }
    return `${slice.time} ${formatMutationSummary(mutation)}`.trim();
}

function attrRoot(path: string): string {
    return attrParts(path)[0] ?? patchAttr(path);
}

function formatMutationSummary(mutation: WorldSlicePatchDto): string {
    if (mutation.summary?.trim()) {
        return mutation.summary.trim();
    }
    const value = mutation.op === "remove" ? "" : ` = ${formatProposalValue(mutation.value)}`;
    return `${mutation.subjectId}.${mutation.path} ${mutation.op}${value}`;
}

function patchAttr(path: string): string {
    return path.startsWith("/") ? attrParts(path).join(".") : path;
}

function attrParts(path: string): string[] {
    if (!path.startsWith("/")) {
        return path.split(".").map((part) => part.trim()).filter(Boolean);
    }
    return path.slice(1).split("/").filter(Boolean).map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function formatProposalValue(value: WorkbenchJsonValue | undefined): string {
    if (value === undefined) {
        return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
}

function subjectSystemPath(summary: WorldWorkbenchPreviewSubjectSystemSummary, label: string, fallback: string): string {
    return summary.ragIndexSources.find((source) => source.label === label)?.path || fallback;
}

/** 为真实持久 issue 构造稳定 key。 */
export function persistedWorldWorkbenchIssueKey(sliceId: string, identityOccurrence: number, issue: Pick<WorldIssueDto, "subjectId" | "attr" | "code" | "message">): string {
    return `persisted:${worldWorkbenchIssueIdentity({sliceId, ...issue})}:${identityOccurrence}`;
}

/** 用于 transient issue 去重的业务身份。 */
export function worldWorkbenchIssueIdentity(item: Pick<WorldWorkbenchReviewIssueSource, "sliceId" | "subjectId" | "attr" | "code" | "message">): string {
    return `${item.sliceId}:${item.subjectId}:${item.attr}:${item.code}:${item.message}`;
}

type WorldWorkbenchReviewIssueSource = {
    attr: string;
    code: WorldIssueDto["code"];
    explanation: WorldIssueDto["explanation"];
    identity: string;
    issueIndex: number;
    key: string;
    label: WorldIssueDto["label"];
    message: string;
    op?: WorldIssueDto["op"];
    patchId?: string;
    path?: string;
    severity: WorldIssueDto["severity"];
    sliceId: string;
    sliceTime: string;
    sliceTitle: string;
    subjectId: string;
    title: string;
};

/** 合并持久 slice issue 和本次操作 transient issue，triage 只在前端会话态生效。 */
export function buildWorldWorkbenchReviewQueueItems(input: {
    slices: WorldWorkbenchPreviewSlice[];
    transientIssues: WorldWorkbenchTransientIssue[];
    triageStatus: Map<string, WorldWorkbenchPreviewIssueStatus>;
}): WorldWorkbenchPreviewReviewQueueItem[] {
    const persistedIdentityCounts = new Map<string, number>();
    const persisted = input.slices.flatMap((slice) => (slice.issues ?? []).map((issue, issueIndex): WorldWorkbenchReviewIssueSource => ({
        attr: issue.attr,
        code: issue.code,
        explanation: issue.explanation,
        identity: worldWorkbenchIssueIdentity({...issue, sliceId: slice.id}),
        issueIndex,
        key: (() => {
            const identity = worldWorkbenchIssueIdentity({...issue, sliceId: slice.id});
            const occurrence = persistedIdentityCounts.get(identity) ?? 0;
            persistedIdentityCounts.set(identity, occurrence + 1);
            return persistedWorldWorkbenchIssueKey(slice.id, occurrence, issue);
        })(),
        label: issue.label,
        message: issue.message,
        op: issue.op,
        patchId: issue.patchId,
        path: issue.path,
        severity: issue.severity,
        sliceId: slice.id,
        sliceTime: slice.time,
        sliceTitle: slice.title,
        subjectId: issue.subjectId,
        title: issue.title,
    })));
    const persistedIdentities = new Set(persisted.map(worldWorkbenchIssueIdentity));
    const transient = input.transientIssues
        .filter((issue) => !persistedIdentities.has(worldWorkbenchIssueIdentity(issue)))
        .map((issue): WorldWorkbenchReviewIssueSource => ({
            ...issue,
            identity: worldWorkbenchIssueIdentity(issue),
        }));
    return [...persisted, ...transient].map((issue) => ({
        ...issue,
        status: input.triageStatus.get(issue.key) ?? input.triageStatus.get(issue.identity) ?? "open",
    }));
}

function stringAttr(value: WorkbenchJsonValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function intAttr(value: WorkbenchJsonValue | undefined): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function objectPathEntries(value: WorkbenchJsonValue | undefined): WorldWorkbenchPreviewSubjectSystemPath[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
    }
    return Object.entries(value)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([label, path]) => ({label, path}));
}
