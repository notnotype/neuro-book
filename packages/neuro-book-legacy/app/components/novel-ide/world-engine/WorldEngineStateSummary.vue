<script setup lang="ts">
import type {
    SubjectStateDto,
    WorldIssueDto,
    WorkbenchJsonValue,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

defineProps<{
    states: SubjectStateDto[];
    issues?: WorldIssueDto[];
}>();

/** 将 subject attrs 转成摘要行，便于模板稳定渲染。 */
function stateAttrEntries(subject: SubjectStateDto): Array<{name: string; value: string}> {
    return Object.entries(subject.attrs).map(([name, value]) => ({
        name,
        value: formatStateAttrValue(value),
    }));
}

/** 把 JSON 值压成单行展示，原始 JSON 仍由父组件保留。 */
function formatStateAttrValue(value: WorkbenchJsonValue): string {
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value);
}
</script>

<template>
    <!-- State Query 摘要列表 -->
    <div v-if="issues?.length" class="mb-4 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
        <div class="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[var(--status-warning)]">
            <span class="i-lucide-triangle-alert h-4 w-4"></span>
            Query 返回 {{ issues.length }} 个 issue
        </div>
        <div class="space-y-1.5">
            <div v-for="issue in issues" :key="`state-issue:${issue.code}:${issue.sliceId}:${issue.subjectId}:${issue.attr}:${issue.message}`" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                <span class="font-mono text-[var(--status-warning)]">{{ issue.code }}</span>
                <span class="mx-1 text-[var(--text-muted)]">·</span>
                <span class="font-mono">{{ issue.subjectId }}.{{ issue.attr }}</span>
                <span v-if="issue.sliceId" class="ml-1 text-[var(--text-muted)]">slice {{ issue.sliceId }}</span>
                <div class="mt-1 text-[var(--text-main)]">{{ issue.message }}</div>
            </div>
        </div>
    </div>
    <div v-if="states.length" class="mb-4 space-y-3">
        <div v-for="subject in states" :key="`state-summary:${subject.subjectId}`" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
            <div class="mb-2 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="truncate text-[13px] font-semibold text-[var(--text-main)]">{{ subject.subjectId }}</div>
                    <div class="text-[11px] text-[var(--text-muted)]">{{ subject.type }}</div>
                </div>
                <span class="shrink-0 rounded-md bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-muted)]">{{ Object.keys(subject.attrs).length }} attrs</span>
            </div>
            <div class="divide-y divide-[var(--border-color)] overflow-hidden rounded-md border border-[var(--border-color)]">
                <div v-for="attr in stateAttrEntries(subject)" :key="`state-summary:${subject.subjectId}:${attr.name}`" class="grid grid-cols-[128px_minmax(0,1fr)] gap-2 bg-[var(--bg-input)] px-2 py-1.5 text-[12px]">
                    <div class="truncate font-mono text-[var(--text-secondary)]">{{ attr.name }}</div>
                    <div class="truncate font-mono text-[var(--text-main)]" :title="attr.value">{{ attr.value }}</div>
                </div>
            </div>
        </div>
    </div>
</template>
