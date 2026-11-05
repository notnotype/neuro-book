<script setup lang="ts">
/**
 * 等用户时替换输入框的向导（docs/specs/agent/conversation.md 输出 10–14）。放在消息流内容的末尾、`position: sticky`：它占的高度就是留白，
 * 贴底时不盖最后一条，往上滚时浮在内容上，跟随底部的逻辑不用改。
 *
 * 界面状态（第几步、选了什么、收起没有）在这里，每次变化经 `wizard.state` 交给宿主、宿主经 `ctx.wizardState` 放回：编辑区页面切标签
 * 会卸载这个组件，切回来答案还在。挂载时读一次；之后这里是准的，宿主的回写不用再读。
 *
 * 焦点：出现时到容器（不到批准按钮：用户可能正在打字，回车会直接批）；没有焦点陷阱，消息流还要能读；收起后到展开按钮。
 */
import {computed, nextTick, onMounted, ref, watch} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";

import type {InputResolution, JsonValue, PendingInputView} from "../../types";
import {approvalResolution, EMPTY_WIZARD, isApproval, isQuestions, questionResolution, readWizardState} from "../../wizard";
import type {WizardState} from "../../wizard";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";
import AgentApprovalWizard from "./AgentApprovalWizard.vue";
import AgentQuestionWizard from "./AgentQuestionWizard.vue";

const props = defineProps<{
    pending: readonly PendingInputView[];
    state?: JsonValue | undefined;
}>();

const emit = defineEmits<{action: [action: ViewAction]}>();

const {t} = useAgentText();
const state = ref<WizardState>(readWizardState(props.state));
const rootRef = ref<HTMLElement | null>(null);

const approvals = computed(() => props.pending.filter(isApproval));
const questions = computed(() => props.pending.find(isQuestions) ?? null);
const showApprovals = computed(() => approvals.value.length > 0);
const announcement = computed(() => (showApprovals.value ? t("wizard.announce.approval", {count: approvals.value.length}) : t("wizard.announce.question")));

function setState(next: WizardState): void {
    state.value = next;
    emit("action", {type: "wizard.state", state: next as unknown as JsonValue});
}

function focusRoot(): void {
    // 容器可能比可见区域高，滚动的事交给 sticky。
    rootRef.value?.focus({preventScroll: true});
}

function setCollapsed(collapsed: boolean): void {
    setState({...state.value, collapsed});
    void nextTick(() => {
        if (collapsed) rootRef.value?.querySelector<HTMLElement>("[data-wizard-expand]")?.focus();
        else focusRoot();
    });
}

onMounted(() => {
    if (props.pending.length > 0) focusRoot();
});

// 这一批的 id 变了：新的一批从头来，上一批选的不算数。别的窗口先答了的事项从列表里消失，这里跟着走（输出 14）。
const batchKey = computed(() => props.pending.map((item) => item.id).join(" "));
watch(batchKey, (key, previous) => {
    if (key === "") {
        setState(EMPTY_WIZARD);
        return;
    }
    const known = new Set(previous.split(" "));
    if (props.pending.some((item) => !known.has(item.id))) {
        setState({...EMPTY_WIZARD, approvals: {}, answers: {}});
        void nextTick(focusRoot);
    }
});

function submit(id: string, resolutions: InputResolution): void {
    emit("action", {type: "input.submit", batchKey: id, resolutions});
}

function submitApprovals(): void {
    for (const item of approvals.value) {
        const choice = state.value.approvals[item.id];
        if (choice !== undefined) submit(item.id, approvalResolution(choice));
    }
}

function denyAll(note: string): void {
    for (const item of approvals.value) submit(item.id, {kind: "approval", decision: "deny", ...(note === "" ? {} : {note})});
}

function submitQuestions(): void {
    const item = questions.value;
    if (item === null) return;
    submit(item.id, questionResolution(item.questions, state.value.answers[item.id] ?? [], {other: t("wizard.question.otherLabel"), form: t("wizard.question.formLabel")}));
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    setCollapsed(true);
}

const collapsedWhat = computed(() => {
    const item = showApprovals.value ? approvals.value[Math.min(state.value.step, approvals.value.length - 1)] : null;
    if (item !== undefined && item !== null) return item.tool;
    return questions.value?.questions[0]?.question ?? "";
});
</script>

<template>
    <div ref="rootRef" class="acv-wizard" role="group" tabindex="-1" :aria-label="announcement" data-agent-wizard data-stream-scroll-ignore @keydown="onKeydown">
        <span class="sr-only" aria-live="polite">{{ announcement }}</span>
        <div v-if="state.collapsed" class="acv-wizard__collapsed nb-ui-popover-surface" data-wizard-collapsed>
            <span class="acv-wizard__dot" aria-hidden="true" />
            <b>{{ showApprovals ? t("wizard.waitingApproval") : t("wizard.waitingAnswer") }}</b>
            <span class="acv-wizard__what">{{ collapsedWhat }}</span>
            <span class="acv-wizard__spacer" />
            <span v-if="showApprovals && approvals.length > 1" class="acv-wizard__count">{{ t("wizard.count", {index: Math.min(state.step, approvals.length - 1) + 1, total: approvals.length}) }}</span>
            <IconButton icon-class="i-lucide-chevron-up" size="sm" :title="t('wizard.expand')" :aria-label="t('wizard.expand')" data-wizard-expand @click="setCollapsed(false)" />
        </div>
        <AgentApprovalWizard
            v-else-if="showApprovals"
            :items="approvals"
            :state="state"
            @update:state="setState"
            @submit="submitApprovals"
            @deny-all="denyAll"
            @collapse="setCollapsed(true)"
        />
        <AgentQuestionWizard
            v-else-if="questions !== null"
            :key="questions.id"
            :item="questions"
            :state="state"
            @update:state="setState"
            @submit="submitQuestions"
            @stop="emit('action', {type: 'input.cancelRun'})"
            @collapse="setCollapsed(true)"
        />
    </div>
</template>

<style scoped>
.acv-wizard {
    position: sticky;
    bottom: 6px;
    z-index: 3;
    overflow-anchor: none;
    margin-block: 8px 6px;
    outline: none;
}

.acv-wizard__collapsed {
    --nb-popover-pad: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 6px 0 12px;
    /* 定稿：比浮层轻，小条不该抢注意力。 */
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 10%, transparent);
    font-size: var(--text-xs);
}

.acv-wizard__collapsed b {
    color: var(--accent-text);
    font-weight: var(--weight-medium);
}

.acv-wizard__dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main);
}

.acv-wizard__what {
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-wizard__spacer {
    flex: 1;
}

.acv-wizard__count {
    flex-shrink: 0;
    color: var(--text-muted);
}
</style>
