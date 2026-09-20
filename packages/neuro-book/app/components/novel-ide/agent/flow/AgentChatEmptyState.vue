<script setup lang="ts">
import {computed} from "vue";
import {EmptyState, Tooltip} from "@notnotype/nb-ui/components";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";

export interface PromptSuggestionItem {
    id: string;
    icon: string;
    iconColorClass?: string;
    prompt: string;
}

const props = withDefaults(defineProps<{
    mode?: "main" | "compact";
    unselected?: boolean;
    recentSessions?: AgentSessionSummaryDto[];
    suggestions?: PromptSuggestionItem[];
}>(), {
    mode: "main",
    unselected: false,
    recentSessions: () => [],
});

const emit = defineEmits<{
    (e: "select-starter", prompt: string): void;
    (e: "select-session", sessionId: number): void;
    (e: "create-session"): void;
    (e: "open-sessions"): void;
}>();

const {t} = useI18n();

/**
 * 默认智能推荐指令（最多 3 条）：
 * 类似 ChatGPT 首页灵感条，前置特色能力图标，直接展示自然语言提示词正文，悬停查看全文。
 */
const defaultSuggestions: PromptSuggestionItem[] = [
    {
        id: "polish",
        icon: "i-lucide-feather",
        iconColorClass: "text-amber-500",
        prompt: "帮我润色一段环境描写：暴雨中的蒸汽工业城市，充满湿冷的金属味、雾气与钟声。文风克制冷峻，突出压抑感。",
    },
    {
        id: "outline",
        icon: "i-lucide-git-merge",
        iconColorClass: "text-sky-500",
        prompt: "规划第三幕高潮“雨夜钟楼对决”的细纲，设计三段递进的冲突转折，并让两条暗线在此处收束。",
    },
    {
        id: "lint",
        icon: "i-lucide-shield-check",
        iconColorClass: "text-emerald-500",
        prompt: "对当前章节进行一致性规则体检，排查时间线冲突、战力体系失衡、伏笔漏洞以及高频重复词。",
    },
];

const displaySuggestions = computed(() => {
    const list = props.suggestions && props.suggestions.length > 0 ? props.suggestions : defaultSuggestions;
    return list.slice(0, 3);
});

const displayRecentSessions = computed(() => {
    if (!props.recentSessions || props.recentSessions.length === 0) {
        return [];
    }
    return props.recentSessions
        .filter((session) => !session.archived)
        .slice(0, 3);
});
</script>

<template>
    <div class="flex w-full flex-col select-none my-auto">
        <!-- 1. compact 模式：精简等待中 -->
        <template v-if="props.mode === 'compact'">
            <div class="flex flex-col items-center justify-center gap-2 py-4">
                <div class="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]">
                    <span class="i-lucide-loader-circle h-4 w-4 animate-spin text-[var(--text-muted)]" />
                </div>
                <p class="text-xs text-[var(--text-muted)]">{{ t("agent.chat.waiting") }}</p>
            </div>
        </template>

        <!-- 2. main 模式 + unselected（有多会话但未选） -->
        <template v-else-if="props.unselected">
            <EmptyState
                icon-class="i-lucide-messages-square text-[var(--status-warning)]"
                title="请选择一个对话"
                description="当前实例还有可用对话，但没有可靠的上次选择。请从对话列表中选择。"
                class="py-6"
            />
        </template>

        <!-- 3. 标准入口：最近对话 + 智能推荐指令（最多3条） -->
        <template v-else>
            <div class="mx-auto flex w-full max-w-[460px] flex-col gap-5 py-2">
                <!-- Hero 欢迎与引导 -->
                <div class="flex flex-col items-center text-center">
                    <div class="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-xs">
                        <span class="i-lucide-sparkles h-5 w-5 text-[var(--accent-text)]" />
                    </div>
                    <h3 class="text-sm font-semibold tracking-wide text-[var(--text-main)]">NeuroBook 创作工作区</h3>
                    <p class="mt-0.5 text-xs text-[var(--text-muted)]">从最近对话继续书写，或尝试以下专属创作指令</p>
                </div>

                <!-- A. 最近对话区域（仅当存在历史会话时呈现） -->
                <div v-if="displayRecentSessions.length > 0" class="flex flex-col">
                    <div class="mb-2 flex items-center justify-between">
                        <span class="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-main)]">
                            <span class="i-lucide-history h-3.5 w-3.5 text-[var(--accent-text)]" />
                            <span>最近对话</span>
                        </span>
                        <button
                            type="button"
                            class="flex items-center gap-0.5 text-[11px] text-[var(--accent-text)] transition-colors hover:underline"
                            @click="emit('open-sessions')"
                        >
                            <span>查看全部历史</span>
                            <span v-if="props.recentSessions.length > 0">({{ props.recentSessions.length }})</span>
                            <span class="i-lucide-arrow-right h-3 w-3" />
                        </button>
                    </div>

                    <div class="flex flex-col gap-1.5 text-left">
                        <button
                            v-for="session in displayRecentSessions"
                            :key="session.sessionId"
                            type="button"
                            class="group flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 shadow-2xs transition-all duration-150 hover:border-[var(--accent-border,var(--accent-main))] hover:bg-[var(--bg-hover)]"
                            @click="emit('select-session', session.sessionId)"
                        >
                            <div class="flex min-w-0 items-center gap-2">
                                <span class="i-lucide-message-square h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-text)]" />
                                <span class="truncate text-xs font-medium text-[var(--text-main)]">{{ session.title || "未命名会话" }}</span>
                            </div>
                            <div class="ml-2 flex shrink-0 items-center gap-2 text-[11px] text-[var(--text-muted)]">
                                <span>{{ formatTimestamp(session.updatedAt) }}</span>
                                <span class="i-lucide-arrow-right h-3 w-3 shrink-0 text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent-text)]" />
                            </div>
                        </button>
                    </div>
                </div>

                <!-- B. 智能推荐指令（最多3条，通过 Tooltip 悬停展示全文） -->
                <div class="flex flex-col">
                    <div class="mb-1.5 flex items-center justify-between px-1">
                        <div class="flex items-center gap-1.5">
                            <span class="i-lucide-sparkles h-3.5 w-3.5 text-[var(--accent-text)]" />
                            <span class="text-xs font-semibold text-[var(--text-main)]">推荐创作指令</span>
                            <span class="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">智能生成</span>
                        </div>
                        <span class="text-[10px] text-[var(--text-muted)]">点击填入 · 悬停查看全文</span>
                    </div>

                    <!-- 纵向无边框极简行（最多3条，Tooltip 悬停展示全文） -->
                    <div class="flex flex-col gap-1 text-left">
                        <Tooltip
                            v-for="item in displaySuggestions"
                            :key="item.id"
                            :text="item.prompt"
                            placement="top"
                            :delay="150"
                        >
                            <button
                                type="button"
                                class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                                @click="emit('select-starter', item.prompt)"
                            >
                                <span :class="[item.icon, item.iconColorClass || 'text-[var(--accent-text)]']" class="h-4 w-4 shrink-0" />
                                <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)] transition-colors group-hover:text-[var(--accent-text)]">
                                    {{ item.prompt }}
                                </span>
                            </button>
                            <template #content>
                                <span class="block max-w-[280px] text-xs leading-relaxed">
                                    {{ item.prompt }}
                                </span>
                            </template>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </template>
    </div>
</template>
