<script setup lang="ts">
import {computed, ref} from "vue";
import {
    buildWorldWorkbenchSubjectFileProposals,
    worldWorkbenchIssueLevel,
    worldWorkbenchIssueStatusLabel,
} from "nbook/app/utils/world-engine-workbench-real";
import {formatWorkbenchPreviewValue} from "nbook/app/utils/world-engine-workbench-preview-value";
import type {
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewReviewQueueItem,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSliceReviewSummary,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectGroup,
    WorldWorkbenchPreviewSubjectSystemSummary,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = withDefaults(defineProps<{
    slice: WorldWorkbenchPreviewSlice;
    subjects: WorldWorkbenchPreviewSubject[];
    focusedSubjectId: string;
    selected: boolean;
    selectedSubjectIds: string[];
    sliceReviewSummary?: WorldWorkbenchPreviewSliceReviewSummary;
    reviewItems: WorldWorkbenchPreviewReviewQueueItem[];
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    metadataDraftCount: number;
    metadataDraftSummary?: WorldWorkbenchPreviewMetadataDraftSummary;
    valueDraftCount: number;
    layoutCols?: "single" | "double";
}>(), {
    layoutCols: "single",
});

const emit = defineEmits<{
    (e: "select", sliceId: string): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "focusReviewIssue", item: WorldWorkbenchPreviewReviewQueueItem): void;
    (e: "filterSubject", subjectId: string): void;
    (e: "openSubjectFileProposals", sliceId: string, subjectId: string): void;
    (e: "insertSliceBefore", sliceId: string): void;
    (e: "insertSliceAfter", sliceId: string): void;
}>();

const maxVisiblePatchesPerSubject = 6;
const opLabels: Record<string, string> = {
    append: "追加",
    increment: "增减",
    remove: "移除",
    replace: "设置",
};
const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const subjectNameMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject.name || subject.id])));
const subjectFileProposals = computed(() => buildWorldWorkbenchSubjectFileProposals({
    contextSubjectId: props.focusedSubjectId,
    slice: props.slice,
    subjectNames: subjectNameMap.value,
    subjectSystemSummaries: props.subjectSystemSummaries ?? [],
}));
const subjectFileProposalCount = computed(() => subjectFileProposals.value.length);
const reviewSummary = computed(() => props.sliceReviewSummary ?? {
    confirmed: 0,
    done: 0,
    ignored: 0,
    open: props.slice.issues?.length ?? 0,
    sliceId: props.slice.id,
    total: props.slice.issues?.length ?? 0,
});
const hasIssues = computed(() => reviewSummary.value.total > 0);
const hasOpenIssues = computed(() => reviewSummary.value.open > 0);
const hasMetadataDraft = computed(() => props.metadataDraftCount > 0);
const hasValueDraft = computed(() => props.valueDraftCount > 0);
const displayTime = computed(() => props.metadataDraftSummary?.draftTime || props.slice.time);
const displayKind = computed(() => props.metadataDraftSummary?.draftKind || props.slice.kind);
const displayTitle = computed(() => props.metadataDraftSummary?.draftTitle || props.slice.title || props.slice.id);
const displaySummary = computed(() => props.metadataDraftSummary?.draftSummary ?? props.slice.summary);
const visibleReviewItems = computed(() => props.reviewItems.slice(0, 3));
const hiddenReviewItemCount = computed(() => Math.max(0, props.reviewItems.length - visibleReviewItems.value.length));
const metadataDraftDiffLabel = computed(() => {
    const summary = props.metadataDraftSummary;
    if (!summary) {
        return "";
    }
    const changedFields: string[] = [];
    if (summary.draftTime !== props.slice.time) {
        changedFields.push("time");
    }
    if (summary.draftKind !== props.slice.kind) {
        changedFields.push("kind");
    }
    if (summary.draftTitle !== (props.slice.title || props.slice.id)) {
        changedFields.push("title");
    }
    if (summary.draftSummary !== props.slice.summary) {
        changedFields.push("summary");
    }
    return changedFields.length ? changedFields.join(" / ") : "metadata";
});
const reviewBadgeLabel = computed(() => {
    if (!hasIssues.value) {
        return "clean";
    }
    if (hasOpenIssues.value) {
        return `open ${reviewSummary.value.open}/${reviewSummary.value.total}`;
    }
    return `done ${reviewSummary.value.done}/${reviewSummary.value.total}`;
});
const patchGroups = computed<WorldWorkbenchPreviewSubjectGroup[]>(() => {
    const groups = new Map<string, WorldWorkbenchPreviewSubjectGroup>();
    for (const mutation of props.slice.mutations) {
        const group = groups.get(mutation.subjectId) ?? {
            subjectId: mutation.subjectId,
            subject: subjectMap.value.get(mutation.subjectId) ?? null,
            mutations: [],
        };
        group.mutations.push(mutation);
        groups.set(mutation.subjectId, group);
    }
    return [...groups.values()];
});

const expandedSubjectIds = ref<Record<string, boolean>>({});

function isSubjectExpanded(subjectId: string): boolean {
    return !!expandedSubjectIds.value[subjectId];
}

function toggleSubjectExpanded(subjectId: string): void {
    expandedSubjectIds.value[subjectId] = !expandedSubjectIds.value[subjectId];
}

/** patch op 的人话标签。 */
function opLabel(op: string): string {
    return opLabels[op] ?? op;
}

/** 主画布每个 subject 只展示前几条 patch，完整编辑留给底部审查工作台。 */
function visiblePatches(group: WorldWorkbenchPreviewSubjectGroup): WorldWorkbenchPreviewSubjectGroup["mutations"] {
    if (isSubjectExpanded(group.subjectId)) {
        return group.mutations;
    }
    return group.mutations.slice(0, maxVisiblePatchesPerSubject);
}

/** 当前 subject group 被折叠的 patch 数。 */
function hiddenPatchCount(group: WorldWorkbenchPreviewSubjectGroup): number {
    if (isSubjectExpanded(group.subjectId)) {
        return 0;
    }
    return Math.max(0, group.mutations.length - maxVisiblePatchesPerSubject);
}

/** patch value 的紧凑展示文本；remove 或未带 value 时保持空白。 */
function patchValueLabel(mutation: WorldWorkbenchPreviewSubjectGroup["mutations"][number]): string {
    return formatWorkbenchPreviewValue(mutation.value);
}

/** 选中当前切片。 */
function selectSlice(): void {
    emit("select", props.slice.id);
}

/** 键盘选中切片；只响应卡片自身焦点，避免吞掉内部按钮的 Enter / Space。 */
function selectSliceByKeyboard(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) {
        return;
    }
    event.preventDefault();
    selectSlice();
}

/** 从切片卡片直接进入某个 subject 的检查视角。 */
function focusSubject(subjectId: string): void {
    emit("select", props.slice.id);
    emit("focusSubject", subjectId);
}

/** 从主画布 issue 行定位到底部 Review Focus。 */
function focusReviewIssue(item: WorldWorkbenchPreviewReviewQueueItem): void {
    emit("select", props.slice.id);
    emit("focusReviewIssue", item);
}

/** 从 proposal 徽标直接进入右侧 Inspector 的主体文件建议区域。 */
function openSubjectFileProposals(): void {
    emit("openSubjectFileProposals", props.slice.id, subjectFileProposals.value[0]?.subjectId ?? "");
}

/** 在当前 slice 前打开新建入口。 */
function insertSliceBefore(): void {
    emit("insertSliceBefore", props.slice.id);
}

/** 在当前 slice 后打开新建入口。 */
function insertSliceAfter(): void {
    emit("insertSliceAfter", props.slice.id);
}

/** 将后端 issue severity 映射成 A/E，便于主画布快速扫读。 */
function issueLevel(severity: WorldWorkbenchPreviewReviewQueueItem["severity"]): "A" | "E" {
    return worldWorkbenchIssueLevel(severity);
}

/** issue 级别的紧凑视觉样式。 */
function issueLevelClass(severity: WorldWorkbenchPreviewReviewQueueItem["severity"]): string {
    return issueLevel(severity) === "E" ? "border-[var(--we-danger)] bg-[var(--we-danger-soft)] text-[var(--we-danger)]" : "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
}

/** issue triage 状态短文案。 */
function issueStatusLabel(status: WorldWorkbenchPreviewReviewQueueItem["status"]): string {
    return worldWorkbenchIssueStatusLabel(status);
}

/** issue triage 状态视觉样式。 */
function issueStatusClass(status: WorldWorkbenchPreviewReviewQueueItem["status"]): string {
    if (status === "confirmed") {
        return "border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]";
    }
    if (status === "ignored") {
        return "border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]";
    }
    return "border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]";
}
</script>

<template>
    <!-- World Engine 切片卡片：元信息 + 按 subject 分组的 patches -->
    <article
        data-testid="world-slice-card"
        role="button"
        tabindex="0"
        class="w-full cursor-pointer rounded-md border bg-[var(--we-bg-panel)] text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
        :class="props.selected ? 'border-[var(--we-accent)] bg-[var(--we-bg-active)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--we-accent)_18%,transparent)]' : 'border-[var(--we-border)] hover:border-[var(--we-border-strong)] hover:bg-[var(--we-bg-hover)]'"
        @click="selectSlice"
        @keydown.enter.stop="selectSliceByKeyboard"
        @keydown.space.stop="selectSliceByKeyboard"
    >
        <div class="grid gap-3 p-3 xl:grid-cols-[184px_minmax(0,1fr)]">
            <div class="flex flex-col gap-1.5 border-b border-[var(--we-border)] pb-3 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-3">
                <div class="font-mono text-[12px] font-semibold leading-5 text-[var(--we-text-main)]">{{ displayTime }}</div>
                <div class="flex items-center gap-1.5">
                    <span class="inline-flex max-w-full rounded bg-[var(--we-bg-muted)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--we-text-secondary)]">{{ displayKind }}</span>
                    <span class="font-mono text-[10px] text-[var(--we-text-muted)]" :title="props.slice.id">#{{ props.slice.id.slice(0, 8) }}</span>
                </div>
                <div v-if="displaySummary" class="mt-2 line-clamp-4 text-[11px] leading-relaxed text-[var(--we-text-secondary)]" :title="displaySummary">{{ displaySummary }}</div>
            </div>

            <div class="min-w-0">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span v-if="hasMetadataDraft" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-warning)]" :title="`未应用 metadata 草稿：${metadataDraftDiffLabel}`">meta draft</span>
                            <span v-if="hasValueDraft" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-warning)]" :title="`${props.valueDraftCount} 个未应用 value 草稿`">value draft {{ props.valueDraftCount }}</span>
                            <button v-if="subjectFileProposalCount" data-testid="slice-card-subject-file-proposal-count" type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 py-1 text-[11px] font-semibold text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]" title="按当前主体语境，当前切片有主体文件建议；打开右侧 Inspector 查看" @click.stop="openSubjectFileProposals">
                                <span class="i-lucide-files h-3 w-3"></span>
                                files {{ subjectFileProposalCount }}
                            </button>
                            <span v-if="hasIssues" class="rounded-md border px-2 py-1 text-[11px] font-semibold" :class="hasOpenIssues ? 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]' : 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]'">{{ reviewBadgeLabel }}</span>
                        </div>
                        <div class="mt-2 truncate text-[14px] font-semibold text-[var(--we-text-main)]" :title="hasMetadataDraft ? `草稿：${displayTitle}；已应用：${props.slice.title || props.slice.id}` : displayTitle">{{ displayTitle }}</div>
                        <div v-if="hasMetadataDraft" class="mt-1 truncate text-[10px] text-[var(--we-text-muted)]">已应用：{{ props.slice.title || props.slice.id }}</div>
                        <div v-if="props.reviewItems.length" class="mt-3 space-y-1.5">
                            <button
                                v-for="item in visibleReviewItems"
                                :key="`slice-card-issue:${item.key}`"
                                type="button"
                                data-testid="slice-card-issue-row"
                                class="grid w-full grid-cols-[28px_minmax(76px,0.7fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 text-left text-[11px] transition-colors hover:border-[var(--we-warning-border)] hover:bg-[var(--we-warning-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
                                :title="item.message"
                                @click.stop="focusReviewIssue(item)"
                            >
                                <span class="justify-self-start rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold" :class="issueLevelClass(item.severity)">{{ item.label }}</span>
                                <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ item.code }}</span>
                                <span class="min-w-0 truncate text-[var(--we-text-secondary)]">
                                    {{ subjectMap.get(item.subjectId)?.name ?? item.subjectId }}
                                    <span class="font-mono text-[var(--we-text-muted)]">· {{ item.attr }}</span>
                                </span>
                                <span class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="issueStatusClass(item.status)">{{ issueStatusLabel(item.status) }}</span>
                            </button>
                            <div v-if="hiddenReviewItemCount" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[11px] text-[var(--we-text-muted)]">
                                +{{ hiddenReviewItemCount }} issues
                            </div>
                        </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-0.5">
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]" title="在此 Slice 之前插入新 Slice" aria-label="在此 Slice 之前插入新 Slice" @click.stop="insertSliceBefore">
                            <span class="i-lucide-arrow-up-to-line h-3 w-3"></span>
                        </button>
                        <button type="button" class="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]" title="在此 Slice 之后插入新 Slice" aria-label="在此 Slice 之后插入新 Slice" @click.stop="insertSliceAfter">
                            <span class="i-lucide-arrow-down-to-line h-3 w-3"></span>
                        </button>
                    </div>
                </div>

                <div class="mt-3 grid gap-2" :class="props.layoutCols === 'double' ? '2xl:grid-cols-2' : 'grid-cols-1'">
                    <div
                        v-for="group in patchGroups"
                        :key="`${props.slice.id}:${group.subjectId}`"
                        role="button"
                        tabindex="0"
                        class="cursor-pointer overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-data)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--we-accent-border)]"
                        :class="props.focusedSubjectId === group.subjectId ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] shadow-[inset_3px_0_0_var(--we-accent)]' : 'border-[var(--we-border)] bg-[var(--we-bg-data)]'"
                        :aria-label="`聚焦 ${group.subject?.name || group.subjectId}`"
                        @click.stop="focusSubject(group.subjectId)"
                        @keydown.enter.stop.prevent="focusSubject(group.subjectId)"
                        @keydown.space.stop.prevent="focusSubject(group.subjectId)"
                    >
                        <div class="flex items-center justify-between gap-2 border-b border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2.5 py-1.5">
                            <div class="flex min-w-0 items-center gap-2">
                                <span class="text-[12px] font-bold text-[var(--we-text-main)]">{{ group.subject?.name || group.subjectId }}</span>
                                <span class="rounded bg-[var(--we-bg-muted)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-[var(--we-text-secondary)]">{{ group.subject?.type ?? "unknown" }}</span>
                                <span class="font-mono text-[10px] text-[var(--we-text-muted)]" :title="group.subjectId">({{ group.subjectId.slice(0, 8) }})</span>
                            </div>
                        </div>
                        <div class="divide-y divide-[var(--we-border)]">
                            <div
                                v-for="mutation in visiblePatches(group)"
                                :key="`${mutation.subjectId}:${mutation.path}:${mutation.op}:${mutation.summary ?? ''}`"
                                class="grid grid-cols-[minmax(88px,0.56fr)_44px_minmax(96px,1.65fr)_minmax(0,0.72fr)] gap-1 px-2.5 py-1.5 text-[11px]"
                            >
                                <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]">{{ mutation.path }}</span>
                                <span class="min-w-0 truncate text-[var(--we-accent-strong)]">{{ opLabel(mutation.op) }}</span>
                                <span class="min-w-0 truncate font-mono text-[var(--we-code-text)]" :title="patchValueLabel(mutation)">{{ patchValueLabel(mutation) }}</span>
                                <span class="min-w-0 truncate text-[var(--we-text-secondary)]" :title="mutation.summary ?? ''">{{ mutation.summary ?? "" }}</span>
                            </div>
                            <button
                                v-if="hiddenPatchCount(group)"
                                type="button"
                                class="w-full text-left px-2.5 py-1.5 text-[11px] font-medium text-[var(--we-text-muted)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] transition-colors"
                                @click.stop="toggleSubjectExpanded(group.subjectId)"
                                @keydown.enter.stop
                                @keydown.space.stop
                            >
                                +{{ hiddenPatchCount(group) }} patches (点击展开)
                            </button>
                            <button
                                v-if="isSubjectExpanded(group.subjectId) && group.mutations.length > maxVisiblePatchesPerSubject"
                                type="button"
                                class="w-full text-left px-2.5 py-1.5 text-[11px] font-medium text-[var(--we-text-muted)] hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] transition-colors"
                                @click.stop="toggleSubjectExpanded(group.subjectId)"
                                @keydown.enter.stop
                                @keydown.space.stop
                            >
                                收起
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </article>
</template>
