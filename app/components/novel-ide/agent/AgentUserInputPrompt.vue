<script setup lang="ts">
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import AgentComposerInput from "nbook/app/components/novel-ide/agent/AgentComposerInput.vue";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";
import {
    isPlanSuggestion,
    pendingResolutionItemComplete,
    pendingResolutionItems,
    updateAgentPendingFormDraft,
    type AgentPendingFormItem,
    type AgentPendingResolutionDraft,
    type AgentPendingSubmissionIssue,
} from "nbook/app/components/novel-ide/agent/agent-pending-resolution";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {LowCodeJsonObject} from "nbook/shared/dto/low-code-form.dto";

const NONE_OF_ABOVE_OPTION_INDEX = -1;

const props = defineProps<{
    sessions: readonly AgentPendingUserInputSession[];
    draft: AgentPendingResolutionDraft;
    submitting?: boolean;
    canResolve: boolean;
    canAbort: boolean;
    blockedMessage?: string;
    submissionIssue?: AgentPendingSubmissionIssue | null;
    menuRefreshKey: string | number;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
}>();

const emit = defineEmits<{
    (e: "update:draft", value: AgentPendingResolutionDraft): void;
    (e: "submit"): void;
    (e: "cancel"): void;
    (e: "resync"): void;
}>();

const {t} = useI18n();
const activeKey = ref("");
const answerInputRef = ref<InstanceType<typeof AgentComposerInput> | null>(null);
const contentScrollRef = ref<HTMLDivElement | null>(null);
const items = computed(() => pendingResolutionItems(props.sessions));
const activeIndex = computed(() => Math.max(0, items.value.findIndex((item) => item.key === activeKey.value)));
const activeItem = computed(() => items.value[activeIndex.value] ?? null);
const activeQuestion = computed(() => activeItem.value?.kind === "form" ? null : activeItem.value?.question ?? null);
const activeForm = computed<AgentPendingFormItem | null>(() => activeItem.value?.kind === "form" ? activeItem.value : null);
const activeAnswer = computed(() => {
    const item = activeItem.value;
    return item && item.kind !== "form" ? props.draft.answers[item.key] ?? {note: ""} : {note: ""};
});
const activeFormDraft = computed(() => activeForm.value
    ? props.draft.forms[activeForm.value.key] ?? {data: {}, confirmed: false}
    : {data: {}, confirmed: false});
const completedCount = computed(() => items.value.filter((item) => pendingResolutionItemComplete(item, props.draft)).length);
const allComplete = computed(() => items.value.length > 0 && completedCount.value === items.value.length);
const currentComplete = computed(() => Boolean(activeItem.value && pendingResolutionItemComplete(activeItem.value, props.draft)));
const submissionUnknown = computed(() => props.submissionIssue?.kind === "unknown");
const answerControlsDisabled = computed(() => !props.canResolve || Boolean(props.submitting) || submissionUnknown.value);
const planSuggestionSelected = computed(() => Boolean(
    activeQuestion.value
    && isPlanSuggestion(activeQuestion.value, activeAnswer.value.selectedOptionIndex),
));
/** 备注/回答输入区常显（Task 137）：未选选项时也直接展示，减少一次点击才发现入口的成本。 */
const showNoteInput = computed(() => Boolean(activeQuestion.value));
const primaryLabel = computed(() => {
    if (activeForm.value && !activeFormDraft.value.confirmed) return t("agent.userInput.confirmItem");
    if (allComplete.value) return t("agent.userInput.submitAll");
    return t("agent.userInput.next");
});
const primaryDisabled = computed(() => {
    if (answerControlsDisabled.value || !activeItem.value) return true;
    if (activeForm.value && !activeFormDraft.value.confirmed) return false;
    return !currentComplete.value;
});
const questionTypeLabel = computed(() => {
    if (activeForm.value) return t("agent.userInput.formRequest");
    if (activeItem.value?.kind === "approval") return t("agent.userInput.approval");
    return t("agent.userInput.currentRequest");
});
const noteLabel = computed(() => {
    const question = activeQuestion.value;
    if (!question || question.options.length === 0) return t("agent.userInput.answerRequired");
    if (planSuggestionSelected.value) return t("agent.userInput.suggestionRequired");
    if (activeAnswer.value.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX) return t("agent.userInput.otherAnswerRequired");
    return activeItem.value?.kind === "approval"
        ? t("agent.userInput.approvalReasonOptional")
        : t("agent.userInput.noteOptional");
});
const notePlaceholder = computed(() => {
    const question = activeQuestion.value;
    if (!question || question.options.length === 0) return t("agent.userInput.answerPlaceholder");
    if (planSuggestionSelected.value) return t("agent.userInput.suggestionPlaceholder");
    if (activeAnswer.value.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX) return t("agent.userInput.otherAnswerPlaceholder");
    return activeItem.value?.kind === "approval"
        ? t("agent.userInput.approvalReasonPlaceholder")
        : t("agent.userInput.notePlaceholder");
});

/** pending 重投影时保留当前身份，否则跳到第一个未完成项目。 */
watch(() => items.value.map((item) => item.key).join("\n"), () => {
    if (items.value.some((item) => item.key === activeKey.value)) return;
    activeKey.value = items.value.find((item) => !pendingResolutionItemComplete(item, props.draft))?.key
        ?? items.value[0]?.key
        ?? "";
}, {immediate: true});

/** 不同项目共享固定面板，但滚动位置必须回到新项目顶部。 */
watch(activeKey, () => {
    void nextTick(() => {
        contentScrollRef.value?.scrollTo({top: 0});
    });
});

/** 切换当前待处理项目。 */
function switchItem(nextIndex: number): void {
    const item = items.value[Math.min(Math.max(nextIndex, 0), items.value.length - 1)];
    if (item) activeKey.value = item.key;
}

/** 为原生 radio 生成当前面板内稳定的 DOM id。 */
function optionId(optionIndex: number): string {
    return `agent-pending-${String(activeIndex.value)}-${optionIndex === NONE_OF_ABOVE_OPTION_INDEX ? "other" : String(optionIndex)}`;
}

/** 更新当前问题的单选答案。 */
function selectOption(optionIndex: number): void {
    const item = activeItem.value;
    if (!item || item.kind === "form" || answerControlsDisabled.value) return;
    emit("update:draft", {
        answers: {
            ...props.draft.answers,
            [item.key]: {...activeAnswer.value, selectedOptionIndex: optionIndex},
        },
        forms: props.draft.forms,
    });
    if (optionIndex === NONE_OF_ABOVE_OPTION_INDEX) {
        void nextTick(() => answerInputRef.value?.focus());
    }
}

/** 更新当前问题的开放回答或补充说明。 */
function updateNote(note: string): void {
    const item = activeItem.value;
    if (!item || item.kind === "form" || answerControlsDisabled.value) return;
    emit("update:draft", {
        answers: {
            ...props.draft.answers,
            [item.key]: {...activeAnswer.value, note},
        },
        forms: props.draft.forms,
    });
}

/** pending 回答只消费引用与 skill chip，不暴露会改写 Session 的斜杠命令。 */
function resolveAnswerMenu(context: AgentTriggerMenuContext): AgentTriggerMenuState {
    const state = props.resolveMenu(context);
    return context.kind === "command" ? {...state, sections: []} : state;
}

/** 表单修改后撤销显式确认，防止提交用户尚未复核的新值。 */
function updateForm(data: LowCodeJsonObject): void {
    const item = activeForm.value;
    if (!item || answerControlsDisabled.value) return;
    emit("update:draft", updateAgentPendingFormDraft(props.draft, item.key, data));
}

/** 显式确认当前 Low-Code Form。 */
function confirmForm(item: AgentPendingFormItem): void {
    emit("update:draft", {
        answers: props.draft.answers,
        forms: {
            ...props.draft.forms,
            [item.key]: {...activeFormDraft.value, confirmed: true},
        },
    });
}

/** 当前项目完成后前往下一未完成项；全部完成时提交整批 resolution。 */
function handlePrimary(): void {
    const item = activeItem.value;
    if (!item || primaryDisabled.value) return;
    if (item.kind === "form" && !activeFormDraft.value.confirmed) {
        confirmForm(item);
        return;
    }
    if (allComplete.value) {
        emit("submit");
        return;
    }
    const nextIndex = items.value.findIndex((candidate, index) => index > activeIndex.value
        && !pendingResolutionItemComplete(candidate, props.draft));
    const fallbackIndex = items.value.findIndex((candidate) => !pendingResolutionItemComplete(candidate, props.draft));
    switchItem(nextIndex >= 0 ? nextIndex : fallbackIndex);
}
</script>

<template>
    <!-- Task 63：唯一的会话待处理输入入口；历史气泡只展示摘要。 -->
    <section
        v-if="activeItem"
        class="grid h-[clamp(320px,50dvh,420px)] min-w-0 w-full grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-[var(--status-warning-border)] bg-[var(--bg-input)] shadow-sm"
        role="region"
        :aria-label="t('agent.userInput.pendingRegion')"
        :aria-busy="props.submitting ? 'true' : 'false'"
    >
        <header class="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2">
            <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[var(--status-warning)]">
                    <span class="inline-flex items-center gap-1.5"><span class="i-lucide-message-square-more h-3.5 w-3.5"></span>{{ t("agent.userInput.pendingTitle") }}</span>
                    <span class="rounded-full border border-[var(--status-warning-border)] bg-[var(--bg-input)] px-2 py-0.5 tabular-nums">{{ activeIndex + 1 }} / {{ items.length }}</span>
                    <span class="rounded-full border border-[var(--status-warning-border)] bg-[var(--bg-input)] px-2 py-0.5 tabular-nums">{{ t("agent.userInput.answeredProgress", {answered: completedCount, total: items.length}) }}</span>
                </div>
                <div class="mt-0.5 text-xs font-medium text-[var(--text-main)]">{{ questionTypeLabel }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-1 text-[var(--text-muted)]">
                <button type="button" class="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35" :disabled="activeIndex === 0" :title="t('agent.userInput.previous')" @click="switchItem(activeIndex - 1)">
                    <span class="i-lucide-chevron-left h-3.5 w-3.5"></span>
                </button>
                <button type="button" class="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-35" :disabled="activeIndex >= items.length - 1" :title="t('agent.userInput.nextQuestion')" @click="switchItem(activeIndex + 1)">
                    <span class="i-lucide-chevron-right h-3.5 w-3.5"></span>
                </button>
            </div>
        </header>

        <div>
            <div v-if="!props.canResolve && props.blockedMessage" class="flex items-start gap-2 border-b border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs leading-5 text-[var(--status-danger)]" role="status">
                <span class="i-lucide-octagon-alert mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                <span>{{ props.blockedMessage }}</span>
            </div>
            <div v-if="props.submissionIssue" class="flex items-start gap-2 border-b px-3 py-2 text-xs leading-5" :class="props.submissionIssue.kind === 'unknown' ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]' : 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]'" role="status">
                <span :class="props.submissionIssue.kind === 'unknown' ? 'i-lucide-circle-help' : 'i-lucide-circle-alert'" class="mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                <span class="min-w-0 flex-1">{{ props.submissionIssue.message }}</span>
                <button v-if="props.submissionIssue.kind === 'unknown'" type="button" class="shrink-0 rounded border border-current px-2 py-0.5 font-medium hover:bg-[var(--bg-hover)]" @click="emit('resync')">{{ t("agent.userInput.resync") }}</button>
            </div>
        </div>

        <div class="min-h-0">
            <!-- Low-Code Form 项目 -->
            <div v-if="activeForm && activeForm.session.form" ref="contentScrollRef" class="h-full overflow-y-auto px-3 py-3">
                <LowCodeForm :form="activeForm.session.form" :model-value="activeFormDraft.data" :disabled="answerControlsDisabled" @update:model-value="updateForm" />
                <div class="mt-3 flex items-center gap-2 text-xs" :class="activeFormDraft.confirmed ? 'text-[var(--status-success)]' : 'text-[var(--text-muted)]'">
                    <span :class="activeFormDraft.confirmed ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'" class="h-3.5 w-3.5"></span>
                    <span>{{ activeFormDraft.confirmed ? t("agent.userInput.itemConfirmed") : t("agent.userInput.formNeedsConfirmation") }}</span>
                </div>
            </div>

            <!-- 问答与审批项目 -->
            <div v-else-if="activeQuestion" class="flex h-full min-h-0 flex-col">
                <div ref="contentScrollRef" class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    <div v-if="activeQuestion.header" class="mb-1 text-[11px] font-medium text-[var(--text-muted)]">{{ activeQuestion.header }}</div>
                    <h3 class="break-words text-sm font-semibold leading-6 text-[var(--text-main)]">{{ activeQuestion.question }}</h3>

                    <fieldset v-if="activeQuestion.options.length > 0" class="mt-3 space-y-1.5" :disabled="answerControlsDisabled">
                        <legend class="sr-only">{{ activeQuestion.question }}</legend>
                        <label v-for="(option, index) in activeQuestion.options" :key="index" :for="optionId(index)" class="group flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-hover)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55" :class="activeAnswer.selectedOptionIndex === index ? 'bg-[var(--accent-bg)] shadow-[inset_2px_0_0_var(--accent-main)]' : ''">
                            <input :id="optionId(index)" type="radio" :name="`agent-pending-${activeItem.key}`" class="sr-only" :checked="activeAnswer.selectedOptionIndex === index" :disabled="answerControlsDisabled" @change="selectOption(index)">
                            <span class="w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{{ index + 1 }}.</span>
                            <span class="min-w-0 flex-1">
                                <span class="block text-[13px] font-semibold leading-5" :class="activeAnswer.selectedOptionIndex === index ? 'text-[var(--text-main)]' : 'text-[var(--text-secondary)]'">{{ option.label }}</span>
                                <span v-if="option.description" class="block text-[11px] leading-4 text-[var(--text-muted)]">{{ option.description }}</span>
                            </span>
                            <span class="mt-0.5 h-4 w-4 shrink-0 rounded-full border" :class="activeAnswer.selectedOptionIndex === index ? 'border-[var(--accent-main)] bg-[var(--accent-main)] shadow-[inset_0_0_0_2px_var(--bg-main)]' : 'border-[var(--border-color)] group-hover:border-[var(--text-muted)]'"></span>
                        </label>

                        <label v-if="activeItem.kind === 'question' || (activeItem.kind === 'approval' && activeQuestion.approvalAction === 'switch_mode' && activeQuestion.switchTargetMode === 'normal')" :for="optionId(NONE_OF_ABOVE_OPTION_INDEX)" class="group flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--bg-hover)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55" :class="activeAnswer.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX ? 'bg-[var(--accent-bg)] shadow-[inset_2px_0_0_var(--accent-main)]' : ''">
                            <input :id="optionId(NONE_OF_ABOVE_OPTION_INDEX)" type="radio" :name="`agent-pending-${activeItem.key}`" class="sr-only" :checked="activeAnswer.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX" :disabled="answerControlsDisabled" @change="selectOption(NONE_OF_ABOVE_OPTION_INDEX)">
                            <span class="w-5 shrink-0 pt-0.5 text-right text-xs tabular-nums text-[var(--text-muted)]">{{ activeQuestion.options.length + 1 }}.</span>
                            <span class="min-w-0 flex-1">
                                <span class="block text-[13px] font-semibold leading-5" :class="activeAnswer.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX ? 'text-[var(--text-main)]' : 'text-[var(--text-secondary)]'">{{ activeItem.kind === 'approval' ? t("agent.userInput.addSuggestion") : t("agent.userInput.otherAnswer") }}</span>
                                <span class="block text-[11px] leading-4 text-[var(--text-muted)]">{{ activeItem.kind === 'approval' ? t("agent.userInput.suggestionDescription") : t("agent.userInput.otherAnswerDescription") }}</span>
                            </span>
                            <span class="mt-0.5 h-4 w-4 shrink-0 rounded-full border" :class="activeAnswer.selectedOptionIndex === NONE_OF_ABOVE_OPTION_INDEX ? 'border-[var(--accent-main)] bg-[var(--accent-main)] shadow-[inset_0_0_0_2px_var(--bg-main)]' : 'border-[var(--border-color)] group-hover:border-[var(--text-muted)]'"></span>
                        </label>
                    </fieldset>
                </div>

                <!-- 回答编辑器固定在选项区下方，不随长问题滚出面板。 -->
                <div v-if="showNoteInput" class="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-3 py-2">
                    <span class="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{{ noteLabel }}</span>
                    <AgentComposerInput
                        :key="activeItem.key"
                        ref="answerInputRef"
                        :model-value="activeAnswer.note"
                        :placeholder="notePlaceholder"
                        :aria-label="noteLabel"
                        :readonly="answerControlsDisabled"
                        :min-height="72"
                        :max-height="112"
                        :submit-on-enter="false"
                        :submit-on-modifier-enter="false"
                        :enable-image-files="false"
                        :menu-refresh-key="props.menuRefreshKey"
                        :resolve-menu="resolveAnswerMenu"
                        :on-skill-trigger-start="props.onSkillTriggerStart"
                        @update:model-value="updateNote"
                    />
                </div>
            </div>
        </div>

        <footer class="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] bg-[var(--bg-panel)]/50 px-3 py-2">
            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)] disabled:cursor-not-allowed disabled:opacity-40" :disabled="props.submitting || !props.canAbort" @click="emit('cancel')">
                <span class="i-lucide-square h-3.5 w-3.5"></span>
                <span>{{ t("agent.userInput.terminateRun") }}</span>
            </button>
            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-xs font-semibold text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="primaryDisabled" @click="handlePrimary">
                <span>{{ primaryLabel }}</span>
                <span v-if="props.submitting" class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>
                <span v-else-if="allComplete" class="i-lucide-corner-down-left h-3.5 w-3.5"></span>
                <span v-else class="i-lucide-arrow-right h-3.5 w-3.5"></span>
            </button>
        </footer>
    </section>
</template>
