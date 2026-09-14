<script setup lang="ts">
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import { resolveToolRenderConfig } from "nbook/app/components/novel-ide/agent/tool-render-registry";
import { toolStatusClass, toolStatusIcon } from "nbook/app/components/novel-ide/agent/agent-message";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";

const props = defineProps<{
    toolCall: AgentToolCall;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: "toggle"): void;
    (e: "copy"): void;
}>();

const renderConfig = computed(() => resolveToolRenderConfig(props.toolCall));
const {t} = useI18n();

const isRunning = computed(() => props.toolCall.status === "running" || props.toolCall.status === "streaming");
const collapsedPreview = computed(() => renderConfig.value.collapsedPreviewKey ? t(renderConfig.value.collapsedPreviewKey) : renderConfig.value.collapsedPreview);
/** 后台 workflow 的 tool success 只表示 job 已登记，头部不得显示成 workflow 完成。 */
const isStartedWorkflowJob = computed(() => {
    const details = props.toolCall.resultData;
    if (props.toolCall.name !== "run_workflow" || !details || typeof details !== "object" || Array.isArray(details)) {
        return false;
    }
    return details.status === "started";
});
const displayedStatusClass = computed(() => isStartedWorkflowJob.value
    ? "bg-[var(--status-info-bg)] text-[var(--status-info)]"
    : toolStatusClass(props.toolCall));
const displayedStatusIcon = computed(() => isStartedWorkflowJob.value
    ? "i-lucide-briefcase-business"
    : toolStatusIcon(props.toolCall));

/** 尝试将 args 解析为 JSON 对象，失败返回 null。 */
const parsedArgs = computed<unknown | null>(() => {
    try {
        const raw = props.toolCall.argsJson ?? props.toolCall.argsText;
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
});

/** 尝试将 result 解析为 JSON 对象，失败返回 null。 */
const parsedResult = computed<unknown | null>(() => {
    try {
        if (!props.toolCall.result) return null;
        return JSON.parse(props.toolCall.result);
    } catch {
        return null;
    }
});
</script>

<template>
    <div v-if="renderConfig.mode !== 'hidden'" class="w-full overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-subtle)] shadow-sm">
        <!-- 容器头部：点击切换展开 -->
        <button class="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]" @click="emit('toggle')">
            <div class="flex min-w-0 items-center gap-2.5 overflow-hidden">
                <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded" :class="displayedStatusClass">
                    <span :class="[displayedStatusIcon, isRunning ? 'animate-spin' : '']" class="h-3 w-3"></span>
                </div>
                <!-- 紧凑单行 -->
                <div class="flex min-w-0 items-center gap-2">
                    <span class="truncate font-mono text-xs font-medium text-[var(--text-main)] shrink-0">{{ props.toolCall.name }}</span>
                    <span class="shrink-0 text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ renderConfig.typeLabel }}</span>
                    <span v-if="!props.expanded && renderConfig.mode === 'inline'" class="truncate font-mono text-[11px] text-[var(--text-muted)] opacity-80 min-w-0">
                        {{ props.toolCall.argsJson ?? props.toolCall.argsText }}
                    </span>
                    <span v-else-if="!props.expanded && collapsedPreview" class="truncate font-mono text-[11px] text-[var(--text-muted)] opacity-80 min-w-0">
                        {{ collapsedPreview }}
                    </span>
                </div>
            </div>
            <span :class="props.expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="ml-2 h-4 w-4 shrink-0 text-[var(--text-muted)]"></span>
        </button>

        <!-- 展开内容区域 -->
        <div v-if="props.expanded" class="border-t border-[var(--border-color)]/50 bg-[var(--bg-input)]/50 px-3 pb-3 pt-1">
            <!-- block 模式：使用注册表声明的专用组件 -->
            <component :is="renderConfig.component" v-if="renderConfig.mode === 'block' && renderConfig.component" :tool-call="props.toolCall" />

            <!-- 默认 Tool 渲染 -->
            <template v-else>
                <div class="mt-2 space-y-2 overflow-y-auto max-h-[500px] pr-1">
                    <!-- Arguments：优先用 JsonViewer，fallback 到纯文本 -->
                    <div>
                        <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Arguments</div>
                        <JsonViewer v-if="parsedArgs !== null" :value="parsedArgs" :max-height="300" />
                        <div v-else class="break-all whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 font-mono text-xs text-[var(--text-secondary)]">
                            {{ props.toolCall.argsJson ?? props.toolCall.argsText }}
                        </div>
                    </div>
                    <!-- Result：优先用 JsonViewer，fallback 到纯文本 -->
                    <div v-if="props.toolCall.result">
                        <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Result</div>
                        <JsonViewer v-if="parsedResult !== null" :value="parsedResult" :max-height="300" />
                        <div v-else class="break-all whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-main)] p-2 font-mono text-xs text-[var(--text-secondary)]">
                            {{ props.toolCall.result }}
                        </div>
                    </div>
                    <div v-if="props.toolCall.error">
                        <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">Error</div>
                        <div class="break-all whitespace-pre-wrap rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-xs text-[var(--status-danger)]">
                            {{ props.toolCall.error }}
                        </div>
                    </div>
                </div>
                <div class="mt-2 flex items-center justify-start gap-1 text-[var(--text-muted)]">
                    <button class="rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('agent.textBubble.copy')" @click="emit('copy')">
                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>
