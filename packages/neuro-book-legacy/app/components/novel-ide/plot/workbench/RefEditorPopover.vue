<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { onClickOutside } from "@vueuse/core";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type { SelectOption } from "nbook/app/components/common/form/FormSelect.vue";
import type { WorkbenchManualRef } from "nbook/app/components/novel-ide/plot/workbench/plot-workbench.types";
import { useFloatingPanelLayout } from "nbook/app/composables/useFloatingPanelLayout";
import type { AgentTriggerMenuSection } from "nbook/app/components/novel-ide/agent/trigger-menu";

const props = defineProps<{
    refItem: WorkbenchManualRef;
    refRelationOptions: SelectOption[];
    refTargetOptions: SelectOption[];
    // 按 query 即时搜索候选(内容节点走 workspace 搜索器,覆盖静态列表截断之外的节点);为空表示宿主未提供,退回静态列表本地过滤。
    refTargetSearch?: (query: string) => SelectOption[];
    anchorElement: HTMLElement | null;
}>();

const emit = defineEmits<{
    (e: "update", patch: Partial<WorkbenchManualRef>): void;
    (e: "close"): void;
}>();

const panelRef = ref<HTMLDivElement | null>(null);
const searchQuery = ref("");

onClickOutside(panelRef, (e) => {
    if (props.anchorElement && props.anchorElement.contains(e.target as Node)) {
        return;
    }
    // Also ignore Combobox dropdown clicks
    if ((e.target as HTMLElement).closest('.n-combobox-dropdown')) {
        return;
    }
    emit("close");
});

const { panelStyle, resolvedDirection } = useFloatingPanelLayout({
    open: computed(() => true),
    anchorRef: computed(() => props.anchorElement),
    panelRef,
    direction: ref("auto"),
    maxHeight: 480, // Increased max height to accommodate list
    matchAnchorWidth: true,
});

const targetSections = computed<AgentTriggerMenuSection[]>(() => {
    const threadItems = [];
    const sceneItems = [];
    const lorebookItems = [];

    const query = searchQuery.value.trim().toLowerCase();
    // 优先走宿主的按需搜索(带 query 才能覆盖静态列表 maxResults 截断之外的内容节点);无搜索器时退回静态列表。
    // 宿主搜索器结果直接使用——其内部已支持路径/frontmatter id/拼音/子序列等高级匹配,
    // 本地再按 label/description 字面过滤会把这些有效结果二次丢弃;仅静态 fallback 才做本地字面过滤。
    const usingHostSearch = Boolean(props.refTargetSearch);
    const sourceOptions = props.refTargetSearch ? props.refTargetSearch(searchQuery.value) : props.refTargetOptions;

    for (const opt of sourceOptions) {
        const value = String(opt.value);
        if (!usingHostSearch) {
            const matchesQuery = !query || opt.label.toLowerCase().includes(query) || (opt.description && opt.description.toLowerCase().includes(query));
            if (!matchesQuery) continue;
        }
        
        const item = {
            id: value,
            label: opt.label,
            description: String(opt.description || value),
            iconClass: opt.iconClass || "i-lucide-bookmark"
        };
        
        if (value.startsWith("thread://")) threadItems.push(item);
        else if (value.startsWith("scene://")) sceneItems.push(item);
        else if (value.startsWith("lorebook/")) lorebookItems.push(item);
        else lorebookItems.push(item);
    }
    
    return [
        { id: "thread", title: "Thread", items: threadItems },
        { id: "scene", title: "Scene", items: sceneItems },
        { id: "lorebook", title: "Lorebook", items: lorebookItems }
    ].filter(s => s.items.length > 0);
});

// Since the popover combines target/relation/note, when clicking a target item we update immediately.
function updateTarget(targetId: string) {
    emit("update", { target: targetId });
    emit("close");
}

const noteTextareaRef = ref<HTMLTextAreaElement | null>(null);

function resizeTextarea() {
    const el = noteTextareaRef.value;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
}

function handleNoteInput(e: Event) {
    resizeTextarea();
}

watch(() => props.refItem.note, async () => {
    await nextTick();
    resizeTextarea();
});

onMounted(() => {
    resizeTextarea();
});

</script>

<template>
    <div
        ref="panelRef"
        class="absolute left-0 z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-2xl"
        :class="resolvedDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'"
        :style="panelStyle"
    >
        <!-- Top Bar -->
        <div class="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-sidebar)] px-3 py-2">
            <div class="flex items-center gap-2">
                <span class="font-mono text-[10px] font-bold tracking-wider text-[var(--accent-text)]">REF ATTRIBUTES</span>
            </div>
        </div>
        
        <!-- Properties (Notion Style) -->
        <div class="flex flex-col gap-0.5 p-1.5">
            <!-- Relation Property -->
            <div class="flex items-center gap-2 rounded-md px-2 transition-colors hover:bg-[var(--bg-hover)] ghost-form-select">
                <div class="flex w-16 shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span class="i-lucide-git-commit h-3.5 w-3.5"></span>
                    <span>关联</span>
                </div>
                <div class="flex-1">
                    <FormSelect
                        :model-value="props.refItem.relation"
                        :options="props.refRelationOptions"
                        placeholder="选择关联类型..."
                        @update:model-value="emit('update', {relation: $event})"
                    />
                </div>
            </div>
            
            <!-- Note Property -->
            <div class="flex items-start gap-2 rounded-md px-2 transition-colors hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)]">
                <div class="flex h-7 w-16 shrink-0 items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    <span class="i-lucide-file-text h-3.5 w-3.5"></span>
                    <span>备注</span>
                </div>
                <div class="flex-1 py-1">
                    <textarea
                        ref="noteTextareaRef"
                        class="w-full resize-none bg-transparent py-0.5 pl-2.5 text-[12px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]/60 overflow-hidden leading-relaxed block"
                        rows="1"
                        :value="props.refItem.note || ''"
                        placeholder="添加补充说明..."
                        @input="handleNoteInput"
                        @change="emit('update', {note: ($event.target as HTMLTextAreaElement).value || null})"
                        style="min-height: 20px;"
                    ></textarea>
                </div>
            </div>
        </div>

        <!-- Divider -->
        <div class="h-px bg-[var(--border-color)]"></div>

        <!-- Search Bar -->
        <div class="bg-[var(--bg-panel)] p-2 pb-1.5">
            <div class="relative flex items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] focus-within:border-[var(--accent-main)] focus-within:ring-1 focus-within:ring-[var(--accent-main)]/30">
                <span class="i-lucide-search absolute left-2 h-3.5 w-3.5 text-[var(--text-muted)]"></span>
                <input
                    v-model="searchQuery"
                    type="text"
                    class="w-full bg-transparent py-1.5 pl-7 pr-2 text-[11px] text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                    placeholder="搜索引用目标..."
                />
            </div>
        </div>

        <!-- Target List -->
        <div class="min-h-0 flex-1 overflow-y-auto p-1.5 custom-scrollbar">
            <template v-for="section in targetSections" :key="section.id">
                <div class="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {{ section.title }}
                </div>
                <button
                    v-for="item in section.items"
                    :key="item.id"
                    type="button"
                    class="mb-0.5 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors last:mb-0"
                    :class="item.id === props.refItem.target ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                    @mousedown.prevent="updateTarget(item.id)"
                >
                    <span class="mt-0.5 h-3.5 w-3.5 shrink-0" :class="item.id === props.refItem.target ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]'">
                        <span :class="item.iconClass" class="block h-full w-full"></span>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="flex items-center gap-2">
                            <span class="truncate text-[12px] font-medium">{{ item.label }}</span>
                        </span>
                        <span class="mt-0.5 block text-[10px] leading-4 text-[var(--text-muted)]">
                            {{ item.description }}
                        </span>
                    </span>
                </button>
            </template>
            <div v-if="targetSections.length === 0" class="py-6 text-center text-[11px] text-[var(--text-muted)]">
                没有找到匹配的目标
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Override FormSelect styles to make it completely borderless and seamless */
.ghost-form-select :deep(.relative > div.border) {
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    padding-left: 10px !important;
    padding-right: 0 !important;
}
.ghost-form-select :deep(.relative > div.border:hover) {
    background: transparent !important;
}
</style>
