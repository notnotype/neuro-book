<script setup lang="ts">
import {computed, ref, watch} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import SegmentedControl from "nbook/app/components/common/form/SegmentedControl.vue";
import type {SegmentedControlOption, SegmentedControlValue} from "nbook/app/components/common/form/SegmentedControl.vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import type {
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectStat,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchPreviewValueDraftSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = withDefaults(defineProps<{
    busy?: boolean;
    collapsed: boolean;
    /** 尺寸记录还没读到分类：调整控件在此前不可用（`persistence.md` 的「读取就绪前不可用」）。 */
    resizeDisabled?: boolean;
    focusedSubjectId?: string;
    resetKey: number;
    schema: WorldWorkbenchPreviewSchema;
    width: number;
    subjectStats: WorldWorkbenchPreviewSubjectStat[];
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    subjects: WorldWorkbenchPreviewSubject[];
    selectedSubjectIds: string[];
    valueDraftSummaries: WorldWorkbenchPreviewValueDraftSummary[];
}>(), {
    busy: false,
    resizeDisabled: false,
    focusedSubjectId: "",
    subjectSystemSummaries: () => [],
});

const emit = defineEmits<{
    (e: "update:selectedSubjectIds", value: string[]): void;
    (e: "update:width", value: number): void;
    (e: "clearSubjectContext"): void;
    (e: "focusSubjectContext", subjectId: string): void;
    (e: "toggleCollapsed"): void;
    (e: "openWorkspacePath", path: string): void;
}>();

type SubjectReviewFilter = "all" | "active" | "open" | "done" | "draft";

const search = ref("");
const selectedType = ref("");
const subjectReviewFilter = ref<SubjectReviewFilter>("all");
const resizeHandleRef = ref<HTMLElement | null>(null);
const schemaSourcePath = "world-engine/schema/index.ts";
const calendarSourcePath = "world-engine/calendar.ts";
const {t} = useI18n();

const schemaTypes = computed(() => props.schema.subjectTypes);
const typeOptions = computed(() => [
    {value: "", label: t("worldEngine.workbenchPreview.allTypes")},
    ...schemaTypes.value.map((item) => ({value: item.type, label: item.type})),
]);
const selectedSubjectSet = computed(() => new Set(props.selectedSubjectIds));
const subjectStatMap = computed(() => new Map(props.subjectStats.map((stat) => [stat.subjectId, stat])));
const subjectSystemSummaryMap = computed(() => new Map(props.subjectSystemSummaries.map((summary) => [summary.subjectId, summary])));
const activeSubjectContextId = computed(() => props.focusedSubjectId && subjectSystemSummaryMap.value.has(props.focusedSubjectId) ? props.focusedSubjectId : "");
const subjectDraftCountMap = computed(() => {
    const countMap = new Map<string, number>();
    for (const draft of props.valueDraftSummaries) {
        countMap.set(draft.subjectId, (countMap.get(draft.subjectId) ?? 0) + 1);
    }
    return countMap;
});
const activeSubjectCount = computed(() => props.subjectStats.filter((stat) => stat.sliceCount > 0).length);
const openReviewSubjectCount = computed(() => props.subjectStats.filter((stat) => stat.openIssueCount > 0).length);
const doneReviewSubjectCount = computed(() => props.subjectStats.filter((stat) => stat.issueCount > 0 && stat.openIssueCount === 0).length);
const draftSubjectCount = computed(() => subjectDraftCountMap.value.size);
const subjectReviewFilterOptions = computed<SegmentedControlOption[]>(() => [
    {value: "active", label: t("worldEngine.workbenchPreview.active"), count: activeSubjectCount.value, tone: "accent"},
    {value: "open", label: t("worldEngine.workbenchPreview.open"), count: openReviewSubjectCount.value, tone: "warning"},
    {value: "done", label: t("worldEngine.workbenchPreview.done"), count: doneReviewSubjectCount.value, tone: "accent"},
    {value: "draft", label: t("worldEngine.workbenchPreview.value"), count: draftSubjectCount.value, tone: "warning", title: "只看有未应用 value 草稿的 subjects；slice metadata 草稿请使用中间 timeline 的 draft 过滤"},
]);
const subjectReviewFilterLabel = computed(() => {
    if (subjectReviewFilter.value === "active") {
        return t("worldEngine.workbenchPreview.activeSubjects");
    }
    if (subjectReviewFilter.value === "open") {
        return t("worldEngine.workbenchPreview.openReview");
    }
    if (subjectReviewFilter.value === "done") {
        return t("worldEngine.workbenchPreview.doneReview");
    }
    if (subjectReviewFilter.value === "draft") {
        return t("worldEngine.workbenchPreview.valueDraftSubjects");
    }
    return "";
});
const filteredSubjects = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    return props.subjects.filter((subject) => {
        const matchedType = !selectedType.value || subject.type === selectedType.value;
        const stat = subjectStatMap.value.get(subject.id);
        const summary = subjectSystemSummaryMap.value.get(subject.id);
        const matchedKeyword = !keyword || [
            subject.id,
            subject.name,
            subject.type,
            stat?.latestTime,
            stat?.latestKind,
            summary?.sourcePath,
            summary?.actorImportPath,
            summary?.leaderOnlyPath,
            summary?.directStatePath,
            summary?.displayName,
            summary?.legacyKind,
            summary?.controlledBy,
            summary?.profile,
            summary?.canonicalSource,
            summary?.ragIndexSources.map((source) => source.path).join(" "),
        ].join(" ").toLowerCase().includes(keyword);
        return matchedType && matchedKeyword && matchesReviewFilter(stat);
    });
});
const hasLocalFilters = computed(() => Boolean(search.value.trim()) || Boolean(selectedType.value) || subjectReviewFilter.value !== "all");
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: 220,
    maxSize: 420,
    edge: "right",
    enabled: computed(() => !props.collapsed && !props.resizeDisabled),
    // 拖拽期间只更新面板自己的预览；结束才提交一次（宿主据此写记录，不在每帧写盘）。
    onResizeEnd: (width) => emit("update:width", width),
});

/** 选择或取消选择一个 subject，用于驱动中间 timeline 过滤。 */
function toggleSubject(subjectId: string): void {
    if (props.busy) {
        return;
    }
    const next = selectedSubjectSet.value.has(subjectId)
        ? props.selectedSubjectIds.filter((id) => id !== subjectId)
        : [...props.selectedSubjectIds, subjectId];
    emit("update:selectedSubjectIds", next);
}

/** 清空 subject 过滤，回到整体世界视角。 */
function clearSubjects(): void {
    if (props.busy) {
        return;
    }
    emit("update:selectedSubjectIds", []);
}

/** 设置主体文件建议使用的当前主体语境，不改变中间 timeline 过滤。 */
function focusSubjectContext(subjectId: string): void {
    if (props.busy) {
        return;
    }
    emit("focusSubjectContext", subjectId);
}

/** 清空主体文件建议语境，不改变中间 timeline 过滤。 */
function clearSubjectContext(): void {
    if (props.busy) {
        return;
    }
    emit("clearSubjectContext");
}

/** 清空左侧本地搜索和 type 过滤，恢复完整 subject 列表。 */
function clearLocalFilters(): void {
    search.value = "";
    selectedType.value = "";
    subjectReviewFilter.value = "all";
}

/** 返回 subject 在当前 mock timeline 中的 activity 聚合。 */
function subjectStat(subjectId: string): WorldWorkbenchPreviewSubjectStat | undefined {
    return subjectStatMap.value.get(subjectId);
}

/** 判断 subject 是否命中左栏 activity / review 快捷过滤。 */
function matchesReviewFilter(stat: WorldWorkbenchPreviewSubjectStat | undefined): boolean {
    if (subjectReviewFilter.value === "active") {
        return Boolean(stat?.sliceCount);
    }
    if (subjectReviewFilter.value === "open") {
        return Boolean(stat?.openIssueCount);
    }
    if (subjectReviewFilter.value === "done") {
        return Boolean(stat?.issueCount && stat.openIssueCount === 0);
    }
    if (subjectReviewFilter.value === "draft") {
        return Boolean(stat?.subjectId && subjectDraftCountMap.value.get(stat.subjectId));
    }
    return true;
}

/** 只过滤左侧 subject 列表，不改变中间 timeline 的 subject 选择。 */
function setSubjectReviewFilter(filter: SubjectReviewFilter): void {
    subjectReviewFilter.value = subjectReviewFilter.value === filter ? "all" : filter;
}

/** 从通用 segmented 控件接回左侧 subject 状态筛选。 */
function updateSubjectReviewFilter(value: SegmentedControlValue): void {
    if (value === "active" || value === "open" || value === "done" || value === "draft") {
        setSubjectReviewFilter(value);
    }
}

/** 清空左栏 activity / review 快捷过滤。 */
function clearSubjectReviewFilter(): void {
    subjectReviewFilter.value = "all";
}

/** 返回 review badge 的完整分布说明，用于 hover 检查。 */
function subjectReviewTitle(stat: WorldWorkbenchPreviewSubjectStat | undefined): string {
    if (!stat?.issueCount) {
        return t("worldEngine.workbenchPreview.noReviewIssue");
    }
    return t("worldEngine.workbenchPreview.reviewIssueTitle", {
        total: stat.issueCount,
        open: stat.openIssueCount,
        confirmed: stat.confirmedIssueCount,
        ignored: stat.ignoredIssueCount,
    });
}

/** 返回 subject 下未应用 value 草稿数量。 */
function subjectDraftCount(subjectId: string): number {
    return subjectDraftCountMap.value.get(subjectId) ?? 0;
}

/** 返回主体系统摘要，用于左栏显示六文件主体系统的接入状态。 */
function subjectSystemSummary(subjectId: string): WorldWorkbenchPreviewSubjectSystemSummary | undefined {
    return subjectSystemSummaryMap.value.get(subjectId);
}

function subjectSystemSyncLabel(summary: WorldWorkbenchPreviewSubjectSystemSummary | undefined): string {
    if (!summary) {
        return "";
    }
    if (summary.syncStatus === "linked") {
        return "主体系统";
    }
    if (summary.syncStatus === "pending-world-subject") {
        return "待接入";
    }
    return "孤儿";
}

function subjectSystemSyncTitle(summary: WorldWorkbenchPreviewSubjectSystemSummary | undefined): string {
    if (!summary) {
        return "";
    }
    const sourceStatus = summary.sourceStatuses.map((status) => `${status.source}:${status.status}`).join(" / ");
    return [
        summary.sourcePath,
        summary.displayName ? `name: ${summary.displayName}` : "",
        summary.legacyKind ? `kind: ${summary.legacyKind}` : "",
        summary.controlledBy ? `controlledBy: ${summary.controlledBy}` : "",
        summary.profile ? `profile: ${summary.profile}` : "",
        `World Engine: ${subjectSystemSyncLabel(summary)}`,
        `files: subject=${summary.subjectFileExists ? "yes" : "no"}, soul=${summary.soulFileExists ? "yes" : "no"}, mind=${summary.mindFileExists ? "yes" : "no"}, state=${summary.stateFileExists ? "yes" : "no"}`,
        sourceStatus ? `RAG: ${sourceStatus}` : "",
    ].filter(Boolean).join("\n");
}

/** 返回主体系统常见文件路径，用于左栏快速打开六文件。 */
function subjectSystemFilePath(summary: WorldWorkbenchPreviewSubjectSystemSummary | undefined, label: string): string {
    if (!summary) {
        return "";
    }
    const sourcePath = summary.sourcePath.trim();
    if (label === "state") {
        return summary.directStatePath || (sourcePath ? `${sourcePath}/state.md` : "");
    }
    const fallbackExt = label === "events" || label === "memory" ? "jsonl" : "md";
    return summary.subjectFiles.find((file) => file.label === label)?.path
        || summary.ragIndexSources.find((file) => file.label === label)?.path
        || (sourcePath ? `${sourcePath}/${label}.${fallbackExt}` : "");
}

/** 请求外层 IDE 打开主体系统文件；Sidebar 只做导航，不改写六文件。 */
function openSubjectSystemFile(summary: WorldWorkbenchPreviewSubjectSystemSummary | undefined, label: string): void {
    if (props.busy) {
        return;
    }
    const path = subjectSystemFilePath(summary, label).trim();
    if (!path) {
        return;
    }
    emit("openWorkspacePath", path);
}

watch(() => props.resetKey, clearLocalFilters);
</script>

<template>
    <!-- World Engine Workbench 左侧 Schema / Subjects 面板 -->
    <aside
        class="relative flex min-h-0 shrink-0 flex-col border-r border-[var(--we-border)] bg-[var(--we-bg-panel)] transition-[width] duration-200"
        :class="[props.collapsed ? 'w-12' : '', isResizing ? 'select-none transition-none' : '']"
        :style="props.collapsed ? undefined : panelStyle"
    >
        <!-- 左侧面板宽度拖拽手柄 -->
        <div v-if="!props.collapsed" ref="resizeHandleRef" class="group absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize">
            <div class="ml-[3px] h-full w-[2px] bg-[var(--we-accent)] opacity-0 transition-opacity group-hover:opacity-100" :class="isResizing ? 'opacity-100' : ''"></div>
        </div>
        <button v-if="props.collapsed" type="button" class="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="展开左侧栏" @click="emit('toggleCollapsed')">
            <span :class="props.collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'" class="h-4 w-4"></span>
        </button>

        <div v-if="props.collapsed" class="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 py-12 text-[var(--we-text-muted)]">
            <span class="i-lucide-table-properties h-4 w-4"></span>
            <span class="i-lucide-users-round h-4 w-4"></span>
            <span class="[writing-mode:vertical-rl] text-[11px] tracking-[0.18em]">{{ t("worldEngine.workbenchPreview.subjects") }}</span>
            <div data-testid="world-sidebar-collapsed-summary" class="mt-1 flex flex-col items-center gap-1.5">
                <span class="inline-flex h-7 w-8 items-center justify-center gap-0.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] font-mono text-[10px] text-[var(--we-text-secondary)]" :title="t('worldEngine.workbenchPreview.activeSubjects')">
                    <span class="i-lucide-activity h-3 w-3"></span>
                    {{ activeSubjectCount }}
                </span>
                <span v-if="props.selectedSubjectIds.length" class="inline-flex h-7 w-8 items-center justify-center gap-0.5 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] font-mono text-[10px] text-[var(--we-accent-strong)]" :title="t('worldEngine.workbenchPreview.selectedSubjects')">
                    <span class="i-lucide-filter h-3 w-3"></span>
                    {{ props.selectedSubjectIds.length }}
                </span>
                <span v-if="openReviewSubjectCount" class="inline-flex h-7 w-8 items-center justify-center gap-0.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] font-mono text-[10px] text-[var(--we-warning)]" :title="t('worldEngine.workbenchPreview.subjectsWithOpenReviewIssues')">
                    <span class="i-lucide-alert-triangle h-3 w-3"></span>
                    {{ openReviewSubjectCount }}
                </span>
                <span v-if="draftSubjectCount" class="inline-flex h-7 w-8 items-center justify-center gap-0.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] font-mono text-[10px] text-[var(--we-warning)]" :title="t('worldEngine.workbenchPreview.subjectsWithValueDrafts')">
                    <span class="i-lucide-pencil-line h-3 w-3"></span>
                    {{ draftSubjectCount }}
                </span>
            </div>
        </div>

        <template v-else>
            <div class="shrink-0 space-y-3 border-b border-[var(--we-border)] px-3 py-3">
                <div>
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.schema") }}</div>
                        <div class="flex shrink-0 items-center gap-1.5">
                            <span class="text-[10px] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.typeCount", {count: schemaTypes.length}) }}</span>
                            <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="收起左侧栏" @click="emit('toggleCollapsed')">
                                <span class="i-lucide-panel-left-close h-4 w-4"></span>
                            </button>
                        </div>
                    </div>
                    <div class="mt-2 flex min-w-0 flex-wrap gap-1.5" title="Project Workspace 内的 World Engine 配置文件">
                        <button type="button" class="inline-flex min-w-0 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 schema 配置文件" @click="emit('openWorkspacePath', schemaSourcePath)">
                            <span class="i-lucide-table-properties h-3 w-3 shrink-0"></span>
                            <span class="min-w-0 truncate">{{ schemaSourcePath }}</span>
                        </button>
                        <button type="button" class="inline-flex min-w-0 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 calendar.ts 配置文件" @click="emit('openWorkspacePath', calendarSourcePath)">
                            <span class="i-lucide-calendar-clock h-3 w-3 shrink-0"></span>
                            <span class="min-w-0 truncate">{{ calendarSourcePath }}</span>
                        </button>
                    </div>
                </div>

                <div class="flex items-center justify-between gap-2 pt-1">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.subjects") }}</div>
                    <div class="flex shrink-0 items-center gap-2">
                        <button v-if="activeSubjectContextId" type="button" class="text-[11px] font-medium text-[var(--we-accent-strong)] transition-colors hover:text-[var(--we-accent)] disabled:opacity-45" :disabled="props.busy" title="清空主体文件建议语境，不改变 timeline 过滤" @click="clearSubjectContext">清语境</button>
                        <button type="button" class="text-[11px] text-[var(--we-text-secondary)] transition-colors hover:text-[var(--we-accent)] disabled:opacity-45" :disabled="props.busy" @click="clearSubjects">整体世界</button>
                    </div>
                </div>

                <div class="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                    <FormInput v-model="search" type="search" :placeholder="t('worldEngine.workbenchPreview.searchSubject')">
                        <template #prefix>
                        <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--we-text-muted)]"></span>
                        </template>
                    </FormInput>
                    <FormSelect v-model="selectedType" :options="typeOptions" dropdown-direction="down" />
                </div>

                <div class="flex items-center justify-between text-[11px] text-[var(--we-text-muted)]">
                    <span>{{ t("worldEngine.workbenchPreview.subjectCount", {shown: filteredSubjects.length, total: props.subjects.length}) }}</span>
                    <span>{{ props.selectedSubjectIds.length ? t("worldEngine.workbenchPreview.selectedCount", {count: props.selectedSubjectIds.length}) : t("worldEngine.workbenchPreview.noFilter") }}</span>
                </div>
                <SegmentedControl :model-value="subjectReviewFilter" :options="subjectReviewFilterOptions" size="xs" @update:model-value="updateSubjectReviewFilter" />
                <div v-if="subjectReviewFilter !== 'all'" class="flex items-center justify-between gap-2 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 py-1 text-[11px] text-[var(--we-accent-strong)]">
                    <span class="min-w-0 truncate">左栏筛选：{{ subjectReviewFilterLabel }}</span>
                    <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-panel)]" title="清空左栏状态过滤" @click="clearSubjectReviewFilter">
                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                    </button>
                </div>
                <slot name="actions"></slot>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
                <div class="space-y-1">
                    <div
                        v-for="subject in filteredSubjects"
                        :key="subject.id"
                        class="w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                        :class="selectedSubjectSet.has(subject.id) ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] shadow-[inset_3px_0_0_var(--we-accent)]' : 'border-[var(--we-border)] bg-[var(--we-bg-panel)] hover:border-[var(--we-border-strong)] hover:bg-[var(--we-bg-hover)]'"
                    >
                        <button type="button" class="w-full text-left disabled:opacity-45" :aria-pressed="selectedSubjectSet.has(subject.id)" :disabled="props.busy" @click="toggleSubject(subject.id)">
                            <div class="flex items-center justify-between gap-2">
                                <span class="min-w-0 truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ subject.name || subject.id }}</span>
                                <span class="shrink-0 rounded-full border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)]">{{ subject.type }}</span>
                            </div>
                            <div class="mt-0.5 truncate font-mono text-[11px] text-[var(--we-text-muted)]">{{ subject.id }}</div>
                            <div v-if="subjectSystemSummary(subject.id)" class="mt-2 flex min-w-0 flex-wrap items-center gap-1" :title="subjectSystemSyncTitle(subjectSystemSummary(subject.id))">
                                <span class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium" :class="subjectSystemSummary(subject.id)?.syncStatus === 'linked' ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : subjectSystemSummary(subject.id)?.syncStatus === 'pending-world-subject' ? 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : 'border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]'">
                                    <span class="i-lucide-folder-tree h-3 w-3"></span>
                                    {{ subjectSystemSyncLabel(subjectSystemSummary(subject.id)) }}
                                </span>
                                <span v-if="subjectSystemSummary(subject.id)?.eventCount !== null" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ subjectSystemSummary(subject.id)?.eventCount }} events</span>
                                <span v-if="subjectSystemSummary(subject.id)?.memoryCount !== null" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ subjectSystemSummary(subject.id)?.memoryCount }} memory</span>
                                <span v-if="subjectSystemSummary(subject.id)?.legacyKind" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)]">{{ subjectSystemSummary(subject.id)?.legacyKind }}</span>
                                <span v-if="subjectSystemSummary(subject.id)?.controlledBy" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-muted)]">{{ subjectSystemSummary(subject.id)?.controlledBy }}</span>
                            </div>
                            <div class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[10px]">
                                <div class="min-w-0 truncate text-[var(--we-text-muted)]">
                                    <span class="font-mono">{{ subjectStat(subject.id)?.latestTime || "no slice" }}</span>
                                    <span v-if="subjectStat(subject.id)?.latestKind" class="ml-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1 font-mono text-[var(--we-text-secondary)]">{{ subjectStat(subject.id)?.latestKind }}</span>
                                </div>
                                <div class="flex min-w-0 flex-wrap items-center justify-end gap-1">
                                    <span class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 py-0.5 font-mono text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.mutationCountShort", {count: subjectStat(subject.id)?.mutationCount ?? 0}) }}</span>
                                    <span v-if="subjectDraftCount(subject.id)" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 font-mono font-semibold text-[var(--we-warning)]" :title="t('worldEngine.workbenchPreview.valueDraftCountTitle', {count: subjectDraftCount(subject.id)})">{{ t("worldEngine.workbenchPreview.valueCountShort", {count: subjectDraftCount(subject.id)}) }}</span>
                                    <span v-if="subjectStat(subject.id)?.openIssueCount" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1.5 py-0.5 font-mono font-semibold text-[var(--we-warning)]" :title="subjectReviewTitle(subjectStat(subject.id))">{{ t("worldEngine.workbenchPreview.openCountShort", {count: subjectStat(subject.id)?.openIssueCount}) }}</span>
                                    <template v-if="subjectStat(subject.id)?.doneIssueCount">
                                        <span class="rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 py-0.5 font-mono font-semibold text-[var(--we-accent-strong)]" :title="subjectReviewTitle(subjectStat(subject.id))">{{ t("worldEngine.workbenchPreview.doneCountShort", {count: subjectStat(subject.id)?.doneIssueCount}) }}</span>
                                        <span v-if="subjectStat(subject.id)?.confirmedIssueCount" class="rounded border border-[var(--we-accent-border)] bg-[var(--we-bg-panel)] px-1.5 py-0.5 font-mono text-[var(--we-accent-strong)]" :title="subjectReviewTitle(subjectStat(subject.id))">{{ t("worldEngine.workbenchPreview.confirmedCountShort", {count: subjectStat(subject.id)?.confirmedIssueCount}) }}</span>
                                        <span v-if="subjectStat(subject.id)?.ignoredIssueCount" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-muted)] px-1.5 py-0.5 font-mono text-[var(--we-text-muted)]" :title="subjectReviewTitle(subjectStat(subject.id))">{{ t("worldEngine.workbenchPreview.ignoredCountShort", {count: subjectStat(subject.id)?.ignoredIssueCount}) }}</span>
                                    </template>
                                </div>
                            </div>
                        </button>
                        <div v-if="subjectSystemSummary(subject.id)" class="mt-2 flex min-w-0 flex-wrap gap-1 border-t border-[var(--we-border)] pt-2">
                            <button type="button" class="inline-flex h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :class="activeSubjectContextId === subject.id ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-subtle)] text-[var(--we-text-secondary)] hover:text-[var(--we-text-main)]'" :aria-pressed="activeSubjectContextId === subject.id" :disabled="props.busy" :title="activeSubjectContextId === subject.id ? '当前主体文件建议语境，不改变 timeline 过滤' : '设为主体语境，不改变 timeline 过滤'" @click="focusSubjectContext(subject.id)">
                                <span class="i-lucide-target h-3 w-3"></span>
                                {{ activeSubjectContextId === subject.id ? "语境中" : "语境" }}
                            </button>
                            <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 subject.md" @click="openSubjectSystemFile(subjectSystemSummary(subject.id), 'subject')">
                                <span class="i-lucide-file-text h-3 w-3"></span>
                                subject
                            </button>
                            <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 events.jsonl" @click="openSubjectSystemFile(subjectSystemSummary(subject.id), 'events')">
                                <span class="i-lucide-list-plus h-3 w-3"></span>
                                events
                            </button>
                            <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 memory.jsonl" @click="openSubjectSystemFile(subjectSystemSummary(subject.id), 'memory')">
                                <span class="i-lucide-brain h-3 w-3"></span>
                                memory
                            </button>
                            <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-1.5 font-mono text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 state.md" @click="openSubjectSystemFile(subjectSystemSummary(subject.id), 'state')">
                                <span class="i-lucide-eye h-3 w-3"></span>
                                state
                            </button>
                        </div>
                    </div>
                </div>
                <div v-if="!filteredSubjects.length" class="rounded-md border border-dashed border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 py-8 text-center">
                    <div class="text-[12px] font-semibold text-[var(--we-text-secondary)]">没有匹配的 subject</div>
                    <div class="mt-1 text-[11px] text-[var(--we-text-muted)]">当前搜索、type 或状态过滤没有命中</div>
                    <button v-if="hasLocalFilters" type="button" class="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2.5 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" @click="clearLocalFilters">
                        <span class="i-lucide-x h-3.5 w-3.5"></span>
                        清空过滤
                    </button>
                </div>
            </div>
        </template>
    </aside>
</template>
