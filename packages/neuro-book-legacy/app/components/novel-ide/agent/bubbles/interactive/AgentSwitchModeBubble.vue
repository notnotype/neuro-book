<script setup lang="ts">
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "./request-user-input-context";
import {RequestUserInputToolAnswerSchema, formatByteCount} from "nbook/app/components/novel-ide/agent/agent-message";
import AgentMarkdownContent from "../base/AgentMarkdownContent.vue";
import {parseToolArgsObject} from "nbook/app/components/novel-ide/agent/tool-args-stream";
import {AgentModeSchema, type AgentMode} from "nbook/shared/dto/agent-session.dto";
import {z} from "zod";

const NONE_OF_ABOVE_OPTION_INDEX = -1;
const REJECT_OPTION_INDEX = 1;
const APPROVE_OPTION_INDEX = 0;

const SwitchModePreviewDataSchema = z.object({
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
});

const SwitchModeRawResultSchema = z.object({
    answers: z.array(RequestUserInputToolAnswerSchema).optional(),
    approved: z.boolean().optional(),
    targetMode: AgentModeSchema.optional(),
    planFilePath: z.string().optional(),
    planContent: z.string().optional(),
    data: z.unknown().optional(),
});

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);
const showApprovedPreview = ref(false);
const {t} = useI18n();

/**
 * switch_mode 参数中的目标模式；参数流式期间用 partial-json 解析，未完成时回退 resultData。
 */
const targetMode = computed<AgentMode>(() => {
    const streamedArgs = parseToolArgsObject<{targetMode?: unknown}>(props.toolCall.argsJson ?? props.toolCall.argsText);
    const candidate = streamedArgs?.targetMode ?? parsedRawResult.value?.targetMode;
    const parsed = AgentModeSchema.safeParse(candidate);
    return parsed.success ? parsed.data : "normal";
});

const targetModeLabel = computed(() => t(`agent.mode.${targetMode.value}`));

/**
 * 当前 switch_mode 是否仍在等待审批。
 */
const pendingSession = computed(() => userInputContext?.pendingSessions.value.find((session) => {
    return session.assistantMessageId === props.toolCall.assistantMessageId
        && session.questions.some((question) => question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id);
}) ?? null);
const pendingQuestion = computed(() => pendingSession.value?.questions.find((question) => {
    return question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id;
}) ?? null);

const isPendingQuestion = computed(() => {
    return Boolean(pendingSession.value);
});

const parsedRawResult = computed(() => {
    const parsed = SwitchModeRawResultSchema.safeParse(props.toolCall.resultData);
    return parsed.success ? parsed.data : null;
});

const parsedPreviewData = computed(() => {
    const parsed = SwitchModePreviewDataSchema.safeParse(parsedRawResult.value?.data);
    return parsed.success ? parsed.data : null;
});

const planFilePath = computed(() => {
    return pendingQuestion.value?.planFilePath ?? parsedRawResult.value?.planFilePath ?? parsedPreviewData.value?.planFilePath ?? "";
});

const planContent = computed(() => {
    return pendingQuestion.value?.planContent ?? parsedRawResult.value?.planContent ?? parsedPreviewData.value?.planContent ?? "";
});

const hasPlanFilePreview = computed(() => Boolean(planFilePath.value && planContent.value));
const hasPlanFileArgument = computed(() => Boolean(planFilePath.value));
const planContentBytes = computed(() => pendingQuestion.value?.planContentBytes ?? new TextEncoder().encode(planContent.value).byteLength);

/** 只有退出到 normal 的切换才涉及计划实现语义；进入 discuss/plan 展示切换请求本身。 */
const isExitToNormal = computed(() => targetMode.value === "normal");

const parsedAnswer = computed(() => {
    const answer = parsedRawResult.value?.answers?.[0];
    if (answer) {
        return answer;
    }
    try {
        return RequestUserInputToolAnswerSchema.parse(props.toolCall.resultData);
    } catch {
        return null;
    }
});

const questionOptions = computed(() => {
    return pendingQuestion.value?.options ?? [];
});

const selectedIndexes = computed(() => {
    if (!parsedAnswer.value) {
        return [];
    }
    return parsedAnswer.value.selectedOptionIndex === undefined ? [] : [parsedAnswer.value.selectedOptionIndex];
});

function selectedOptionLabel(optionIndex: number): string {
    if (optionIndex === NONE_OF_ABOVE_OPTION_INDEX) {
        return t("agent.planApproval.addSuggestion");
    }
    const optionLabel = questionOptions.value[optionIndex]?.label;
    if (optionLabel) {
        return optionLabel;
    }
    if (optionIndex === APPROVE_OPTION_INDEX) {
        return t("agent.planApproval.approve");
    }
    if (optionIndex === REJECT_OPTION_INDEX) {
        return t("agent.planApproval.reject");
    }
    return String(optionIndex);
}

const selectedLabel = computed(() => {
    if (!parsedAnswer.value) {
        return "";
    }
    if (parsedAnswer.value.ignored) {
        return t("agent.planApproval.ignored");
    }
    if (selectedIndexes.value.length === 0) {
        return t("agent.planApproval.openAnswer");
    }
    return selectedIndexes.value.map(selectedOptionLabel).join(t("agent.planApproval.separator"));
});

const shouldShowPlanPreview = computed(() => {
    return isPendingQuestion.value || showApprovedPreview.value;
});

const planSummary = computed(() => {
    const source = planContent.value;
    return source
        .split(/\r?\n/)
        .map((line) => line
            .replace(/^#{1,6}\s+/, "")
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/^\s*\d+[.)]\s+/, "")
            .replace(/`{1,3}/g, "")
            .trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" / ");
});

const statusLabel = computed(() => {
    if (isPendingQuestion.value) {
        if (!isExitToNormal.value) {
            return t("agent.modeSwitch.pending", {mode: targetModeLabel.value});
        }
        return hasPlanFileArgument.value ? t("agent.planApproval.pendingFile") : t("agent.planApproval.pendingChat");
    }
    if (!parsedAnswer.value) {
        if (parsedRawResult.value?.approved === true) {
            return t("agent.modeSwitch.approved", {mode: targetModeLabel.value});
        }
        if (parsedRawResult.value?.approved === false) {
            return t("agent.modeSwitch.rejected", {mode: targetModeLabel.value});
        }
        if (!isExitToNormal.value) {
            return t("agent.modeSwitch.request", {mode: targetModeLabel.value});
        }
        return hasPlanFileArgument.value ? t("agent.planApproval.fileApproval") : t("agent.planApproval.chatApproval");
    }
    if (parsedAnswer.value.ignored) {
        return t("agent.planApproval.paused");
    }
    if (selectedIndexes.value.includes(APPROVE_OPTION_INDEX)) {
        return t("agent.modeSwitch.approved", {mode: targetModeLabel.value});
    }
    if (selectedIndexes.value.includes(NONE_OF_ABOVE_OPTION_INDEX)) {
        return t("agent.planApproval.suggestionAdded");
    }
    if (selectedIndexes.value.includes(REJECT_OPTION_INDEX) || parsedRawResult.value?.approved === false) {
        return t("agent.modeSwitch.rejected", {mode: targetModeLabel.value});
    }
    return t("agent.planApproval.suggestionAdded");
});
</script>

<template>
    <!-- switch_mode 模式切换审批气泡；退出到 normal 时附带计划文件预览 -->
    <div class="min-w-0 w-full">
        <div class="min-w-0 w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2.5 shadow-sm">
            <div class="mb-1.5 flex min-w-0 items-center gap-2 text-[11px] leading-5 text-[var(--text-muted)]">
                <span :class="isPendingQuestion ? 'i-lucide-clock text-[var(--status-warning)]' : 'i-lucide-file-check-2 text-[var(--status-success)]'" class="h-3.5 w-3.5 shrink-0"></span>
                <span class="shrink-0 font-medium text-[var(--text-main)]">{{ statusLabel }}</span>
                <span v-if="planFilePath" class="min-w-0 truncate font-mono text-[11px] text-[var(--text-muted)]">{{ planFilePath }}</span>
                <button
                    v-if="!isPendingQuestion && planContent"
                    class="ml-auto shrink-0 rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    type="button"
                    :title="showApprovedPreview ? t('agent.planApproval.collapsePreview') : t('agent.planApproval.expandPreview')"
                    @click="showApprovedPreview = !showApprovedPreview"
                >
                    <span :class="showApprovedPreview ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>
            </div>

            <div v-if="shouldShowPlanPreview && hasPlanFilePreview" class="max-h-[320px] min-w-0 overflow-y-auto pr-2 text-xs leading-relaxed text-[var(--text-main)]">
                <AgentMarkdownContent :content="planContent" />
                <div class="mt-2 text-[11px] text-[var(--text-muted)]">完整计划文件 · {{ formatByteCount(planContentBytes) }}</div>
            </div>
            <div v-else-if="planSummary" class="line-clamp-2 break-words text-xs leading-5 text-[var(--text-secondary)]">
                {{ planSummary || t("agent.planApproval.collapsed") }}
            </div>
            <div v-else-if="isExitToNormal" class="text-xs leading-5 text-[var(--text-muted)]">
                {{ hasPlanFileArgument ? t("agent.planApproval.noFileContent") : t("agent.planApproval.noChatContent") }}
            </div>

            <div v-if="isPendingQuestion" class="mt-2 flex items-center gap-2 text-[11px] leading-5 text-[var(--status-warning)]">
                <span class="i-lucide-clock h-3.5 w-3.5 shrink-0"></span>
                <span>{{ t("agent.planApproval.waiting") }}</span>
            </div>
            <div v-else-if="parsedAnswer" class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-5 text-[var(--text-muted)]">
                <span>{{ t("agent.planApproval.choice", {label: selectedLabel}) }}</span>
                <span v-if="parsedAnswer.note">{{ t("agent.planApproval.note", {note: parsedAnswer.note}) }}</span>
            </div>
        </div>
    </div>
</template>
