<script setup lang="ts">
/**
 * 权限规则设置页（见同名 `.md`）。只吃普通的属性，写入由包装交给配置服务，所以能在 Lab 里直接摆。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {Badge, Button, Dialog, EmptyState, IconButton, Input, Select, SegmentedControl, Textarea} from "@notnotype/nb-ui/components";

import type {Rule, RuleAction} from "../../shared/permissions";
import {emptyRuleForm, formToRule, moveRule, ruleSummary, ruleToForm} from "../permission-rules";
import type {RuleForm} from "../permission-rules";
import {useAgentPageText} from "../text";

const props = withDefaults(defineProps<{
    rules: readonly Rule[];
    /** 这本书的规则。`null`：没有绑定作品。`"invalid"`：文件坏了。`"unavailable"`：请求没有成功。 */
    projectRules?: readonly Rule[] | "invalid" | "unavailable" | null;
    projectTitle?: string | null;
    writable?: boolean;
    /** 讨论与计划模式下的写入：拒绝或询问。 */
    modeWriteAction?: "deny" | "ask";
    readOnlyCommands?: readonly string[];
    /** Lab 用：打开时就在编辑第几条。 */
    initialEdit?: number | "new" | null;
}>(), {projectRules: null, projectTitle: null, writable: true, modeWriteAction: "deny", readOnlyCommands: () => [], initialEdit: null});

const emit = defineEmits<{change: [rules: Rule[]]; modeWriteAction: [value: "deny" | "ask"]; readOnlyCommands: [value: string[]]}>();

const t = useAgentPageText();

const ACTION_TONE = {allow: "success", ask: "warning", deny: "danger"} as const;
const actionLabel = (action: RuleAction): string => t(`permissions.action.${action}`);

function summaryText(rule: Rule): string {
    const summary = ruleSummary(rule);
    switch (summary.key) {
        case "none": return t("permissions.summary.none");
        case "json": return t("permissions.summary.json");
        case "keywords": return t("permissions.summary.keywords", {field: summary.field, value: summary.value});
        case "subject": return t("permissions.summary.subject", {field: summary.field, value: summary.value});
        default: return t(`permissions.summary.${summary.key}`, {value: summary.value});
    }
}

const editing = ref<number | "new" | null>(props.initialEdit);
const form = ref<RuleForm>(props.initialEdit === null ? emptyRuleForm() : props.initialEdit === "new" ? emptyRuleForm() : ruleToForm(props.rules[props.initialEdit]!));
const problem = ref<string | null>(null);
let openedRule = typeof props.initialEdit === "number" ? JSON.stringify(props.rules[props.initialEdit]) : "";

function startAdd(): void {
    form.value = emptyRuleForm();
    problem.value = null;
    editing.value = "new";
}
function startEdit(index: number): void {
    openedRule = JSON.stringify(props.rules[index]);
    form.value = ruleToForm(props.rules[index]!);
    problem.value = null;
    editing.value = index;
}
function save(): void {
    const result = formToRule(form.value);
    if (!result.ok) {
        problem.value = result.field;
        return;
    }
    const next = [...props.rules];
    // 对话框开着时列表可能被别处改了（别的窗口、设置文件）：按打开时那一条的内容找，找不到就当新的，不改到别的规则上。
    const at = editing.value === "new" || editing.value === null ? -1 : props.rules.findIndex((rule) => JSON.stringify(rule) === openedRule);
    if (at === -1) next.push(result.rule);
    else next[at] = result.rule;
    emit("change", next);
    editing.value = null;
}
const remove = (index: number): void => emit("change", props.rules.filter((_, at) => at !== index));
const move = (index: number, delta: -1 | 1): void => emit("change", moveRule(props.rules, index, delta));

const MODE_ACTION_OPTIONS = computed(() => (["deny", "ask"] as const).map((value) => ({value, label: t(`permissions.modeWrite.${value}`)})));
// 一行一条。失去焦点才写：边打边写，打到一半的前缀（`npm`）也算只读命令。
const commandsText = ref(props.readOnlyCommands.join("\n"));
watch(() => props.readOnlyCommands, (value) => {
    commandsText.value = value.join("\n");
});
function commitCommands(): void {
    const next = commandsText.value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    if (JSON.stringify(next) !== JSON.stringify(props.readOnlyCommands)) emit("readOnlyCommands", next);
}
// 输入框聚焦时直接关掉窗口，不一定有 blur。
onBeforeUnmount(commitCommands);

const KIND_OPTIONS = computed(() => (["none", "command", "path", "keywords", "subject", "json"] as const).map((value) => ({value, label: t(`permissions.kind.${value}`)})));
const ACTION_OPTIONS = computed(() => (["allow", "ask", "deny"] as const).map((value) => ({value, label: actionLabel(value)})));
const ACCESS_OPTIONS = computed(() => (["any", "read", "write"] as const).map((value) => ({value, label: t(`permissions.access.${value}`)})));
const projectList = computed(() => (props.projectRules === null || typeof props.projectRules === "string" ? [] : props.projectRules));
</script>

<template>
    <div class="permission-rules" data-permission-rules>
        <section class="permission-rules__group">
            <header class="permission-rules__head">
                <div>
                    <h3>{{ t("permissions.user.title") }}</h3>
                    <p>{{ t("permissions.user.hint") }}</p>
                </div>
                <Button size="sm" variant="subtle" icon-class="i-lucide-plus" :disabled="!writable" data-permission-add @click="startAdd">{{ t("permissions.add") }}</Button>
            </header>
            <EmptyState v-if="rules.length === 0" icon-class="i-lucide-shield" :title="t('permissions.empty.title')" :description="t('permissions.empty.description')" />
            <ul v-else class="permission-rules__list">
                <li v-for="(rule, index) in rules" :key="index" class="permission-rules__row" data-permission-rule>
                    <Badge :tone="ACTION_TONE[rule.action]" variant="soft" size="sm">{{ actionLabel(rule.action) }}</Badge>
                    <div class="permission-rules__body">
                        <div class="permission-rules__line"><code>{{ rule.tool }}</code><span>{{ summaryText(rule) }}</span></div>
                        <p v-if="rule.reason" class="permission-rules__reason">{{ rule.reason }}</p>
                    </div>
                    <div class="permission-rules__actions">
                        <IconButton size="sm" icon-class="i-lucide-arrow-up" :disabled="!writable || index === 0" :title="t('permissions.moveUp')" :aria-label="t('permissions.moveUp')" @click="move(index, -1)" />
                        <IconButton size="sm" icon-class="i-lucide-arrow-down" :disabled="!writable || index === rules.length - 1" :title="t('permissions.moveDown')" :aria-label="t('permissions.moveDown')" @click="move(index, 1)" />
                        <IconButton size="sm" icon-class="i-lucide-pencil" :disabled="!writable" :title="t('permissions.edit')" :aria-label="t('permissions.edit')" data-permission-edit @click="startEdit(index)" />
                        <IconButton size="sm" icon-class="i-lucide-trash-2" :disabled="!writable" :title="t('permissions.remove')" :aria-label="t('permissions.remove')" data-permission-remove @click="remove(index)" />
                    </div>
                </li>
            </ul>
        </section>

        <section v-if="projectRules !== null" class="permission-rules__group" data-permission-project>
            <header class="permission-rules__head">
                <div>
                    <h3>{{ t("permissions.project.title", {title: projectTitle ?? ""}) }}</h3>
                    <p>{{ t("permissions.project.hint") }}</p>
                </div>
            </header>
            <p v-if="projectRules === 'invalid'" class="permission-rules__invalid" role="status">{{ t("permissions.project.invalid") }}</p>
            <p v-else-if="projectRules === 'unavailable'" class="permission-rules__invalid" role="status">{{ t("permissions.project.unavailable") }}</p>
            <p v-else-if="projectList.length === 0" class="permission-rules__muted">{{ t("permissions.project.empty") }}</p>
            <ul v-else class="permission-rules__list">
                <li v-for="(rule, index) in projectList" :key="index" class="permission-rules__row" :class="{'is-ignored': rule.action === 'allow'}">
                    <Badge :tone="ACTION_TONE[rule.action]" variant="soft" size="sm">{{ actionLabel(rule.action) }}</Badge>
                    <div class="permission-rules__body">
                        <div class="permission-rules__line"><code>{{ rule.tool }}</code><span>{{ summaryText(rule) }}</span></div>
                        <p v-if="rule.action === 'allow'" class="permission-rules__reason">{{ t("permissions.project.allowIgnored") }}</p>
                        <p v-else-if="rule.reason" class="permission-rules__reason">{{ rule.reason }}</p>
                    </div>
                </li>
            </ul>
        </section>

        <section class="permission-rules__group" data-permission-others>
            <header class="permission-rules__head">
                <div><h3>{{ t("permissions.others.title") }}</h3></div>
            </header>
            <div class="permission-rules__others">
                <div class="permission-rules__field">
                    <span>{{ t("permissions.modeWrite.label") }}</span>
                    <SegmentedControl :model-value="modeWriteAction" :options="MODE_ACTION_OPTIONS" size="sm" :disabled="!writable" :aria-label="t('permissions.modeWrite.label')" @update:model-value="emit('modeWriteAction', $event as 'deny' | 'ask')" />
                    <p class="permission-rules__muted">{{ t("permissions.modeWrite.hint") }}</p>
                </div>
                <label class="permission-rules__field">
                    <span>{{ t("permissions.readOnly.label") }}</span>
                    <Textarea v-model="commandsText" :rows="3" :disabled="!writable" :placeholder="t('permissions.readOnly.placeholder')" data-permission-readonly @blur="commitCommands" />
                    <p class="permission-rules__muted">{{ t("permissions.readOnly.hint") }}</p>
                </label>
            </div>
        </section>

        <Dialog
            :open="editing !== null"
            size="md"
            :title="editing === 'new' ? t('permissions.dialog.add') : t('permissions.dialog.edit')"
            show-footer
            show-cancel
            closable
            :confirm-label="t('permissions.dialog.save')"
            :cancel-label="t('permissions.dialog.cancel')"
            data-permission-dialog
            @confirm="save"
            @request-close="editing = null"
        >
            <div class="permission-rules__form">
                <label class="permission-rules__field">
                    <span>{{ t("permissions.field.tool") }}</span>
                    <Input v-model="form.tool" size="sm" placeholder="shell、write、*.image-gen" :invalid="problem === 'tool'" data-permission-field="tool" />
                </label>
                <label class="permission-rules__field">
                    <span>{{ t("permissions.field.kind") }}</span>
                    <Select v-model="form.kind" :options="KIND_OPTIONS" size="sm" :aria-label="t('permissions.field.kind')" data-permission-field="kind" />
                </label>
                <label v-if="form.kind === 'keywords' || form.kind === 'subject'" class="permission-rules__field">
                    <span>{{ form.kind === "keywords" ? t("permissions.field.arg") : t("permissions.field.subjectKind") }}</span>
                    <Input v-model="form.field" size="sm" :placeholder="form.kind === 'keywords' ? 'prompt' : 'host'" :invalid="problem === 'field'" />
                </label>
                <label v-if="form.kind === 'command' || form.kind === 'path' || form.kind === 'keywords' || form.kind === 'subject'" class="permission-rules__field">
                    <span>{{ t(`permissions.field.value.${form.kind}`) }}</span>
                    <Input v-model="form.value" size="sm" :placeholder="t(`permissions.placeholder.${form.kind}`)" :invalid="problem === 'value'" data-permission-field="value" />
                </label>
                <div v-if="form.kind === 'path'" class="permission-rules__field">
                    <span>{{ t("permissions.field.access") }}</span>
                    <SegmentedControl v-model="form.access" :options="ACCESS_OPTIONS" size="sm" :aria-label="t('permissions.field.access')" />
                </div>
                <label v-if="form.kind === 'json'" class="permission-rules__field">
                    <span>{{ t("permissions.kind.json") }}</span>
                    <Textarea v-model="form.json" :rows="6" :invalid="problem === 'json'" />
                </label>
                <div class="permission-rules__field">
                    <span>{{ t("permissions.field.action") }}</span>
                    <SegmentedControl v-model="form.action" :options="ACTION_OPTIONS" size="sm" :aria-label="t('permissions.field.action')" data-permission-field="action" />
                </div>
                <label class="permission-rules__field">
                    <span>{{ t("permissions.field.reason") }}</span>
                    <Input v-model="form.reason" size="sm" :placeholder="t('permissions.placeholder.reason')" />
                </label>
            </div>
        </Dialog>
    </div>
</template>

<style scoped>
.permission-rules {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.permission-rules__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
}

.permission-rules__head h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-main);
}

.permission-rules__head p,
.permission-rules__muted {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.permission-rules__others {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.permission-rules__list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-panel);
    list-style: none;
}

.permission-rules__row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    padding: 6px 8px 6px 10px;
}

.permission-rules__row + .permission-rules__row {
    border-top: var(--border-w) solid var(--border-color);
}

.permission-rules__row.is-ignored {
    opacity: 0.6;
}

.permission-rules__body {
    min-width: 0;
    flex: 1 1 auto;
}

.permission-rules__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.permission-rules__line code {
    color: var(--text-main);
    font-size: var(--text-xs);
}

.permission-rules__reason {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.permission-rules__invalid {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.permission-rules__actions {
    display: flex;
    flex: none;
    gap: 2px;
}

.permission-rules__form {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.permission-rules__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
</style>
