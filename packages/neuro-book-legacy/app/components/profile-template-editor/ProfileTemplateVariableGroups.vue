<script setup lang="ts">
import type {PreviewVariableGroup} from "nbook/app/components/profile-template-editor/profile-template-editor-ui";

const props = defineProps<{
    groups: PreviewVariableGroup[];
    compact?: boolean;
    isCollapsed: (group: string) => boolean;
    formatValue: (value: unknown) => string;
}>();

const emit = defineEmits<{
    (e: "toggle-group", group: string): void;
}>();
</script>

<template>
    <!-- 变量分组：用于属性侧栏的变量和运行时变量页签 -->
    <section v-for="group in props.groups" :key="group.group" class="variable-group-section">
        <button class="variable-group-header" @click="emit('toggle-group', group.group)">
            <span :class="props.isCollapsed(group.group) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
            <span v-if="props.compact" class="i-lucide-braces h-3.5 w-3.5"></span>
            <span>{{ group.group }}</span>
            <span class="ml-auto text-[10px] text-[var(--text-muted)]">{{ group.items.length }}</span>
        </button>
        <div v-if="!props.isCollapsed(group.group)" class="mt-2 flex flex-wrap gap-2">
            <div v-for="item in group.items" :key="item.path" class="variable-chip" :title="item.description ?? item.path">
                <span>{{ item.path }}</span>
                <span v-if="!props.compact" class="variable-chip-value">{{ props.formatValue(item.currentValue) }}</span>
            </div>
        </div>
    </section>
</template>

<style scoped>
.variable-chip {
    display: inline-flex;
    max-width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    border: 1px solid color-mix(in srgb, var(--accent-main) 30%, var(--border-color));
    border-radius: 5px;
    background: var(--accent-bg);
    padding: 3px 7px;
    color: var(--accent-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
}

.variable-chip-value {
    max-width: 180px;
    overflow: hidden;
    color: var(--text-muted);
    font-family: inherit;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.variable-group-section {
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-input);
    padding: 8px;
}

.variable-group-header {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
    text-align: left;
}
</style>
