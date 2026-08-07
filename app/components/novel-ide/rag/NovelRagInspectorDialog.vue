<script setup lang="ts">
import {computed, ref, watch} from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import NovelRagInspectorDetail from "nbook/app/components/novel-ide/rag/NovelRagInspectorDetail.vue";
import NovelRagInspectorMain from "nbook/app/components/novel-ide/rag/NovelRagInspectorMain.vue";
import NovelRagInspectorSidebar from "nbook/app/components/novel-ide/rag/NovelRagInspectorSidebar.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    ProjectRagDebugRequestDto,
    ProjectRagDebugResultDto,
    ProjectRagInspectorDto,
    ProjectRagSearchResultDto,
} from "nbook/shared/dto/project-rag.dto";
import type {
    RagInspectorChunk,
    RagInspectorDebugAction,
    RagInspectorDetailSelection,
    RagInspectorLimit,
    RagInspectorMainMode,
    RagInspectorSearchCandidate,
    RagInspectorSourceFilter,
} from "nbook/app/components/novel-ide/rag/rag-inspector-workbench.types";

const props = defineProps<{
    modelValue: boolean;
    projectRoot: string | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const notification = useNotification();
const mode = ref<RagInspectorMainMode>("chunks");
const inspector = ref<ProjectRagInspectorDto | null>(null);
const loading = ref(false);
const actionBusy = ref(false);
const error = ref("");
const selectedSubjectPath = ref("");
const selectedChunkId = ref<number | null>(null);
const selectedSearchKey = ref("");
const detailSelection = ref<RagInspectorDetailSelection>({kind: "overview"});
const sourceFilter = ref<RagInspectorSourceFilter[]>(["events", "memory"]);
const chunkLimit = ref<RagInspectorLimit>(200);
const searchQuery = ref("");
const searching = ref(false);
const searchError = ref("");
const searchResult = ref<ProjectRagSearchResultDto | null>(null);
const confirmOpen = ref(false);
const pendingAction = ref<{action: RagInspectorDebugAction; label: string} | null>(null);

const subjects = computed(() => inspector.value?.subjects ?? []);
const selectedSubject = computed(() => subjects.value.find((subject) => subject.subjectPath === selectedSubjectPath.value) ?? null);
const selectedChunks = computed(() => inspector.value?.selectedSubject?.chunks ?? []);
const chunkSourceCounts = computed(() => inspector.value?.selectedSubject?.chunkSourceCounts ?? {events: 0, memory: 0});
const totalEvents = computed(() => subjects.value.reduce((sum, subject) => sum + subject.eventCount, 0));
const totalMemories = computed(() => subjects.value.reduce((sum, subject) => sum + subject.memoryCount, 0));
const indexStatus = computed(() => {
    if (inspector.value?.index.readError) return "读取失败";
    if (!inspector.value?.index.dbExists) return "无缓存";
    if (inspector.value.index.schemaVersion && inspector.value.index.schemaVersion !== "subject-rag-v3") return "需重建索引";
    if (inspector.value.index.metaMatchesEffectiveConfig === false) return "配置已变化";
    if (subjects.value.some((subject) => subject.sourceStatuses.some((status) => status.status === "dirty"))) return "有修改待索引";
    if (subjects.value.some((subject) => subject.sourceStatuses.some((status) => status.status === "error"))) return "索引失败";
    return "可用";
});
const statusToneClass = computed(() => {
    if (indexStatus.value === "可用") return "bg-[var(--status-success)]";
    if (indexStatus.value === "读取失败" || indexStatus.value === "索引失败") return "bg-[var(--status-danger)]";
    return "bg-[var(--status-warning)]";
});

/**
 * RAG API 的 Project query。
 */
function projectQuery(): {projectRoot: string} {
    if (!props.projectRoot) {
        throw new Error("当前没有 Project Workspace");
    }
    return {projectRoot: props.projectRoot};
}

/**
 * 读取 Inspector 快照。
 */
async function loadInspector(subjectPath = selectedSubjectPath.value): Promise<void> {
    if (!props.modelValue || !props.projectRoot) {
        inspector.value = null;
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        const next = await $fetch<ProjectRagInspectorDto>("/api/projects/rag/inspector", {
            query: {
                ...projectQuery(),
                ...(subjectPath ? {subjectPath} : {}),
                sources: sourceFilter.value.join(","),
                limit: chunkLimit.value,
            },
        });
        inspector.value = next;
        selectedSubjectPath.value = next.selectedSubjectPath ?? "";
        clearSelection();
        searchResult.value = null;
        searchError.value = "";
    } catch (loadError) {
        inspector.value = null;
        selectedSubjectPath.value = "";
        clearSelection();
        searchResult.value = null;
        searchError.value = "";
        error.value = resolveApiErrorMessage(loadError, "读取 RAG Inspector 失败");
    } finally {
        loading.value = false;
    }
}

/**
 * 切换当前 subject，并清空当前详情选择。
 */
function selectSubject(subjectPath: string): void {
    if (selectedSubjectPath.value === subjectPath) {
        return;
    }
    selectedSubjectPath.value = subjectPath;
    void loadInspector(subjectPath);
}

/**
 * 切换 source 过滤，至少保留一个 source。
 */
function toggleSource(source: RagInspectorSourceFilter): void {
    if (sourceFilter.value.includes(source) && sourceFilter.value.length > 1) {
        sourceFilter.value = sourceFilter.value.filter((item) => item !== source);
    } else if (!sourceFilter.value.includes(source)) {
        sourceFilter.value = [...sourceFilter.value, source];
    }
    clearSelection();
    searchResult.value = null;
    void loadInspector();
}

/**
 * 更新 chunk 读取上限。
 */
function updateLimit(value: RagInspectorLimit): void {
    chunkLimit.value = value;
    clearSelection();
    void loadInspector();
}

/**
 * 选择 chunk 并在右侧展示向量元数据。
 */
function selectChunk(chunk: RagInspectorChunk): void {
    selectedChunkId.value = chunk.id;
    selectedSearchKey.value = "";
    detailSelection.value = {kind: "chunk", chunk};
}

/**
 * 选择 RAG search 候选。
 */
function selectSearchCandidate(candidate: RagInspectorSearchCandidate): void {
    selectedChunkId.value = null;
    selectedSearchKey.value = searchKey(candidate);
    detailSelection.value = {kind: "search", candidate};
}

/**
 * 清空右侧详情选择。
 */
function clearSelection(): void {
    selectedChunkId.value = null;
    selectedSearchKey.value = "";
    detailSelection.value = {kind: "overview"};
}

/**
 * 生成 search result 的稳定选择 key。
 */
function searchKey(candidate: RagInspectorSearchCandidate): string {
    return `${candidate.rank}:${candidate.source}:${candidate.sourcePath}:${candidate.text}`;
}

/**
 * 通过真实 RAG search API 检索当前 subject。
 */
async function searchRag(): Promise<void> {
    if (!searchQuery.value.trim() || !selectedSubjectPath.value) {
        return;
    }
    searching.value = true;
    searchError.value = "";
    mode.value = "search";
    try {
        searchResult.value = await $fetch<ProjectRagSearchResultDto>("/api/projects/rag/search", {
            method: "POST",
            query: projectQuery(),
            body: {
                subjectPath: selectedSubjectPath.value,
                query: searchQuery.value.trim(),
                sources: sourceFilter.value,
                limit: 10,
            },
        });
        clearSelection();
    } catch (searchFailure) {
        searchResult.value = null;
        searchError.value = resolveApiErrorMessage(searchFailure, "RAG 搜索失败");
    } finally {
        searching.value = false;
    }
}

/**
 * 打开 Debug 操作二次确认。
 */
function queueDebug(action: RagInspectorDebugAction, label: string): void {
    pendingAction.value = {action, label};
    confirmOpen.value = true;
}

/**
 * 执行 Debug 操作并刷新 Inspector。
 */
async function confirmDebugAction(): Promise<void> {
    const target = pendingAction.value;
    if (!target) {
        return;
    }
    actionBusy.value = true;
    try {
        const body = toDebugRequest(target.action);
        const result = await $fetch<ProjectRagDebugResultDto>("/api/projects/rag/debug", {
            method: "POST",
            query: projectQuery(),
            body,
        });
        notification.success(result.message);
        confirmOpen.value = false;
        pendingAction.value = null;
        await loadInspector();
    } catch (debugError) {
        notification.error(resolveApiErrorMessage(debugError, "RAG debug 操作失败"));
    } finally {
        actionBusy.value = false;
    }
}

/**
 * 生成 Debug API request body。
 */
function toDebugRequest(action: RagInspectorDebugAction): ProjectRagDebugRequestDto {
    if (action === "mark-dirty") {
        return {
            action,
            ...(selectedSubjectPath.value ? {subjectPath: selectedSubjectPath.value} : {}),
            sources: sourceFilter.value,
        };
    }
    if (action === "delete-subject-index") {
        return {
            action,
            subjectPath: selectedSubjectPath.value,
        };
    }
    if (action === "clear-index-cache-and-rebuild") {
        return {
            action,
            ...(selectedSubjectPath.value ? {subjectPath: selectedSubjectPath.value} : {}),
        };
    }
    return {action};
}

watch(() => props.modelValue, (open) => {
    if (open) {
        void loadInspector();
    }
});

watch(() => props.projectRoot, () => {
    selectedSubjectPath.value = "";
    inspector.value = null;
    clearSelection();
    if (props.modelValue) {
        void loadInspector("");
    }
});
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="full"
        overlay-type="opaque"
        :close-on-overlay="false"
        :show-footer="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <template #header>
            <!-- RAG Workbench 顶部栏 -->
            <div class="flex min-w-0 flex-1 items-center gap-3">
                <span class="rag-workbench-accent-icon">
                    <span class="i-lucide-brain-circuit h-4 w-4"></span>
                </span>
                <span class="text-[16px] font-semibold text-[var(--text-main)]">RAG 检查器</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">Project</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] md:inline">›</span>
                <span class="hidden max-w-[260px] truncate text-[13px] text-[var(--text-secondary)] md:inline">{{ props.projectRoot || "未选择 Project" }}</span>
                <span class="hidden text-[13px] text-[var(--text-muted)] lg:inline">›</span>
                <span class="hidden max-w-[220px] truncate text-[13px] text-[var(--text-secondary)] lg:inline">{{ selectedSubject?.subjectId ?? "未选择 subject" }}</span>

                <span class="ml-auto hidden items-center gap-3 text-[11px] text-[var(--text-muted)] md:flex">
                    <span>{{ subjects.length }} 个 subject</span>
                    <span>{{ totalEvents }} 条经历</span>
                    <span>{{ totalMemories }} 条认知</span>
                    <span>{{ inspector?.index.chunkCount ?? 0 }} 个 chunk</span>
                    <span>{{ inspector?.embedding.model ?? "未配置 embedding" }} / {{ inspector?.embedding.dimensions ?? "?" }} 维</span>
                    <span class="inline-flex items-center gap-1">
                        <span class="h-2 w-2 rounded-full" :class="statusToneClass"></span>
                        {{ indexStatus }}
                    </span>
                </span>

                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" title="刷新 RAG Inspector" :disabled="loading" @click="void loadInspector()">
                    <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'" class="h-4 w-4"></span>
                </button>
                <button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:modelValue', false)">
                    <span class="i-lucide-x h-4 w-4"></span>
                </button>
            </div>
        </template>

        <!-- RAG Workbench 主体 -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--bg-main)_96%,white)]">
            <div v-if="error" class="shrink-0 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[12px] text-[var(--status-danger)]">{{ error }}</div>
            <div class="relative flex min-h-0 flex-1">
                <NovelRagInspectorSidebar
                    :project-root="props.projectRoot"
                    :subjects="subjects"
                    :selected-subject-path="selectedSubjectPath"
                    :loading="loading"
                    @select-subject="selectSubject"
                />
                <NovelRagInspectorMain
                    v-model:mode="mode"
                    v-model:search-query="searchQuery"
                    :chunks="selectedChunks"
                    :chunks-truncated="inspector?.selectedSubject?.chunksTruncated ?? false"
                    :selected-chunk-id="selectedChunkId"
                    :source-filter="sourceFilter"
                    :chunk-limit="chunkLimit"
                    :chunk-source-counts="chunkSourceCounts"
                    :searching="searching"
                    :search-error="searchError"
                    :search-result="searchResult"
                    :selected-search-key="selectedSearchKey"
                    :selected-subject-path="selectedSubjectPath"
                    :loading="loading"
                    @toggle-source="toggleSource"
                    @update-limit="updateLimit"
                    @search="void searchRag()"
                    @select-chunk="selectChunk"
                    @select-search="selectSearchCandidate"
                />
                <Transition name="rag-inspector">
                    <NovelRagInspectorDetail
                        :inspector="inspector"
                        :selected-subject="selectedSubject"
                        :selection="detailSelection"
                        :index-status="indexStatus"
                        :action-busy="actionBusy"
                        @debug="queueDebug"
                        @clear-selection="clearSelection"
                    />
                </Transition>
            </div>
        </div>

        <Dialog v-model="confirmOpen" title="确认 RAG Debug 操作" width="420px" show-cancel :busy="actionBusy" @confirm="confirmDebugAction">
            <div class="text-sm leading-6 text-[var(--text-secondary)]">
                确认执行「{{ pendingAction?.label }}」吗？该操作只影响 RAG 缓存或 dirty state，不会修改 events.jsonl / memory.jsonl。
            </div>
        </Dialog>
    </Dialog>
</template>

<style scoped>
.rag-workbench-accent-icon {
    display: flex;
    height: 1.75rem;
    width: 1.75rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    border: 1px solid color-mix(in srgb, var(--accent-main) 58%, var(--border-color));
    background: color-mix(in srgb, var(--accent-main) 18%, var(--bg-panel));
    color: var(--accent-text);
}

.rag-inspector-enter-active,
.rag-inspector-leave-active {
    transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.rag-inspector-enter-from,
.rag-inspector-leave-to {
    margin-right: -360px;
    transform: translateX(20px);
    opacity: 0;
}
</style>
