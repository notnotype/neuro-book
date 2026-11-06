<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";
import {useAgentText} from "../host";

const props = withDefaults(defineProps<{
    actions?: Array<{id: string; icon: string; label: string}>;
    branch?: {index: number; total: number} | null;
    disabled?: boolean;
    /** 分支切换不可点（运行中），别的操作照常。 */
    branchDisabled?: boolean;
}>(), {
    actions: () => [],
    branch: null,
    disabled: false,
});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "branch", direction: "previous" | "next"): void;
}>();

const {t} = useAgentText();
</script>

<template>
    <div class="agent-message-actions">
        <div v-if="props.branch && props.branch.total > 1" class="agent-message-actions__branch">
            <IconButton
                icon-class="i-lucide-chevron-left"
                size="sm"
                :disabled="props.disabled || props.branchDisabled || props.branch.index <= 1"
                :title="t('messageAction.previousBranch')"
                :aria-label="t('messageAction.previousBranch')"
                @click="emit('branch', 'previous')"
            />
            <span class="agent-message-actions__branch-label">
                <span class="i-lucide-git-branch agent-message-actions__branch-icon" aria-hidden="true" />{{ props.branch.index }}/{{ props.branch.total }}
            </span>
            <IconButton
                icon-class="i-lucide-chevron-right"
                size="sm"
                :disabled="props.disabled || props.branchDisabled || props.branch.index >= props.branch.total"
                :title="t('messageAction.nextBranch')"
                :aria-label="t('messageAction.nextBranch')"
                @click="emit('branch', 'next')"
            />
        </div>
        <IconButton
            v-for="action in props.actions"
            :key="action.id"
            :icon-class="action.icon"
            size="sm"
            :disabled="props.disabled"
            :title="action.label"
            :aria-label="action.label"
            @click="emit('select', action.id)"
        />
    </div>
</template>

<style scoped>
.agent-message-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}

/* 分支切换装在一个描边小框里，和旁边的单个操作按钮区分开。 */
.agent-message-actions__branch {
    display: inline-flex;
    align-items: center;
    margin-right: 4px;
    border: var(--border-w, 1px) solid var(--border-color);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
}

.agent-message-actions__branch-label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 2px;
    color: var(--text-secondary);
    font-size: calc(var(--text-2xs) - 1px);
    font-variant-numeric: tabular-nums;
}

.agent-message-actions__branch-icon {
    width: 12px;
    height: 12px;
    color: var(--accent-text);
}
</style>
