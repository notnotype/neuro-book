<script setup lang="ts">
import type {AgentToolCall} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "./request-user-input-context";
import {RequestUserInputToolArgsSchema, deriveRequestUserInputAnswerViews} from "nbook/app/components/novel-ide/agent/agent-message";

const DEFAULT_QUESTION_OPTIONS: Array<{label: string; description?: string}> = [];

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const {t} = useI18n();
const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);

const parsedArgs = computed(() => {
    try {
        return RequestUserInputToolArgsSchema.parse(JSON.parse(props.toolCall.argsJson ?? props.toolCall.argsText));
    } catch {
        return null;
    }
});

/** 在完整 pending 列表中定位当前历史 tool，历史气泡只展示状态。 */
const pendingSession = computed(() => userInputContext?.pendingSessions.value.find((session) => {
    return session.assistantMessageId === props.toolCall.assistantMessageId
        && (session.formToolCallId === props.toolCall.id || session.questions.some((question) => {
            return question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id;
        }));
}) ?? null);
const pendingQuestion = computed(() => pendingSession.value?.questions.find((question) => {
    return question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id;
}) ?? null);

const isToolApproval = computed(() => pendingQuestion.value?.kind === "tool_approval");
/** switch_mode 退出到 normal 的审批：第三选项语义是“补充建议”而不是“其他回答”。 */
const isPlanExitApproval = computed(() => pendingQuestion.value?.approvalAction === "switch_mode" && pendingQuestion.value?.switchTargetMode === "normal");

/**
 * 当前 tool 是否仍处于等待用户回答状态。
 */
const isPendingQuestion = computed(() => {
    return Boolean(pendingSession.value);
});

/**
 * 当前问题文本。
 */
const questionText = computed(() => {
    return pendingQuestion.value?.question ?? parsedArgs.value?.questions.map((question) => question.question).join("\n") ?? "";
});

/**
 * 当前问题选项。
 */
const questionOptions = computed(() => {
    return pendingQuestion.value?.options ?? parsedArgs.value?.questions[0]?.options ?? DEFAULT_QUESTION_OPTIONS;
});

const answerViews = computed(() => {
    return deriveRequestUserInputAnswerViews(parsedArgs.value, props.toolCall.resultData, {
        fallbackQuestion: pendingQuestion.value,
        otherLabel: isPlanExitApproval.value ? t("agent.userInput.addSuggestion") : t("agent.userInput.otherAnswer"),
    });
});

/**
 * 当前工具参数文本，流式期间可能是不完整 JSON。
 */
const toolArgsText = computed(() => {
    return props.toolCall.argsJson ?? props.toolCall.argsText;
});
</script>

<template>
    <!-- request_user_input 已回答 / 待回答 -->
    <div class="mt-2 space-y-2">
        <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] p-3">
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ isToolApproval ? "Approval" : "Question" }}</div>
            <div v-if="questionText" class="text-sm leading-6 text-[var(--text-main)]">
                {{ questionText }}
            </div>
            <div v-else class="text-xs whitespace-pre-wrap break-all font-mono leading-5 text-[var(--text-secondary)]">
                {{ toolArgsText || t("agent.userInput.streamingArgs") }}
            </div>

            <div class="mt-3 space-y-2">
                <div v-if="questionOptions.length > 0" class="space-y-1.5">
                    <div
                        v-for="(option, index) in questionOptions"
                        :key="index"
                        class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2"
                    >
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-medium text-[var(--text-main)]">{{ option.label }}</span>
                        </div>
                        <div v-if="option.description" class="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
                            {{ option.description }}
                        </div>
                    </div>
                </div>
                <div class="flex flex-wrap gap-1.5 text-[10px] text-[var(--text-muted)]">
                    <span v-if="questionOptions.length === 0" class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">{{ t("agent.userInput.openAnswer") }}</span>
                    <span class="rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5">{{ t("agent.userInput.allowNote") }}</span>
                </div>
            </div>
        </div>

        <div
            class="rounded-lg p-3"
            :class="isPendingQuestion ? 'border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]' : answerViews.length > 0 ? 'border border-[var(--status-success-border)] bg-[var(--status-success-bg)]' : 'border border-[var(--border-color)] bg-[var(--bg-main)]'"
        >
            <div class="mb-1 text-[9px] uppercase tracking-[0.24em] text-[var(--text-muted)]">{{ isToolApproval ? "Decision" : "Answer" }}</div>

            <div v-if="isPendingQuestion" class="flex items-center gap-2 text-xs leading-5 text-[var(--status-warning)]">
                <span class="i-lucide-clock h-3.5 w-3.5 shrink-0"></span>
                <span>{{ isToolApproval ? t("agent.userInput.waitingApproval") : t("agent.userInput.waitingAnswer") }}</span>
            </div>

            <div v-else-if="answerViews.length > 0" class="space-y-3">
                <div v-for="answer in answerViews" :key="answer.questionIndex" class="space-y-1">
                    <div v-if="answerViews.length > 1 && answer.question" class="text-xs leading-5 text-[var(--text-muted)]">{{ answer.questionIndex + 1 }}. {{ answer.question }}</div>
                    <div v-if="answer.ignored" class="text-sm leading-6 text-[var(--text-main)]">{{ t("agent.userInput.ignored") }}</div>
                    <div v-else-if="answer.openAnswer && answer.text" class="text-sm leading-6 text-[var(--text-main)]">{{ t("agent.userInput.answerPrefix", {text: answer.text}) }}</div>
                    <div v-else-if="answer.openAnswer && answer.note" class="text-sm leading-6 text-[var(--text-main)]">{{ t("agent.userInput.answerPrefix", {text: answer.note}) }}</div>
                    <div v-else class="text-sm text-[var(--text-main)]">{{ t("agent.userInput.choicePrefix", {text: answer.selectedLabel || t("agent.userInput.openAnswer")}) }}</div>
                    <div v-if="answer.note && !answer.openAnswer" class="text-xs leading-5 text-[var(--text-muted)]">{{ t("agent.userInput.notePrefix", {text: answer.note}) }}</div>
                    <div v-if="answer.omitted" class="flex items-center gap-1 text-[11px] text-[var(--status-info)]"><span class="i-lucide-info h-3 w-3"></span><span>仅显示预览</span></div>
                </div>
            </div>

            <div v-else class="text-xs whitespace-pre-wrap break-all text-[var(--text-secondary)]">
                {{ props.toolCall.result }}
            </div>
        </div>
    </div>
</template>
