<script setup lang="ts">
import {computed} from "vue";
import type {SubjectStateDto} from "nbook/app/components/novel-ide/world-engine/world-engine-workbench.types";
import type {WorldPreviewSchemaType} from "nbook/app/utils/world-engine-preview";
import WorldEngineSubjectStateViewerRow from "nbook/app/components/novel-ide/world-engine/WorldEngineSubjectStateViewerRow.vue";

const props = defineProps<{
    subjectId: string;
    subjectName?: string;
    schemaType?: WorldPreviewSchemaType;
    state: SubjectStateDto;
    subjectNameMap?: Map<string, string>;
}>();

const rootEntries = computed(() => {
    if (!props.schemaType) return [];
    return props.schemaType.attrs.map(attr => ({
        attr,
        value: props.state.attrs[attr.name],
    }));
});
</script>

<template>
    <div class="flex flex-col overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)]">
        <!-- Header -->
        <div class="flex items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <span class="truncate text-[13px] font-semibold text-[var(--text-main)]">{{ props.subjectName || props.subjectId }}</span>
                    <span class="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ props.state.type }}</span>
                </div>
                <div v-if="props.subjectName && props.subjectName !== props.subjectId" class="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{{ props.subjectId }}</div>
            </div>
            <span class="shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">{{ rootEntries.length }} attrs</span>
        </div>
        
        <!-- Table Header -->
        <div class="flex items-center gap-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <div class="w-[180px] pl-7">属性 (Attr)</div>
            <div class="flex-1">当前值 (Value)</div>
            <div class="w-[180px]">描述 (Desc)</div>
            <div class="w-[64px] text-right pr-1">类型</div>
        </div>
        
        <!-- Body -->
        <div class="flex min-h-0 flex-1 flex-col divide-y divide-[var(--border-color)] overflow-y-auto custom-scrollbar">
            <div v-if="!props.schemaType" class="px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">缺少对应的 Schema 类型定义</div>
            <template v-else>
                <WorldEngineSubjectStateViewerRow
                    v-for="entry in rootEntries"
                    :key="entry.attr.name"
                    :attr="entry.attr"
                    :value="entry.value"
                    :depth="0"
                    :subject-name-map="props.subjectNameMap"
                />
            </template>
        </div>
    </div>
</template>
