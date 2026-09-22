<script setup lang="ts">
import {IconButton} from "@notnotype/nb-ui/components";
import AgentBranchSwitcher from "./AgentBranchSwitcher.vue";
import type {AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";

const props = withDefaults(defineProps<{
    canEdit?: boolean;
    canRetry?: boolean;
    isUnknownDelivery?: boolean;
    isContentOmitted?: boolean;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    branchSwitcher?: AgentMessageSwitcherState;
}>(), {
    canEdit: false,
    canRetry: false,
    isUnknownDelivery: false,
    isContentOmitted: false,
    actionDisabled: false,
    runActionDisabled: false,
});

const emit = defineEmits<{
    (e: "copy"): void;
    (e: "start-edit"): void;
    (e: "retry"): void;
    (e: "branch-from-here"): void;
    (e: "cycle-branch", direction: -1 | 1): void;
    (e: "resend-unknown"): void;
    (e: "dismiss-unknown"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <div class="agent-message-action-bar flex items-center gap-0.5 text-[var(--text-muted)] select-none">
        <!-- 乐观消息发送失败/未知交付状态操作 -->
        <IconButton
            v-if="props.isUnknownDelivery"
            icon-class="i-lucide-send"
            size="sm"
            variant="default"
            title="确认可能重复后重新发送"
            aria-label="重新发送"
            class="text-[var(--status-warning)] hover:text-[var(--status-warning)]"
            @click="emit('resend-unknown')"
        />
        <IconButton
            v-if="props.isUnknownDelivery"
            icon-class="i-lucide-x"
            size="sm"
            variant="default"
            title="移除本地未知占位"
            aria-label="移除本地未知占位"
            class="hover:text-[var(--status-danger)]"
            @click="emit('dismiss-unknown')"
        />

        <!-- 分支指示器 -->
        <AgentBranchSwitcher
            v-if="props.branchSwitcher"
            class="mr-1"
            :state="props.branchSwitcher"
            :disabled="props.actionDisabled || props.runActionDisabled"
            @cycle="emit('cycle-branch', $event)"
        />

        <!-- 复制内容 -->
        <IconButton
            icon-class="i-lucide-copy"
            size="sm"
            variant="default"
            :disabled="props.actionDisabled"
            :title="props.isContentOmitted ? (t('agent.textBubble.copyPreview') || '复制预览') : (t('agent.textBubble.copy') || '复制')"
            aria-label="复制消息"
            class="hover:text-[var(--text-main)]"
            @click="emit('copy')"
        />

        <!-- 就地编辑历史 -->
        <IconButton
            v-if="props.canEdit"
            icon-class="i-lucide-pencil"
            size="sm"
            variant="default"
            :disabled="props.actionDisabled || props.runActionDisabled"
            :title="t('agent.textBubble.edit') || '编辑此条消息'"
            aria-label="编辑此条消息"
            class="hover:text-[var(--text-main)]"
            @click="emit('start-edit')"
        />

        <!-- 重试/刷新生成 -->
        <IconButton
            v-if="props.canRetry"
            icon-class="i-lucide-rotate-cw"
            size="sm"
            variant="default"
            :disabled="props.actionDisabled || props.runActionDisabled"
            :title="t('agent.textBubble.retry') || '重新生成'"
            aria-label="重新生成"
            class="hover:text-[var(--text-main)]"
            @click="emit('retry')"
        />

        <!-- 新开分支 -->
        <IconButton
            icon-class="i-lucide-git-branch-plus"
            size="sm"
            variant="default"
            :disabled="props.actionDisabled || props.runActionDisabled"
            :title="t('agent.textBubble.branchFromHere') || '从此处新开分支'"
            aria-label="从此处新开分支"
            class="hover:text-[var(--text-main)]"
            @click="emit('branch-from-here')"
        />
    </div>
</template>
