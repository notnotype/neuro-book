<script setup lang="ts">
import { computed } from "vue";
import {formatByteCount, type AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "../base/AgentMarkdownContent.vue";
import { extractStreamingStringField, parseToolArgsObject } from "nbook/app/components/novel-ide/agent/tool-args-stream";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const {t} = useI18n();

interface WriteFileArgs {
    path?: string;
    content?: string;
}

const parsedArgs = computed<WriteFileArgs>(() => {
    const parsed = parseToolArgsObject<WriteFileArgs>(props.toolCall.argsJson ?? props.toolCall.argsText);
    return parsed ?? {};
});

const publicArgs = computed(() => props.toolCall.publicArgs?.kind === "write" ? props.toolCall.publicArgs : null);
const filePathText = computed(() => publicArgs.value?.path ?? parsedArgs.value.path ?? extractStreamingStringField(props.toolCall.argsText, "path"));
const contentText = computed(() => publicArgs.value?.contentPreview ?? parsedArgs.value.content ?? extractStreamingStringField(props.toolCall.argsText, "content"));
const previewNotice = computed(() => publicArgs.value?.contentOmitted
    ? `仅显示预览 · 原文 ${formatByteCount(publicArgs.value.contentBytes)}`
    : "");

</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Tool 目标路径 -->
        <div class="flex items-center gap-2">
            <span class="rounded bg-[var(--bg-main)] px-2 py-1 font-mono text-[11px] text-[var(--accent-main)] border border-[var(--accent-main)]/30">
                <span class="i-lucide-file-code h-3 w-3 mr-1 inline-block align-text-bottom"></span>
                {{ filePathText || t("agent.tool.resolvingPath") }}
            </span>
            <span class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">overwrite</span>
        </div>
        
        <!-- Content Preview：content 在流式阶段实时增长 -->
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)]/50 p-4">
            <div class="text-sm leading-relaxed text-[var(--text-main)]">
                <AgentMarkdownContent :content="contentText || '...'" />
            </div>
            <div v-if="previewNotice" class="mt-3 text-[11px] text-[var(--status-info)]">{{ previewNotice }}</div>
        </div>

        <div v-if="props.toolCall.error" class="mt-2 break-all whitespace-pre-wrap rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-xs text-[var(--status-danger)]">
            {{ props.toolCall.error }}
        </div>
        
        <div v-if="props.toolCall.status === 'success'" class="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[var(--status-success)]">
            <span class="i-lucide-check-circle h-3.5 w-3.5"></span>
            {{ t("agent.tool.fileWritten") }}
        </div>
    </div>
</template>

