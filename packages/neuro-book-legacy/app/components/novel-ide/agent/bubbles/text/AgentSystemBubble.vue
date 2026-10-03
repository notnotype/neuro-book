<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {AgentMessage, AgentMessageSwitcherState} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "../base/AgentMarkdownContent.vue";
import AgentBranchSwitcher from "../base/AgentBranchSwitcher.vue";

const props = withDefaults(defineProps<{
    message: AgentMessage;
    actionDisabled?: boolean;
    runActionDisabled?: boolean;
    branchSwitcher?: AgentMessageSwitcherState;
    openReference?: (target: string) => void;
}>(), {
    actionDisabled: false,
    runActionDisabled: false,
});

const emit = defineEmits<{
    (e: "cycle-branch", payload: {messageId: string; direction: -1 | 1}): void;
}>();

const systemDisplayKind = computed(() => props.message.systemDisplayKind ?? "system");
const isSystemReminder = computed(() => systemDisplayKind.value === "reminder");
const isSystemError = computed(() => systemDisplayKind.value === "error");

const isSystemCollapsed = ref(!isSystemError.value);

watch(() => props.message.id, () => {
    isSystemCollapsed.value = !isSystemError.value;
}, {immediate: true});

const systemLabel = computed(() => {
    if (props.message.systemLabel) return props.message.systemLabel;
    if (systemDisplayKind.value === "prompt") return "System Prompt";
    if (systemDisplayKind.value === "reminder") return "System Reminder";
    if (systemDisplayKind.value === "error") return "Run Error";
    return "System";
});

const systemSummary = computed(() => {
    const firstLine = props.message.content
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return firstLine.length > 86 ? `${firstLine.slice(0, 86)}...` : firstLine;
});

const toggleSystem = (): void => {
    isSystemCollapsed.value = !isSystemCollapsed.value;
};

const cycleBranch = (direction: -1 | 1): void => {
    if (!props.branchSwitcher || props.actionDisabled) return;
    emit("cycle-branch", {
        messageId: props.message.id,
        direction,
    });
};
</script>

<template>
    <div
        class="agent-system-bubble group flex min-w-0 w-full flex-col pl-6 select-none"
        :class="isSystemReminder ? 'my-2' : 'my-3'"
    >
        <div class="flex min-w-0 w-full items-center gap-2">
            <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-md border text-left transition-colors cursor-pointer"
                :class="isSystemError
                    ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)]'
                    : isSystemReminder
                        ? 'border-[var(--border-color)]/50 bg-[var(--bg-panel)]/45 px-2.5 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text-secondary)]'
                        : 'border-[var(--border-color)] bg-[var(--bg-main)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'"
                @click="toggleSystem"
            >
                <span
                    :class="isSystemError ? 'i-lucide-alert-triangle h-3.5 w-3.5' : isSystemReminder ? 'i-lucide-bell-ring h-3 w-3' : 'i-lucide-settings-2 h-3.5 w-3.5'"
                    class="shrink-0"
                />
                <span class="shrink-0 font-medium uppercase tracking-[0.18em]">{{ systemLabel }}</span>
                <span
                    v-if="isSystemCollapsed && systemSummary"
                    class="min-w-0 flex-1 truncate normal-case tracking-normal opacity-75"
                >
                    {{ systemSummary }}
                </span>
                <span v-else class="min-w-0 flex-1" />
                <span
                    :class="isSystemCollapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'"
                    class="h-3.5 w-3.5 shrink-0"
                />
            </button>

            <!-- 跑挂的运行也是一条分支；没有它用户切不回上一个成功的回答。 -->
            <AgentBranchSwitcher
                v-if="isSystemError && props.branchSwitcher"
                :state="props.branchSwitcher"
                :disabled="props.actionDisabled || props.runActionDisabled"
                @cycle="cycleBranch"
            />
        </div>

        <div v-show="!isSystemCollapsed" class="mt-2 min-w-0 w-full select-text">
            <div
                class="min-w-0 max-w-full overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-sidebar)]/55 px-3 py-2 shadow-sm"
                :class="isSystemError ? 'max-h-[240px] border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]' : isSystemReminder ? 'max-h-[180px]' : 'max-h-[320px]'"
            >
                <div
                    v-if="props.message.content"
                    class="min-w-0 text-xs leading-relaxed"
                    :class="isSystemError ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'"
                >
                    <AgentMarkdownContent
                        :content="props.message.content"
                        :html="props.message.html"
                        :open-reference="props.openReference"
                    />
                </div>
            </div>
        </div>
    </div>
</template>
