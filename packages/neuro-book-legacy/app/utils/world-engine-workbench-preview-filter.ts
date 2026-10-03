import type {
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceHealthFilter,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubjectFilterMode,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

// ============================================================================
// 性能优化：缓存热路径计算结果
// ============================================================================

const touchedSubjectsCache = new WeakMap<WorldWorkbenchPreviewSlice, Set<string>>();
const searchableTextCache = new WeakMap<WorldWorkbenchPreviewSlice, string>();

/** 获取或计算 slice 的 touched subjects Set（缓存） */
function getTouchedSubjects(slice: WorldWorkbenchPreviewSlice): Set<string> {
    let cached = touchedSubjectsCache.get(slice);
    if (!cached) {
        cached = new Set(slice.mutations.map((mutation) => mutation.subjectId));
        touchedSubjectsCache.set(slice, cached);
    }
    return cached;
}

/** 获取或计算 slice 的可搜索文本（缓存 JSON.stringify 结果） */
function getSearchableText(slice: WorldWorkbenchPreviewSlice): string {
    let cached = searchableTextCache.get(slice);
    if (!cached) {
        const mutationText = slice.mutations.map((mutation) =>
            [mutation.subjectId, mutation.path, mutation.op, "value" in mutation ? JSON.stringify(mutation.value) : ""].join(" ")
        ).join(" ");
        cached = [slice.id, slice.time, slice.title, slice.summary, slice.kind, mutationText].join(" ").toLowerCase();
        searchableTextCache.set(slice, cached);
    }
    return cached;
}

/**
 * 核心 subject filter 逻辑（共享实现）
 * 检查 mutations 触及的 subject 是否匹配选中的 subject 列表
 */
export function checkSubjectFilter(
    mutationSubjectIds: string[],
    selectedSubjectIds: string[],
    mode: WorldWorkbenchPreviewSubjectFilterMode,
): boolean {
    if (!selectedSubjectIds.length) {
        return true;
    }
    const touched = new Set(mutationSubjectIds);
    if (mode === "all") {
        return selectedSubjectIds.every((subjectId) => touched.has(subjectId));
    }
    return selectedSubjectIds.some((subjectId) => touched.has(subjectId));
}

export type WorkbenchPreviewSliceFilterInput = {
    selectedSubjectIds: string[];
    slice: WorldWorkbenchPreviewSlice;
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceReviewSummary: WorldWorkbenchPreviewSliceReviewSummary | undefined;
    sliceSearch: string;
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
    metadataDraftCount?: number;
    valueDraftCount?: number;
};

export type WorkbenchPreviewFilterState = {
    selectedSubjectIds: string[];
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter;
    sliceKindFilter: string;
    sliceSearch: string;
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode;
};

/** 判断切片是否命中完整 Slice List 可见过滤。 */
export function matchesWorkbenchPreviewSliceFilter(input: WorkbenchPreviewSliceFilterInput): boolean {
    const keyword = input.sliceSearch.trim().toLowerCase();
    return matchesWorkbenchPreviewSubjectFilter(input.slice, input.selectedSubjectIds, input.subjectFilterMode)
        && matchesWorkbenchPreviewKindFilter(input.slice, input.sliceKindFilter)
        && matchesWorkbenchPreviewHealthFilter(input.slice, input.sliceHealthFilter, input.sliceReviewSummary, (input.valueDraftCount ?? 0) + (input.metadataDraftCount ?? 0))
        && matchesWorkbenchPreviewKeywordFilter(input.slice, keyword);
}

/** 保存编辑后计算下一组过滤器，确保刚保存的 slice 仍留在主画布可见范围。 */
export function buildWorkbenchPreviewFiltersAfterSavedEdit(input: WorkbenchPreviewFilterState & {
    editedSlice: WorldWorkbenchPreviewSlice;
}): WorkbenchPreviewFilterState {
    const next: WorkbenchPreviewFilterState = {
        selectedSubjectIds: input.selectedSubjectIds,
        sliceHealthFilter: input.sliceHealthFilter,
        sliceKindFilter: input.sliceKindFilter,
        sliceSearch: input.sliceSearch,
        subjectFilterMode: input.subjectFilterMode,
    };
    if (!matchesWorkbenchPreviewSubjectFilter(input.editedSlice, input.selectedSubjectIds, input.subjectFilterMode)) {
        next.selectedSubjectIds = [];
        next.subjectFilterMode = "any";
    }
    if (!matchesWorkbenchPreviewKindFilter(input.editedSlice, input.sliceKindFilter)) {
        next.sliceKindFilter = "all";
    }
    if (!matchesWorkbenchPreviewKeywordFilter(input.editedSlice, input.sliceSearch.trim().toLowerCase())) {
        next.sliceSearch = "";
    }
    if (input.sliceHealthFilter !== "all") {
        next.sliceHealthFilter = "all";
    }
    return next;
}

/** 判断切片是否命中 subject any/all 过滤。 */
export function matchesWorkbenchPreviewSubjectFilter(
    slice: WorldWorkbenchPreviewSlice,
    selectedSubjectIds: string[],
    subjectFilterMode: WorldWorkbenchPreviewSubjectFilterMode,
): boolean {
    const touched = getTouchedSubjects(slice);  // 使用缓存的 Set
    return checkSubjectFilter(Array.from(touched), selectedSubjectIds, subjectFilterMode);
}

/** 判断切片是否命中 kind 过滤。 */
export function matchesWorkbenchPreviewKindFilter(slice: WorldWorkbenchPreviewSlice, sliceKindFilter: string): boolean {
    return sliceKindFilter === "all" || slice.kind === sliceKindFilter;
}

/** 判断切片是否命中 open / done / clean 过滤。 */
export function matchesWorkbenchPreviewHealthFilter(
    slice: WorldWorkbenchPreviewSlice,
    sliceHealthFilter: WorldWorkbenchPreviewSliceHealthFilter,
    sliceReviewSummary: WorldWorkbenchPreviewSliceReviewSummary | undefined,
    draftCount = 0,
): boolean {
    if (sliceHealthFilter === "all") {
        return true;
    }
    if (sliceHealthFilter === "draft") {
        return draftCount > 0;
    }
    const total = sliceReviewSummary?.total ?? slice.issues?.length ?? 0;
    if (sliceHealthFilter === "clean") {
        return total === 0;
    }
    if (sliceHealthFilter === "done") {
        return total > 0 && (sliceReviewSummary?.open ?? total) === 0;
    }
    return (sliceReviewSummary?.open ?? total) > 0;
}

/** 判断切片是否命中搜索关键词。 */
export function matchesWorkbenchPreviewKeywordFilter(slice: WorldWorkbenchPreviewSlice, keyword: string): boolean {
    if (!keyword) {
        return true;
    }
    const searchableText = getSearchableText(slice);  // 使用缓存
    return searchableText.includes(keyword);
}
