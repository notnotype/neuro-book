<script setup lang="ts">
import {computed, ref} from "vue";
import type {WorldSliceDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";

const props = defineProps<{
    slices: WorldSliceDto[];
    selectedSliceId: string;
    selectedSubjectId: string;
    loading: boolean;
    actionBusy: boolean;
    schemaLoaded: boolean;
}>();

const emit = defineEmits<{
    (e: "select-slice", sliceId: string): void;
    (e: "edit-slice", sliceId: string): void;
}>();

const timelineOnlySelectedSubject = ref(false);
const timelineSearchText = ref("");

const totalMutationCount = computed(() => props.slices.reduce((sum, slice) => sum + (slice.patches?.length ?? 0), 0));
const totalIssueCount = computed(() => props.slices.reduce((sum, slice) => sum + (slice.issues?.length ?? 0), 0));
const visibleSlices = computed<WorldSliceDto[]>(() => {
    const keyword = timelineSearchText.value.trim().toLowerCase();
    return props.slices.filter((slice) => {
        if (timelineOnlySelectedSubject.value && props.selectedSubjectId && !(slice.patches ?? []).some((mutation) => mutation.subjectId === props.selectedSubjectId)) {
            return false;
        }
        if (!keyword) {
            return true;
        }
        return timelineSliceSearchText(slice).includes(keyword);
    });
});
const visibleMutationCount = computed(() => visibleSlices.value.reduce((sum, slice) => sum + (slice.patches?.length ?? 0), 0));
const timelineEmptyText = computed(() => {
    if (!props.slices.length) {
        return "暂无 slice。可以先新建 Slice。";
    }
    if (timelineSearchText.value.trim()) {
        return "没有匹配当前搜索条件的 slice。";
    }
    return "当前 subject 暂无相关 slice。";
});

/** 把 timeline slice 压成可搜索文本，覆盖事件元信息和 mutation 关键字段。 */
function timelineSliceSearchText(slice: WorldSliceDto): string {
    const mutationText = (slice.patches ?? []).map((mutation) => {
        const value = "value" in mutation ? mutation.value : "";
        return [mutation.subjectId, mutation.path, mutation.op, typeof value === "string" ? value : JSON.stringify(value), mutation.summary ?? ""].join(" ");
    }).join(" ");
    return [slice.id, slice.time, slice.title, slice.summary, slice.kind, mutationText].join(" ").toLowerCase();
}
</script>

<template>
    <!-- Timeline 列表与过滤工具 -->
    <section class="p-5">
        <div class="mb-4 flex items-center justify-between gap-3">
            <div>
                <h2 class="m-0 text-[18px] font-semibold text-[var(--text-main)]">Timeline</h2>
                <p class="m-0 mt-1 text-[12px] text-[var(--text-muted)]">{{ visibleSlices.length }} / {{ slices.length }} slices · {{ visibleMutationCount }} / {{ totalMutationCount }} mutations · {{ totalIssueCount }} issues</p>
            </div>
            <div class="flex items-center gap-2">
                <label class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                    <input v-model="timelineOnlySelectedSubject" type="checkbox" class="h-4 w-4 accent-[var(--accent-main)]" :disabled="!selectedSubjectId">
                    <span class="i-lucide-filter h-4 w-4"></span>
                    当前 subject
                </label>
            </div>
        </div>
        <div class="mb-4 flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3">
            <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
            <input v-model="timelineSearchText" class="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]" placeholder="搜索 title / time / summary / mutation">
            <button v-if="timelineSearchText" type="button" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="清空搜索" @click="timelineSearchText = ''">
                <span class="i-lucide-x h-3.5 w-3.5"></span>
            </button>
        </div>
        <div class="space-y-3">
            <div v-for="slice in visibleSlices" :key="slice.id" role="button" tabindex="0" class="w-full rounded-md border p-4 text-left transition-colors" :class="selectedSliceId === slice.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)]'" @click="emit('select-slice', slice.id)" @keydown.enter="emit('select-slice', slice.id)">
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <div class="truncate text-[14px] font-semibold text-[var(--text-main)]">{{ slice.title || slice.id }}</div>
                        <div class="mt-1 text-[12px] text-[var(--text-muted)]">{{ slice.time }} · {{ slice.kind }}</div>
                        <div v-if="slice.summary" class="mt-2 line-clamp-2 text-[12px] text-[var(--text-secondary)]">{{ slice.summary }}</div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        <span v-if="slice.issues?.length" class="inline-flex items-center gap-1 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 py-1 text-[11px] text-[var(--status-warning)]">
                            <span class="i-lucide-triangle-alert h-3.5 w-3.5"></span>
                            {{ slice.issues.length }}
                        </span>
                        <span class="rounded-md bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-muted)]">{{ slice.patches?.length ?? 0 }} patches</span>
                        <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="编辑 slice" aria-label="编辑 slice" @click.stop="emit('edit-slice', slice.id)">
                            <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                            编辑
                        </button>
                    </div>
                </div>
            </div>
            <div v-if="!visibleSlices.length" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-12 text-center text-[13px] text-[var(--text-muted)]">{{ timelineEmptyText }}</div>
        </div>
    </section>
</template>
