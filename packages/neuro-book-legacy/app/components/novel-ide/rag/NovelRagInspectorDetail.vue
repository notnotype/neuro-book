<script setup lang="ts">
import type {ProjectRagInspectorDto, ProjectRagSubjectSummaryDto} from "nbook/shared/dto/project-rag.dto";
import type {
    RagInspectorDebugAction,
    RagInspectorDetailSelection,
} from "nbook/app/components/novel-ide/rag/rag-inspector-workbench.types";

const props = defineProps<{
    inspector: ProjectRagInspectorDto | null;
    selectedSubject: ProjectRagSubjectSummaryDto | null;
    selection: RagInspectorDetailSelection;
    indexStatus: string;
    actionBusy: boolean;
}>();

const emit = defineEmits<{
    (e: "debug", action: RagInspectorDebugAction, label: string): void;
    (e: "clear-selection"): void;
}>();

/**
 * 格式化可能为空的值。
 */
function valueLabel(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") {
        return "无";
    }
    return String(value);
}

/**
 * 格式化旧索引缺少的条目级 embedding 元数据。
 */
function embeddingMetaLabel(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") {
        return "旧索引未记录";
    }
    return String(value);
}

/**
 * 格式化 source 类型。
 */
function sourceLabel(value: string): string {
    return value === "events" ? "经历" : "认知";
}
</script>

<template>
    <!-- RAG Workbench 右侧详情 Inspector -->
    <aside class="flex w-[360px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-panel)]">
        <div class="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3">
            <div>
                <div class="text-[12px] font-semibold text-[var(--text-main)]">检查器</div>
                <div class="text-[10px] text-[var(--text-muted)]">{{ selection.kind === "chunk" ? "条目与向量元数据" : selection.kind === "search" ? "召回候选详情" : "Project RAG 状态" }}</div>
            </div>
            <button v-if="selection.kind !== 'overview'" type="button" class="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="回到总览" @click="emit('clear-selection')">
                <span class="i-lucide-panel-right-close h-4 w-4"></span>
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-3">
            <div v-if="!inspector" class="py-10 text-center text-[12px] text-[var(--text-muted)]">暂无 Inspector 快照。</div>

            <template v-else-if="selection.kind === 'chunk'">
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">索引条目 #{{ selection.chunk.id }}</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>来源：{{ sourceLabel(selection.chunk.source) }}</div>
                        <div>来源键：{{ selection.chunk.sourceKey }}</div>
                        <div>分片序号：{{ selection.chunk.chunkIndex }}</div>
                        <div>主题：{{ valueLabel(selection.chunk.topic) }}</div>
                        <div>时间：{{ valueLabel(selection.chunk.time) }}</div>
                        <div>Tick：{{ valueLabel(selection.chunk.tick) }}</div>
                        <div>内容 Hash：{{ selection.chunk.contentHash }}</div>
                        <div>创建时间：{{ selection.chunk.createdAt }}</div>
                    </div>
                </div>
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">向量信息</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>向量缓存：{{ selection.chunk.vector.exists ? "存在" : "缺失" }}</div>
                        <div>Provider：{{ embeddingMetaLabel(selection.chunk.vector.embeddingProvider) }}</div>
                        <div>模型：{{ embeddingMetaLabel(selection.chunk.vector.embeddingModel) }}</div>
                        <div>记录维数：{{ embeddingMetaLabel(selection.chunk.vector.embeddingDimensions) }}</div>
                        <div>实际维数：{{ valueLabel(selection.chunk.vector.dimensions) }}</div>
                        <div>索引时间：{{ embeddingMetaLabel(selection.chunk.vector.embeddingIndexedAt) }}</div>
                    </div>
                    <div v-if="!selection.chunk.vector.embeddingModel" class="mt-2 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-2 text-[11px] leading-5 text-[var(--status-warning)]">这条缓存来自旧版索引，chunk 正文可以查看，但条目级 embedding 元数据需要重建索引后才会补齐。</div>
                    <div class="mt-2 rounded bg-[var(--bg-panel)] p-2 font-mono text-[11px] text-[var(--text-secondary)]">
                        向量预览（{{ selection.chunk.vector.previewDimensions }}/{{ selection.chunk.vector.dimensions ?? "?" }}）：[{{ selection.chunk.vector.preview.map((item) => Number(item).toFixed(4)).join(", ") }}]
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">正文</div>
                    <div class="whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]">{{ selection.chunk.text }}</div>
                </div>
            </template>

            <template v-else-if="selection.kind === 'search'">
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">召回候选 #{{ selection.candidate.rank }}</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>来源：{{ sourceLabel(selection.candidate.source) }}</div>
                        <div>来源路径：{{ selection.candidate.sourcePath }}</div>
                        <div>主题：{{ valueLabel(selection.candidate.topic) }}</div>
                        <div>时间：{{ valueLabel(selection.candidate.time) }}</div>
                        <div>Tick：{{ valueLabel(selection.candidate.tick) }}</div>
                    </div>
                </div>
                <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">正文</div>
                    <div class="whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]">{{ selection.candidate.text }}</div>
                </div>
            </template>

            <template v-else>
                <div v-if="inspector.index.readError" class="mb-3 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 text-[11px] text-[var(--status-danger)]">SQLite 读取失败：{{ inspector.index.readError }}</div>
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">当前嵌入配置</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>启用状态：{{ inspector.embedding.enabled ? "已启用" : "未启用" }}</div>
                        <div>Provider：{{ inspector.embedding.provider }}</div>
                        <div>模型：{{ valueLabel(inspector.embedding.model) }}</div>
                        <div>维数：{{ valueLabel(inspector.embedding.dimensions) }}</div>
                        <div>API Base：{{ inspector.embedding.baseURLLabel ?? (inspector.embedding.baseURLConfigured ? "已配置" : "未配置") }}</div>
                        <div>API Key：{{ inspector.embedding.apiKeyConfigured ? "已配置" : "未配置" }}</div>
                    </div>
                </div>
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">索引缓存</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>状态：{{ indexStatus }}</div>
                        <div>SQLite 缓存：{{ inspector.index.dbExists ? "存在" : "不存在" }}</div>
                        <div>Schema：{{ valueLabel(inspector.index.schemaVersion) }}</div>
                        <div>索引模型：{{ valueLabel(inspector.index.embeddingProvider) }} / {{ valueLabel(inspector.index.embeddingModel) }} / {{ valueLabel(inspector.index.embeddingDimensions) }} 维</div>
                        <div>匹配当前配置：{{ inspector.index.metaMatchesEffectiveConfig === null ? "未知" : inspector.index.metaMatchesEffectiveConfig ? "匹配" : "不匹配" }}</div>
                        <div>Source：{{ inspector.index.sourceCount }}</div>
                        <div>Chunk：{{ inspector.index.chunkCount }}</div>
                        <div>Vector：{{ inspector.index.vectorCount }}</div>
                    </div>
                </div>
                <div class="mb-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                    <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">当前 Subject</div>
                    <div class="space-y-1 text-[11px] text-[var(--text-secondary)]">
                        <div>Subject：{{ selectedSubject?.subjectId ?? "无" }}</div>
                        <div>经历事实：{{ selectedSubject?.eventCount ?? 0 }}</div>
                        <div>稳定认知：{{ selectedSubject?.memoryCount ?? 0 }}</div>
                        <div>已索引条目：{{ inspector.selectedSubject?.chunkSourceCounts.events ?? 0 }} 条经历 / {{ inspector.selectedSubject?.chunkSourceCounts.memory ?? 0 }} 条认知</div>
                    </div>
                </div>
            </template>
        </div>

        <div class="shrink-0 border-t border-[var(--border-color)] p-3">
            <div class="mb-2 text-[12px] font-semibold text-[var(--text-main)]">索引操作</div>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1.5 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="actionBusy || !inspector?.selectedSubjectPath" @click="emit('debug', 'mark-dirty', '标记当前 subject 待索引')">标记待索引</button>
                <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1.5 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="actionBusy || !inspector?.selectedSubjectPath" @click="emit('debug', 'delete-subject-index', '删除当前 subject 索引缓存')">删除本角色索引</button>
                <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1.5 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="actionBusy || !inspector?.selectedSubjectPath" @click="emit('debug', 'clear-index-cache-and-rebuild', '清空缓存并重建当前 subject')">清空并重建</button>
                <button type="button" class="rounded-md border border-[var(--status-danger-border)] px-2 py-1.5 text-[11px] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-50" :disabled="actionBusy" @click="emit('debug', 'clear-index-cache', '清空 Project RAG SQLite 缓存')">清空缓存</button>
            </div>
            <div class="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">这些操作只影响 RAG 缓存或 dirty state，不会修改 events.jsonl / memory.jsonl。</div>
        </div>
    </aside>
</template>
