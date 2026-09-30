<script setup lang="ts">
import AgentRequestUserInputCard from "../../components/novel-ide/agent/bubbles/interactive/AgentRequestUserInputCard.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {computed, provide} from "vue";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentRequestUserInputCard>(() => props.input);
import LabFixtureControls from "../LabFixtureControls.vue";
import type {AgentPendingUserInputSession, AgentToolCall} from "../../components/novel-ide/agent/agent-message";
import {AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, type AgentRequestUserInputContext} from "../../components/novel-ide/agent/bubbles/interactive/request-user-input-context";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {parseToolArgsObject} from "../../components/novel-ide/agent/tool-args-stream";
const toolCall = computed(() => subject.bindings.value.toolCall);
const pendingSessions = computed<AgentPendingUserInputSession[]>(() => {
    const call = toolCall.value;
    if (call.status !== "running") return [];
    const parsed = parseToolArgsObject<{questions?: Array<{id?: string; header?: string; question: string; options?: Array<{label: string; description?: string}>}>}>(call.argsJson ?? call.argsText);
    if (!Array.isArray(parsed?.questions)) return [];
    return [{assistantMessageId: call.assistantMessageId ?? "msg-assistant-1", status: "pending", questions: parsed.questions.map((q, i) => ({
        id: q.id ?? `q-${i}`, toolNodeId: call.id, toolCallId: call.id, questionIndex: i, toolName: "request_user_input",
        kind: q.header === "审批" || /批准|审批|tool_approval/u.test(q.question) ? "tool_approval" : "question",
        header: q.header, question: q.question, options: q.options ?? [],
    }))}];
});
provide<AgentRequestUserInputContext>(AGENT_REQUEST_USER_INPUT_CONTEXT_KEY, {pendingSessions});
function updateCall(patch: Partial<typeof toolCall.value>): void { subject.write("props", "toolCall", {...toolCall.value, ...patch}); }
function handleSelectChoice(choiceIndex: number): void {
    const call = toolCall.value;
    const answers = ((call.resultData as {answers?: Array<Record<string, JsonValue>>} | undefined)?.answers ?? []).map(answer => ({...answer}));
    if (answers.length) answers[0] = {...answers[0], selectedOptionIndex: choiceIndex};
    else answers.push({questionIndex: 0, selectedOptionIndex: choiceIndex, note: ""});
    updateCall({status: "success", resultData: {answers}});
}
function handleAddCustomNote(): void {
    const call = toolCall.value;
    const answers = ((call.resultData as {answers?: Array<Record<string, JsonValue>>} | undefined)?.answers ?? []).map(answer => ({...answer}));
    if (answers.length) answers[0] = {...answers[0], note: "在第三章末尾预留钟楼线索的伏笔备忘录"};
    else answers.push({questionIndex: 0, note: "在第三章末尾预留钟楼线索的伏笔备忘录"});
    updateCall({status: "success", resultData: {answers}});
}
function handleResetPending(): void { updateCall({status: "running", resultData: undefined}); }
function handleSetFailed(): void { updateCall({status: "error", error: "用户取消了本次决策流程或已超时", resultData: undefined}); }
</script>
<template>
    <AgentRequestUserInputCard data-lab-subject class="w-full" v-bind="subject.bindings.value" :tool-call="subject.bindings.value.toolCall as AgentToolCall" />
    <!-- 底部交互控制抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <div class="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span class="i-lucide-sparkles h-3.5 w-3.5 text-[var(--accent)]" />
                <span>只读留痕卡片 · 交互调试</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleSelectChoice(0)"
                >
                    <span class="i-lucide-check h-3 w-3 text-[var(--status-success)]" />
                    <span>选选项 1</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleSelectChoice(1)"
                >
                    <span class="i-lucide-check h-3 w-3 text-[var(--status-success)]" />
                    <span>选选项 2</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] cursor-pointer"
                    @click="handleAddCustomNote"
                >
                    <span class="i-lucide-pen-line h-3 w-3 text-[var(--accent)]" />
                    <span>追加备注说明</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-2 text-[11px] text-[var(--status-warning)] hover:brightness-95 cursor-pointer"
                    @click="handleResetPending"
                >
                    <span class="i-lucide-clock h-3 w-3" />
                    <span>设为等待作答</span>
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2 text-[11px] text-[var(--status-danger)] hover:brightness-95 cursor-pointer"
                    @click="handleSetFailed"
                >
                    <span class="i-lucide-circle-alert h-3 w-3" />
                    <span>设为执行失败</span>
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
