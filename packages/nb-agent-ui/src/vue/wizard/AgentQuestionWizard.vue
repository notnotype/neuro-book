<script setup lang="ts">
/**
 * 提问向导（docs/specs/agent/conversation.md 输出 13）：一次 1 到 4 题，单选或多选，总带“其它”；带表单的题用 `renderers.form`。
 * 已答的答案在提交前可以来回改。
 */
import {computed} from "vue";
import {Button, CheckboxGroup, Input, RadioGroup} from "@notnotype/nb-ui/components";

import type {JsonValue, PendingQuestionsView} from "../../types";
import {answered, emptyAnswer} from "../../wizard";
import type {QuestionAnswer, WizardState} from "../../wizard";
import {useAgentRenderers, useAgentText} from "../host";
import AgentWizardFrame from "./AgentWizardFrame.vue";

const props = defineProps<{
    item: PendingQuestionsView;
    state: WizardState;
}>();

const emit = defineEmits<{
    "update:state": [state: WizardState];
    submit: [];
    stop: [];
    collapse: [];
}>();

const {t} = useAgentText();
const renderers = useAgentRenderers();

const step = computed(() => Math.min(props.state.step, props.item.questions.length - 1));
const question = computed(() => props.item.questions[step.value]!);
const answers = computed(() => props.state.answers[props.item.id] ?? []);
const answer = computed(() => answers.value[step.value] ?? emptyAnswer());
const total = computed(() => props.item.questions.length);

const isAnswered = (index: number) => answered(props.item.questions[index]!, answers.value[index]);
const allAnswered = computed(() => props.item.questions.every((_, index) => isAnswered(index)));

function update(change: Partial<QuestionAnswer>): void {
    const next = [...answers.value];
    next[step.value] = {...answer.value, ...change};
    emit("update:state", {...props.state, answers: {...props.state.answers, [props.item.id]: next}});
}

/** 表单组件一挂上就报一次；没变时不写，免得切回来多发一次状态。 */
function onFormValid(valid: boolean): void {
    if ((answer.value.formInvalid === true) !== valid) return;
    update({formInvalid: !valid});
}

function go(delta: number): void {
    emit("update:state", {...props.state, step: step.value + delta});
}

const radioOptions = computed(() => question.value.options.map((option) => ({value: option.label, label: option.label, ...(option.description === undefined ? {} : {description: option.description})})));
const single = computed(() => answer.value.selected[0] ?? "");
const count = computed(() => (total.value > 1 ? t("wizard.questionCount", {index: step.value + 1, total: total.value}) : undefined));
</script>

<template>
    <AgentWizardFrame icon="i-lucide-message-circle-question" :title="question.header || question.question" :count="count" :tall="question.form !== undefined" @collapse="emit('collapse')">
        <p v-if="question.header" class="acv-question__text">{{ question.question }}</p>
        <CheckboxGroup v-if="question.multiSelect" :model-value="answer.selected" :options="radioOptions" orientation="vertical" data-question-options @update:model-value="update({selected: $event as string[]})" />
        <RadioGroup v-else :model-value="single" :options="radioOptions" data-question-options @update:model-value="update({selected: $event === '' ? [] : [$event as string]})" />
        <component
            :is="renderers.form"
            v-if="question.form !== undefined"
            :key="`${props.item.id}:${step}`"
            class="acv-question__form"
            :schema="question.form"
            :model-value="answer.form"
            data-question-form
            @update:model-value="update({form: $event as JsonValue})"
            @update:valid="onFormValid($event)"
        />
        <Input :model-value="answer.other ?? ''" class="acv-question__other" :placeholder="t('wizard.question.otherPlaceholder')" :aria-label="t('wizard.question.otherPlaceholder')" data-question-other @update:model-value="update({other: String($event)})" />
        <template #foot>
            <div class="acv-question__actions">
                <Button v-if="step > 0" size="sm" variant="subtle" data-question-step="previous" @click="go(-1)">{{ t("wizard.question.previous") }}</Button>
                <Button v-if="step < total - 1" size="sm" :variant="isAnswered(step) ? 'primary' : 'subtle'" data-question-step="next" @click="go(1)">{{ t("wizard.question.next") }}</Button>
                <Button v-else size="sm" variant="primary" :disabled="!allAnswered" data-question-submit @click="emit('submit')">{{ t("wizard.submit") }}</Button>
                <span class="acv-question__spacer" />
                <Button size="sm" variant="subtle" data-question-stop @click="emit('stop')">{{ t("wizard.question.stop") }}</Button>
            </div>
        </template>
    </AgentWizardFrame>
</template>

<style scoped>
.acv-question__text {
    margin: 0 0 8px;
}

.acv-question__form,
.acv-question__other {
    margin-top: 8px;
}

.acv-question__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.acv-question__spacer {
    flex: 1;
}
</style>
