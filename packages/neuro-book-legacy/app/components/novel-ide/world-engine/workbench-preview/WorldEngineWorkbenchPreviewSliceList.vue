<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import SegmentedControl from "nbook/app/components/common/form/SegmentedControl.vue";
import type {SegmentedControlOption, SegmentedControlValue} from "nbook/app/components/common/form/SegmentedControl.vue";
import WorldEngineWorkbenchPreviewSliceCard from "nbook/app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceCard.vue";
import {isWorldWorkbenchSubjectSystemMaintenanceSlice} from "nbook/app/utils/world-engine-workbench-slice-classifier";
import {matchesWorkbenchPreviewSliceFilter} from "nbook/app/utils/world-engine-workbench-preview-filter";
import type {
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectFilterMode,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchPreviewValueDraftSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

type WorkbenchPreviewFilterChip = {
    actionLabel: string;
    id: "search" | "kind" | "health" | "subject-mode";
    label: string;
    title: string;
    value: string;
};
type WorkbenchPreviewResultStats = {
    cleanSlices: number;
    doneSlices: number;
    draftSlices: number;
    openIssues: number;
    openSlices: number;
    touchedSubjects: number;
};
type WorkbenchPreviewDraftQueueItem = {
    displayKind: string;
    displayTime: string;
    displayTitle: string;
    draftSummary: WorldWorkbenchPreviewMetadataDraftSummary | null;
    kind: string;
    metadataDraftCount: number;
    sliceId: string;
    time: string;
    title: string;
    totalDraftCount: number;
    valueDraftCount: number;
};

const props = defineProps<{
    slices: WorldWorkbenchPreviewSlice[];
    subjects: WorldWorkbenchPreviewSubject[];
    busy?: boolean;
    focusedSubjectId: string;
    resetKey: number;
    selectedSliceId: string;
    selectedSubjectIds: string[];
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceReviewSummaries: WorldWorkbenchPreviewSliceReviewSummary[];
    reviewQueueItems: WorldWorkbenchPreviewReviewQueueItem[];
    sliceSearch: string;
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
    metadataDraftSummaries: WorldWorkbenchPreviewMetadataDraftSummary[];
    valueDraftSummaries: WorldWorkbenchPreviewValueDraftSummary[];
    openInspectorPanel: (target?: "subject-file-proposals") => void;
    openDraftInspector: () => void;
    expandDraftEditor: () => void;
}>();

const emit = defineEmits<{
    (e: "selectSlice", sliceId: string): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "focusReviewIssue", item: WorldWorkbenchPreviewReviewQueueItem): void;
    (e: "filterSubject", subjectId: string): void;
    (e: "clearSubjectFilter"): void;
    (e: "removeSubjectFilter", subjectId: string): void;
    (e: "insertSliceBefore", sliceId: string): void;
    (e: "insertSliceAfter", sliceId: string): void;
    (e: "updateSliceHealthFilter", filter: WorldWorkbenchPreviewSliceHealthFilter): void;
    (e: "updateSliceKindFilter", filter: string): void;
    (e: "updateSliceSearch", value: string): void;
    (e: "updateSubjectFilterMode", mode: WorldWorkbenchPreviewSubjectFilterMode): void;
}>();

const scrollerRef = ref<HTMLElement | null>(null);
const showMaintenanceSlices = ref(false);
const {t} = useI18n();

const layoutCols = ref<"single" | "double">("single");
const layoutOptions = computed<SegmentedControlOption[]>(() => [
    { value: "single", label: "单列", iconClass: "i-lucide-list", disabled: props.busy },
    { value: "double", label: "双列", iconClass: "i-lucide-layout-grid", disabled: props.busy }
]);

const browsableSlices = computed(() => props.slices.filter((slice) => showMaintenanceSlices.value || !isWorldWorkbenchSubjectSystemMaintenanceSlice(slice)));
const hiddenMaintenanceSliceCount = computed(() => props.slices.length - browsableSlices.value.length);
const filteredSlices = computed(() => {
    return browsableSlices.value.filter((slice) => matchesWorkbenchPreviewSliceFilter({
        selectedSubjectIds: props.selectedSubjectIds,
        slice,
        sliceHealthFilter: props.sliceHealthFilter,
        sliceKindFilter: props.sliceKindFilter,
        sliceReviewSummary: sliceReviewSummaryMap.value.get(slice.id),
        sliceSearch: props.sliceSearch,
        subjectFilterMode: props.subjectFilterMode,
        metadataDraftCount: metadataDraftCountMap.value.get(slice.id) ?? 0,
        valueDraftCount: valueDraftCountMap.value.get(slice.id) ?? 0,
    }));
});
const currentVisibleSliceIndex = computed(() => filteredSlices.value.findIndex((slice) => slice.id === props.selectedSliceId));
const previousVisibleSlice = computed(() => currentVisibleSliceIndex.value > 0 ? filteredSlices.value[currentVisibleSliceIndex.value - 1] ?? null : null);
const nextVisibleSlice = computed(() => currentVisibleSliceIndex.value >= 0 && currentVisibleSliceIndex.value < filteredSlices.value.length - 1 ? filteredSlices.value[currentVisibleSliceIndex.value + 1] ?? null : null);
const visibleSlicePositionLabel = computed(() => currentVisibleSliceIndex.value >= 0 ? `${currentVisibleSliceIndex.value + 1} / ${filteredSlices.value.length}` : `- / ${filteredSlices.value.length}`);
const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const sliceReviewSummaryMap = computed(() => new Map(props.sliceReviewSummaries.map((summary) => [summary.sliceId, summary])));
const reviewQueueItemsBySlice = computed(() => {
    const itemsBySlice = new Map<string, WorldWorkbenchPreviewReviewQueueItem[]>();
    for (const item of props.reviewQueueItems) {
        const items = itemsBySlice.get(item.sliceId) ?? [];
        items.push(item);
        itemsBySlice.set(item.sliceId, items);
    }
    return itemsBySlice;
});
const valueDraftCountMap = computed(() => {
    const countMap = new Map<string, number>();
    for (const draft of props.valueDraftSummaries) {
        countMap.set(draft.sliceId, (countMap.get(draft.sliceId) ?? 0) + 1);
    }
    return countMap;
});
const metadataDraftCountMap = computed(() => {
    const countMap = new Map<string, number>();
    for (const draft of props.metadataDraftSummaries) {
        countMap.set(draft.sliceId, 1);
    }
    return countMap;
});
const metadataDraftSummaryMap = computed(() => new Map(props.metadataDraftSummaries.map((summary) => [summary.sliceId, summary])));
const sliceKinds = computed(() => Array.from(new Set(browsableSlices.value.map((slice) => slice.kind).filter(Boolean))));
const kindShortcutSlices = computed(() => browsableSlices.value.filter((slice) => matchesWorkbenchPreviewSliceFilter({
    selectedSubjectIds: props.selectedSubjectIds,
    slice,
    sliceHealthFilter: props.sliceHealthFilter,
    sliceKindFilter: "all",
    sliceReviewSummary: sliceReviewSummaryMap.value.get(slice.id),
    sliceSearch: props.sliceSearch,
    subjectFilterMode: props.subjectFilterMode,
    metadataDraftCount: metadataDraftCountMap.value.get(slice.id) ?? 0,
    valueDraftCount: valueDraftCountMap.value.get(slice.id) ?? 0,
})));
const kindShortcutCountMap = computed(() => {
    const countMap = new Map<string, number>();
    for (const slice of kindShortcutSlices.value) {
        countMap.set(slice.kind, (countMap.get(slice.kind) ?? 0) + 1);
    }
    return countMap;
});
const draftQueueItems = computed<WorkbenchPreviewDraftQueueItem[]>(() => {
    return props.slices.flatMap((slice) => {
        const metadataDraftCount = metadataDraftCountMap.value.get(slice.id) ?? 0;
        const valueDraftCount = valueDraftCountMap.value.get(slice.id) ?? 0;
        const totalDraftCount = metadataDraftCount + valueDraftCount;
        if (!totalDraftCount) {
            return [];
        }
        const draftSummary = metadataDraftSummaryMap.value.get(slice.id) ?? null;
        return [{
            displayKind: draftSummary?.draftKind || slice.kind,
            displayTime: draftSummary?.draftTime || slice.time,
            displayTitle: draftSummary?.draftTitle || slice.title,
            draftSummary,
            kind: slice.kind,
            metadataDraftCount,
            sliceId: slice.id,
            time: slice.time,
            title: slice.title,
            totalDraftCount,
            valueDraftCount,
        }];
    });
});
const selectedSubjectFilters = computed(() => props.selectedSubjectIds.map((subjectId) => {
    const subject = subjectMap.value.get(subjectId);
    return {
        id: subjectId,
        label: subject?.name ?? subjectId,
        type: subject?.type ?? "unknown",
    };
}));
const selectedSubjectLabel = computed(() => props.selectedSubjectIds.map((subjectId) => subjectMap.value.get(subjectId)?.name ?? subjectId).join(", "));
const hasActiveFilters = computed(() => Boolean(props.sliceSearch.trim()) || Boolean(props.selectedSubjectIds.length) || props.sliceKindFilter !== "all" || props.sliceHealthFilter !== "all");
const statusShortcutSlices = computed(() => browsableSlices.value.filter((slice) => matchesWorkbenchPreviewSliceFilter({
    selectedSubjectIds: props.selectedSubjectIds,
    slice,
    sliceHealthFilter: "all",
    sliceKindFilter: props.sliceKindFilter,
    sliceReviewSummary: sliceReviewSummaryMap.value.get(slice.id),
    sliceSearch: props.sliceSearch,
    subjectFilterMode: props.subjectFilterMode,
    metadataDraftCount: metadataDraftCountMap.value.get(slice.id) ?? 0,
    valueDraftCount: valueDraftCountMap.value.get(slice.id) ?? 0,
})));
const statusShortcutStats = computed<WorkbenchPreviewResultStats>(() => collectResultStats(statusShortcutSlices.value));
const subjectFilterModeOptions = computed<SegmentedControlOption[]>(() => [
    {value: "any", label: "任一 subject", disabled: props.busy},
    {value: "all", label: "全部 subject", disabled: props.busy},
]);
const kindFilterOptions = computed<SegmentedControlOption[]>(() => [
    {value: "all", label: "全部", count: kindShortcutSlices.value.length, disabled: props.busy},
    ...sliceKinds.value.map((kind) => ({
        value: kind,
        label: kind,
        count: kindShortcutCountMap.value.get(kind) ?? 0,
        disabled: props.busy,
    })),
]);
const statusFilterOptions = computed<SegmentedControlOption[]>(() => [
    {value: "all", label: "全部", disabled: props.busy},
    {value: "open", label: "open", count: statusShortcutStats.value.openSlices, tone: "warning", title: "只看仍有 open issue 的切片", disabled: props.busy},
    {value: "done", label: "done", count: statusShortcutStats.value.doneSlices, tone: "accent", title: "只看 review 已处理完成的切片", disabled: props.busy},
    {value: "clean", label: "clean", count: statusShortcutStats.value.cleanSlices, title: "只看没有派生 issue 的 clean 切片", disabled: props.busy},
    {value: "draft", label: "draft", count: statusShortcutStats.value.draftSlices, tone: "warning", title: "只看有未应用草稿的切片", disabled: props.busy},
]);
const scopeLabel = computed(() => {
    if (!props.selectedSubjectIds.length) {
        return "整体世界";
    }
    if (props.selectedSubjectIds.length === 1) {
        return `单 subject：${selectedSubjectFilters.value[0]?.label ?? props.selectedSubjectIds[0]}`;
    }
    return props.subjectFilterMode === "all" ? "多 subject：全部命中" : "多 subject：任一命中";
});
const activeFilterChips = computed<WorkbenchPreviewFilterChip[]>(() => {
    const chips: WorkbenchPreviewFilterChip[] = [];
    if (props.sliceSearch.trim()) {
        chips.push({
            actionLabel: "清空搜索",
            id: "search",
            label: t("worldEngine.workbenchPreview.search"),
            title: "清空搜索关键词",
            value: shortChipValue(props.sliceSearch.trim()),
        });
    }
    if (props.sliceKindFilter !== "all") {
        chips.push({
            actionLabel: "清空 kind",
            id: "kind",
            label: "kind",
            title: "清空 kind 过滤",
            value: props.sliceKindFilter,
        });
    }
    if (props.sliceHealthFilter !== "all") {
        chips.push({
            actionLabel: "清空 status",
            id: "health",
            label: t("worldEngine.workbenchPreview.status"),
            title: "清空 issue 状态过滤",
            value: sliceHealthFilterLabel(props.sliceHealthFilter),
        });
    }
    if (props.selectedSubjectIds.length > 1) {
        chips.push({
            actionLabel: props.subjectFilterMode === "any" ? "切换为全部 subject" : "切换为任一 subject",
            id: "subject-mode",
            label: t("worldEngine.workbenchPreview.subjectMode"),
            title: props.subjectFilterMode === "any" ? "切换为全部 subject 都命中" : "切换为任一 subject 命中",
            value: props.subjectFilterMode === "any" ? "匹配任一" : "匹配全部",
        });
    }
    return chips;
});

/** 汇总一组切片的状态分布；调用方决定是否包含当前 status 过滤。 */
function collectResultStats(targetSlices: readonly WorldWorkbenchPreviewSlice[]): WorkbenchPreviewResultStats {
    const touchedSubjectIds = new Set<string>();
    let cleanSlices = 0;
    let doneSlices = 0;
    let draftSlices = 0;
    let openIssues = 0;
    let openSlices = 0;
    for (const slice of targetSlices) {
        for (const mutation of slice.mutations) {
            touchedSubjectIds.add(mutation.subjectId);
        }
        if (draftCountForSlice(slice.id) > 0) {
            draftSlices += 1;
        }
        const summary = sliceReviewSummaryMap.value.get(slice.id);
        if (!summary || summary.total === 0) {
            cleanSlices += 1;
        } else if (summary.open > 0) {
            openSlices += 1;
            openIssues += summary.open;
        } else {
            doneSlices += 1;
        }
    }
    return {
        cleanSlices,
        doneSlices,
        draftSlices,
        openIssues,
        openSlices,
        touchedSubjects: touchedSubjectIds.size,
    };
}

/** 汇总一个 slice 上所有未应用草稿，供 status=draft 和结果统计复用。 */
function draftCountForSlice(sliceId: string): number {
    return (valueDraftCountMap.value.get(sliceId) ?? 0) + (metadataDraftCountMap.value.get(sliceId) ?? 0);
}

/** 清空切片列表本地搜索条件。 */
function clearSearch(): void {
    if (props.busy) {
        return;
    }
    emit("updateSliceSearch", "");
}

/** 同时清空本地搜索和外部 subject 过滤，恢复完整切片时间线。 */
function clearAllFilters(): void {
    if (props.busy) {
        return;
    }
    emit("updateSliceSearch", "");
    emit("updateSliceKindFilter", "all");
    emit("updateSliceHealthFilter", "all");
    emit("clearSubjectFilter");
}

/** 清空 kind/status 过滤。 */
function clearKindAndHealthFilters(): void {
    if (props.busy) {
        return;
    }
    emit("updateSliceKindFilter", "all");
    emit("updateSliceHealthFilter", "all");
}

/** 处理当前筛选 chip 的清除或模式切换动作。 */
function handleFilterChipAction(chip: WorkbenchPreviewFilterChip): void {
    if (props.busy) {
        return;
    }
    if (chip.id === "search") {
        emit("updateSliceSearch", "");
        return;
    }
    if (chip.id === "kind") {
        emit("updateSliceKindFilter", "all");
        return;
    }
    if (chip.id === "health") {
        emit("updateSliceHealthFilter", "all");
        return;
    }
    emit("updateSubjectFilterMode", props.subjectFilterMode === "any" ? "all" : "any");
}

/** 从通用 segmented 控件接回 subject 过滤模式。 */
function updateSubjectFilterMode(value: SegmentedControlValue): void {
    if (props.busy) {
        return;
    }
    if (value === "any" || value === "all") {
        emit("updateSubjectFilterMode", value);
    }
}

/** 从通用 segmented 控件接回切片 kind。 */
function updateSliceKindFilter(value: SegmentedControlValue): void {
    if (props.busy) {
        return;
    }
    if (typeof value === "string") {
        emit("updateSliceKindFilter", value);
    }
}

/** 从通用 segmented 控件接回切片健康状态。 */
function updateSliceHealthFilter(value: SegmentedControlValue): void {
    if (props.busy) {
        return;
    }
    if (value === "all" || value === "open" || value === "done" || value === "clean" || value === "draft") {
        emit("updateSliceHealthFilter", value);
    }
}

/** 在当前可见切片列表内移动选中项，保持过滤上下文不跳出主画布。 */
function navigateVisibleSlice(direction: "previous" | "next"): void {
    if (props.busy) {
        return;
    }
    const target = direction === "previous" ? previousVisibleSlice.value : nextVisibleSlice.value;
    if (!target) {
        return;
    }
    emit("selectSlice", target.id);
}

/** 从主画布草稿队列进入 draft 视角，并定位到目标切片。 */
function focusDraftQueueItem(item: WorkbenchPreviewDraftQueueItem): void {
    if (props.busy) {
        return;
    }
    showDraftSlices();
    emit("selectSlice", item.sliceId);
    if (item.metadataDraftCount > 0) {
        props.openDraftInspector();
    }
    if (item.valueDraftCount > 0) {
        props.expandDraftEditor();
    }
}

/** 从切片 proposal 徽标进入 Inspector，并保持当前选中切片与主体语境同步。 */
function openSubjectFileProposals(sliceId: string, subjectId: string): void {
    if (props.busy) {
        return;
    }
    emit("selectSlice", sliceId);
    if (subjectId) {
        emit("focusSubject", subjectId);
    }
    props.openInspectorPanel("subject-file-proposals");
}

/** 从 Draft Queue 顶部进入完整草稿视角，清掉会遮挡草稿的过滤条件。 */
function showDraftSlices(): void {
    if (props.busy) {
        return;
    }
    emit("updateSliceSearch", "");
    emit("updateSliceKindFilter", "all");
    emit("updateSliceHealthFilter", "draft");
    emit("clearSubjectFilter");
}

/** 将 status 过滤转成工作台里更接近用户意图的短文案。 */
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

/** 限制 chip 内搜索词长度，避免工具栏在窄屏下溢出。 */
function shortChipValue(value: string): string {
    if (value.length <= 24) {
        return value;
    }
    return `${value.slice(0, 24)}...`;
}

/** 将当前选中的切片滚入列表可见区域，避免底部导航后上下文脱节。 */
async function scrollSelectedSliceIntoView(): Promise<void> {
    await nextTick();
    const scroller = scrollerRef.value;
    if (!scroller || !props.selectedSliceId) {
        return;
    }
    const target = Array.from(scroller.querySelectorAll<HTMLElement>("[data-slice-id]")).find((element) => element.dataset.sliceId === props.selectedSliceId);
    target?.scrollIntoView({block: "nearest"});
}

function toggleMaintenanceSlices(): void {
    if (props.busy) {
        return;
    }
    showMaintenanceSlices.value = !showMaintenanceSlices.value;
}

watch(filteredSlices, (nextSlices) => {
    if (props.busy) {
        return;
    }
    if (!nextSlices.length || nextSlices.some((slice) => slice.id === props.selectedSliceId)) {
        void scrollSelectedSliceIntoView();
        return;
    }
    if (!props.selectedSliceId) {
        return;
    }
    emit("selectSlice", nextSlices[0]?.id ?? "");
});

watch(() => props.selectedSliceId, () => {
    void scrollSelectedSliceIntoView();
}, {flush: "post"});

watch(() => props.resetKey, () => {
    showMaintenanceSlices.value = false;
    emit("updateSliceSearch", "");
    emit("updateSliceKindFilter", "all");
    emit("updateSliceHealthFilter", "all");
});
</script>

<template>
    <!-- World Engine 中间切片列表 -->
    <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--we-bg-canvas)]">
        <div class="shrink-0 border-b border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 py-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-clock-3 h-4 w-4 text-[var(--we-text-secondary)]"></span>
                    <div class="min-w-0">
                        <h2 class="m-0 text-[15px] font-semibold leading-5 text-[var(--we-text-main)]">世界切片列表</h2>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[11px] text-[var(--we-text-muted)] xl:inline">{{ t("worldEngine.workbenchPreview.mainViewHint") }}</span>
                    <div class="inline-flex h-7 items-center rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] text-[11px]">
                        <button
                            type="button"
                            class="inline-flex h-full w-7 items-center justify-center rounded-l-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-40"
                            :disabled="props.busy || !previousVisibleSlice"
                            :title="previousVisibleSlice ? `上一个可见切片：${previousVisibleSlice.time} · ${previousVisibleSlice.title}` : '没有上一个可见切片'"
                            @click="navigateVisibleSlice('previous')"
                        >
                            <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
                        </button>
                        <span class="min-w-[52px] border-x border-[var(--we-border)] px-2 text-center font-mono text-[10px] text-[var(--we-text-secondary)]">{{ visibleSlicePositionLabel }}</span>
                        <button
                            type="button"
                            class="inline-flex h-full w-7 items-center justify-center rounded-r-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-40"
                            :disabled="props.busy || !nextVisibleSlice"
                            :title="nextVisibleSlice ? `下一个可见切片：${nextVisibleSlice.time} · ${nextVisibleSlice.title}` : '没有下一个可见切片'"
                            @click="navigateVisibleSlice('next')"
                        >
                            <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
                        </button>
                    </div>
                    <span v-if="props.selectedSubjectIds.length <= 1" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 text-[11px] text-[var(--we-text-secondary)]">
                        <span :class="props.selectedSubjectIds.length ? 'i-lucide-user-round' : 'i-lucide-globe-2'" class="h-3.5 w-3.5 text-[var(--we-text-muted)]"></span>
                        {{ scopeLabel }}
                    </span>
                    <SegmentedControl v-else :model-value="props.subjectFilterMode" :options="subjectFilterModeOptions" tone="accent" @update:model-value="updateSubjectFilterMode" />
                    <button
                        v-if="props.selectedSubjectIds.length"
                        type="button"
                        data-testid="slice-list-clear-subject-filter-top"
                        class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 text-[11px] font-medium text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45"
                        :disabled="props.busy"
                        title="清空 subject 过滤，回到整体世界时间线"
                        @click="emit('clearSubjectFilter')"
                    >
                        <span class="i-lucide-filter-x h-3.5 w-3.5"></span>
                        清空过滤
                    </button>
                    <button
                        v-if="hiddenMaintenanceSliceCount || showMaintenanceSlices"
                        type="button"
                        data-testid="slice-list-maintenance-toggle"
                        class="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors"
                        :class="showMaintenanceSlices ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-subtle)] text-[var(--we-text-secondary)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]'"
                        :aria-pressed="showMaintenanceSlices"
                        :disabled="props.busy"
                        :title="showMaintenanceSlices ? '隐藏主体系统维护切片' : `显示 ${hiddenMaintenanceSliceCount} 个主体系统维护切片`"
                        @click="toggleMaintenanceSlices"
                    >
                        <span class="i-lucide-wrench h-3.5 w-3.5"></span>
                        维护切片
                        <span class="rounded bg-[var(--we-bg-panel)] px-1 font-mono text-[10px]">{{ showMaintenanceSlices ? props.slices.length - hiddenMaintenanceSliceCount : hiddenMaintenanceSliceCount }}</span>
                    </button>
                </div>
            </div>
            <FormInput :model-value="props.sliceSearch" type="search" :placeholder="t('worldEngine.workbenchPreview.searchSlicePlaceholder')" :disabled="props.busy" @update:model-value="emit('updateSliceSearch', $event)">
                <template #prefix>
                    <span class="i-lucide-search h-3.5 w-3.5 shrink-0 text-[var(--we-text-muted)]"></span>
                </template>
            </FormInput>
            <div v-if="draftQueueItems.length" data-testid="slice-list-draft-queue" class="mt-2 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2.5 py-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--we-warning)]">
                        <span class="i-lucide-list-todo h-3.5 w-3.5 shrink-0"></span>
                        <span>{{ t("worldEngine.workbenchPreview.draftQueue") }}</span>
                        <span class="rounded bg-[var(--we-bg-panel)] px-1.5 font-mono text-[10px]">{{ t("worldEngine.workbenchPreview.sliceCountShort", {count: draftQueueItems.length}) }}</span>
                    </div>
                    <button type="button" class="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-2 text-[10px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-45" :disabled="props.busy" title="清空 search / kind / subject 过滤，只看有未应用草稿的切片" @click="showDraftSlices">
                        <span class="i-lucide-filter h-3 w-3"></span>
                        查看草稿切片
                    </button>
                </div>
                <div class="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar">
                    <button
                        v-for="item in draftQueueItems"
                        :key="`draft-queue:${item.sliceId}`"
                        type="button"
                        data-testid="slice-list-draft-queue-item"
                        class="inline-flex h-8 max-w-[260px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-left text-[11px] transition-colors"
                        :class="item.sliceId === props.selectedSliceId ? 'border-[var(--we-accent-border)] bg-[var(--we-bg-active)] text-[var(--we-accent-strong)]' : 'border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-secondary)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]'"
                        :disabled="props.busy"
                        :title="`定位草稿：${item.displayTime} · ${item.displayTitle}`"
                        @click="focusDraftQueueItem(item)"
                    >
                        <span class="shrink-0 font-mono text-[10px] text-[var(--we-text-muted)]">{{ item.displayTime }}</span>
                        <span class="min-w-0 truncate font-medium">{{ item.displayTitle }}</span>
                        <span class="shrink-0 rounded bg-[var(--we-bg-subtle)] px-1 font-mono text-[10px] text-[var(--we-text-muted)]">{{ item.displayKind }}</span>
                        <span v-if="item.metadataDraftCount" class="shrink-0 rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1 font-mono text-[10px] text-[var(--we-warning)]">meta</span>
                        <span v-if="item.valueDraftCount" class="shrink-0 rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-1 font-mono text-[10px] text-[var(--we-warning)]">value {{ item.valueDraftCount }}</span>
                        <span v-if="item.draftSummary" class="shrink-0 rounded bg-[var(--we-bg-subtle)] px-1 text-[10px] text-[var(--we-text-muted)]">preview</span>
                    </button>
                </div>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 text-[11px]" data-testid="slice-list-filter-toolbar">
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                    <span class="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--we-text-muted)]">kind</span>
                    <SegmentedControl :model-value="props.sliceKindFilter" :options="kindFilterOptions" tone="accent" @update:model-value="updateSliceKindFilter" />
                </div>
                <div class="h-5 w-px bg-[var(--we-border)]"></div>
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                    <span class="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--we-text-muted)]">status</span>
                    <SegmentedControl :model-value="props.sliceHealthFilter" :options="statusFilterOptions" @update:model-value="updateSliceHealthFilter" />
                </div>
                <div class="h-5 w-px bg-[var(--we-border)]"></div>
                <div class="flex min-w-0 flex-wrap items-center gap-1">
                    <span class="px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--we-text-muted)]">layout</span>
                    <SegmentedControl :model-value="layoutCols" :options="layoutOptions" tone="accent" @update:model-value="layoutCols = $event as 'single' | 'double'" />
                </div>
                <button v-if="props.sliceKindFilter !== 'all' || props.sliceHealthFilter !== 'all'" type="button" class="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="清空 kind / status 过滤" @click="clearKindAndHealthFilters">
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                    清空
                </button>
            </div>
            <div v-if="activeFilterChips.length || selectedSubjectFilters.length" class="mt-2 flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] font-medium text-[var(--we-text-muted)]">当前筛选</span>
                <button
                    v-for="chip in activeFilterChips"
                    :key="`active-filter:${chip.id}`"
                    type="button"
                    class="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:border-[var(--we-accent-border)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]"
                    :disabled="props.busy"
                    :title="chip.title"
                    @click="handleFilterChipAction(chip)"
                >
                    <span class="shrink-0 font-mono text-[10px] uppercase text-[var(--we-text-muted)]">{{ chip.label }}</span>
                    <span class="min-w-0 truncate font-medium">{{ chip.value }}</span>
                    <span class="shrink-0 rounded bg-[var(--we-bg-subtle)] px-1 font-mono text-[10px] text-[var(--we-text-muted)]">{{ chip.actionLabel }}</span>
                </button>
                <button
                    v-for="subject in selectedSubjectFilters"
                    :key="`slice-filter:${subject.id}`"
                    type="button"
                    class="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 text-[11px] text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)]"
                    :disabled="props.busy"
                    :title="`移除 ${subject.label}`"
                    @click="emit('removeSubjectFilter', subject.id)"
                >
                    <span class="truncate">{{ subject.label }}</span>
                    <span class="shrink-0 rounded bg-[var(--we-bg-panel)] px-1 font-mono text-[10px] text-[var(--we-text-muted)]">{{ subject.type }}</span>
                    <span class="i-lucide-x h-3 w-3 shrink-0"></span>
                </button>
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" @click="emit('clearSubjectFilter')">
                    <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                    整体世界
                </button>
            </div>
        </div>

        <div ref="scrollerRef" class="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scrollbar">
            <div class="space-y-3">
                <div v-for="slice in filteredSlices" :key="slice.id" class="relative" :data-slice-id="slice.id">
                    <WorldEngineWorkbenchPreviewSliceCard
                        :slice="slice"
                        :subjects="props.subjects"
                        :focused-subject-id="props.focusedSubjectId"
                        :selected="slice.id === props.selectedSliceId"
                        :selected-subject-ids="props.selectedSubjectIds"
                        :slice-review-summary="sliceReviewSummaryMap.get(slice.id)"
                        :review-items="reviewQueueItemsBySlice.get(slice.id) ?? []"
                        :subject-system-summaries="props.subjectSystemSummaries ?? []"
                        :metadata-draft-count="metadataDraftCountMap.get(slice.id) ?? 0"
                        :metadata-draft-summary="metadataDraftSummaryMap.get(slice.id)"
                        :value-draft-count="valueDraftCountMap.get(slice.id) ?? 0"
                        :layout-cols="layoutCols"
                        @filter-subject="emit('filterSubject', $event)"
                        @focus-subject="emit('focusSubject', $event)"
                        @focus-review-issue="emit('focusReviewIssue', $event)"
                        @insert-slice-before="emit('insertSliceBefore', $event)"
                        @insert-slice-after="emit('insertSliceAfter', $event)"
                        @open-subject-file-proposals="openSubjectFileProposals"
                        @select="emit('selectSlice', $event)"
                    />
                </div>
            </div>
            <div v-if="!filteredSlices.length" class="rounded-md border border-dashed border-[var(--we-border)] bg-[var(--we-bg-panel)] px-4 py-12 text-center">
                <div class="text-[13px] font-semibold text-[var(--we-text-secondary)]">没有匹配当前条件的切片</div>
                <div class="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[var(--we-text-muted)]">
                    <template v-if="hasActiveFilters">
                        当前筛选组合过窄<template v-if="selectedSubjectLabel">：{{ selectedSubjectLabel }}</template>
                    </template>
                    <template v-else>mock 时间线暂时没有切片</template>
                </div>
                <div v-if="hasActiveFilters" class="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button v-if="props.sliceSearch.trim()" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" @click="clearSearch">
                        <span class="i-lucide-search-x h-3.5 w-3.5"></span>
                        清空搜索
                    </button>
                    <button v-if="props.sliceKindFilter !== 'all' || props.sliceHealthFilter !== 'all'" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" @click="clearKindAndHealthFilters">
                        <span class="i-lucide-list-filter h-3.5 w-3.5"></span>
                        清空状态过滤
                    </button>
                    <button v-if="props.selectedSubjectIds.length" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-3 text-[12px] font-medium text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45" :disabled="props.busy" @click="emit('clearSubjectFilter')">
                        <span class="i-lucide-users-round h-3.5 w-3.5"></span>
                        取消 subject 过滤
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" @click="clearAllFilters">
                        <span class="i-lucide-rotate-ccw h-3.5 w-3.5"></span>
                        恢复完整时间线
                    </button>
                    <button v-if="hiddenMaintenanceSliceCount && !showMaintenanceSlices" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" @click="toggleMaintenanceSlices">
                        <span class="i-lucide-wrench h-3.5 w-3.5"></span>
                        显示维护切片
                    </button>
                </div>
            </div>
        </div>
    </section>
</template>
