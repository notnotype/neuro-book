<script setup lang="ts">
import {computed} from "vue";
import {useCollapsible} from "nbook/app/composables/useCollapsible";
import AgentMarkdownContent from "./AgentMarkdownContent.vue";

const THINKING_SUMMARY_LENGTH = 48;

const props = withDefaults(defineProps<{
    thinking: string;
    streaming?: boolean;
    openReference?: (target: string) => void;
    defaultCollapsed?: boolean;
}>(), {
    streaming: false,
    defaultCollapsed: true,
});

const {isCollapsed, toggle} = useCollapsible(props.defaultCollapsed);
const {t} = useI18n();

const thinkingSummary = computed(() => {
    const text = props.thinking.trim();
    if (!text) return "";

    const summaries = text
        .split(/\n\s*\n/g)
        .map((segment) => segment
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "")
        .filter((line) => line.length > 0)
        .map((line) => line.length > THINKING_SUMMARY_LENGTH
            ? `${line.slice(0, THINKING_SUMMARY_LENGTH)}...`
            : line,
        );

    return summaries.at(-1) ?? "";
});
</script>

<template>
    <div v-if="props.thinking.trim()" class="agent-thinking-collapsible mb-1 w-full pl-6 select-none">
        <div class="px-0.5 py-0.5">
            <button
                type="button"
                class="flex w-full items-center gap-1.5 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]/90 transition-colors hover:text-[var(--text-main)] cursor-pointer"
                :title="isCollapsed ? '展开思维链' : '收起思维链'"
                @click="toggle"
            >
                <span :class="isCollapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3 w-3 shrink-0" />
                <span class="i-lucide-brain-circuit h-3 w-3 shrink-0 text-[var(--accent-text)]" />
                <span
                    v-if="isCollapsed"
                    class="min-w-0 flex-1 truncate text-[11px] normal-case tracking-normal text-[var(--text-muted)]/75"
                >
                    {{ thinkingSummary }}
                </span>
                <span v-else class="text-[10px] normal-case tracking-normal text-[var(--text-muted)]/65">
                    {{ t("agent.textBubble.collapse") || "收起" }}
                </span>
            </button>

            <div
                v-if="!isCollapsed"
                class="mt-1.5 border-l border-[var(--border-color)]/40 pl-3 text-[13px] leading-relaxed text-[var(--text-muted)]/85 select-text"
            >
                <AgentMarkdownContent
                    :content="props.thinking"
                    :streaming="props.streaming"
                    :open-reference="props.openReference"
                />
            </div>
        </div>
    </div>
</template>
