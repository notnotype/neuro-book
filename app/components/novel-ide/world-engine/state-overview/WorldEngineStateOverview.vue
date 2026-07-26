<script setup lang="ts">
import {computed, onMounted, reactive, ref, watch} from "vue";
import type {WorldPreviewSchemaType} from "nbook/app/utils/world-engine-preview";
import type {StagedStateEdit, StateViewConfig} from "nbook/app/utils/world-engine-state-view";
import {
    EMPTY_STATE_VIEW_CONFIG,
    parseStateViewConfig,
    resolveTypeIcon,
    resolveTypeLabel,
    stagedEditKey,
} from "nbook/app/utils/world-engine-state-view";
import type {
    SliceWriteResultDto,
    SubjectStateDto,
    WorldSchemaProjectionDto,
    WorldSlicePatchDto,
    WorldStateDto,
    WorldSubjectDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {WorldWorkbenchPreviewSlice} from "nbook/app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types";
import WorldEngineStateOverviewCard from "nbook/app/components/novel-ide/world-engine/state-overview/WorldEngineStateOverviewCard.vue";
import {useNotification} from "nbook/app/composables/useNotification";

const props = defineProps<{
    projectPath: string;
    /** 世界线：main = 写作模式（默认），rp = RP 模式独立世界线。 */
    worldKey?: "main" | "rp";
    schema: WorldSchemaProjectionDto;
    subjects: WorldSubjectDto[];
    /** 全量切片（含 mutations），时间升序，由 Workbench 提供。 */
    slices: WorldWorkbenchPreviewSlice[];
    busy?: boolean;
}>();

const emit = defineEmits<{
    /** 请求跳转到切片编辑视图并选中该切片。 */
    openSlice: [sliceId: string];
    /** 保存写入成功，请求 Workbench 刷新自身数据。 */
    saved: [];
}>();

const notification = useNotification();

// ---- 时间选择 ----------------------------------------------------------------

/** null = 最新切片。 */
const selectedSliceId = ref<string | null>(null);

const orderedSlices = computed(() => props.slices);

const selectedSlice = computed<WorldWorkbenchPreviewSlice | null>(() => {
    if (!orderedSlices.value.length) return null;
    if (selectedSliceId.value === null) return orderedSlices.value[orderedSlices.value.length - 1] ?? null;
    return orderedSlices.value.find((slice) => slice.id === selectedSliceId.value) ?? orderedSlices.value[orderedSlices.value.length - 1] ?? null;
});

const selectedSliceIndex = computed(() => {
    if (!selectedSlice.value) return -1;
    return orderedSlices.value.findIndex((slice) => slice.id === selectedSlice.value?.id);
});

const isLatest = computed(() => selectedSliceIndex.value === orderedSlices.value.length - 1);

function selectSliceAt(index: number): void {
    const slice = orderedSlices.value[index];
    if (!slice) return;
    guardStagedThen(() => {
        selectedSliceId.value = index === orderedSlices.value.length - 1 ? null : slice.id;
    });
}

function selectLatest(): void {
    guardStagedThen(() => {
        selectedSliceId.value = null;
    });
}

/** 有未保存修改时切换时间需确认（防止暂存意外丢失）。 */
function guardStagedThen(action: () => void): void {
    if (stagedEdits.size > 0 && !window.confirm(`有 ${stagedEdits.size} 处未保存的修改，切换时间将丢弃这些修改。继续？`)) {
        return;
    }
    stagedEdits.clear();
    action();
}

// ---- 状态推算 ----------------------------------------------------------------

const stateLoading = ref(false);
const stateError = ref("");
const stateResult = ref<WorldStateDto | null>(null);

async function loadState(): Promise<void> {
    if (!selectedSlice.value) {
        stateResult.value = null;
        return;
    }
    stateLoading.value = true;
    stateError.value = "";
    try {
        stateResult.value = await $fetch<WorldStateDto>("/api/projects/world-engine/state", {
            query: {projectPath: props.projectPath, worldKey: props.worldKey ?? "main", at: selectedSlice.value.time},
        });
    } catch (error) {
        stateError.value = error instanceof Error ? error.message : String(error);
    } finally {
        stateLoading.value = false;
    }
}

watch([selectedSlice], () => {
    void loadState();
}, {immediate: false});

// ---- 视图配置 ----------------------------------------------------------------

const viewConfig = ref<StateViewConfig>(EMPTY_STATE_VIEW_CONFIG);
const viewConfigIssues = ref<string[]>([]);
const viewConfigIssuesVisible = ref(false);

async function loadViewConfig(): Promise<void> {
    try {
        const file = await $fetch<{content: string}>("/api/workspace-files/read", {
            query: {projectPath: props.projectPath, path: "world-engine/state-view.json"},
        });
        const parsed = parseStateViewConfig(file.content);
        viewConfig.value = parsed.config;
        viewConfigIssues.value = parsed.issues;
    } catch {
        // 配置文件不存在是正常情况：走 schema 默认渲染。
        viewConfig.value = EMPTY_STATE_VIEW_CONFIG;
        viewConfigIssues.value = [];
    }
}

// ---- 分类分组 ----------------------------------------------------------------

const collapsedTypes = reactive(new Set<string>());

const subjectNameMap = computed(() => new Map(props.subjects.map((subject) => [subject.id, subject.name])));

const schemaTypeMap = computed(() => new Map<string, WorldPreviewSchemaType>(props.schema.subjectTypes.map((item) => [item.type, item])));

const stateBySubjectId = computed(() => {
    const map = new Map<string, SubjectStateDto>();
    for (const subject of stateResult.value?.subjects ?? []) {
        map.set(subject.subjectId, subject);
    }
    return map;
});

const subjectSearch = ref("");

type TypeGroup = {
    type: string;
    label: string;
    icon: string;
    subjects: WorldSubjectDto[];
};

const typeGroups = computed<TypeGroup[]>(() => {
    const search = subjectSearch.value.trim().toLowerCase();
    const groupsByType = new Map<string, WorldSubjectDto[]>();
    for (const subject of props.subjects) {
        if (search && !subject.id.toLowerCase().includes(search) && !subject.name.toLowerCase().includes(search)) {
            continue;
        }
        const list = groupsByType.get(subject.type) ?? [];
        list.push(subject);
        groupsByType.set(subject.type, list);
    }
    const groups: TypeGroup[] = [];
    for (const [type, subjects] of groupsByType) {
        const typeConfig = viewConfig.value.types[type];
        groups.push({
            type,
            label: resolveTypeLabel(type, typeConfig, schemaTypeMap.value.get(type)?.desc),
            icon: resolveTypeIcon(type, typeConfig),
            subjects,
        });
    }
    groups.sort((left, right) => {
        const leftOrder = viewConfig.value.types[left.type]?.order ?? (left.type === "world" ? -1 : 0);
        const rightOrder = viewConfig.value.types[right.type]?.order ?? (right.type === "world" ? -1 : 0);
        return leftOrder - rightOrder || left.type.localeCompare(right.type);
    });
    return groups;
});

function toggleType(type: string): void {
    if (collapsedTypes.has(type)) {
        collapsedTypes.delete(type);
    } else {
        collapsedTypes.add(type);
    }
}

// ---- 编辑暂存与保存 -----------------------------------------------------------

const stagedEdits = reactive(new Map<string, StagedStateEdit>());
const saving = ref(false);

function stageEdit(edit: StagedStateEdit): void {
    stagedEdits.set(stagedEditKey(edit), edit);
}

function unstageEdit(key: string): void {
    stagedEdits.delete(key);
}

function discardStaged(): void {
    stagedEdits.clear();
}

const stagedList = computed(() => [...stagedEdits.values()]);

/**
 * 保存：把暂存修改以 replace patch 写入当前选中切片。
 * 切片内已有同 subject+path 的 replace patch 时就地覆盖其值，否则追加。
 */
async function saveStaged(): Promise<void> {
    const slice = selectedSlice.value;
    if (!slice || !stagedEdits.size || saving.value) return;
    saving.value = true;
    try {
        const patches: WorldSlicePatchDto[] = slice.mutations.map((patch) => ({
            subjectId: patch.subjectId,
            path: patch.path,
            op: patch.op,
            ...(patch.value !== undefined ? {value: patch.value} : {}),
            ...(patch.summary ? {summary: patch.summary} : {}),
        }));
        for (const edit of stagedEdits.values()) {
            const existingIndex = patches.findIndex((patch) => patch.subjectId === edit.subjectId && patch.path === edit.path && patch.op === "replace");
            const nextPatch: WorldSlicePatchDto = {
                subjectId: edit.subjectId,
                path: edit.path,
                op: "replace",
                value: edit.value,
                summary: "状态总览面板手动修改",
            };
            if (existingIndex >= 0) {
                patches[existingIndex] = {...patches[existingIndex], ...nextPatch};
            } else {
                patches.push(nextPatch);
            }
        }
        const result = await $fetch<SliceWriteResultDto>(`/api/projects/world-engine/slices/${encodeURIComponent(slice.id)}/edit`, {
            method: "POST",
            query: {projectPath: props.projectPath, worldKey: props.worldKey ?? "main"},
            body: {
                time: slice.time,
                title: slice.title,
                summary: slice.summary,
                kind: slice.kind,
                patches,
            },
        });
        const issueText = result.issues.length ? `，引擎返回 ${result.issues.length} 个 issue` : "";
        notification.success(`已写入 ${stagedEdits.size} 处修改到切片「${slice.title || slice.time}」${issueText}。`, {title: "保存成功"});
        stagedEdits.clear();
        emit("saved");
        await loadState();
    } catch (error) {
        notification.error(error instanceof Error ? error.message : String(error), {title: "写入切片失败"});
    } finally {
        saving.value = false;
    }
}

// ---- 变更历史 ----------------------------------------------------------------

const historySubjectId = ref<string | null>(null);

const historySubjectName = computed(() => historySubjectId.value ? (subjectNameMap.value.get(historySubjectId.value) ?? historySubjectId.value) : "");

type HistoryEntry = {
    slice: WorldWorkbenchPreviewSlice;
    patches: WorldSlicePatchDto[];
};

const historyEntries = computed<HistoryEntry[]>(() => {
    if (!historySubjectId.value) return [];
    const entries: HistoryEntry[] = [];
    for (const slice of orderedSlices.value) {
        const patches = slice.mutations.filter((patch) => patch.subjectId === historySubjectId.value);
        if (patches.length) {
            entries.push({slice, patches});
        }
    }
    return entries.reverse();
});

// ---- 切片分布条 ---------------------------------------------------------------

const maxPatchCount = computed(() => Math.max(1, ...orderedSlices.value.map((slice) => slice.mutations.length)));

function stripBarHeight(slice: WorldWorkbenchPreviewSlice): number {
    const count = slice.mutations.length;
    return Math.max(18, Math.round((count / maxPatchCount.value) * 100));
}

onMounted(() => {
    void loadViewConfig();
    void loadState();
});

defineExpose({refresh: async () => {
    await Promise.all([loadViewConfig(), loadState()]);
}});
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="world-state-overview">
        <!-- 时间控制条 -->
        <div class="flex shrink-0 flex-col gap-1.5 border-b border-[var(--we-border)] bg-[var(--we-bg-panel)] px-4 py-2">
            <div class="flex flex-wrap items-center gap-2">
                <span class="i-lucide-clock h-4 w-4 text-[var(--we-accent,var(--accent-main))]"></span>
                <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--we-border)] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-40" :disabled="selectedSliceIndex <= 0" title="上一切片" @click="selectSliceAt(selectedSliceIndex - 1)">
                    <span class="i-lucide-chevron-left h-4 w-4"></span>
                </button>
                <div class="flex min-w-0 items-center gap-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-canvas)] px-3 py-1">
                    <span v-if="selectedSlice" class="truncate font-mono text-[13px] text-[var(--we-text-main)]">{{ selectedSlice.time }}</span>
                    <span v-else class="text-[13px] text-[var(--we-text-muted)]">没有切片</span>
                    <span v-if="selectedSlice" class="hidden max-w-[240px] truncate text-[11px] text-[var(--we-text-muted)] md:inline">{{ selectedSlice.title }}</span>
                </div>
                <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--we-border)] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-40" :disabled="selectedSliceIndex < 0 || isLatest" title="下一切片" @click="selectSliceAt(selectedSliceIndex + 1)">
                    <span class="i-lucide-chevron-right h-4 w-4"></span>
                </button>
                <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors" :class="isLatest ? 'border-[var(--we-accent-border)] text-[var(--we-accent-strong,var(--we-accent))]' : 'border-[var(--we-border)] text-[var(--we-text-secondary)] hover:bg-[var(--we-bg-hover)]'" @click="selectLatest">
                    <span class="i-lucide-fast-forward h-3 w-3"></span>
                    最新
                </button>
                <span v-if="selectedSlice" class="font-mono text-[10px] text-[var(--we-text-muted)]">#{{ selectedSliceIndex + 1 }}/{{ orderedSlices.length }}</span>
                <div class="ml-auto flex items-center gap-2">
                    <button v-if="viewConfigIssues.length" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-2 text-[11px] text-[var(--we-warning)]" title="视图配置存在问题，已部分回退默认渲染" @click="viewConfigIssuesVisible = !viewConfigIssuesVisible">
                        <span class="i-lucide-triangle-alert h-3 w-3"></span>
                        配置 {{ viewConfigIssues.length }} 处问题
                    </button>
                    <div class="relative">
                        <span class="i-lucide-search pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--we-text-muted)]"></span>
                        <input v-model="subjectSearch" type="text" placeholder="搜索主体…" class="h-7 w-40 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-canvas)] pl-6 pr-2 text-[12px] text-[var(--we-text-main)] placeholder:text-[var(--we-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--we-accent-border)]" />
                    </div>
                </div>
            </div>
            <!-- 配置问题明细 -->
            <div v-if="viewConfigIssuesVisible && viewConfigIssues.length" class="rounded-md border border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-3 py-2 text-[11px] text-[var(--we-warning)]">
                <div v-for="issue in viewConfigIssues" :key="issue">· {{ issue }}</div>
            </div>
            <!-- 切片分布条 -->
            <div v-if="orderedSlices.length" class="flex h-8 items-end gap-px overflow-x-auto pb-0.5" data-testid="state-overview-distribution">
                <button
                    v-for="(slice, index) in orderedSlices"
                    :key="slice.id"
                    type="button"
                    class="group relative w-2 shrink-0 rounded-sm transition-colors"
                    :class="selectedSlice?.id === slice.id ? 'bg-[var(--we-accent,var(--accent-main))]' : 'bg-[var(--we-border)] hover:bg-[var(--we-text-muted)]'"
                    :style="{height: `${stripBarHeight(slice)}%`}"
                    :title="`${slice.time} · ${slice.title || '(无标题)'} · ${slice.mutations.length} patches`"
                    @click="selectSliceAt(index)"
                ></button>
            </div>
        </div>

        <!-- 主体分类内容 -->
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3 custom-scrollbar">
            <div v-if="stateError" class="mb-3 rounded-md border border-[var(--we-danger-border)] bg-[var(--we-danger-soft)] px-3 py-2 text-[12px] text-[var(--we-danger)]">{{ stateError }}</div>
            <div v-if="!orderedSlices.length" class="flex h-full items-center justify-center text-center text-[13px] text-[var(--we-text-muted)]">还没有任何切片记录。先在「切片编辑」视图创建 subject 与切片。</div>
            <div v-else-if="stateLoading && !stateResult" class="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--we-text-muted)]">
                <span class="i-lucide-loader-2 h-4 w-4 animate-spin"></span>
                推算世界状态…
            </div>
            <template v-else>
                <section v-for="group in typeGroups" :key="group.type" class="mb-4">
                    <button type="button" class="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--we-bg-hover)]" @click="toggleType(group.type)">
                        <span :class="`i-lucide-${group.icon}`" class="h-4 w-4 text-[var(--we-accent,var(--accent-main))]"></span>
                        <span class="text-[13px] font-semibold text-[var(--we-text-main)]">{{ group.label }}</span>
                        <span class="rounded bg-[var(--we-bg-panel)] px-1.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ group.subjects.length }}</span>
                        <span :class="collapsedTypes.has(group.type) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="ml-auto h-3.5 w-3.5 text-[var(--we-text-muted)]"></span>
                    </button>
                    <div v-if="!collapsedTypes.has(group.type)" class="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                        <WorldEngineStateOverviewCard
                            v-for="subject in group.subjects"
                            :key="subject.id"
                            :subject="subject"
                            :state="stateBySubjectId.get(subject.id)"
                            :schema-type="schemaTypeMap.get(subject.type)"
                            :type-config="viewConfig.types[subject.type]"
                            :subjects="props.subjects"
                            :subject-name-map="subjectNameMap"
                            :staged-edits="stagedEdits"
                            :readonly="props.busy || saving"
                            @stage="stageEdit"
                            @unstage="unstageEdit"
                            @show-history="historySubjectId = $event"
                        />
                    </div>
                </section>
                <div v-if="!typeGroups.length" class="py-8 text-center text-[13px] text-[var(--we-text-muted)]">没有匹配的主体</div>
            </template>
        </div>

        <!-- 编辑暂存条 -->
        <div v-if="stagedList.length" class="flex shrink-0 items-center gap-3 border-t border-[var(--we-warning-border)] bg-[var(--we-warning-soft)] px-4 py-2" data-testid="state-overview-staging-bar">
            <span class="i-lucide-pencil-line h-4 w-4 shrink-0 text-[var(--we-warning)]"></span>
            <div class="min-w-0 flex-1 truncate text-[12px] text-[var(--we-text-main)]">
                <span class="font-semibold text-[var(--we-warning)]">{{ stagedList.length }} 处修改待写入</span>
                <span class="ml-2 text-[var(--we-text-muted)]">{{ stagedList.slice(0, 3).map((edit) => `${edit.subjectName}·${edit.attrLabel}`).join("，") }}<template v-if="stagedList.length > 3"> 等</template></span>
            </div>
            <button type="button" class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--we-border)] px-3 text-[12px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)]" :disabled="saving" @click="discardStaged">放弃</button>
            <button type="button" class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--we-warning-border)] bg-[var(--we-bg-panel)] px-3 text-[12px] font-medium text-[var(--we-warning)] transition-colors hover:bg-[var(--we-bg-hover)] disabled:opacity-50" :disabled="saving || !selectedSlice" data-testid="state-overview-save" @click="void saveStaged()">
                <span :class="saving ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-save'" class="h-3.5 w-3.5"></span>
                写入到「{{ selectedSlice?.time }}」切片
            </button>
        </div>

        <!-- 变更历史侧栏 -->
        <Teleport to="body" :disabled="true">
            <div v-if="historySubjectId" class="absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col border-l border-[var(--we-border)] bg-[var(--we-bg-panel)] shadow-2xl" data-testid="state-overview-history">
                <div class="flex h-11 shrink-0 items-center justify-between border-b border-[var(--we-border)] px-3">
                    <div class="flex min-w-0 items-center gap-2">
                        <span class="i-lucide-history h-4 w-4 text-[var(--we-accent,var(--accent-main))]"></span>
                        <span class="truncate text-[13px] font-semibold text-[var(--we-text-main)]">{{ historySubjectName }} 的变更历史</span>
                        <span class="rounded bg-[var(--we-bg-canvas)] px-1.5 font-mono text-[10px] text-[var(--we-text-muted)]">{{ historyEntries.length }}</span>
                    </div>
                    <button type="button" class="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--we-text-muted)] hover:bg-[var(--we-bg-hover)]" @click="historySubjectId = null">
                        <span class="i-lucide-x h-4 w-4"></span>
                    </button>
                </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
                    <div v-if="!historyEntries.length" class="py-8 text-center text-[12px] text-[var(--we-text-muted)]">没有涉及该主体的切片</div>
                    <div v-for="entry in historyEntries" :key="entry.slice.id" class="mb-2 rounded-md border border-[var(--we-border)] bg-[var(--we-bg-canvas)] p-2">
                        <div class="flex items-center justify-between gap-2">
                            <span class="min-w-0 truncate font-mono text-[11px] text-[var(--we-text-main)]">{{ entry.slice.time }}</span>
                            <button type="button" class="shrink-0 rounded border border-[var(--we-border)] px-1.5 py-0.5 text-[10px] text-[var(--we-text-secondary)] transition-colors hover:bg-[var(--we-bg-hover)]" title="在切片编辑视图中打开" @click="emit('openSlice', entry.slice.id)">编辑</button>
                        </div>
                        <div class="mt-0.5 truncate text-[11px] text-[var(--we-text-muted)]">{{ entry.slice.title || "(无标题)" }}</div>
                        <div class="mt-1.5 flex flex-col gap-1">
                            <div v-for="(patch, index) in entry.patches" :key="`${entry.slice.id}:${index}`" class="flex items-center gap-1.5 text-[11px]">
                                <span class="rounded bg-[var(--we-bg-panel)] px-1 font-mono text-[9px] uppercase text-[var(--we-text-muted)]">{{ patch.op }}</span>
                                <span class="font-mono text-[var(--we-text-secondary)]">{{ patch.path }}</span>
                                <span v-if="patch.value !== undefined" class="min-w-0 truncate font-mono text-[var(--we-text-main)]">= {{ typeof patch.value === "object" ? JSON.stringify(patch.value) : String(patch.value) }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>
