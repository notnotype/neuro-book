<script setup lang="ts">
import {computed, nextTick, reactive, ref, watch} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import FormField from "nbook/app/components/common/form/FormField.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import FormTextarea from "nbook/app/components/common/form/FormTextarea.vue";
import {useResizablePanel} from "nbook/app/composables/useResizablePanel";
import {useNotification} from "nbook/app/composables/useNotification";
import {
    buildWorldWorkbenchSubjectFileProposals,
    formatWorldWorkbenchSubjectFileProposal,
    worldWorkbenchSubjectEventProposalKey,
} from "nbook/app/utils/world-engine-workbench-real";
import type {
    SubjectStateDto,
    WorldIssueDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {
    WorldWorkbenchPreviewMetadataDraftSummary,
    WorldWorkbenchPreviewSchema,
    WorldWorkbenchPreviewSlice,
    WorldWorkbenchPreviewSlicePatch,
    WorldWorkbenchPreviewSubject,
    WorldWorkbenchPreviewSubjectSystemSummary,
    WorldWorkbenchSubjectFileProposal,
} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";

const props = withDefaults(defineProps<{
    applyButtonLabel?: string;
    busy?: boolean;
    /** 尺寸记录还没读到分类：调整控件在此前不可用。 */
    resizeDisabled?: boolean;
    committedSubjectEventKeys?: string[];
    discardDraftSliceId?: string;
    discardDraftVersion?: number;
    focusedSubjectId: string;
    fullSnapshotError?: string;
    fullSnapshotIssues?: WorldIssueDto[] | null;
    fullSnapshotLoading?: boolean;
    fullSnapshotMode?: "local" | "remote";
    fullSnapshotSubjects?: SubjectStateDto[] | null;
    metadataStatusSuffix?: string;
    resetKey: number;
    schema: WorldWorkbenchPreviewSchema;
    slice: WorldWorkbenchPreviewSlice;
    subjectSystemSummaries?: WorldWorkbenchPreviewSubjectSystemSummary[];
    subjects: WorldWorkbenchPreviewSubject[];
    snapshotIssues?: WorldIssueDto[];
    snapshotSubjects: SubjectStateDto[];
    subjectFileProposalFocusVersion?: number;
    width: number;
}>(), {
    applyButtonLabel: "应用到预览",
    busy: false,
    committedSubjectEventKeys: () => [],
    discardDraftSliceId: "",
    discardDraftVersion: 0,
    fullSnapshotError: "",
    fullSnapshotIssues: null,
    fullSnapshotLoading: false,
    fullSnapshotMode: "local",
    fullSnapshotSubjects: null,
    metadataStatusSuffix: "mock 本地预览",
    snapshotIssues: () => [],
    subjectSystemSummaries: () => [],
    subjectFileProposalFocusVersion: 0,
});

const emit = defineEmits<{
    (e: "close"): void;
    (e: "commitSubjectEventProposal", proposal: WorldWorkbenchSubjectFileProposal): void;
    (e: "focusSubject", subjectId: string): void;
    (e: "openWorkspacePath", path: string): void;
    (e: "requestFullSnapshot"): void;
    (e: "updateMetadataDrafts", drafts: WorldWorkbenchPreviewMetadataDraftSummary[]): void;
    (e: "update:width", value: number): void;
    (e: "applyPatch", patch: WorldWorkbenchPreviewSlicePatch): void;
}>();

const showFullState = ref(false);
const resizeHandleRef = ref<HTMLElement | null>(null);
const subjectFileProposalsRef = ref<HTMLElement | null>(null);
const {t} = useI18n();
const notification = useNotification();
const draft = reactive<WorldWorkbenchPreviewSlicePatch>({
    time: props.slice.time,
    title: props.slice.title,
    summary: props.slice.summary,
    kind: props.slice.kind,
});
const metadataDrafts = reactive<Record<string, WorldWorkbenchPreviewSlicePatch>>({});

const standardKindOptions: SelectOption[] = [
    {value: "init", label: "init"},
    {value: "event", label: "event"},
    {value: "backstory", label: "backstory"},
];

const subjectMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject])));
const subjectNameMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject.name || subject.id])));
const touchedSubjectIds = computed(() => Array.from(new Set(props.slice.mutations.map((mutation) => mutation.subjectId))));
const subjectFileProposals = computed<WorldWorkbenchSubjectFileProposal[]>(() => buildWorldWorkbenchSubjectFileProposals({
    contextSubjectId: props.focusedSubjectId,
    slice: props.slice,
    subjectNames: subjectNameMap.value,
    subjectSystemSummaries: props.subjectSystemSummaries,
}));
const subjectFileProposalCount = computed(() => subjectFileProposals.value.length);
const committedSubjectEventKeySet = computed(() => new Set(props.committedSubjectEventKeys));
const fullSnapshotSource = computed(() => props.fullSnapshotMode === "remote" ? (props.fullSnapshotSubjects ?? []) : props.snapshotSubjects);
const visibleSnapshotIssues = computed(() => showFullState.value && props.fullSnapshotMode === "remote" ? (props.fullSnapshotIssues ?? []) : props.snapshotIssues);
const visibleSnapshotSubjects = computed(() => {
    if (showFullState.value) {
        return fullSnapshotSource.value;
    }
    const touched = new Set(touchedSubjectIds.value);
    return props.snapshotSubjects.filter((state) => touched.has(state.subjectId));
});
const rawSnapshotValue = computed(() => ({
    at: props.slice.time,
    scope: showFullState.value ? "world" : "touched-subjects",
    issues: visibleSnapshotIssues.value,
    subjects: visibleSnapshotSubjects.value,
}));
const kindOptions = computed<SelectOption[]>(() => {
    const options = [...standardKindOptions];
    const values = new Set(options.map((option) => option.value));
    for (const kind of [props.slice.kind, draft.kind]) {
        if (kind && !values.has(kind)) {
            options.push({value: kind, label: kind});
            values.add(kind);
        }
    }
    return options;
});
const metadataDraftDirty = computed(() => draft.time !== props.slice.time
    || draft.title !== props.slice.title
    || draft.summary !== props.slice.summary
    || draft.kind !== props.slice.kind);
const metadataDraftStatusLabel = computed(() => metadataDraftDirty.value ? "未应用修改" : "已同步");
const metadataStatusText = computed(() => `${metadataDraftStatusLabel.value} · ${props.metadataStatusSuffix}`);
const metadataDraftSummaries = computed<WorldWorkbenchPreviewMetadataDraftSummary[]>(() => {
    const summaries = new Map<string, WorldWorkbenchPreviewMetadataDraftSummary>();
    for (const [sliceId, savedDraft] of Object.entries(metadataDrafts)) {
        summaries.set(sliceId, {
            draftKind: savedDraft.kind,
            draftSummary: savedDraft.summary,
            draftTime: savedDraft.time,
            draftTitle: savedDraft.title || sliceId,
            sliceId,
            sliceTitle: savedDraft.title || sliceId,
        });
    }
    if (metadataDraftDirty.value) {
        summaries.set(props.slice.id, {
            draftKind: draft.kind,
            draftSummary: draft.summary,
            draftTime: draft.time,
            draftTitle: draft.title || props.slice.title || props.slice.id,
            sliceId: props.slice.id,
            sliceTitle: draft.title || props.slice.title || props.slice.id,
        });
    }
    return [...summaries.values()];
});

/** 同步外部选中 slice 到 Inspector 草稿。 */
function syncDraft(): void {
    const savedDraft = metadataDrafts[props.slice.id];
    if (savedDraft && metadataPatchMatchesSlice(savedDraft, props.slice)) {
        delete metadataDrafts[props.slice.id];
        draft.time = props.slice.time;
        draft.title = props.slice.title;
        draft.summary = props.slice.summary;
        draft.kind = props.slice.kind;
        return;
    }
    draft.time = savedDraft?.time ?? props.slice.time;
    draft.title = savedDraft?.title ?? props.slice.title;
    draft.summary = savedDraft?.summary ?? props.slice.summary;
    draft.kind = savedDraft?.kind ?? props.slice.kind;
}

/** 判断已缓存草稿是否已经被外部 slice 成功应用。 */
function metadataPatchMatchesSlice(patch: WorldWorkbenchPreviewSlicePatch, slice: WorldWorkbenchPreviewSlice): boolean {
    return patch.time === slice.time && patch.title === slice.title && patch.summary === slice.summary && patch.kind === slice.kind;
}

/** 将当前表单草稿保存到指定 slice，避免切换 slice 时丢失未应用 metadata。 */
function persistMetadataDraft(sliceId: string, baseline: WorldWorkbenchPreviewSlicePatch): void {
    const dirty = draft.time !== baseline.time || draft.title !== baseline.title || draft.summary !== baseline.summary || draft.kind !== baseline.kind;
    if (!dirty) {
        delete metadataDrafts[sliceId];
        return;
    }
    metadataDrafts[sliceId] = {
        kind: draft.kind,
        summary: draft.summary,
        time: draft.time,
        title: draft.title,
    };
}

/** 提交 metadata 草稿；外部 slice 成功同步到新值后再自动清理草稿。 */
function applyPatch(): void {
    if (props.busy || !metadataDraftDirty.value) {
        return;
    }
    emit("applyPatch", {...draft});
}

/** 放弃 metadata 本地草稿，回到当前 slice 元信息。 */
function resetDraft(): void {
    if (props.busy) {
        return;
    }
    delete metadataDrafts[props.slice.id];
    syncDraft();
}

/** 重置 mock 世界时清空所有 metadata 草稿缓存。 */
function resetMetadataDrafts(): void {
    for (const sliceId of Object.keys(metadataDrafts)) {
        delete metadataDrafts[sliceId];
    }
    syncDraft();
}

/** 清理某个 slice 的内部 metadata 草稿；删除 slice 时由真实 Dialog 精确触发。 */
function discardMetadataDraftForSlice(sliceId: string): void {
    delete metadataDrafts[sliceId];
    if (props.slice.id === sliceId) {
        syncDraft();
    }
}

/** 切换完整世界状态；真实页面在首次展开时按需请求后端。 */
function toggleFullState(): void {
    if (props.busy || props.fullSnapshotLoading) {
        return;
    }
    const nextValue = !showFullState.value;
    showFullState.value = nextValue;
    requestFullSnapshotIfNeeded();
}

/** 在真实 Workbench 中按需读取完整世界状态；同步回流中先等待，避免并发读旧上下文。 */
function requestFullSnapshotIfNeeded(): void {
    if (showFullState.value && props.fullSnapshotMode === "remote" && !props.fullSnapshotSubjects?.length && !props.fullSnapshotLoading && !props.busy) {
        emit("requestFullSnapshot");
    }
}

/** 复制主体文件建议文本；仍由作者决定是否写入六文件。 */
async function copySubjectFileProposal(proposal: WorldWorkbenchSubjectFileProposal): Promise<void> {
    await copySubjectFileProposalText(formatWorldWorkbenchSubjectFileProposal(proposal), "主体文件建议已复制。");
}

/** 复制当前 slice 的全部主体文件建议，便于多主体切片一次性进入人工审查。 */
async function copyAllSubjectFileProposals(): Promise<void> {
    const text = subjectFileProposals.value.map(formatWorldWorkbenchSubjectFileProposal).join("\n\n---\n\n");
    await copySubjectFileProposalText(text, "全部主体文件建议已复制。");
}

/** 复制主体文件建议中的精确文本片段，方便作者手动粘贴到目标文件。 */
async function copySubjectFileProposalText(text: string, successMessage: string): Promise<boolean> {
    const content = text.trim();
    if (!content) {
        return false;
    }
    if (!import.meta.client || !navigator.clipboard) {
        notification.error("当前环境不支持剪贴板。");
        return false;
    }
    try {
        await navigator.clipboard.writeText(content);
        notification.success(successMessage);
        return true;
    } catch {
        notification.error("复制失败，请手动选择文本后复制。");
        return false;
    }
}

/** 先复制建议片段，再打开目标文件，避免作者打开文件后丢失当前 proposal 上下文。 */
async function copySubjectFileProposalTextAndOpen(text: string, successMessage: string, path: string): Promise<void> {
    if (props.busy) {
        notification.error("World Engine 工作台正在同步，请稍候再打开目标文件。");
        return;
    }
    if (!path.trim()) {
        notification.error("目标文件路径为空，无法打开。");
        return;
    }
    const copied = await copySubjectFileProposalText(text, successMessage);
    if (copied) {
        openSubjectFileProposalPath(path);
    }
}

/** 请求外层 IDE 打开主体六文件目标路径；Inspector 本身不直接写文件。 */
function openSubjectFileProposalPath(path: string): void {
    const targetPath = path.trim();
    if (props.busy || !targetPath) {
        return;
    }
    emit("openWorkspacePath", targetPath);
}

/** 请求外层把单条 event proposal 显式追加到 events.jsonl；Inspector 不直接写文件。 */
function commitSubjectEventProposal(proposal: WorldWorkbenchSubjectFileProposal): void {
    if (props.busy) {
        notification.error("World Engine 工作台正在同步，请稍候再追加 events.jsonl。");
        return;
    }
    if (committedSubjectEventKeySet.value.has(worldWorkbenchSubjectEventProposalKey(proposal))) {
        notification.success("这条 events.jsonl 经历已在当前会话处理。");
        return;
    }
    emit("commitSubjectEventProposal", proposal);
}

/** 从时间线入口进入时，滚动到主体文件建议区域，减少作者在 Inspector 内寻找。 */
async function scrollSubjectFileProposalsIntoView(): Promise<void> {
    await nextTick();
    subjectFileProposalsRef.value?.scrollIntoView({block: "start"});
}

watch(() => [props.slice.id, props.slice.time, props.slice.title, props.slice.summary, props.slice.kind] as const, (_next, previous) => {
    const previousSliceId = previous?.[0];
    if (previousSliceId && previousSliceId !== props.slice.id) {
        persistMetadataDraft(previousSliceId, {
            time: previous[1],
            title: previous[2],
            summary: previous[3],
            kind: previous[4],
        });
    }
    syncDraft();
});
watch(metadataDraftSummaries, (drafts) => {
    emit("updateMetadataDrafts", drafts);
}, {immediate: true});
watch(() => props.resetKey, resetMetadataDrafts);
watch(() => [props.discardDraftSliceId, props.discardDraftVersion] as const, ([sliceId]) => {
    if (sliceId) {
        discardMetadataDraftForSlice(sliceId);
    }
});
watch(() => [props.slice.id, showFullState.value, props.fullSnapshotMode, props.fullSnapshotSubjects?.length ?? 0, props.busy] as const, requestFullSnapshotIfNeeded);
watch(() => props.subjectFileProposalFocusVersion, (version) => {
    if (version > 0 && subjectFileProposals.value.length) {
        void scrollSubjectFileProposalsIntoView();
    }
});
const {isResizing, panelStyle} = useResizablePanel(resizeHandleRef, {
    size: computed(() => props.width),
    minSize: 300,
    maxSize: 560,
    edge: "left",
    enabled: computed(() => !props.resizeDisabled),
    // 拖拽期间只更新面板自己的预览；结束才提交一次。
    onResizeEnd: (width) => emit("update:width", width),
});
</script>

<template>
    <!-- World Engine 右侧 Inspector：元信息就地编辑 + State Snapshot -->
    <aside
        class="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--we-border)] bg-[var(--we-bg-panel)] transition-[width] duration-200"
        :class="isResizing ? 'select-none transition-none' : ''"
        :style="panelStyle"
    >
        <!-- Inspector 宽度拖拽手柄 -->
        <div ref="resizeHandleRef" class="group absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize">
            <div class="ml-[3px] h-full w-[2px] bg-[var(--we-accent)] opacity-0 transition-opacity group-hover:opacity-100" :class="isResizing ? 'opacity-100' : ''"></div>
        </div>
        <div class="flex items-center justify-between gap-3 border-b border-[var(--we-border)] px-3 py-3">
            <div class="min-w-0">
                <div class="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.sliceContext") }}</div>
                <div class="mt-0.5 truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ props.slice.title || props.slice.id }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
                <span v-if="subjectFileProposalCount" data-testid="subject-file-proposal-count" class="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-2 text-[10px] font-medium text-[var(--we-accent-strong)]" title="当前切片有主体文件建议">
                    <span class="i-lucide-file-check-2 h-3 w-3"></span>
                    {{ subjectFileProposalCount }} proposals
                </span>
                <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="关闭检查器" @click="emit('close')">
                    <span class="i-lucide-panel-right-close h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3 custom-scrollbar">
            <section class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] p-3">
                <div class="mb-3 flex items-center justify-between gap-2">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.metadata") }}</div>
                    <span class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1 text-[11px] text-[var(--we-text-secondary)]">{{ draft.kind }}</span>
                </div>
                <div class="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
                    <FormField label="time">
                        <FormInput v-model="draft.time" :disabled="props.busy" />
                    </FormField>
                    <FormField label="kind">
                        <FormSelect v-model="draft.kind" :options="kindOptions" :disabled="props.busy" />
                    </FormField>
                </div>
                <FormField label="title">
                    <FormInput v-model="draft.title" :disabled="props.busy" />
                </FormField>
                <FormField label="summary">
                    <FormTextarea v-model="draft.summary" :rows="4" :disabled="props.busy" />
                </FormField>
                <div class="mt-3 flex items-center justify-between gap-2">
                    <span class="inline-flex min-w-0 items-center gap-1.5 text-[11px]" :class="metadataDraftDirty ? 'text-[var(--we-warning)]' : 'text-[var(--we-text-muted)]'">
                        <span :class="metadataDraftDirty ? 'i-lucide-pencil-line' : 'i-lucide-check'" class="h-3.5 w-3.5 shrink-0"></span>
                        <span class="truncate">{{ metadataStatusText }}</span>
                    </span>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button v-if="metadataDraftDirty" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2.5 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="props.busy" @click="resetDraft">
                            <span class="i-lucide-undo-2 h-3.5 w-3.5"></span>
                            还原
                        </button>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50" :class="metadataDraftDirty && !props.busy ? 'border-[var(--we-accent-border)] bg-[var(--we-accent)] text-[var(--text-inverse)] hover:bg-[var(--we-accent-strong)]' : 'border-[var(--we-border)] bg-[var(--we-bg-muted)] text-[var(--we-text-muted)]'" :disabled="props.busy || !metadataDraftDirty" @click="applyPatch">
                            <span :class="props.busy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-check'" class="h-3.5 w-3.5"></span>
                            {{ props.applyButtonLabel }}
                        </button>
                    </div>
                </div>
            </section>

            <section v-if="subjectFileProposals.length" ref="subjectFileProposalsRef" data-testid="subject-file-proposals" class="order-6 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">Subject file proposals</div>
                        <div class="mt-0.5 text-[11px] text-[var(--we-text-muted)]">仅生成建议，不会自动写入 simulation/subjects</div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="复制全部主体文件建议" @click="void copyAllSubjectFileProposals()">
                            <span class="i-lucide-copy-check h-3.5 w-3.5"></span>
                            复制全部
                        </button>
                        <span class="rounded-full border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--we-text-muted)]">review</span>
                    </div>
                </div>
                <div class="space-y-2">
                    <details v-for="proposal in subjectFileProposals" :key="`subject-file-proposal:${proposal.subjectId}`" class="overflow-hidden rounded-md border border-[var(--we-border)] bg-[var(--we-bg-muted)]" open>
                        <summary class="flex cursor-pointer items-center justify-between gap-2 bg-[var(--we-bg-subtle)] px-3 py-2">
                            <span class="flex min-w-0 items-center gap-1.5">
                                <span class="min-w-0 truncate text-[12px] font-semibold text-[var(--we-text-main)]">{{ proposal.subjectName }}</span>
                                <span class="min-w-0 max-w-[168px] truncate rounded border px-1.5 py-0.5 text-[10px]" :class="proposal.sourceKind === 'direct-mutation' ? 'border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] text-[var(--we-accent-strong)]' : 'border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] text-[var(--we-warning)]'" :title="proposal.sourceLabel">{{ proposal.sourceLabel }}</span>
                            </span>
                            <span class="min-w-0 shrink-0 truncate font-mono text-[10px] text-[var(--we-text-muted)]">{{ proposal.subjectPath }}</span>
                        </summary>
                        <div class="space-y-2 border-t border-[var(--we-border)] px-3 py-2 text-[11px]">
                            <div class="flex items-center justify-end">
                                <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="复制主体文件建议" @click="void copySubjectFileProposal(proposal)">
                                    <span class="i-lucide-copy h-3.5 w-3.5"></span>
                                    复制建议
                                </button>
                            </div>
                            <div>
                                <div class="mb-1 flex items-center justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--we-text-secondary)]">
                                        <span class="i-lucide-list-plus h-3.5 w-3.5 shrink-0"></span>
                                        <span class="truncate">events.jsonl draft</span>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-1">
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 text-[10px] font-medium text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45" :disabled="props.busy || committedSubjectEventKeySet.has(worldWorkbenchSubjectEventProposalKey(proposal))" :title="committedSubjectEventKeySet.has(worldWorkbenchSubjectEventProposalKey(proposal)) ? '这条 events.jsonl 经历已在当前会话处理' : '确认后追加到 events.jsonl'" @click="commitSubjectEventProposal(proposal)">
                                            <span :class="committedSubjectEventKeySet.has(worldWorkbenchSubjectEventProposalKey(proposal)) ? 'i-lucide-check h-3 w-3' : 'i-lucide-file-plus-2 h-3 w-3'"></span>
                                            {{ committedSubjectEventKeySet.has(worldWorkbenchSubjectEventProposalKey(proposal)) ? "已追加" : "追加" }}
                                        </button>
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-1.5 text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="复制 events.jsonl 行" @click="void copySubjectFileProposalText(proposal.eventJsonLine, 'events.jsonl 行已复制。')">
                                            <span class="i-lucide-copy h-3 w-3"></span>
                                            复制行
                                        </button>
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 text-[10px] text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45" :disabled="props.busy" title="复制 events.jsonl 行并打开文件，确认后追加到文件末尾" @click="void copySubjectFileProposalTextAndOpen(proposal.eventJsonLine, 'events.jsonl 行已复制，打开文件后确认并追加到末尾。', proposal.eventsPath)">
                                            <span class="i-lucide-arrow-up-right h-3 w-3"></span>
                                            复制并打开
                                        </button>
                                    </div>
                                </div>
                                <div class="rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1.5 font-mono text-[10px] text-[var(--we-code-text)]">{{ proposal.eventJsonLine }}</div>
                                <div class="mt-1 rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-1 text-[10px] text-[var(--we-warning)]">写入前确认第一人称口吻、角色当时知道什么；确认后追加到 events.jsonl 末尾。</div>
                                <div class="mt-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1.5 text-[var(--we-text-secondary)]">{{ proposal.eventDraft }}</div>
                                <div class="mt-1 flex min-w-0 items-center gap-1.5">
                                    <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 events.jsonl" @click="openSubjectFileProposalPath(proposal.eventsPath)">
                                        <span class="i-lucide-folder-open h-3 w-3"></span>
                                    </button>
                                    <div class="min-w-0 truncate font-mono text-[10px] text-[var(--we-text-muted)]" :title="proposal.eventsPath">{{ proposal.eventsPath }}</div>
                                </div>
                            </div>
                            <div v-if="proposal.memoryFacts.length">
                                <div class="mb-1 flex items-center justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--we-text-secondary)]">
                                        <span class="i-lucide-brain h-3.5 w-3.5 shrink-0"></span>
                                        <span class="truncate">memory facts</span>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-1">
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-1.5 text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="复制 memory.jsonl 候选行" @click="void copySubjectFileProposalText(proposal.memoryJsonLines.join('\n'), 'memory.jsonl 候选行已复制。')">
                                            <span class="i-lucide-copy h-3 w-3"></span>
                                            复制行
                                        </button>
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 text-[10px] text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45" :disabled="props.busy" title="复制 memory.jsonl 候选行并打开文件，确认后追加新行或按 topic 改写" @click="void copySubjectFileProposalTextAndOpen(proposal.memoryJsonLines.join('\n'), 'memory.jsonl 候选行已复制，打开文件后确认追加新行或按 topic 改写。', proposal.memoryPath)">
                                            <span class="i-lucide-arrow-up-right h-3 w-3"></span>
                                            复制并打开
                                        </button>
                                    </div>
                                </div>
                                <ul class="space-y-1">
                                    <li v-for="line in proposal.memoryJsonLines" :key="`memory-jsonl:${proposal.subjectId}:${line}`" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--we-code-text)]">{{ line }}</li>
                                    <li class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-1 text-[10px] text-[var(--we-warning)]">memory.jsonl 是当前认知快照；写入前确认追加新行，还是按 topic 改写已有行。</li>
                                    <li v-for="fact in proposal.memoryFacts" :key="`memory-fact:${proposal.subjectId}:${fact}`" class="rounded border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 py-1 text-[var(--we-text-secondary)]">{{ fact }}</li>
                                </ul>
                                <div class="mt-1 flex min-w-0 items-center gap-1.5">
                                    <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 memory.jsonl" @click="openSubjectFileProposalPath(proposal.memoryPath)">
                                        <span class="i-lucide-folder-open h-3 w-3"></span>
                                    </button>
                                    <div class="min-w-0 truncate font-mono text-[10px] text-[var(--we-text-muted)]" :title="proposal.memoryPath">{{ proposal.memoryPath }}</div>
                                </div>
                            </div>
                            <div v-if="proposal.stateReviewReasons.length">
                                <div class="mb-1 flex items-center justify-between gap-2">
                                    <div class="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--we-warning)]">
                                        <span class="i-lucide-eye h-3.5 w-3.5 shrink-0"></span>
                                        <span class="truncate">state.md review</span>
                                    </div>
                                    <div class="flex shrink-0 items-center gap-1">
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] px-1.5 text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)]" title="复制 state.md 审查提示" @click="void copySubjectFileProposalText(proposal.stateReviewReasons.join('\n'), 'state.md 审查提示已复制。')">
                                            <span class="i-lucide-copy h-3 w-3"></span>
                                            复制提示
                                        </button>
                                        <button type="button" class="inline-flex h-6 items-center gap-1 rounded border border-[var(--we-accent-border)] bg-[var(--we-accent-soft)] px-1.5 text-[10px] text-[var(--we-accent-strong)] transition-colors hover:bg-[var(--we-bg-active)] disabled:opacity-45" :disabled="props.busy" title="复制 state.md 审查提示并打开文件，打开后检查对应区块" @click="void copySubjectFileProposalTextAndOpen(proposal.stateReviewReasons.join('\n'), 'state.md 审查提示已复制，打开文件后检查对应区块。', proposal.statePath)">
                                            <span class="i-lucide-arrow-up-right h-3 w-3"></span>
                                            复制并打开
                                        </button>
                                    </div>
                                </div>
                                <ul class="space-y-1">
                                    <li v-for="reason in proposal.stateReviewReasons" :key="`state-review:${proposal.subjectId}:${reason}`" class="rounded border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 py-1 text-[var(--we-warning)]">{{ reason }}</li>
                                </ul>
                                <div class="mt-1 flex min-w-0 items-center gap-1.5">
                                    <button type="button" class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--we-border)] bg-[var(--we-bg-panel)] text-[var(--we-text-muted)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :disabled="props.busy" title="打开 state.md" @click="openSubjectFileProposalPath(proposal.statePath)">
                                        <span class="i-lucide-folder-open h-3 w-3"></span>
                                    </button>
                                    <div class="min-w-0 truncate font-mono text-[10px] text-[var(--we-text-muted)]" :title="proposal.statePath">{{ proposal.statePath }}</div>
                                </div>
                            </div>
                        </div>
                    </details>
                </div>
            </section>

            <section class="order-7 flex flex-col gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-panel)] p-3">
                <div class="flex items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--we-text-muted)]">{{ t("worldEngine.workbenchPreview.stateSnapshot") }}</div>
                        <div class="mt-0.5 text-[11px] text-[var(--we-text-muted)]">{{ showFullState ? "完整世界状态" : "当前切片触及主体" }}</div>
                    </div>
                    <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-2 text-[11px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] hover:text-[var(--we-text-main)] disabled:opacity-45" :aria-pressed="showFullState" :disabled="props.busy || props.fullSnapshotLoading" @click="toggleFullState">
                        <span :class="props.fullSnapshotLoading && showFullState ? 'i-lucide-loader-2 animate-spin' : showFullState ? 'i-lucide-minimize-2' : 'i-lucide-expand'" class="h-3.5 w-3.5"></span>
                        {{ showFullState ? "只看触及主体" : "完整世界" }}
                    </button>
                </div>

                <div v-if="visibleSnapshotIssues.length" data-testid="snapshot-query-issues" class="space-y-1 rounded-md border border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] px-2.5 py-2">
                    <div class="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--we-danger)]">
                        <span class="i-lucide-circle-alert h-3.5 w-3.5"></span>
                        State issues · {{ visibleSnapshotIssues.length }}
                    </div>
                    <div v-for="(issue, issueIndex) in visibleSnapshotIssues" :key="`snapshot-issue:${issue.sliceId ?? 'query'}:${issueIndex}:${issue.subjectId}:${issue.attr}:${issue.code}`" class="grid grid-cols-[112px_minmax(0,1fr)] gap-2 text-[11px] text-[var(--we-danger)]">
                        <span class="min-w-0 truncate font-mono font-semibold" :title="issue.code">{{ issue.code }}</span>
                        <span class="min-w-0 truncate" :title="issue.message">{{ subjectMap.get(issue.subjectId)?.name ?? issue.subjectId }} · {{ issue.attr }} · {{ issue.message }}</span>
                    </div>
                </div>

                <div v-if="showFullState && props.fullSnapshotLoading" class="rounded-md border border-[var(--we-border)] bg-[var(--we-bg-subtle)] px-3 py-6 text-center text-[12px] text-[var(--we-text-muted)]">正在读取完整世界状态...</div>
                <div v-else-if="showFullState && props.fullSnapshotError" class="rounded-md border border-[var(--we-danger)] bg-[var(--we-danger-soft)] px-3 py-3 text-[12px] text-[var(--we-danger)]">{{ props.fullSnapshotError }}</div>
                <div v-else class="rounded-md border border-[var(--we-border)]">
                    <JsonViewer :value="rawSnapshotValue" :max-height="400" />
                </div>
            </section>
        </div>
    </aside>
</template>
