<script setup lang="ts">
import {computed} from "vue";
import type {ProjectRagSearchResultDto} from "nbook/shared/dto/project-rag.dto";
import type {
    RagInspectorChunk,
    RagInspectorLimit,
    RagInspectorMainMode,
    RagInspectorSearchCandidate,
    RagInspectorSourceFilter,
} from "nbook/app/components/novel-ide/rag/rag-inspector-workbench.types";

const props = defineProps<{
    mode: RagInspectorMainMode;
    chunks: RagInspectorChunk[];
    chunksTruncated: boolean;
    selectedChunkId: number | null;
    sourceFilter: RagInspectorSourceFilter[];
    chunkLimit: RagInspectorLimit;
    chunkSourceCounts: {events: number; memory: number};
    searchQuery: string;
    searching: boolean;
    searchError: string;
    searchResult: ProjectRagSearchResultDto | null;
    selectedSearchKey: string;
    selectedSubjectPath: string;
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "update:mode", value: RagInspectorMainMode): void;
    (e: "update:searchQuery", value: string): void;
    (e: "toggle-source", value: RagInspectorSourceFilter): void;
    (e: "update-limit", value: RagInspectorLimit): void;
    (e: "search"): void;
    (e: "select-chunk", value: RagInspectorChunk): void;
    (e: "select-search", value: RagInspectorSearchCandidate): void;
}>();

const limits = [100, 200, 500] as const;

const visibleChunkTotal = computed(() => {
    return props.sourceFilter.reduce((sum, source) => sum + props.chunkSourceCounts[source], 0);
});

/**
 * 生成 search result 的稳定选择 key。
 */
function searchKey(candidate: RagInspectorSearchCandidate): string {
    return `${candidate.rank}:${candidate.source}:${candidate.sourcePath}:${candidate.text}`;
}
</script>

<template>
    <!-- RAG Workbench 中央主区 -->
    <section class="flex min-w-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--bg-main)_96%,white)]">
        <nav class="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)]/88 px-4 text-[12px] font-medium shadow-sm">
            <div class="flex h-full items-center gap-8">
                <button type="button" class="relative inline-flex h-full items-center gap-2 transition-colors" :class="mode === 'chunks' ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'" @click="emit('update:mode', 'chunks')">
                    <span class="i-lucide-list-tree h-4 w-4"></span>
                    <span>索引条目</span>
                    <span class="rounded-sm bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ chunks.length }}</span>
                    <span v-if="mode === 'chunks'" class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-[var(--accent-main)]"></span>
                </button>
                <button type="button" class="relative inline-flex h-full items-center gap-2 transition-colors" :class="mode === 'search' ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]'" @click="emit('update:mode', 'search')">
                    <span class="i-lucide-search h-4 w-4"></span>
                    <span>召回测试</span>
                    <span v-if="mode === 'search'" class="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-[var(--accent-main)]"></span>
                </button>
            </div>

            <div class="flex items-center gap-1 text-[11px]">
                <button type="button" class="rounded-md border px-2 py-1" :class="sourceFilter.includes('events') ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="emit('toggle-source', 'events')">经历 {{ chunkSourceCounts.events }}</button>
                <button type="button" class="rounded-md border px-2 py-1" :class="sourceFilter.includes('memory') ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="emit('toggle-source', 'memory')">认知 {{ chunkSourceCounts.memory }}</button>
                <button v-for="limit in limits" :key="limit" type="button" class="rounded-md border px-2 py-1" :class="chunkLimit === limit ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'" @click="emit('update-limit', limit)">{{ limit }}</button>
            </div>
        </nav>

        <div class="min-h-0 flex-1 overflow-auto p-4">
            <div v-if="loading" class="py-12 text-center text-[12px] text-[var(--text-muted)]">正在加载 RAG Inspector...</div>

            <template v-else-if="mode === 'chunks'">
                <div v-if="chunksTruncated" class="mb-3 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[11px] text-[var(--status-warning)]">当前只显示前 {{ chunkLimit }} 条索引条目，可切换上限查看更多。</div>
                <div v-if="chunks.length === 0" class="mx-auto mt-20 max-w-[420px] rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 text-center">
                    <div class="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-[var(--bg-input)] text-[var(--text-muted)]">
                        <span class="i-lucide-database-x h-4 w-4"></span>
                    </div>
                    <div class="text-[13px] font-semibold text-[var(--text-main)]">当前筛选下没有可显示的索引条目</div>
                    <div class="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
                        <template v-if="visibleChunkTotal > 0">统计中有 {{ visibleChunkTotal }} 条缓存，但列表读取不到条目时，通常是旧版索引缓存缺少新 Inspector 字段。右侧执行“清空并重建”后会补齐条目级向量元数据。</template>
                        <template v-else>这个 subject 还没有对应 source 的 chunk 缓存。可以先执行一次 RAG 搜索，或在右侧重建当前 subject 索引。</template>
                    </div>
                </div>
                <button
                    v-for="chunk in chunks"
                    :key="chunk.id"
                    type="button"
                    class="mb-2 w-full rounded-md border p-3 text-left transition-colors"
                    :class="selectedChunkId === chunk.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('select-chunk', chunk)"
                >
                    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                        <span>#{{ chunk.id }} {{ chunk.source === "events" ? "经历" : "认知" }} · {{ chunk.sourceKey }} · 分片 {{ chunk.chunkIndex }}</span>
                        <span>{{ chunk.vector.embeddingModel ?? "需重建索引" }} / {{ chunk.vector.embeddingDimensions ?? "?" }} 维</span>
                    </div>
                    <div class="mb-2 flex flex-wrap gap-1 text-[10px]">
                        <span v-if="chunk.topic" class="rounded-sm bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-muted)]">{{ chunk.topic }}</span>
                        <span v-if="chunk.time" class="rounded-sm bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-muted)]">{{ chunk.time }}</span>
                        <span v-if="chunk.tick" class="rounded-sm bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-muted)]">{{ chunk.tick }}</span>
                        <span class="rounded-sm bg-[var(--bg-input)] px-1.5 py-0.5 text-[var(--text-muted)]">{{ chunk.contentHash.slice(0, 16) }}</span>
                    </div>
                    <div class="line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-main)]">{{ chunk.text }}</div>
                </button>
            </template>

            <template v-else>
                <div class="mb-3 flex gap-2">
                    <input :value="searchQuery" class="min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" placeholder="输入要测试召回的问题或关键词" @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)" @keydown.enter="emit('search')">
                    <button type="button" class="inline-flex items-center gap-1 rounded-md border border-[var(--border-color)] px-3 py-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="searching || !searchQuery.trim() || !selectedSubjectPath" @click="emit('search')">
                        <span :class="searching ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-search'" class="h-3.5 w-3.5"></span>
                        搜索
                    </button>
                </div>
                <div v-if="searchError" class="mb-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 text-[11px] text-[var(--status-danger)]">{{ searchError }}</div>
                <div v-if="searchResult && searchResult.candidates.length === 0" class="py-10 text-center text-[12px] text-[var(--text-muted)]">没有召回候选。</div>
                <button
                    v-for="candidate in searchResult?.candidates ?? []"
                    :key="searchKey(candidate)"
                    type="button"
                    class="mb-2 w-full rounded-md border p-3 text-left transition-colors"
                    :class="selectedSearchKey === searchKey(candidate) ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'"
                    @click="emit('select-search', candidate)"
                >
                    <div class="mb-1 text-[10px] text-[var(--text-muted)]">#{{ candidate.rank }} {{ candidate.source === "events" ? "经历" : "认知" }} <span v-if="candidate.topic"> · {{ candidate.topic }}</span></div>
                    <div class="line-clamp-4 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-main)]">{{ candidate.text }}</div>
                </button>
            </template>
        </div>
    </section>
</template>
