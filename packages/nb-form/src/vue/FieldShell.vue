<script setup lang="ts">
/**
 * 字段外壳（docs/specs/ui/forms.md“术语与参与者”、输出 4、14）：标签、必填标记、“默认”标记、状态图标、清除动作、
 * 说明，中间放控件。出错不在字段下插文字：控件标红，第一条错误、警告与状态的文字给读屏，看得见的文字是标题后的状态
 * 图标与它的提示（悬停或焦点在控件上时显示），以及表单的问题汇总。
 *
 * 状态图标只有一个：出错、警告、字段状态（选项源不可用的原因）可以同时有，色调取最重的，提示按这个顺序逐行列出全部
 * 原因。图标在标题行里占固定大小，出现与消失不改变字段高度。`bare` 没有标题行，不画图标，三类原因由 `SchemaField`
 * 经 `field-state` 事件交给调用方画在它自己的标题旁。
 *
 * 外壳自己提供 nb-ui `Field` 的上下文（不用 `Field` 组件）：标题行上还要放“默认”、警告与清除，`Field` 的标题只有文字。
 * 组合控件（单选组、复选组、确认、对象、列表）用组形态：标题是带 id 的元素，控件读 `labelId` 写 `aria-labelledby`。
 *
 * “清除”看上去在标题行右端，在 DOM 里排在控件之后（网格摆位）：Tab 先到控件，可选字段有没有值不改变进入控件的
 * 顺序（审查 S3 Sonnet 10）。
 */
import {NB_FIELD_CONTEXT_KEY, Tooltip} from "@notnotype/nb-ui/components";
import {computed, provide, ref, useTemplateRef} from "vue";

import {useFormText} from "./text";

const props = withDefaults(defineProps<{
    id: string;
    label?: string;
    help?: string;
    /**
     * 字段此刻的状态说明（动态选项不可用的原因）。与 `help` 不同，它不是调用方的说明：不进说明行，而是状态图标提示里
     * 最后一行；读屏文字照样有（`bare` 时也有）。
     */
    status?: string;
    required?: boolean;
    /** 组合控件：标题不是 `<label for>`。 */
    group?: boolean;
    /** 只有控件：标签与说明由调用方画，`labelledby` 指向调用方的标签，`describedby` 是调用方的说明。 */
    bare?: boolean;
    labelledby?: string;
    describedby?: string;
    /** 控件与标题在同一行（开关）。 */
    inline?: boolean;
    errorText?: string;
    warnings?: ReadonlyArray<string>;
    /** 标题旁的标记：“默认：X”或“默认”。 */
    note?: string;
    /** 数字的单位：看得见的画在输入框旁，这里给读屏。 */
    unit?: string;
    clearLabel?: string;
}>(), {
    label: "",
    help: undefined,
    status: undefined,
    required: false,
    group: false,
    bare: false,
    labelledby: undefined,
    describedby: undefined,
    inline: false,
    errorText: undefined,
    warnings: () => [],
    note: undefined,
    unit: undefined,
    clearLabel: undefined,
});

const emit = defineEmits<{(event: "clear"): void}>();

const text = useFormText();
const labelId = computed(() => (props.bare ? props.labelledby : props.label ? `${props.id}-label` : undefined));
/** `bare` 时说明由调用方画，外壳不画也不引用（审查 S3 Sonnet 16）。 */
const helpText = computed(() => (props.bare ? "" : props.help ?? ""));
const helpId = computed(() => (helpText.value ? `${props.id}-help` : undefined));
const errorId = computed(() => (props.errorText ? `${props.id}-error` : undefined));
const warningId = computed(() => (props.warnings.length > 0 ? `${props.id}-warning` : undefined));
const statusId = computed(() => (props.status ? `${props.id}-status` : undefined));
const unitId = computed(() => (props.unit ? `${props.id}-unit` : undefined));
const ariaDescribedby = computed(() => [errorId.value, warningId.value, statusId.value, unitId.value, helpId.value, props.describedby].filter(Boolean).join(" ") || undefined);
const warningText = computed(() => props.warnings.map((warning) => text.t("format.labelled", {label: text.t("warning"), text: warning})).join(text.t("format.clauseSeparator")));

type ReasonTone = "error" | "warning" | "muted";
/** 状态图标提示里的原因，按出错、警告、状态的顺序；第一条的色调就是最重的那个。 */
const reasons = computed<ReadonlyArray<{tone: ReasonTone; text: string}>>(() => [
    ...(props.errorText ? [{tone: "error" as const, text: props.errorText}] : []),
    ...props.warnings.map((text) => ({tone: "warning" as const, text})),
    ...(props.status ? [{tone: "muted" as const, text: props.status}] : []),
]);
const tone = computed(() => reasons.value[0]?.tone);

/**
 * 焦点在控件上时提示也显示（输出 14），悬停之外键盘与聚焦问题（`focusIssue`）也看得到原因。只认本字段自己的焦点：
 * 对象、列表里的成员是嵌套的字段外壳，它们的 `focusin` 会冒泡上来，但属于成员自己的图标。
 */
const root = useTemplateRef<HTMLElement>("root");
const focused = ref(false);
/** 元素是不是本字段自己的（不在嵌套的成员字段里）。 */
function isOwn(element: EventTarget | null): boolean {
    return element instanceof Element && element.closest(".nb-form-field") === root.value;
}
function onFocusIn(event: FocusEvent): void {
    if (isOwn(event.target)) focused.value = true;
}
function onFocusOut(event: FocusEvent): void {
    // 焦点在字段自己的范围内移动（例如从输入框到“清除”）不算离开；移到嵌套的成员字段里也算离开。
    if (isOwn(event.target) && !isOwn(event.relatedTarget)) focused.value = false;
}

provide(NB_FIELD_CONTEXT_KEY, {
    inputId: computed(() => props.id),
    labelId,
    descriptionId: helpId,
    errorId,
    ariaDescribedby,
    required: computed(() => props.required),
    invalid: computed(() => Boolean(props.errorText)),
});
</script>

<template>
    <div ref="root" class="nb-form-field" :class="{'nb-form-field--inline': props.inline, 'nb-form-field--bare': props.bare}" @focusin="onFocusIn" @focusout="onFocusOut">
        <div v-if="!props.bare" class="nb-form-field__head">
            <component
                :is="props.group ? 'span' : 'label'"
                v-if="props.label"
                :id="labelId"
                class="nb-form-field__label"
                :for="props.group ? undefined : props.id"
            >{{ props.label }}<span v-if="props.required" class="nb-form-field__required" aria-hidden="true">*</span><span v-if="props.required && props.group" class="nb-form-sr-only">{{ text.t('format.note', {note: text.t('required')}) }}</span></component>
            <Tooltip v-if="tone" side="right" :force-open="focused">
                <span class="nb-form-field__reason" :class="`nb-form-field__reason--${tone}`" :data-tone="tone" aria-hidden="true">
                    <svg v-if="tone === 'warning'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                    <svg v-else-if="tone === 'error'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
                    <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                </span>
                <template #content>
                    <span v-for="(reason, index) in reasons" :key="index" class="nb-form-field__reason-line" :data-tone="reason.tone">{{ reason.text }}</span>
                </template>
            </Tooltip>
            <span v-if="props.note" class="nb-form-field__note">{{ props.note }}</span>
            <div v-if="props.inline" class="nb-form-field__inline-control"><slot /></div>
        </div>
        <!-- 开关排在标题行里；`bare` 不画标题行，开关同其它控件一样单独一块。 -->
        <div v-if="!props.inline || props.bare" class="nb-form-field__control"><slot /></div>
        <button
            v-if="props.clearLabel && !props.bare"
            type="button"
            class="nb-form-field__clear"
            :aria-label="props.label ? text.t('format.labelled', {label: props.clearLabel, text: props.label}) : props.clearLabel"
            @click="emit('clear')"
        >{{ props.clearLabel }}</button>
        <p v-if="helpId" :id="helpId" class="nb-form-field__help">{{ helpText }}</p>
        <!-- 出错、警告、状态的看得见的部分是标题行的图标与提示（`bare` 交给调用方，见 `field-state`），这里只给读屏。 -->
        <span v-if="errorId" :id="errorId" class="nb-form-sr-only">{{ props.errorText }}</span>
        <span v-if="warningId" :id="warningId" class="nb-form-sr-only">{{ warningText }}</span>
        <span v-if="statusId" :id="statusId" class="nb-form-sr-only">{{ props.status }}</span>
        <span v-if="unitId" :id="unitId" class="nb-form-sr-only">{{ text.t('unit', {unit: props.unit ?? ''}) }}</span>
    </div>
</template>

<style scoped>
/* 标题行一行两格：左边标题、右边“清除”；控件与说明各占整行。“清除”在 DOM 里排在控件后面，靠网格摆到右上。 */
.nb-form-field {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: var(--space-4);
    row-gap: var(--space-3);
}

.nb-form-field--bare {
    display: block;
}

.nb-form-field__head {
    display: flex;
    min-width: 0;
    grid-column: 1;
    grid-row: 1;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-4);
    row-gap: var(--space-2);
}

.nb-form-field--inline .nb-form-field__head {
    align-items: center;
}

.nb-form-field__control,
.nb-form-field__help {
    min-width: 0;
    grid-column: 1 / -1;
}

.nb-form-field__clear {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0 var(--space-2);
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
}

.nb-form-field__clear:hover {
    color: var(--text-main);
}

/* 焦点外观与 nb-ui 控件同一套：`--focus-ring` 是一串 box-shadow，不能写进 outline（审查 S3 Sonnet 9）。 */
.nb-form-field__clear:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.nb-form-field__label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.nb-form-field__required {
    margin-left: var(--space-2);
    color: var(--status-danger);
}

.nb-form-field__note {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 图标在标题行里自己占 14px 见方，行高由标题文字撑开：图标出现与消失，字段高度不变。 */
.nb-form-field__reason {
    display: inline-flex;
    align-self: center;
    flex: none;
    width: 14px;
    height: 14px;
    line-height: 0;
}

.nb-form-field__reason--error {
    color: var(--status-danger);
}

.nb-form-field__reason--warning {
    color: var(--status-warning);
}

.nb-form-field__reason--muted {
    color: var(--text-muted);
}

/* 提示里一条原因一行。 */
.nb-form-field__reason-line {
    display: block;
}

.nb-form-field__inline-control {
    display: flex;
    align-items: center;
}

.nb-form-field__help {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    overflow-wrap: anywhere;
}

.nb-form-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
