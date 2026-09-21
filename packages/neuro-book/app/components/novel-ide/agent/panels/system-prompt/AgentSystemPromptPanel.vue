<script setup lang="ts">
import {Button, IconButton} from "@notnotype/nb-ui/components";
import AgentMarkdownContent from "../../bubbles/base/AgentMarkdownContent.vue";
import {shouldLoadSystemPrompt} from "../../flow/agent-chat-history-ui";

const props = defineProps<{
    modelValue: boolean;
    /** 当前 session 已加载的 System Prompt；空字符串表示 prompt 本身为空。 */
    value: string | null;
    loading: boolean;
    error?: string;
    /** 打开 System Prompt 中的 workspace 引用。 */
    openReference?: (target: string) => void;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "load"): void;
    (e: "refresh"): void;
}>();

const {t} = useI18n();

/** 显式展开时才请求 System Prompt，普通 recovery 不触发。 */
watch(() => props.modelValue, (open) => {
    if (shouldLoadSystemPrompt({
        open,
        loading: props.loading,
        hasValue: props.value !== null,
    })) {
        emit("load");
    }
}, {immediate: true});

const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const copyPrompt = async (): Promise<void> => {
    if (!props.value) return;
    try {
        await navigator.clipboard.writeText(props.value);
        copied.value = true;
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
            copied.value = false;
        }, 2000);
    } catch {
        // 剪贴板不可用时静默降级
    }
};

function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && props.modelValue) {
        event.stopPropagation();
        emit("update:modelValue", false);
    }
}

onMounted(() => {
    window.addEventListener("keydown", handleKeydown, true);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, true);
    if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
    <!-- System Prompt 独立于 durable history，不伪装成对话消息。 -->
    <section v-if="props.modelValue" class="nb-ui-popover-surface shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3 shadow-[var(--elevation-popover)]">
        <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--text-main)]">
                <span class="i-lucide-terminal-square h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                <span>{{ t("agent.systemPrompt.title") }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-1">
                <IconButton
                    size="sm"
                    variant="default"
                    :title="copied ? t('agent.systemPrompt.copied') : t('agent.systemPrompt.copy')"
                    :aria-label="t('agent.systemPrompt.copy')"
                    :disabled="props.loading || !props.value"
                    @click="copyPrompt"
                >
                    <span :class="copied ? 'i-lucide-check text-[var(--status-success)]' : 'i-lucide-copy'" class="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="default"
                    :title="t('agent.systemPrompt.refresh')"
                    :aria-label="t('agent.systemPrompt.refresh')"
                    :disabled="props.loading"
                    @click="emit('refresh')"
                >
                    <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="props.loading ? 'animate-spin' : ''" />
                </IconButton>
                <IconButton
                    size="sm"
                    variant="default"
                    :title="t('agent.systemPrompt.close')"
                    :aria-label="t('agent.systemPrompt.close')"
                    @click="emit('update:modelValue', false)"
                >
                    <span class="i-lucide-x h-3.5 w-3.5" />
                </IconButton>
            </div>
        </div>

        <div class="mt-2 max-h-[min(42vh,420px)] overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2">
            <div v-if="props.loading" class="flex items-center gap-2 py-3 text-xs text-[var(--text-muted)]">
                <span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>
                {{ t("agent.systemPrompt.loading") }}
            </div>
            <div v-else-if="props.error" class="flex items-center justify-between gap-3 py-2 text-xs text-[var(--status-danger)]">
                <span class="min-w-0 break-words">{{ props.error }}</span>
                <Button size="sm" variant="secondary" @click="emit('load')">{{ t("agent.systemPrompt.retry") }}</Button>
            </div>
            <AgentMarkdownContent v-else-if="props.value" :content="props.value" :open-reference="props.openReference" />
            <div v-else class="py-3 text-xs text-[var(--text-muted)]">{{ t("agent.systemPrompt.empty") }}</div>
        </div>
    </section>
</template>
