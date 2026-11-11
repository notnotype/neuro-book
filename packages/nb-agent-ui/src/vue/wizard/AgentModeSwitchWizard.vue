<script setup lang="ts">
/**
 * 模型申请切换 Agent 模式的向导（见同名 `.md`，docs/specs/agent/modes.md 输出 8–10）。退出 `plan` 时是看计划、批准的地方：计划占满内容区，
 * 审批模式与按钮固定在下面，所以长计划也能边滚边看到要点的按钮。
 */
import {computed} from "vue";
import {Button, SegmentedControl, Textarea} from "@notnotype/nb-ui/components";

import type {PendingModeSwitchView} from "../../types";
import type {WizardState} from "../../wizard";
import {useAgentText} from "../host";
import AgentMarkdown from "../parts/AgentMarkdown.vue";
import AgentWizardFrame from "./AgentWizardFrame.vue";

const props = defineProps<{
    item: PendingModeSwitchView;
    state: WizardState;
}>();

const emit = defineEmits<{
    "update:state": [state: WizardState];
    answer: [answer: {approved: boolean; approvalMode?: string; note?: string}];
    collapse: [];
}>();

const {t, text} = useAgentText();

const hasPlan = computed(() => props.item.plan !== undefined);
/** 批准计划时才问审批模式；宿主没给当前模式（后代会话的请求）就不问，免得把猜的值当成“不变”。 */
const approval = computed(() => (hasPlan.value ? props.item.approval : undefined));
const note = computed(() => props.state.notes[props.item.id] ?? "");
const noted = computed(() => note.value.trim() !== "");
/** 默认保持当前审批模式，不替用户放宽（开发者 2026-11-06 定）。 */
const approvalMode = computed(() => props.state.modeSwitch?.[props.item.id]?.approvalMode ?? approval.value?.value ?? "");
const approvalOptions = computed(() => (approval.value?.options ?? []).map((option) => ({value: option.key, label: text(option.label), title: text(option.description)})));
const selectedOption = computed(() => approval.value?.options.find((item) => item.key === approvalMode.value));
const selectedDescription = computed(() => (selectedOption.value === undefined ? "" : text(selectedOption.value.description)));
const yolo = computed(() => selectedOption.value?.danger === true);

function setNote(value: string): void {
    emit("update:state", {...props.state, notes: {...props.state.notes, [props.item.id]: value}});
}
function setApproval(value: string): void {
    emit("update:state", {...props.state, modeSwitch: {...props.state.modeSwitch, [props.item.id]: {approvalMode: value}}});
}
function approve(): void {
    emit("answer", {approved: true, ...(approval.value !== undefined && approvalMode.value !== approval.value.value ? {approvalMode: approvalMode.value} : {})});
}
function decline(): void {
    const trimmed = note.value.trim();
    emit("answer", {approved: false, ...(trimmed === "" ? {} : {note: trimmed})});
}
</script>

<template>
    <AgentWizardFrame
        :icon="hasPlan ? 'i-lucide-clipboard-check' : 'i-lucide-toggle-right'"
        :title="hasPlan ? t('wizard.modeSwitch.planTitle') : t('wizard.modeSwitch.title', {to: props.item.toLabel})"
        :detail="hasPlan ? 'session://plan.md' : undefined"
        :tall="hasPlan"
        :large="hasPlan"
        @collapse="emit('collapse')"
    >
        <div v-if="hasPlan" class="acv-mode-switch__plan" data-mode-switch-plan>
            <AgentMarkdown :text="props.item.plan ?? ''" />
        </div>
        <p v-else class="acv-mode-switch__line">{{ t("wizard.modeSwitch.line", {from: props.item.fromLabel, to: props.item.toLabel}) }}</p>
        <template #foot>
            <div v-if="approval !== undefined" class="acv-mode-switch__approval">
                <span class="acv-mode-switch__label">{{ t("wizard.modeSwitch.approvalLabel") }}</span>
                <SegmentedControl :model-value="approvalMode" :options="approvalOptions" size="sm" data-mode-switch-approval @update:model-value="setApproval(String($event))" />
                <small class="acv-mode-switch__hint" :class="{'is-danger': yolo}">{{ selectedDescription }}</small>
            </div>
            <Textarea
                :model-value="note"
                class="acv-mode-switch__input"
                :rows="1"
                :placeholder="hasPlan ? t('wizard.modeSwitch.notePlaceholderPlan') : t('wizard.modeSwitch.notePlaceholder')"
                :aria-label="hasPlan ? t('wizard.modeSwitch.notePlaceholderPlan') : t('wizard.modeSwitch.notePlaceholder')"
                data-mode-switch-note
                @update:model-value="setNote($event)"
            />
            <div class="acv-mode-switch__actions">
                <Button size="sm" variant="primary" :disabled="noted" data-mode-switch-approve @click="approve">{{ hasPlan ? t("wizard.modeSwitch.approvePlan") : t("wizard.modeSwitch.approve") }}</Button>
                <Button size="sm" variant="subtle" data-mode-switch-decline @click="decline">{{ hasPlan ? t("wizard.modeSwitch.keepEditing") : t("wizard.modeSwitch.decline") }}</Button>
            </div>
        </template>
    </AgentWizardFrame>
</template>

<style scoped>
.acv-mode-switch__line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.acv-mode-switch__approval {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-bottom: 8px;
}

.acv-mode-switch__label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
}

.acv-mode-switch__hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.acv-mode-switch__hint.is-danger {
    color: var(--status-danger);
}

.acv-mode-switch__input {
    width: 100%;
}

.acv-mode-switch__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
</style>
