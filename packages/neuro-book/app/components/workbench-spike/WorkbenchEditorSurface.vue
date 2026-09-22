<script setup lang="ts">
/**
 * 编辑器：标签条 + 空白页（标签与缓冲属编辑器会话，不是布局，因此不进快照）。
 */
import {ref} from "vue";

const EDITOR_TABS = [
    {id: "chapter-001.md", icon: "i-lucide-file-text"},
    {id: "outline.md", icon: "i-lucide-list-tree"},
];
const PROJECT_NAME = "NeuroBook 示例项目";

const editorTab = ref(EDITOR_TABS[0]!.id);
</script>

<template>
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
        <div class="flex shrink-0 items-stretch border-b-[length:var(--border-w)] border-[var(--divider)] bg-[var(--bg-subtle)]" role="tablist">
            <button
                v-for="tab in EDITOR_TABS"
                :key="tab.id"
                type="button"
                role="tab"
                class="nb-ui-focus-ring flex min-h-[var(--control-h-sm)] shrink-0 cursor-pointer items-center gap-[var(--space-2)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-xs)] transition-colors [transition-duration:var(--motion-fast)] hover:bg-[var(--bg-hover)]"
                :class="editorTab === tab.id ? 'bg-[var(--bg-panel)] text-[var(--text-main)]' : 'text-[var(--text-muted)]'"
                :aria-selected="editorTab === tab.id"
                :data-editor-tab="tab.id"
                @click="editorTab = tab.id"
            >
                <span :class="tab.icon" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
                <span class="truncate">{{ tab.id }}</span>
            </button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-3)] p-[var(--space-6)]">
            <p class="text-[length:var(--text-sm)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ PROJECT_NAME }}</p>
            <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">Ctrl+P 快速打开 · Ctrl+Shift+P 命令面板 · 标签与缓冲不进布局快照</p>
        </div>
    </div>
</template>
