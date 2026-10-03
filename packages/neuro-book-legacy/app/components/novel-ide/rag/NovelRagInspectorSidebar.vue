<script setup lang="ts">
import type {ProjectRagSubjectSummaryDto} from "nbook/shared/dto/project-rag.dto";

const props = defineProps<{
    projectRoot: string | null;
    subjects: ProjectRagSubjectSummaryDto[];
    selectedSubjectPath: string;
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: "select-subject", subjectPath: string): void;
}>();

/**
 * 生成 subject 行状态样式。
 */
function statusClass(subject: ProjectRagSubjectSummaryDto): string {
    if (subject.errors.length) return "text-[var(--status-danger)]";
    if (subject.sourceStatuses.some((status) => status.status === "dirty")) return "text-[var(--status-warning)]";
    if (subject.sourceStatuses.some((status) => status.status === "error")) return "text-[var(--status-danger)]";
    if (subject.sourceStatuses.some((status) => status.status === "synced")) return "text-[var(--status-success)]";
    return "text-[var(--text-muted)]";
}

/**
 * 生成 subject 行状态摘要。
 */
function statusLabel(subject: ProjectRagSubjectSummaryDto): string {
    if (subject.errors.length) return "JSONL 错误";
    if (subject.sourceStatuses.some((status) => status.status === "dirty")) return "待索引";
    if (subject.sourceStatuses.some((status) => status.status === "error")) return "索引错误";
    if (subject.sourceStatuses.some((status) => status.status === "synced")) return "已同步";
    return "未知";
}
</script>

<template>
    <!-- RAG Workbench subject 浏览栏 -->
    <aside class="flex w-[286px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-panel)]/92">
        <div class="flex h-12 shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3">
            <div>
                <div class="text-[12px] font-semibold text-[var(--text-main)]">Subject 列表</div>
                <div class="text-[10px] text-[var(--text-muted)]">共 {{ subjects.length }} 个</div>
            </div>
            <span :class="loading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-database'" class="h-4 w-4 text-[var(--text-muted)]"></span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-2">
            <div v-if="!props.projectRoot" class="py-10 text-center text-[12px] text-[var(--text-muted)]">当前没有 Project Workspace。</div>
            <div v-else-if="!loading && subjects.length === 0" class="py-10 text-center text-[12px] text-[var(--text-muted)]">当前 Project 暂无 subject RAG 数据。</div>
            <button
                v-for="subject in subjects"
                :key="subject.subjectPath"
                type="button"
                class="mb-1.5 w-full rounded-md border px-2.5 py-2 text-left transition-colors"
                :class="selectedSubjectPath === subject.subjectPath ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--text-main)]' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="emit('select-subject', subject.subjectPath)"
            >
                <div class="flex items-center justify-between gap-2">
                    <span class="truncate text-[12px] font-semibold">{{ subject.subjectId }}</span>
                    <span :class="statusClass(subject)" class="shrink-0 text-[10px]">{{ statusLabel(subject) }}</span>
                </div>
                <div class="mt-1 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                    <span>{{ subject.eventCount }} 条经历</span>
                    <span>·</span>
                    <span>{{ subject.memoryCount }} 条记忆</span>
                </div>
                <div v-if="subject.errors[0]" class="mt-1 truncate text-[10px] text-[var(--status-danger)]">{{ subject.errors[0].source }}: {{ subject.errors[0].message }}</div>
            </button>
        </div>
    </aside>
</template>
