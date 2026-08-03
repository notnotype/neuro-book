<script setup lang="ts">
import type {AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    /** 当前气泡所属分叉的分支状态；由 session tree 的锚点投影派生。 */
    state: AgentMessageSwitcherState;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (e: "cycle", direction: -1 | 1): void;
}>();

const {t} = useI18n();

const title = computed(() => t("agent.textBubble.branchTitle", {
    current: props.state.currentIndex + 1,
    total: props.state.total,
}));
</script>

<template>
    <!-- 消息级分支切换器：上一条 / 计数 / 下一条 -->
    <div class="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]" :title="title">
        <button type="button" class="flex h-7 w-7 items-center justify-center border-r border-[var(--border-color)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled" :title="t('agent.textBubble.previousBranch')" @click="emit('cycle', -1)">
            <span class="i-lucide-chevron-left h-3.5 w-3.5"></span>
        </button>
        <span class="inline-flex h-7 items-center gap-1 px-2 text-[10px] tabular-nums text-[var(--text-secondary)]">
            <span class="i-lucide-git-branch h-3 w-3 text-[var(--accent-text)]"></span>
            {{ props.state.currentIndex + 1 }} / {{ props.state.total }}
        </span>
        <button type="button" class="flex h-7 w-7 items-center justify-center border-l border-[var(--border-color)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.disabled" :title="t('agent.textBubble.nextBranch')" @click="emit('cycle', 1)">
            <span class="i-lucide-chevron-right h-3.5 w-3.5"></span>
        </button>
    </div>
</template>
