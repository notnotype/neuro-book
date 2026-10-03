<script setup lang="ts">
defineProps<{
    hasSelectedSlice: boolean;
    saving: boolean;
    busy: boolean;
    editingSliceId: string;
    hasDirtyDraft: boolean;
    pendingLoadSelectedSlice: boolean;
}>();

const emit = defineEmits<{
    (e: "load-selected-slice"): void;
    (e: "clear-edit-mode"): void;
    (e: "discard-draft-and-load-selected-slice"): void;
}>();
</script>

<template>
    <div class="mb-4 flex items-center justify-between gap-3">
        <div>
            <h2 class="m-0 text-[18px] font-semibold text-[var(--text-main)]">Edit Timeline</h2>
            <p class="m-0 mt-1 text-[12px] text-[var(--text-muted)]">写入新 slice，或整块替换当前选中的 slice。</p>
        </div>
        <div class="flex items-center gap-2">
            <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!hasSelectedSlice || saving || busy" @click="emit('load-selected-slice')">
                <span class="i-lucide-pencil h-4 w-4"></span>
                载入所选 Slice
            </button>
            <button v-if="editingSliceId" type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="saving || busy" @click="emit('clear-edit-mode')">
                <span class="i-lucide-file-plus-2 h-4 w-4"></span>
                新建模式
            </button>
        </div>
    </div>

    <div v-if="editingSliceId" class="mb-4 rounded-md border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
        当前将整块替换 slice：{{ editingSliceId }}
    </div>
    <div v-if="hasDirtyDraft" class="mb-4 flex items-center justify-between gap-3 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[12px] text-[var(--status-warning)]">
        <span>当前有未保存草稿，切换载入其他 slice 前会保留这份内容。</span>
        <button v-if="pendingLoadSelectedSlice" type="button" class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--status-warning-border)] px-2 text-[11px] hover:bg-[var(--status-warning-bg)] disabled:opacity-50" :disabled="saving || busy" @click="emit('discard-draft-and-load-selected-slice')">
            <span class="i-lucide-file-warning h-3.5 w-3.5"></span>
            放弃草稿并载入
        </button>
    </div>
</template>
