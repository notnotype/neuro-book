<script setup lang="ts">
import {useDraggable} from "@dnd-kit/vue";
import type {ProfileTemplateNodeType} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    type: ProfileTemplateNodeType;
    label: string;
    description: string;
    iconClass: string;
    itemClass: string;
}>();

const emit = defineEmits<{
    (e: "add", type: ProfileTemplateNodeType): void;
}>();

const elementRef = ref<HTMLElement | null>(null);

const {isDragging} = useDraggable({
    id: computed(() => `library-${props.type}`),
    type: "library-node",
    data: computed(() => ({
        kind: "library-node" as const,
        type: props.type,
    })),
    element: elementRef,
});
</script>

<template>
    <button
        ref="elementRef"
        type="button"
        class="library-component-item"
        :class="[props.itemClass, isDragging ? 'library-component-item-dragging' : '']"
        @click="emit('add', props.type)"
    >
        <span class="library-component-icon">
            <span :class="props.iconClass" class="h-3.5 w-3.5"></span>
        </span>
        <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-semibold text-[var(--text-main)]">{{ props.label }}</span>
            <span class="mt-1 block break-words text-[11px] leading-4 text-[var(--text-muted)]">{{ props.description }}</span>
        </span>
    </button>
</template>

<style scoped>
.library-component-item {
    --component-accent: var(--accent-main);
    --component-bg: color-mix(in srgb, var(--component-accent) 8%, var(--bg-panel));
    --component-bg-strong: color-mix(in srgb, var(--component-accent) 17%, var(--bg-panel));
    --component-border: color-mix(in srgb, var(--component-accent) 34%, var(--border-color));
    --component-icon-bg: color-mix(in srgb, var(--component-accent) 22%, var(--bg-panel));
    --component-icon-color: color-mix(in srgb, var(--component-accent) 80%, var(--text-main));
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: var(--component-bg, var(--bg-input));
    padding: 9px;
    text-align: left;
    transition: border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease, opacity 0.18s ease;
}

.library-component-item:hover {
    border-color: var(--component-accent, var(--accent-main));
    background: var(--component-bg-strong, var(--bg-panel));
    transform: translateY(-1px);
}

.library-component-icon {
    display: flex;
    height: 28px;
    width: 28px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--component-border, var(--border-color));
    border-radius: 7px;
    background: var(--component-icon-bg);
    color: var(--component-icon-color);
}

.library-component-item-dragging {
    opacity: 0.72;
    transform: translateY(-1px) scale(0.99);
}

.library-node-ProfilePrompt {
    --component-accent: var(--accent-main);
}

.library-node-System {
    --component-accent: #5f70a5;
}

.library-node-HistorySet {
    --component-accent: #3f7f72;
}

.library-node-ModelContext {
    --component-accent: #47799a;
}

.library-node-AppendingSet {
    --component-accent: #6f6aa8;
}

.library-node-Compaction,
.library-node-CompactionPrompt,
.library-node-CompactionSummaryPrefix {
    --component-accent: #7a7f4e;
}

.library-node-Message {
    --component-accent: #c2693c;
}

.library-node-ToolResult {
    --component-accent: #4b9272;
}

.library-node-Reminder {
    --component-accent: #b65f5b;
}

.library-node-Watch {
    --component-accent: #b1843e;
}

.library-node-If {
    --component-accent: #64895f;
}

.library-node-SystemReminder,
.library-node-LinkedAgentsReminder {
    --component-accent: #b65f5b;
}

.library-node-LinkedAgentsSummary {
    --component-accent: #4f8c8f;
}

.library-node-WorkspaceFocusReminder,
.library-node-ModeAvailabilityReminder {
    --component-accent: #b65f5b;
}

.library-node-TaskReminder,
.library-node-ModeReminder,
.library-node-ModeSlot {
    --component-accent: #8a639e;
}

.library-node-MentionedSkillsReminder {
    --component-accent: #b1843e;
}

.library-node-FileChangeNotice {
    --component-accent: #4f8c8f;
}

.library-node-ActivatedSkills {
    --component-accent: #8a639e;
}

.library-node-AgentCatalog {
    --component-accent: #4e7f9f;
}

.library-node-SkillCatalog {
    --component-accent: #5f70a5;
}

.library-node-SqlSchemaSummary {
    --component-accent: #4f8a8b;
}

.library-node-Import {
    --component-accent: #5c7f67;
}
</style>
