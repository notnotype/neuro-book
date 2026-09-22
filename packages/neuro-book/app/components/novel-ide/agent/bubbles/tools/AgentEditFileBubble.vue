<script setup lang="ts">
import { computed } from "vue";
import {formatByteCount, type AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {
    extractStreamingStringField,
    parseToolArgsObject,
} from "nbook/app/components/novel-ide/agent/tool-args-stream";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();
const {t} = useI18n();

interface EditFileArgs {
    path?: string;
    edits?: Array<{
        oldText?: string;
        newText?: string;
    }>;
}

/** edit_file 参数在流式阶段可能是半截 JSON，需要按字段兜底展示。 */
const parsedArgs = computed<EditFileArgs>(() => {
    const parsed = parseToolArgsObject<EditFileArgs>(props.toolCall.argsJson ?? props.toolCall.argsText);
    return parsed ?? {};
});

const publicArgs = computed(() => props.toolCall.publicArgs?.kind === "edit" ? props.toolCall.publicArgs : null);
const firstEdit = computed(() => parsedArgs.value.edits?.[0] ?? {});
const publicFirstEdit = computed(() => publicArgs.value?.edits[0]);
const filePathText = computed(() => publicArgs.value?.path ?? parsedArgs.value.path ?? extractStreamingStringField(props.toolCall.argsText, "path"));
const oldStringText = computed(() => publicFirstEdit.value?.oldTextPreview ?? firstEdit.value.oldText ?? extractStreamingStringField(props.toolCall.argsText, "oldText"));
const newStringText = computed(() => publicFirstEdit.value?.newTextPreview ?? firstEdit.value.newText ?? extractStreamingStringField(props.toolCall.argsText, "newText"));
const previewNotice = computed(() => {
    const edit = publicFirstEdit.value;
    if (!edit || (!edit.oldTextOmitted && !edit.newTextOmitted && (publicArgs.value?.omittedEdits ?? 0) === 0)) {
        return "";
    }
    return `仅显示预览 · old ${formatByteCount(edit.oldTextBytes)} / new ${formatByteCount(edit.newTextBytes)}`;
});
const diffDetails = computed(() => props.toolCall.publicResult?.details?.kind === "file_change"
    ? props.toolCall.publicResult.details
    : null);

const resultText = computed(() => props.toolCall.result?.trim() ?? "");
</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Tool 目标路径 -->
        <div class="flex items-center gap-2">
            <span class="rounded bg-[var(--bg-main)] px-2 py-1 font-mono text-[11px] text-[var(--accent-main)] border border-[var(--accent-main)]/30">
                <span class="i-lucide-file-edit h-3 w-3 mr-1 inline-block align-text-bottom"></span>
                {{ filePathText || t("agent.tool.resolvingPath") }}
            </span>
            <span v-if="(parsedArgs.edits?.length ?? 0) > 1" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">{{ parsedArgs.edits?.length }} edits</span>
        </div>
        
        <!-- Diff 预览：old/new 都允许在半截 JSON 阶段逐步增长 -->
        <div class="grid grid-cols-2 gap-2 mt-2">
            <div class="rounded border border-[var(--border-color)] bg-[var(--status-danger-bg)]">
                <div class="border-b border-[var(--border-color)]/50 px-2 py-1 text-[10px] uppercase text-[var(--status-danger)]">Old String</div>
                <div class="max-h-40 overflow-y-auto whitespace-pre-wrap p-2 font-mono text-xs text-[var(--status-danger)] line-through opacity-80">
                    {{ oldStringText || "..." }}
                </div>
            </div>
            
            <div class="rounded border border-[var(--border-color)] bg-[var(--status-success-bg)]">
                <div class="border-b border-[var(--border-color)]/50 px-2 py-1 text-[10px] uppercase text-[var(--status-success)]">New String</div>
                <div class="max-h-40 overflow-y-auto whitespace-pre-wrap p-2 font-mono text-xs text-[var(--status-success)]">
                    {{ newStringText || "..." }}
                </div>
            </div>
        </div>
        <div v-if="previewNotice" class="text-[11px] text-[var(--status-info)]">{{ previewNotice }}</div>

        <div v-if="diffDetails?.diffPreview" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <div class="border-b border-[var(--border-color)]/50 px-2 py-1 text-[10px] uppercase text-[var(--text-muted)]">Diff Preview</div>
            <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-all p-2 font-mono text-xs text-[var(--text-secondary)]">{{ diffDetails.diffPreview }}</pre>
            <div v-if="diffDetails.diffOmitted" class="px-2 pb-2 text-[11px] text-[var(--status-info)]">仅显示预览 · 原 diff {{ formatByteCount(diffDetails.diffBytes) }}</div>
        </div>

        <div v-if="props.toolCall.error" class="mt-2 break-all whitespace-pre-wrap rounded border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] p-2 font-mono text-xs text-[var(--status-danger)]">
            {{ props.toolCall.error }}
        </div>
        
        <div v-if="resultText" class="whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 font-mono text-xs leading-5 text-[var(--text-secondary)]">
            {{ resultText }}
        </div>

        <div v-if="props.toolCall.status === 'success'" class="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-[var(--status-success)]">
            <span class="i-lucide-check-circle h-3.5 w-3.5"></span>
            {{ t("agent.tool.fileEdited") }}
        </div>
    </div>
</template>
