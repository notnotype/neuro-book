<script setup lang="ts">
import {computed} from "vue";
import type {
    WorldSliceDto,
    WorldSlicePatchDto,
} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    selectedSlice: WorldSliceDto | null;
    selectedSubjectId: string;
    actionBusy: boolean;
}>();

const emit = defineEmits<{
    (e: "select-subject", subjectId: string): void;
    (e: "query-at-slice"): void;
    (e: "query-slice-subjects"): void;
    (e: "delete-slice"): void;
}>();

const selectedSlicePatches = computed(() => props.selectedSlice?.patches ?? []);
const selectedSliceSubjectIds = computed<string[]>(() => Array.from(new Set(selectedSlicePatches.value.map((patch) => patch.subjectId))).filter(Boolean));
const selectedSliceJson = computed(() => JSON.stringify(selectedSlicePatches.value, null, 2));

/** 将 mutation value 压成单行，方便在检查器列表中快速扫描。 */
function formatMutationValue(mutation: WorldSlicePatchDto): string {
    if (!("value" in mutation)) {
        return "";
    }
    return typeof mutation.value === "string" ? mutation.value : JSON.stringify(mutation.value);
}
</script>

<template>
    <!-- Selected Slice 检查器 -->
    <div>
        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Selected Slice</div>
        <div v-if="selectedSlice" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ selectedSlice.title || selectedSlice.id }}</div>
                    <div class="mt-1 text-[12px] text-[var(--text-muted)]">{{ selectedSlice.time }} · {{ selectedSlice.kind }}</div>
                </div>
                <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] disabled:opacity-50" :disabled="actionBusy" title="删除 slice" aria-label="删除 slice" @click="emit('delete-slice')">
                    <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-trash-2'" class="h-3.5 w-3.5"></span>
                    删除
                </button>
            </div>
            <div v-if="selectedSlice.issues?.length" class="mt-3 space-y-1.5">
                <div class="inline-flex items-center gap-1 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[11px] font-medium text-[var(--status-warning)]">
                    <span class="i-lucide-triangle-alert h-3.5 w-3.5"></span>
                    {{ selectedSlice.issues.length }} issues
                </div>
                <div v-for="issue in selectedSlice.issues" :key="`selected-slice-issue:${issue.code}:${issue.subjectId}:${issue.attr}:${issue.message}`" class="rounded border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
                    <span class="font-mono text-[var(--status-warning)]">{{ issue.code }}</span>
                    <span class="mx-1 text-[var(--text-muted)]">·</span>
                    <span class="font-mono">{{ issue.subjectId }}.{{ issue.attr }}</span>
                    <div class="mt-0.5 text-[var(--text-main)]">{{ issue.message }}</div>
                </div>
            </div>
            <div v-if="selectedSliceSubjectIds.length" class="mt-3 flex flex-wrap gap-1">
                <button v-for="subjectId in selectedSliceSubjectIds" :key="`slice-subject:${selectedSlice.id}:${subjectId}`" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :class="selectedSubjectId === subjectId ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-main)]' : ''" @click="emit('select-subject', subjectId)">
                    <span class="i-lucide-user-round h-3.5 w-3.5"></span>
                    {{ subjectId }}
                </button>
            </div>
            <button type="button" class="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!selectedSubjectId || actionBusy" @click="emit('query-at-slice')">
                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-search'" class="h-4 w-4"></span>
                查询此时状态
            </button>
            <button type="button" class="mt-2 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!selectedSlicePatches.length || actionBusy" @click="emit('query-slice-subjects')">
                <span :class="actionBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-users-round'" class="h-4 w-4"></span>
                查询切面主体
            </button>
            <div v-for="mutation in selectedSlicePatches" :key="`${selectedSlice.id}:${mutation.subjectId}:${mutation.path}:${mutation.op}:${formatMutationValue(mutation)}`" class="mt-2 rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                {{ mutation.subjectId }} · {{ mutation.path }} · {{ mutation.op }} <span v-if="'value' in mutation">= {{ formatMutationValue(mutation) }}</span>
            </div>
            <pre class="mt-3 max-h-40 overflow-auto rounded bg-[var(--bg-panel)] p-2 text-[11px] leading-5 text-[var(--text-main)]">{{ selectedSliceJson }}</pre>
        </div>
        <div v-else class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 text-[12px] text-[var(--text-muted)]">未选择 slice</div>
    </div>
</template>
