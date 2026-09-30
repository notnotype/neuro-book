<script setup lang="ts">
/**
 * AgentRequestUserInputCard
 *
 * 方案 A【精密 IDE 工单卡】(Precision Command Card / Inline Inspector)
 *
 * Agent 在对话流中发起的提问与用户输入工具调用留痕卡片（Tool Call: request_user_input）。
 * 严格对齐后端 RequestUserInputSchema 与业务术语契约：
 * 1. 真实语义归正：工具为「向用户提问 / 请求输入」（request_user_input），彻底与独立审批系统（tool_approval / switch_mode）解耦；
 * 2. 精准支持双题型形状（Question Shapes）：
 *    - 选择题型（Choice Question，options 存在且非空）：展示选中项、选项说明、其余未选项折叠；
 *    - 开放问答题型（Open-ended Question，options 为空或省略）：自然呈现题干与自然语言回答文本块；
 * 3. 规范复用 nb-ui 原生组件：Badge、Separator、Collapsible，同字号 13px 层次；
 * 4. 纯只读不可变留痕：对话流卡片仅用于历史审计展示，实际输入决策由底部的 AgentUserInputPrompt 承载。
 */
import {computed, inject, ref} from "vue";
import {Badge, Collapsible, Separator} from "@notnotype/nb-ui/components";
import type {AgentToolCall, RequestUserInputAnswerView} from "nbook/app/components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY} from "./request-user-input-context";
import {
    deriveRequestUserInputAnswerViews,
    type AgentPendingUserInputQuestion,
} from "nbook/app/components/novel-ide/agent/agent-message";
import {parseToolArgsObject} from "nbook/app/components/novel-ide/agent/tool-args-stream";

type DisplayQuestion = {
    id?: string;
    questionIndex: number;
    header?: string;
    question: string;
    options: Array<{label: string; description?: string}>;
};

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

const {t} = useI18n();
const userInputContext = inject(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, null);

// 是否展开历史所有未选候选项
const showAllOptionsExpanded = ref(false);

const toolArgsText = computed(() => {
    return props.toolCall.argsJson ?? props.toolCall.argsText;
});

/** 宽容提取结构化参数，严格契约映射后端 RequestUserInputSchema。 */
const parsedArgs = computed(() => {
    const raw = props.toolCall.argsJson ?? props.toolCall.argsText;
    const parsedObj = parseToolArgsObject<{questions?: unknown[]}>(raw);
    if (!parsedObj || typeof parsedObj !== "object" || !Array.isArray(parsedObj.questions)) {
        return null;
    }

    return {
        questions: parsedObj.questions
            .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
            .map((q) => ({
                header: typeof q.header === "string" ? q.header : undefined,
                question: typeof q.question === "string" ? q.question : "",
                options: Array.isArray(q.options)
                    ? q.options
                        .filter((opt): opt is Record<string, unknown> => Boolean(opt && typeof opt === "object"))
                        .map((opt) => ({
                            label: typeof opt.label === "string" ? opt.label : "",
                            description: typeof opt.description === "string" ? opt.description : undefined,
                        }))
                    : [],
                id: typeof q.id === "string" ? q.id : undefined,
            })),
    };
});

/** 在完整 pending 列表中定位当前历史 tool，使用安全可选链。 */
const pendingSession = computed(() => userInputContext?.pendingSessions?.value?.find((session) => {
    return session.assistantMessageId === props.toolCall.assistantMessageId
        && (session.formToolCallId === props.toolCall.id || session.questions.some((question) => {
            return question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id;
        }));
}) ?? null);

const pendingQuestion = computed<AgentPendingUserInputQuestion | null>(() => pendingSession.value?.questions.find((question) => {
    return question.toolNodeId === props.toolCall.id || question.toolCallId === props.toolCall.id;
}) ?? null);

/** 当前 tool 是否仍处于等待用户回答状态。 */
const isPendingQuestion = computed(() => {
    return Boolean(pendingSession.value);
});

/** 归一化后的问题列表。 */
const displayQuestions = computed<DisplayQuestion[]>(() => {
    if (pendingSession.value && pendingSession.value.questions.length > 0) {
        return pendingSession.value.questions.map((q, idx) => ({
            id: `q-${idx}`,
            questionIndex: q.questionIndex ?? idx,
            header: q.header,
            question: q.question,
            options: q.options ?? [],
        }));
    }

    if (parsedArgs.value?.questions && parsedArgs.value.questions.length > 0) {
        return parsedArgs.value.questions.map((q, idx) => ({
            id: q.id ?? `q-${idx}`,
            questionIndex: idx,
            header: q.header,
            question: q.question,
            options: q.options,
        }));
    }

    if (pendingQuestion.value) {
        return [{
            id: "q-0",
            questionIndex: pendingQuestion.value.questionIndex ?? 0,
            header: pendingQuestion.value.header,
            question: pendingQuestion.value.question,
            options: pendingQuestion.value.options ?? [],
        }];
    }

    return [];
});

const answerViews = computed(() => {
    return deriveRequestUserInputAnswerViews(parsedArgs.value, props.toolCall.resultData, {
        fallbackQuestion: pendingQuestion.value,
        otherLabel: t("agent.userInput.otherAnswer"),
    });
});

const isAnswered = computed(() => {
    return !isPendingQuestion.value && answerViews.value.length > 0;
});

const isFailed = computed(() => {
    return props.toolCall.status === "error" || props.toolCall.status === "invalid" || Boolean(props.toolCall.error);
});

const hasOptionsInQuestions = computed(() => {
    return displayQuestions.value.some((q) => q.options.length > 0);
});

/** 查找指定题目的已作答视图。 */
function answerForQuestion(questionIndex: number): RequestUserInputAnswerView | undefined {
    return answerViews.value.find((a) => a.questionIndex === questionIndex);
}

/** 查找选中选项的描述。 */
function getSelectedOptionDescription(question: DisplayQuestion, selectedLabel: string): string | undefined {
    return question.options.find((opt) => opt.label === selectedLabel)?.description;
}

/** 查找指定题目中未被选中的备选项。 */
function unselectedOptions(question: DisplayQuestion, answer?: RequestUserInputAnswerView) {
    if (!answer?.selectedLabel) {
        return question.options;
    }
    return question.options.filter((opt) => opt.label !== answer.selectedLabel);
}
</script>

<template>
    <!-- 方案 A【精密 IDE 工单卡】：纯平中性容器，消费统一面板色与控件圆角 -->
    <div
        class="group/card my-2 w-full rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface,var(--bg-main))] p-3.5 shadow-xs select-text transition-colors duration-200"
    >
        <!-- 顶栏元信息行：一体化流式首行，无独立背景横带 -->
        <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
                <!-- 提问状态微型图标 -->
                <span
                    v-if="isPendingQuestion"
                    class="i-lucide-clock h-4 w-4 shrink-0 text-[var(--status-warning)] animate-pulse"
                    aria-hidden="true"
                />
                <span
                    v-else-if="isFailed"
                    class="i-lucide-circle-alert h-4 w-4 shrink-0 text-[var(--status-danger)]"
                    aria-hidden="true"
                />
                <span
                    v-else-if="isAnswered"
                    class="i-lucide-check-circle-2 h-4 w-4 shrink-0 text-[var(--status-success)]"
                    aria-hidden="true"
                />
                <span
                    v-else
                    class="i-lucide-message-circle-question h-4 w-4 shrink-0 text-[var(--accent-main)]"
                    aria-hidden="true"
                />

                <!-- 标题（同字号 13px，字重区分：明确为用户提问与回答） -->
                <span class="truncate text-[13px] font-semibold text-[var(--text-main)]">
                    {{ isAnswered ? t("agent.userInput.decision") : t("agent.userInput.question") }}
                </span>

                <!-- 多题进度小微标（复用 nb-ui Badge outline） -->
                <Badge
                    v-if="displayQuestions.length > 1"
                    tone="neutral"
                    variant="outline"
                    size="sm"
                    class="tabular-nums font-mono"
                >
                    {{ isAnswered ? t("agent.userInput.answeredProgress", {answered: answerViews.length, total: displayQuestions.length}) : `${displayQuestions.length} 题` }}
                </Badge>
            </div>

            <!-- 右侧状态徽章（复用 nb-ui Badge soft dot 体系） -->
            <div class="flex shrink-0 items-center gap-2">
                <Badge
                    v-if="isPendingQuestion"
                    tone="warning"
                    variant="soft"
                    size="sm"
                    dot
                >
                    {{ t("agent.userInput.waitingAnswer") }}
                </Badge>

                <Badge
                    v-else-if="isFailed"
                    tone="danger"
                    variant="soft"
                    size="sm"
                    dot
                >
                    {{ props.toolCall.error || t("agent.userInput.assistantAborted") }}
                </Badge>

                <Badge
                    v-else-if="isAnswered"
                    tone="success"
                    variant="soft"
                    size="sm"
                    dot
                >
                    已完成作答
                </Badge>
            </div>
        </div>

        <!-- 极简发丝线替代机械厚重大框 -->
        <Separator class="my-2.5 opacity-60" />

        <!-- 题干与作答留痕主体 -->
        <div class="space-y-4">
            <!-- 结构化题干列表 -->
            <div v-if="displayQuestions.length > 0" class="space-y-4">
                <div
                    v-for="(question, qIndex) in displayQuestions"
                    :key="question.id || qIndex"
                    class="space-y-2.5"
                >
                    <!-- 题干正文：13px，行高 1.5，一级对比度 -->
                    <div>
                        <div v-if="displayQuestions.length > 1 || question.header" class="flex items-center gap-2 mb-1">
                            <Badge
                                v-if="question.header"
                                tone="neutral"
                                variant="outline"
                                size="sm"
                            >
                                {{ question.header }}
                            </Badge>
                            <span v-if="displayQuestions.length > 1" class="text-[11px] font-medium text-[var(--text-muted)] tabular-nums">
                                第 {{ qIndex + 1 }} 题 / 共 {{ displayQuestions.length }} 题
                            </span>
                        </div>
                        <div class="text-[13px] font-medium leading-relaxed text-[var(--text-main)]">
                            {{ question.question }}
                        </div>
                    </div>

                    <!-- 状态 1：已作答留痕呈现 -->
                    <template v-if="isAnswered">
                        <div
                            v-if="answerForQuestion(question.questionIndex)"
                            class="space-y-2"
                        >
                            <!-- 题型 A：带选项问答（已选择某个具体选项） -->
                            <div
                                v-if="question.options.length > 0 && answerForQuestion(question.questionIndex)?.selectedLabel"
                                class="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-2.5 space-y-1"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <span class="i-lucide-check-circle-2 h-4 w-4 shrink-0 text-[var(--status-success)]" />
                                        <span class="text-xs font-semibold text-[var(--text-main)] truncate">
                                            {{ answerForQuestion(question.questionIndex)?.selectedLabel }}
                                        </span>
                                    </div>
                                    <!-- 复用 nb-ui Badge -->
                                    <Badge
                                        tone="success"
                                        variant="soft"
                                        size="sm"
                                    >
                                        {{ t("agent.userInput.selected") }}
                                    </Badge>
                                </div>
                                <div
                                    v-if="getSelectedOptionDescription(question, answerForQuestion(question.questionIndex)!.selectedLabel)"
                                    class="pl-6 text-[11px] leading-relaxed text-[var(--text-secondary)]"
                                >
                                    {{ getSelectedOptionDescription(question, answerForQuestion(question.questionIndex)!.selectedLabel) }}
                                </div>
                            </div>

                            <!-- 题型 B：开放式问答，或者自定义其它答案（自然语言文本块） -->
                            <div
                                v-else-if="answerForQuestion(question.questionIndex)?.text"
                                class="rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)] p-2.5 space-y-1.5"
                            >
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2">
                                        <span class="i-lucide-message-square h-4 w-4 shrink-0 text-[var(--status-success)]" />
                                        <span class="text-xs font-semibold text-[var(--text-main)]">
                                            {{ question.options.length > 0 ? t("agent.userInput.otherAnswer") : t("agent.userInput.answer") }}
                                        </span>
                                    </div>
                                    <Badge
                                        tone="success"
                                        variant="soft"
                                        size="sm"
                                    >
                                        {{ t("agent.userInput.selected") }}
                                    </Badge>
                                </div>
                                <div class="pl-6 text-xs leading-relaxed text-[var(--text-main)]">
                                    {{ answerForQuestion(question.questionIndex)!.text }}
                                </div>
                            </div>

                            <!-- 附带的补充说明/建议（出版物引线式排版，不再套大方框） -->
                            <div
                                v-if="answerForQuestion(question.questionIndex)?.note"
                                class="border-l-2 border-[var(--accent-main)]/50 pl-3 py-0.5 text-xs text-[var(--text-secondary)] leading-relaxed flex flex-col gap-0.5"
                            >
                                <span class="text-[11px] font-medium text-[var(--text-muted)]">{{ t("agent.userInput.noteOptional") }}</span>
                                <span class="text-[var(--text-main)]">{{ answerForQuestion(question.questionIndex)!.note }}</span>
                            </div>

                            <!-- 选择题的其余未选候选项：复用 nb-ui Collapsible 平滑展开/收起 -->
                            <Collapsible
                                v-if="question.options.length > 0 && unselectedOptions(question, answerForQuestion(question.questionIndex)).length > 0"
                                v-model:open="showAllOptionsExpanded"
                                class="pt-1"
                            >
                                <template #trigger>
                                    <button
                                        type="button"
                                        class="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer select-none"
                                    >
                                        <span
                                            class="h-3.5 w-3.5 transition-transform duration-200"
                                            :class="showAllOptionsExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                                        />
                                        <span>{{ showAllOptionsExpanded ? t("agent.userInput.collapse") : t("agent.userInput.expand") }}</span>
                                        <span class="text-[10px] text-[var(--text-dim)]">({{ unselectedOptions(question, answerForQuestion(question.questionIndex)).length }} 项未选)</span>
                                    </button>
                                </template>

                                <div class="pt-2 space-y-1.5">
                                    <div
                                        v-for="opt in unselectedOptions(question, answerForQuestion(question.questionIndex))"
                                        :key="opt.label"
                                        class="rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-subtle)]/40 p-2 text-xs text-[var(--text-dim)]"
                                    >
                                        <div class="flex items-center gap-1.5 font-medium">
                                            <span class="i-lucide-circle h-3 w-3 shrink-0 opacity-60" />
                                            <span>{{ opt.label }}</span>
                                        </div>
                                        <div v-if="opt.description" class="pl-4.5 pt-0.5 text-[11px] opacity-75">
                                            {{ opt.description }}
                                        </div>
                                    </div>
                                </div>
                            </Collapsible>
                        </div>
                    </template>

                    <!-- 状态 2：等待作答中（按题型展示候选项或开放提示） -->
                    <template v-else-if="isPendingQuestion">
                        <!-- 选择题：展示候选选项清单 -->
                        <div v-if="question.options.length > 0" class="space-y-1.5 pt-0.5">
                            <div
                                v-for="(option, optIdx) in question.options"
                                :key="option.label"
                                class="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-subtle)]/50 p-2 text-xs"
                            >
                                <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                                    {{ optIdx + 1 }}
                                </span>
                                <div class="min-w-0 flex-1">
                                    <div class="font-medium text-[var(--text-main)]">{{ option.label }}</div>
                                    <div v-if="option.description" class="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                                        {{ option.description }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- 极简引导说明 -->
                        <div class="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-1">
                            <span class="i-lucide-corner-down-right h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                            <span>{{ t("agent.userInput.waitingAnswer") }} · 请在下方输入区待处理面板中{{ question.options.length > 0 ? "选择并确认" : "完成输入并提交" }}</span>
                        </div>
                    </template>

                    <!-- 多题之间的分隔线 -->
                    <Separator
                        v-if="displayQuestions.length > 1 && qIndex < displayQuestions.length - 1"
                        class="my-3 opacity-40"
                    />
                </div>
            </div>

            <!-- 参数流式输出回退态 -->
            <div
                v-else
                class="rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-input)] p-2.5 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all leading-relaxed"
            >
                {{ toolArgsText || t("agent.userInput.streamingArgs") }}
            </div>

            <!-- 执行失败提示条 -->
            <div
                v-if="isFailed"
                class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_10%,transparent)] px-2.5 py-2 text-xs text-[var(--status-danger)]"
            >
                <span class="i-lucide-alert-triangle h-4 w-4 shrink-0" />
                <span>{{ props.toolCall.error || t("agent.userInput.assistantAborted") }}</span>
            </div>
        </div>
    </div>
</template>
