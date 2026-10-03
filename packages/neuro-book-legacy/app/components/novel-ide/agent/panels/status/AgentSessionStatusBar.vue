<script setup lang="ts">
import {computed} from "vue";
import {AGENT_MODE_META} from "nbook/app/components/novel-ide/agent/agent-composer-presentation";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";

const props = defineProps<{
    contextUsageExactLabel: string;
    contextUsageCompactLabel: string;
    contextPercentCompactLabel: string;
    cumulativeUsageExactLabel: string;
    cumulativeInputCompactLabel: string;
    cumulativeOutputCompactLabel: string;
    cumulativeCacheCompactLabel: string;
    cumulativeCacheWriteCompactLabel: string;
    cumulativeCacheHitRateLabel: string;
    cumulativeCostCompactLabel: string;
    connectionStatusLabel: string;
    connectionNeedsAction: boolean;
    running: boolean;
    runPhaseLabel: string;
    agentMode: AgentMode;
}>();

const emit = defineEmits<{
    (e: "open-context-inspector"): void;
    (e: "reconnect-events"): void;
    (e: "refresh-history"): void;
}>();

const {t} = useI18n();

const agentModeMeta = computed(() => AGENT_MODE_META[props.agentMode]);
const agentModeLabel = computed(() => t(`agent.mode.${props.agentMode}`));
const modeButtonTitle = computed(() => t("agent.composer.cycleModeTitle", {mode: agentModeLabel.value}));
</script>

<template>
    <!-- 会话 token 上下文与运行时状态栏 -->
    <div class="mt-1.5 flex flex-wrap items-center justify-center gap-1 text-[10px] text-[var(--text-muted)]">
        <!-- gauge 芯片：点击打开上下文检查面板（Task 126） -->
        <button
            :title="props.contextUsageExactLabel"
            class="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-hover)]"
            @click="emit('open-context-inspector')"
        >
            <span class="i-lucide-gauge h-3 w-3 shrink-0"></span>
            <span class="truncate font-medium text-[var(--text-secondary)]">{{ props.contextUsageCompactLabel }}</span>
            <span
                v-if="props.contextPercentCompactLabel"
                class="rounded-full bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]"
            >
                {{ props.contextPercentCompactLabel }}
            </span>
        </button>

        <!-- 累积用量芯片 -->
        <div
            :title="props.cumulativeUsageExactLabel"
            class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5"
        >
            <span class="i-lucide-arrow-down h-3 w-3"></span>
            <span>{{ props.cumulativeInputCompactLabel }}</span>
            <span class="i-lucide-arrow-up h-3 w-3"></span>
            <span>{{ props.cumulativeOutputCompactLabel }}</span>
            <span class="i-lucide-database-zap h-3 w-3"></span>
            <span>{{ props.cumulativeCacheCompactLabel }}</span>
            <template v-if="props.cumulativeCacheHitRateLabel">
                <span class="i-lucide-percent h-3 w-3"></span>
                <span>{{ props.cumulativeCacheHitRateLabel }}</span>
            </template>
            <template v-if="props.cumulativeCacheWriteCompactLabel !== '-' && props.cumulativeCacheWriteCompactLabel !== '0'">
                <span class="i-lucide-hard-drive-upload h-3 w-3"></span>
                <span>{{ props.cumulativeCacheWriteCompactLabel }}</span>
            </template>
            <template v-if="props.cumulativeCostCompactLabel">
                <span class="i-lucide-circle-dollar-sign h-3 w-3"></span>
                <span>{{ props.cumulativeCostCompactLabel }}</span>
            </template>
        </div>

        <!-- 连接状态 -->
        <div
            v-if="props.connectionStatusLabel"
            class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5"
        >
            <span class="i-lucide-wifi h-3 w-3"></span>
            <span>{{ props.connectionStatusLabel }}</span>
        </div>

        <template v-if="props.connectionNeedsAction">
            <button
                class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('agent.composer.reconnectTitle')"
                @click="emit('reconnect-events')"
            >
                <span class="i-lucide-refresh-cw h-3 w-3"></span>
                <span>{{ t("agent.composer.reconnect") }}</span>
            </button>
            <button
                class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                :title="t('agent.composer.refreshHistoryTitle')"
                @click="emit('refresh-history')"
            >
                <span class="i-lucide-history h-3 w-3"></span>
                <span>{{ t("agent.composer.refreshHistory") }}</span>
            </button>
        </template>

        <!-- 运行中指示 -->
        <div
            v-if="props.running"
            class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-1.5 py-0.5"
        >
            <span class="i-lucide-loader-circle h-3 w-3 animate-spin"></span>
            <span>{{ props.runPhaseLabel || t("agent.composer.running") }}</span>
        </div>

        <!-- 当前模式徽标：非 normal 模式时展示 -->
        <div
            v-if="agentModeMeta.badgeVisible"
            class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-main)]/30 bg-[var(--accent-bg)] px-1.5 py-0.5 text-[var(--accent-text)]"
            :title="modeButtonTitle"
        >
            <span :class="agentModeMeta.icon" class="h-3 w-3"></span>
            <span>{{ agentModeLabel }}</span>
        </div>
    </div>
</template>
