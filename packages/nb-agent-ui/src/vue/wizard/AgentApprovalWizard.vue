<script setup lang="ts">
/**
 * 审批向导（docs/specs/agent/conversation.md 输出 11、12）：一条回复要批准的调用是一批，一步一个，全部选完才能提交。
 * 不加“全部批准”，开发者第 3 轮定的。选了的只在界面状态里，由 `AgentWizard` 管。
 */
import {computed} from "vue";
import {Button, CodeBlock, DiffView, Textarea} from "@notnotype/nb-ui/components";

import type {JsonValue, PendingApprovalView} from "../../types";
import {allChosen, choose, nextUnchosen} from "../../wizard";
import type {ApprovalDecision, WizardState} from "../../wizard";
import {useAgentText} from "../host";
import AgentWizardFrame from "./AgentWizardFrame.vue";

const props = defineProps<{
    items: readonly PendingApprovalView[];
    state: WizardState;
}>();

const emit = defineEmits<{
    "update:state": [state: WizardState];
    submit: [];
    denyAll: [note: string];
    collapse: [];
}>();

const {t} = useAgentText();

const step = computed(() => Math.min(props.state.step, props.items.length - 1));
const item = computed(() => props.items[step.value]!);
const chosen = computed(() => props.state.approvals[item.value.id]);
const note = computed(() => props.state.notes[item.value.id] ?? chosen.value?.note ?? "");
const noted = computed(() => note.value.trim() !== "");
const batch = computed(() => props.items.length > 1);
const ready = computed(() => allChosen(props.state, props.items));

const args = computed<{readonly [key: string]: JsonValue}>(() => (item.value.args !== null && typeof item.value.args === "object" && !Array.isArray(item.value.args) ? item.value.args : {}));
const isShell = computed(() => item.value.tool === "shell");
const command = computed(() => (typeof args.value.command === "string" ? args.value.command : ""));
const files = computed(() => (item.value.preview.state === "ready" ? item.value.preview.files : []));
const hasPreview = computed(() => files.value.length > 0);
/** 算不出来、读不了时把参数也列出来：用户总得知道批的是什么。 */
const showArgs = computed(() => !isShell.value && (item.value.preview.state !== "loading") && (!hasPreview.value || files.value.some((file) => file.kind !== "diff")));

const title = computed(() => {
    if (isShell.value) return t("wizard.approval.shell");
    if (item.value.tool === "edit" || item.value.tool === "write") return t("wizard.approval.edit");
    return t("wizard.approval.tool", {tool: item.value.tool});
});
const detail = computed(() => (typeof args.value.path === "string" ? args.value.path : files.value.length === 1 ? files.value[0]!.address : undefined));
const count = computed(() => (batch.value ? t("wizard.count", {index: step.value + 1, total: props.items.length}) : undefined));

/** 8 行大约这么多字（中文一段就是一行，按字算比按行准）。 */
const tall = computed(() => files.value.some((file) => file.kind === "diff" && file.before.length + file.after.length > 400));

const argEntries = computed(() => Object.entries(args.value).map(([key, value]) => ({key, text: typeof value === "string" ? value : JSON.stringify(value)})));
const codeLines = (text: string) => text.split("\n").map((line) => ({text: line}));

function setNote(value: string): void {
    emit("update:state", {...props.state, notes: {...props.state.notes, [item.value.id]: value}});
}

function pick(decision: ApprovalDecision): void {
    const trimmed = note.value.trim();
    const next = choose(props.state, props.items, item.value.id, decision, decision === "deny" ? trimmed : undefined);
    // 只有一个时选了就是提交；一批时走到下一个没选的，都选了就停在这里等提交。
    const following = nextUnchosen(next, props.items, step.value);
    emit("update:state", {...next, step: following ?? step.value});
    if (!batch.value) emit("submit");
}

function go(delta: number): void {
    emit("update:state", {...props.state, step: step.value + delta});
}
</script>

<template>
    <AgentWizardFrame icon="i-lucide-shield-question" :title="title" :detail="detail" :count="count" :tall="tall" @collapse="emit('collapse')">
        <p v-if="item.reason" class="acv-approval__reason">{{ item.reason }}</p>
        <template v-if="isShell">
            <code class="acv-approval__command" data-approval-command>{{ command }}</code>
            <div class="acv-approval__meta">
                <span v-if="typeof args.cwd === 'string'"><span class="i-lucide-folder" aria-hidden="true" />{{ args.cwd }}</span>
                <span v-if="typeof args.timeout === 'number'"><span class="i-lucide-timer" aria-hidden="true" />{{ t("wizard.approval.timeout", {seconds: args.timeout}) }}</span>
            </div>
        </template>
        <template v-else>
            <p v-if="item.preview.state === 'loading'" class="acv-approval__note" role="status">{{ t("wizard.approval.previewLoading") }}</p>
            <p v-else-if="item.preview.state === 'failed'" class="acv-approval__note">{{ t("wizard.approval.previewFailed") }}</p>
            <div v-for="file in files" :key="file.address" class="acv-approval__file" :data-preview-file="file.kind">
                <DiffView v-if="file.kind === 'diff'" :before="file.before" :after="file.after" :label="files.length > 1 ? file.address : ''" />
                <p v-else-if="file.kind === 'too-large'" class="acv-approval__note"><code>{{ file.address }}</code> {{ t("wizard.approval.tooLarge") }}</p>
                <p v-else class="acv-approval__note"><code>{{ file.address }}</code> {{ t("wizard.approval.fileFailed") }}</p>
            </div>
            <dl v-if="showArgs" class="acv-approval__args">
                <template v-for="entry in argEntries" :key="entry.key">
                    <dt>{{ entry.key }}</dt>
                    <dd><CodeBlock :lines="codeLines(entry.text)" /></dd>
                </template>
            </dl>
        </template>
        <template #foot>
            <Textarea
                :model-value="note"
                class="acv-approval__input"
                :rows="1"
                :placeholder="t('wizard.approval.notePlaceholder')"
                :aria-label="t('wizard.approval.notePlaceholder')"
                data-approval-note
                @update:model-value="setNote($event)"
            />
            <p v-if="noted" class="acv-approval__hint">{{ t("wizard.approval.noteHint") }}</p>
            <div class="acv-approval__actions">
                <Button size="sm" :variant="chosen?.decision === 'allow' || !batch ? 'primary' : 'subtle'" :disabled="noted" data-approval-decision="allow" @click="pick('allow')">{{ t("wizard.approval.allow") }}</Button>
                <Button v-if="item.remember !== false" size="sm" :variant="chosen?.decision === 'allow-session' ? 'primary' : 'subtle'" :disabled="noted" data-approval-decision="allow-session" @click="pick('allow-session')">{{ item.remember === undefined ? t("wizard.approval.allowSession") : t("wizard.approval.allowSessionRule", {rule: item.remember.label}) }}</Button>
                <Button v-if="item.remember !== false" size="sm" :variant="chosen?.decision === 'allow-always' ? 'primary' : 'subtle'" :disabled="noted" :title="t('wizard.approval.allowAlwaysHint')" data-approval-decision="allow-always" @click="pick('allow-always')">{{ t("wizard.approval.allowAlways") }}</Button>
                <Button size="sm" :variant="chosen?.decision === 'deny' ? 'primary' : 'subtle'" data-approval-decision="deny" @click="pick('deny')">{{ t("wizard.approval.deny") }}</Button>
            </div>
            <div v-if="batch" class="acv-approval__actions">
                <Button size="sm" variant="subtle" :disabled="step === 0" data-approval-step="previous" @click="go(-1)">{{ t("wizard.previousItem") }}</Button>
                <Button size="sm" variant="subtle" :disabled="step === props.items.length - 1" data-approval-step="next" @click="go(1)">{{ t("wizard.nextItem") }}</Button>
                <span class="acv-approval__spacer" />
                <Button size="sm" variant="subtle" data-approval-deny-all @click="emit('denyAll', note.trim())">{{ t("wizard.approval.denyAll") }}</Button>
                <Button size="sm" variant="primary" :disabled="!ready" data-approval-submit @click="emit('submit')">{{ t("wizard.submit") }}</Button>
            </div>
        </template>
    </AgentWizardFrame>
</template>

<style scoped>
.acv-approval__reason,
.acv-approval__note,
.acv-approval__hint {
    margin: 0 0 6px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.acv-approval__hint {
    margin: 0;
}

.acv-approval__command {
    display: block;
    padding: 8px 10px;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.acv-approval__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 6px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-approval__meta > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}

.acv-approval__file + .acv-approval__file {
    margin-top: 8px;
}

.acv-approval__args {
    margin: 6px 0 0;
    font-size: var(--text-xs);
}

.acv-approval__args dt {
    color: var(--text-muted);
}

.acv-approval__args dd {
    margin: 2px 0 6px;
}

.acv-approval__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.acv-approval__spacer {
    flex: 1;
}
</style>
