<script setup lang="ts">
/**
 * list 分区的内容（同名 .md）：按分组列出配置项，每项一个 SettingsRow，里面放 nb-form 的 `SchemaField`（`bare`，名字与
 * 说明来自行），写入经窗口模型。控件、草稿与提交时机由表单定（docs/specs/settings/settings-window.md 输出 9、14）。
 *
 * 行里显示的值按先后取：留在行里没写的值、写入中的值、层里的实际值。状态原因收在行标题后面的图标里（`SettingsRow`
 * 的 `reasons`）：没写的原因（结构字段的值还不合格、数字框里写的不是数）由这里算，字段自己的警告与状态（选项源不可用）
 * 取自 `SchemaField` 的 `field-state`。单个字段没有问题汇总，不写出来用户只看到一个标红的框。
 */
import {toPointer} from "@notnotype/nb-form";
import type {FormIssue} from "@notnotype/nb-form";
import {describeIssues, SchemaField, useFormText} from "@notnotype/nb-form/vue";
import type {DraftState, FieldState} from "@notnotype/nb-form/vue";
import {reactive, watch} from "vue";

import HighlightedText from "nbook/ui/settings/HighlightedText.vue";
import {settingsRowState} from "nbook/ui/settings/row-state";
import type {SettingsRowReason} from "nbook/ui/settings/row-state";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {settingErrors, settingForm} from "../setting-form";
import {useSettingsText} from "../text";
import type {SettingsSectionView, SettingsWindow} from "../settings-window";
import type {WindowSetting} from "../window-source";

defineOptions({name: "SettingsListSection"});

const props = withDefaults(defineProps<{
    window: SettingsWindow;
    view: Extract<SettingsSectionView, {kind: "list"}>;
    /** 搜索结果里要标出的词（小写）：组标题之外，行的标题与说明里命中的字标底色；缺省不标。 */
    highlight?: ReadonlyArray<string>;
}>(), {highlight: () => []});

const text = useSettingsText();
/** 表单的文字（字段名、问题的写法）经同一个注入的端口取，宿主登记了 nb-form 的目录。 */
const formText = useFormText();

const locale = props.window.locale;

const formOf = (setting: WindowSetting) => settingForm(setting.definition.declaration, locale.value, props.window.text);

/**
 * 结构字段还不合格的值：留在行里、不写。`base` 是留下时层里的值（JSON 文本）：层里的值变了（恢复默认、别处改了）就
 * 作废，行回到实际值。切换标签、换分区时全部丢掉。
 */
const held = reactive(new Map<string, {readonly value: unknown; readonly base: string; readonly errors: ReadonlyArray<FormIssue>}>());
/** 解析不了的草稿（数字框里的 `abc`、写坏的 JSON），键是“配置键 + 字段路径”。 */
const unparseable = reactive(new Map<string, {readonly key: string; readonly issues: ReadonlyArray<FormIssue>}>());
/** 字段交出的警告与状态（`field-state`），键是配置键。 */
const fieldStates = reactive(new Map<string, FieldState>());
watch([() => props.window.layer.value, () => props.view.id], () => {
    held.clear();
    unparseable.clear();
    fieldStates.clear();
});

const json = (value: unknown): string => JSON.stringify(value) ?? "";

function heldOf(setting: WindowSetting, actual: unknown) {
    const entry = held.get(setting.definition.key);
    return entry !== undefined && entry.base === json(actual) ? entry : undefined;
}

async function write(setting: WindowSetting, value: unknown, actual: unknown): Promise<void> {
    const key = setting.definition.key;
    const form = formOf(setting);
    if (form.staged) {
        const errors = settingErrors(form, value);
        if (errors.length > 0) {
            held.set(key, {value, base: json(actual), errors});
            return;
        }
        // 改回了层里原来的值（例如删掉刚加的空项）：不用写，写了反倒把沿用的缺省值记成这一层改过。
        if (held.delete(key) && json(value) === json(actual)) return;
    }
    // 写入失败时不用通知表单：`commit: "change"` 的草稿在发出时已经丢掉，控件显示的就是传回来的实际值。
    await props.window.write(setting, value);
}

function shown(setting: WindowSetting, actual: unknown): unknown {
    const kept = heldOf(setting, actual);
    if (kept !== undefined) return kept.value;
    const pending = props.window.pending(setting.definition.key);
    return pending === undefined ? actual : pending.value;
}

function onDraft(setting: WindowSetting, state: DraftState): void {
    const id = `${setting.definition.key}\n${toPointer(state.path)}`;
    if (state.state === "unparseable" && state.issues.length > 0) unparseable.set(id, {key: setting.definition.key, issues: state.issues});
    else unparseable.delete(id);
}

/** 这一层此刻显示的值（层里的实际值，没写的取下一层）：同 `SettingsRow` 交给插槽的 `value`。 */
function actualValue(setting: WindowSetting): unknown {
    const state = settingsRowState(props.window.editing.inspect(setting.definition), setting.definition.declaration.layers, props.window.layer.value);
    return state.kind === "edit" ? state.value : state.kind === "inherit" ? state.inherited : undefined;
}

/** 这一项为什么没写（不带“未保存”的说法）；都写了时为 null。只取第一条，多的看控件上的标记。 */
function notSavedReason(setting: WindowSetting, actual: unknown): string | null {
    const kept = heldOf(setting, actual);
    const value = kept?.value ?? actual;
    const issues = kept?.errors ?? [...unparseable.values()].filter((entry) => entry.key === setting.definition.key).flatMap((entry) => entry.issues);
    const [first] = describeIssues(setting.definition.declaration.schema, value, issues, formText, formOf(setting).hints);
    return first ?? null;
}

/**
 * 行标题后面图标的原因，按出错、警告、状态排：没写的原因取自这里，其余取自字段的 `field-state`。字段的警告与状态
 * `bare` 的 `SchemaField` 已经挂在控件的 `aria-describedby` 上，标成 `announced`，行不再念一遍。“未保存：…”由行念，
 * 字段自己已经念了同一个原因（例如数字框解析不了）时也标 `announced`，免得读屏把同一句念两遍。
 */
function reasonsOf(setting: WindowSetting): ReadonlyArray<SettingsRowReason> {
    const reasons: SettingsRowReason[] = [];
    const state = fieldStates.get(setting.definition.key);
    const unsaved = notSavedReason(setting, actualValue(setting));
    if (unsaved !== null) reasons.push({tone: "error", text: text("list.notSaved", {reason: unsaved}), announced: state?.error === unsaved});
    for (const warning of state?.warnings ?? []) reasons.push({tone: "warning", text: warning, announced: true});
    if (state?.status != null) reasons.push({tone: "muted", text: state.status, announced: true});
    return reasons;
}

function excludedText(titles: ReadonlyArray<string>): string {
    return text(props.window.layer.value === "project" ? "list.excludedUser" : "list.excludedProject", {titles: titles.join(text("list.separator"))});
}
</script>

<template>
    <div class="settings-list-section" :data-settings-list="view.id" :data-settings-layer="window.layer.value">
        <section v-for="group in view.groups" :key="group.id ?? ''" class="settings-list-section__group" :data-settings-group="group.id ?? ''">
            <!-- 搜索结果的组标题是“分区名 › 小组名”：分区名淡色，小组名正常；没有小组时只有分区名，按正常色写。 -->
            <h3 v-if="group.title !== null" class="settings-list-section__group-title">
                <span v-if="group.parent != null" class="settings-list-section__crumb">{{ group.parent }} ›</span>
                {{ group.title }}
            </h3>
            <SettingsRow
                v-for="setting in group.settings"
                :key="setting.definition.key"
                v-slot="row"
                :settings="window.editing"
                :setting="setting.definition"
                :layer="window.layer.value"
                :project-title="window.projectTitle.value"
                :wide="formOf(setting).wide"
                :reasons="reasonsOf(setting)"
                :highlight="highlight"
                @write-failed="(failure) => window.rowFailed(setting, failure)"
            >
                <div class="settings-list-section__control" :data-settings-width="formOf(setting).wide ? undefined : formOf(setting).width">
                    <SchemaField
                        :id="row.id"
                        :schema="setting.definition.declaration.schema"
                        :hints="formOf(setting).hints"
                        :options="window.options()"
                        :model-value="shown(setting, row.value)"
                        :disabled="row.disabled"
                        :labelledby="row.labelId"
                        :describedby="row.describedby"
                        bare
                        commit="change"
                        @update:model-value="(value: unknown) => write(setting, value, row.value)"
                        @draft-state="(state: DraftState) => onDraft(setting, state)"
                        @field-state="(state: FieldState) => fieldStates.set(setting.definition.key, state)"
                    />
                </div>
            </SettingsRow>
        </section>
        <p v-if="view.excluded.length > 0" class="settings-list-section__excluded" data-settings-excluded>{{ excludedText(view.excluded) }}</p>
    </div>
</template>

<style scoped>
.settings-list-section {
    --settings-line-ui: var(--leading-ui);

    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

/*
 * 行里的小字用整数像素的行高：`--leading-ui` 是倍数，乘上有的主题的字号（例如 macOS 的 11px × 1.35）是小数，一行行累下去，
 * 后面的控件都落在半像素上、描边发虚。`1em` 在用到这个变量的元素上才求值，所以各处按自己的字号取整。`round()` 不支持时
 * 退回倍数。
 */
@supports (line-height: round(nearest, 1.5px, 1px)) {
    .settings-list-section {
        --settings-line-ui: round(nearest, calc(1em * var(--leading-ui)), 1px);
    }
}

/* 单行输入按小组的宽度收窄（见下），小组是它的尺寸容器。 */
.settings-list-section__group {
    display: flex;
    flex-direction: column;
    container-type: inline-size;
}

.settings-list-section__crumb {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.settings-list-section__group-title {
    /* 标题到第一行的距离（下边距、下面的 6px 与行自己的 8px 上内边距）不大于行与行之间的 16px：标题贴着自己这一组（nb-ui 设计语言“分组与层次”第 1 条）。 */
    margin: 0 0 var(--space-1);
    /* 小组标题是框架，不供选字（nb-ui 规范的“文字能否选中”）；设置项自己的名字与说明可选。 */
    user-select: none;
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--settings-line-ui);
    color: var(--text-secondary);
}

/* 标签列加控件列时的宽度（输出 9），都不超过行宽；宽排法占满内容列。 */
.settings-list-section__control {
    min-width: 0;
    max-width: 100%;
}

.settings-list-section__control[data-settings-width="narrow"] {
    width: 120px;
}

.settings-list-section__control[data-settings-width="medium"] {
    width: 220px;
}

/*
 * 单行输入 200 到 320px：行宽减去标题列（200px）、两列间距与最右一格的位置之后还剩多少就给多少，剩不到 200px 才整行
 * 换到标题下面。定宽 320 时内容列稍窄就整行换行，同一分区里与数字框、下拉两种对齐混在一起。这几个量是行（SettingsRow）
 * 在根上定的变量，控件在行里，直接继承；最右一格在用户标签与本作品标签下一样宽（都是图标按钮）。
 */
.settings-list-section__control[data-settings-width="wide"] {
    width: clamp(200px, calc(100cqi - var(--settings-row-text-min) - var(--settings-row-gap-x) - var(--settings-row-cell-gap) - var(--settings-row-slot)), 320px);
}

.settings-list-section__excluded {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--settings-line-ui);
    color: var(--text-muted);
}
</style>
