<script setup lang="ts">
/**
 * frontmatter 的属性面板（同名 .md；docs/specs/workbench/markdown-editing.md 输出 39–51）。读写都经属性模型（`model.ts`），
 * 改一项只替换这一项的原文；编辑器、撤销与展开状态的记录归宿主。
 *
 * 还没写回的输入同一时间只有一个（焦点所在的那个输入）：焦点离开就写回，所以不需要按行存几份。宿主换掉 `raw`（撤销、外部
 * 修改）时它作废，因为它是按行的下标对着旧原文的。
 */
import {Button, Checkbox, DateInput, DropdownMenu, IconButton, Input, TagInput, Textarea} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, useTemplateRef, watch} from "vue";

import {useMarkdownText} from "../../host/text";
import {addProperty, convertKind, readProperties, removeProperty, renameProperty, replaceYaml, writeValue, yamlOf} from "./model";
import type {EditableKind, EditableValue, PropertiesProblem, PropertyDescription, PropertyKind, PropertyRow} from "./model";

const props = withDefaults(defineProps<{
    raw: string;
    open: boolean;
    readonly?: boolean;
    /** 按属性名给图标、显示名与类型（输出 60）；不传、或返回 null 的行照旧。在渲染里调用，所以它读的响应式状态（界面语言）变了面板跟着变。 */
    describe?: (name: string) => PropertyDescription | null;
}>(), {readonly: false, describe: undefined});

const emit = defineEmits<{
    (event: "commit", raw: string): void;
    (event: "update:open", open: boolean): void;
    /** `backspace`：新建后还没有属性时，在空着的新属性名上按了退格（宿主可以撤回刚才的新建）。 */
    (event: "leave", reason?: "backspace"): void;
}>();

const text = useMarkdownText();

const ICONS: Readonly<Record<PropertyKind, string>> = {
    text: "i-lucide-text",
    number: "i-lucide-hash",
    checkbox: "i-lucide-square-check",
    date: "i-lucide-calendar",
    list: "i-lucide-list",
    complex: "i-lucide-braces",
};
const KINDS: readonly EditableKind[] = ["text", "number", "checkbox", "date", "list"];
const PROBLEM_KEYS = {
    "syntax": "properties.problem.syntax",
    "duplicate-key": "properties.problem.duplicateKey",
    "not-mapping": "properties.problem.notMapping",
    "multiple-documents": "properties.problem.multipleDocuments",
    "document-marker": "properties.problem.documentMarker",
    "flow-mapping": "properties.problem.flowMapping",
} as const satisfies Record<PropertiesProblem, string>;

const read = computed(() => readProperties(props.raw));
const rows = computed<readonly PropertyRow[]>(() => (read.value.ok ? read.value.rows : []));
const problem = computed(() => (read.value.ok ? null : read.value));

// 不看 `open` 也展开：挂载时 YAML 就读不成属性（输出 41），或宿主要添加属性（`focusNewName`）。收起一次之后按 `open`。
const forced = ref(problem.value !== null);
const expanded = computed(() => props.open || forced.value);
const mode = ref<"properties" | "source">("properties");
const showingSource = computed(() => problem.value !== null || mode.value === "source");

type Target = {readonly kind: "value" | "name"; readonly index: number} | {readonly kind: "new"} | {readonly kind: "source"};
const draft = ref<{readonly target: Target; readonly text: string} | null>(null);
// 源码里有只写着 `---` 的一行，写不回：字留在文字框里，但不算待写回的输入（结算、保存不该被它挡住）。
const fenceRejected = ref(false);
const adding = ref(false);
const duplicate = ref(false);
/** 空值选过的类型（输出 46）：文件里仍是空值，按名字记，这次挂载期间有效。 */
const chosen = ref(new Map<string, EditableKind>());

const pending = computed(() => draft.value !== null && !(draft.value.target.kind === "source" && fenceRejected.value));

const sameTarget = (left: Target, right: Target): boolean =>
    left.kind === right.kind && (left.kind !== "value" && left.kind !== "name" ? true : left.index === (right as {index: number}).index);
const draftOf = (target: Target): string | undefined => (draft.value !== null && sameTarget(draft.value.target, target) ? draft.value.text : undefined);

function setDraft(target: Target, value: string): void {
    draft.value = {target, text: value};
    if (target.kind === "source") fenceRejected.value = false;
    if (target.kind === "new") duplicate.value = false;
}

watch(() => props.raw, () => {
    // 自己的写回先清掉了草稿再发 `commit`；这里还有草稿，就是宿主换了原文（撤销、外部修改）。
    draft.value = null;
    fenceRejected.value = false;
    renaming.value = null;
});

// 编辑中变成只读（例如文件被外部删除）：还没写回的输入放弃（输出 51）。
watch(() => props.readonly, (readonly) => {
    if (!readonly) return;
    draft.value = null;
    adding.value = false;
});

// 写错的 YAML 改好了：回到按属性显示（输出 45）。
watch(() => problem.value === null, (fixed) => {
    if (fixed) mode.value = "properties";
});

const descriptionOf = (row: PropertyRow): PropertyDescription | null => props.describe?.(row.name) ?? null;

/** 这一行按什么类型输入：空值按这次挂载里选过的类型，没选过按声明的类型，都没有是文字；有值的行按值推断，声明不改它。 */
function kindOf(row: PropertyRow): PropertyKind {
    if (row.kind === "text" && row.value === null) return chosen.value.get(row.name) ?? descriptionOf(row)?.kind ?? "text";
    return row.kind;
}

/** 显示名：声明的 `label`，没有就是真名。摘要、名字一列与各输入的可访问名称都用它。 */
const labelOf = (row: PropertyRow): string => descriptionOf(row)?.label ?? row.name;

/** 名字一列的提示：有显示名时带上真名。 */
const nameTitleOf = (row: PropertyRow): string => {
    const label = labelOf(row);
    return label === row.name ? row.name : `${label}（${row.name}）`;
};

/** 类型图标：声明的图标换掉按类型取的；表示不了的行（“{ }”）不换：它说的是“这一行只读”。 */
const iconOf = (row: PropertyRow): string => (row.kind === "complex" ? ICONS.complex : descriptionOf(row)?.icon ?? ICONS[kindOf(row)]);

/** 有显示名的行：点名字才变成输入框（输入框里是真名），免得把显示名当成键改了。 */
const renaming = ref<number | null>(null);
function startRename(row: PropertyRow): void {
    renaming.value = row.index;
    void nextTick(() => root.value?.querySelector<HTMLInputElement>(`[data-property-name-cell="${String(row.index)}"] input`)?.focus());
}

function emitRaw(next: string | null): boolean {
    if (next === null) return false;
    if (next !== props.raw) emit("commit", next);
    return true;
}

/** 写一个值；空的数字、日期记下类型，免得写成 `名字:` 之后这一行变回文字输入。 */
function writeRow(row: PropertyRow, value: EditableValue): void {
    if ((value.kind === "number" || value.kind === "date") && value.value === null) chosen.value.set(row.name, value.kind);
    emitRaw(writeValue(props.raw, row.index, value));
}

/**
 * 日期：分段输入时每打一个数字都交出一个完整的日期，在年份那一段从头打 `2026` 会先交出 `0002`、`0020`、`0202`。年份不到 1000 的
 * 当作还没打完，不写回（段里的字留在日期输入里）；清空、日历里选的日子与打完的年份照常立即写回。
 */
function writeDate(row: PropertyRow, value: string | null): void {
    if (value !== null && Number(value.slice(0, 4)) < 1000) return;
    writeRow(row, {kind: "date", value});
}

/** 文字框里的字按类型换成值；数字框里不是数时为 undefined（不写回）。 */
function parseValue(kind: PropertyKind, input: string): EditableValue | undefined {
    if (kind === "number") {
        const trimmed = input.trim();
        if (trimmed === "") return {kind: "number", value: null};
        const number = Number(trimmed);
        return Number.isFinite(number) ? {kind: "number", value: number} : undefined;
    }
    return {kind: "text", value: input === "" ? null : input};
}

/**
 * 把草稿写回。`how`：回车（新属性写回后焦点移到它的值；同名时这一行留着）、失焦与宿主的结算（同名时这一行消失）。
 */
function settle(how: "enter" | "blur" | "flush"): void {
    const current = draft.value;
    if (current === null || (current.target.kind === "source" && fenceRejected.value)) return;
    const {target} = current;
    if (target.kind === "source") {
        if (current.text === shownYaml.value) {
            draft.value = null;
            return;
        }
        const next = replaceYaml(props.raw, current.text);
        if (next === null) {
            fenceRejected.value = true;
            return;
        }
        draft.value = null;
        emitRaw(next);
        return;
    }
    draft.value = null;
    if (target.kind === "new") {
        const name = current.text.trim();
        if (name === "") {
            adding.value = false;
            // 这一行随之消失，焦点不能掉到页面上。
            if (how === "enter") void nextTick(() => focusStop(stops().length - 1));
            return;
        }
        const next = addProperty(props.raw, name);
        if (next === null) {
            if (how === "enter") {
                draft.value = current;
                duplicate.value = true;
            } else {
                adding.value = false;
                duplicate.value = false;
            }
            return;
        }
        adding.value = false;
        emitRaw(next);
        if (how === "enter") void nextTick(() => focusStop(stops().length - 2));
        return;
    }
    const row = rows.value[target.index];
    if (row === undefined) return;
    if (target.kind === "name") {
        renaming.value = null;
        // 空值选过的类型跟着名字走。
        if (emitRaw(renameProperty(props.raw, target.index, current.text))) {
            const kind = chosen.value.get(row.name);
            chosen.value.delete(row.name);
            if (kind !== undefined) chosen.value.set(current.text.trim(), kind);
        }
        return;
    }
    if (row.kind === "complex") return;
    const value = parseValue(kindOf(row), current.text);
    if (value !== undefined) writeRow(row, value);
}

/** 焦点离开这个输入（不是去了它自己里面）时写回。 */
function onFocusout(target: Target, event: FocusEvent): void {
    const into = event.relatedTarget;
    if (into instanceof Node && (event.currentTarget as HTMLElement).contains(into)) return;
    if (draft.value !== null && sameTarget(draft.value.target, target)) settle("blur");
    else if (target.kind === "new" && draft.value === null) adding.value = false;
    else if (target.kind === "name") renaming.value = null;
}

function onEnter(target: Target, event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (draft.value !== null && sameTarget(draft.value.target, target)) {
        settle("enter");
    } else if (target.kind === "new") {
        adding.value = false;
        void nextTick(() => focusStop(stops().length - 1));
    }
}

/** 一个属性都没有、新属性的名字空着时按退格：这一行消失，焦点交回（输出 48 的“紧接着按退格”）。 */
function onNewBackspace(event: KeyboardEvent): void {
    if (event.isComposing || (draftOf({kind: "new"}) ?? "") !== "" || rows.value.length > 0) return;
    event.preventDefault();
    draft.value = null;
    adding.value = false;
    emit("leave", "backspace");
}

function changeKind(row: PropertyRow, kind: EditableKind): void {
    if (row.kind === "complex") return;
    const value = convertKind(row, kind);
    if (value === null) return;
    // 空值换成文字、数字、日期：文件里仍是空值，只记着这一行按什么输入。
    if ((value.kind === "text" || value.kind === "number" || value.kind === "date") && value.value === null && row.kind === "text" && row.value === null) {
        chosen.value.set(row.name, value.kind);
        return;
    }
    chosen.value.delete(row.name);
    emitRaw(writeValue(props.raw, row.index, value));
}

function kindItems(row: PropertyRow): DropdownMenuItemData[] {
    const shown = kindOf(row);
    return KINDS.map((kind) => ({
        id: kind,
        label: text.t(`properties.kinds.${kind}`),
        iconClass: ICONS[kind],
        type: "radio",
        group: "kind",
        checked: kind === shown,
        disabled: kind !== shown && convertKind(row, kind) === null,
    }));
}

function remove(row: PropertyRow): void {
    chosen.value.delete(row.name);
    const at = stops().findIndex((stop) => stop.dataset.propertyRow === String(row.index));
    emitRaw(removeProperty(props.raw, row.index));
    // 按钮随这一行消失，焦点不能掉到页面上：给同一位置的下一个输入（没有了就是“添加属性”）。
    void nextTick(() => focusStop(Math.min(at, stops().length - 1)));
}

/** 表示不了的值显示成一行：换行连同下一行的缩进换成一个空格。 */
const oneLine = (source: string): string => source.replace(/\s*\r?\n\s*/gu, " ");

/** 摘要（输出 40）：每个属性“名字 值”，以“·”隔开。 */
const summary = computed(() =>
    rows.value
        .map((row) => {
            const name = labelOf(row);
            if (row.kind === "complex") return name;
            if (row.kind === "checkbox") return `${name} ${text.t(row.value ? "properties.yes" : "properties.no")}`;
            if (row.kind === "list") return `${name} ${row.value.join(text.t("properties.listSeparator"))}`.trim();
            return row.value === null ? name : `${name} ${String(row.value)}`.trim();
        })
        .join(" · "),
);

/**
 * 出错的那一行（文字框里的行号，从 1 起）：文字框里没有开栏那一行，所以减一。没闭合的括号这类错，`yaml` 报在内容结束处（最后
 * 一行之后的空行），夹到最后一个有字的行上，波浪线与行号才指着要改的那一行。
 */
const errorLine = computed(() => {
    const found = problem.value;
    if (found === null) return null;
    const lines = yamlOf(props.raw).split("\n");
    let last = lines.length;
    while (last > 1 && (lines[last - 1] ?? "").trim() === "") last -= 1;
    return Math.min(Math.max(1, found.line - 1), last);
});

const problemText = computed(() => {
    const found = problem.value;
    if (found === null || errorLine.value === null) return null;
    return `${text.t(PROBLEM_KEYS[found.problem], {line: errorLine.value})}${text.t("properties.problemHint")}`;
});

function toggle(): void {
    if (expanded.value) {
        forced.value = false;
        emit("update:open", false);
    } else {
        emit("update:open", true);
    }
}

function toggleSource(): void {
    if (problem.value !== null) return;
    // 收起时点它：展开并看源码（不管上次是不是停在源码上）。
    if (!expanded.value) {
        mode.value = "source";
        emit("update:open", true);
        return;
    }
    if (mode.value === "source") {
        // 回到按属性显示：写不回的源码放弃（输出 44）。
        if (draft.value?.target.kind === "source") draft.value = null;
        fenceRejected.value = false;
        mode.value = "properties";
        return;
    }
    mode.value = "source";
}

// ---- 源码区 ----

/** 文字框里的 YAML：末尾的那个换行不显示（写回时 `replaceYaml` 补上），免得文字框总多一个空行。 */
const shownYaml = computed(() => yamlOf(props.raw).replace(/\n$/u, ""));
const sourceText = computed(() => draftOf({kind: "source"}) ?? shownYaml.value);
const textareaHost = useTemplateRef<HTMLElement>("textareaHost");
const mirror = useTemplateRef<HTMLElement>("mirror");
const mirrorLines = computed(() => sourceText.value.split("\n"));

function textareaOf(): HTMLTextAreaElement | null {
    return textareaHost.value?.querySelector("textarea") ?? null;
}

function syncMirror(): void {
    const area = textareaOf();
    if (area !== null && mirror.value !== null) mirror.value.scrollTop = area.scrollTop;
}

/** 打开源码并把光标放到第 `line` 行（整段原文的行号，开栏是第 1 行）的行首。 */
function revealInSource(line: number): void {
    mode.value = "source";
    void nextTick(() => {
        const area = textareaOf();
        if (area === null) return;
        const lines = sourceText.value.split("\n");
        const offset = lines.slice(0, Math.max(0, line - 2)).reduce((sum, item) => sum + item.length + 1, 0);
        area.focus();
        area.setSelectionRange(offset, offset);
    });
}

// ---- 键盘与焦点 ----

const root = useTemplateRef<HTMLElement>("root");
const newName = useTemplateRef<HTMLElement>("newName");
const FOCUSABLE = "input:not([type=hidden]), button:not([disabled]), textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']";

/** 上下方向键走过的几站：顶上一行、各属性的值、“添加属性”；按文档顺序。 */
function stops(): HTMLElement[] {
    return [...(root.value?.querySelectorAll<HTMLElement>("[data-property-stop]") ?? [])];
}

function focusStop(index: number): void {
    const stop = stops()[index];
    if (stop === undefined) return;
    const target = stop.matches(FOCUSABLE) ? stop : stop.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
}

function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("leave");
        return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && target.tagName === "TEXTAREA") {
        event.preventDefault();
        settle("enter");
        return;
    }
    if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // 文字框与日期的分段输入自己用上下键。
    if (target.tagName === "TEXTAREA" || target.closest("[data-property-kind='date']") !== null) return;
    const all = stops();
    // 属性名与类型按钮不是一站：按它所在那一行的值算。
    const row = target.closest<HTMLElement>(".markdown-properties__row");
    const stop = target.closest<HTMLElement>("[data-property-stop]") ?? row?.querySelector<HTMLElement>("[data-property-stop]") ?? null;
    const at = stop === null ? -1 : all.indexOf(stop);
    if (at < 0) return;
    event.preventDefault();
    if (event.key === "ArrowUp") {
        if (at > 0) focusStop(at - 1);
    } else if (at === all.length - 1) {
        emit("leave");
    } else {
        focusStop(at + 1);
    }
}

function startAdding(): void {
    if (props.readonly || problem.value !== null) return;
    forced.value = true;
    mode.value = "properties";
    adding.value = true;
    duplicate.value = false;
    void nextTick(() => newName.value?.querySelector("input")?.focus());
}

defineExpose({
    flush: (): void => settle("flush"),
    get pending(): boolean {
        return pending.value;
    },
    focusLast: (): void => focusStop(stops().length - 1),
    focusNewName: startAdding,
});
</script>

<template>
    <section ref="root" class="markdown-properties" :aria-label="text.t('properties.title')" data-markdown-properties @keydown="onKeydown">
        <div class="markdown-properties__head">
            <button type="button" class="markdown-properties__toggle nb-ui-focus-ring" :aria-expanded="expanded" data-property-stop @click="toggle">
                <span class="markdown-properties__chevron" :class="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
                <span class="markdown-properties__label">{{ text.t("properties.title") }}</span>
                <span v-if="!expanded && problem !== null" class="markdown-properties__summary markdown-properties__summary--problem">{{ text.t("properties.summaryProblem") }}</span>
                <span v-else-if="!expanded" class="markdown-properties__summary" data-property-summary>{{ summary }}</span>
            </button>
            <IconButton size="xs" icon-class="i-lucide-code" class="markdown-properties__source-toggle" :class="showingSource && expanded ? 'markdown-properties__source-toggle--on' : ''" :title="text.t('properties.source')" :aria-pressed="showingSource && expanded" :disabled="problem !== null" @click="toggleSource" />
        </div>

        <div v-if="expanded && showingSource" class="markdown-properties__source" data-property-source>
            <div ref="textareaHost" class="markdown-properties__code">
                <Textarea
                    :model-value="sourceText"
                    variant="bare"
                    autosize
                    :rows="1"
                    :max-rows="40"
                    :readonly="props.readonly"
                    :invalid="problem !== null || fenceRejected"
                    :aria-label="text.t('properties.source')"
                    class="markdown-properties__textarea"
                    spellcheck="false"
                    @update:model-value="(value: string) => setDraft({kind: 'source'}, value)"
                    @focusout="(event: FocusEvent) => onFocusout({kind: 'source'}, event)"
                    @scroll="syncMirror"
                />
                <!-- 出错的那一行画波浪线：文字框里画不了，盖一层排版相同、字透明的副本（不接收指针）。 -->
                <div v-if="errorLine !== null" ref="mirror" class="markdown-properties__mirror" aria-hidden="true">
                    <div v-for="(line, index) in mirrorLines" :key="index" :class="index + 1 === errorLine ? 'markdown-properties__mirror-error' : ''">{{ line === "" ? " " : line }}</div>
                </div>
            </div>
            <p v-if="fenceRejected || problemText !== null" class="markdown-properties__problem" role="alert">
                <span class="i-lucide-circle-alert markdown-properties__problem-icon" aria-hidden="true" />
                <span>{{ fenceRejected ? text.t("properties.fence") : problemText }}</span>
            </p>
        </div>

        <div v-else-if="expanded" class="markdown-properties__rows">
            <div v-for="row in rows" :key="row.index" class="markdown-properties__row" :data-property-name="row.name">
                <DropdownMenu v-if="!props.readonly && row.kind !== 'complex'" :items="kindItems(row)" @select="(kind: string) => changeKind(row, kind as EditableKind)">
                    <button type="button" class="markdown-properties__type nb-ui-focus-ring" :title="text.t('properties.kindMenu', {kind: text.t(`properties.kinds.${kindOf(row)}`)})" :aria-label="text.t('properties.kindMenu', {kind: text.t(`properties.kinds.${kindOf(row)}`)})">
                        <span :class="iconOf(row)" aria-hidden="true" />
                    </button>
                </DropdownMenu>
                <span v-else class="markdown-properties__type" :title="text.t(`properties.kinds.${kindOf(row)}`)">
                    <span :class="iconOf(row)" aria-hidden="true" />
                </span>

                <span v-if="props.readonly || !row.renamable" class="markdown-properties__name" :title="nameTitleOf(row)">{{ labelOf(row) }}</span>
                <!-- 有显示名：点名字才变成输入框，输入框里是真名。 -->
                <button v-else-if="labelOf(row) !== row.name && renaming !== row.index" type="button" class="markdown-properties__name markdown-properties__name--label nb-ui-focus-ring" :title="nameTitleOf(row)" @click="startRename(row)">{{ labelOf(row) }}</button>
                <span v-else class="markdown-properties__name" :data-property-name-cell="row.index" @focusout="onFocusout({kind: 'name', index: row.index}, $event)" @keydown.enter="onEnter({kind: 'name', index: row.index}, $event)">
                    <Input
                        :model-value="draftOf({kind: 'name', index: row.index}) ?? row.name"
                        variant="bare"
                        size="sm"
                        :aria-label="text.t('properties.rename', {name: row.name})"
                        @update:model-value="(value: string) => setDraft({kind: 'name', index: row.index}, value)"
                    />
                </span>

                <span class="markdown-properties__value" :data-property-kind="kindOf(row)" :data-property-row="row.index" :data-property-stop="row.kind === 'complex' ? undefined : ''">
                    <span v-if="row.kind === 'complex'" class="markdown-properties__complex" :title="row.source">{{ oneLine(row.source) }}</span>
                    <Checkbox v-else-if="kindOf(row) === 'checkbox'" :model-value="row.kind === 'checkbox' ? row.value : false" :readonly="props.readonly" @update:model-value="(value: boolean) => writeRow(row, {kind: 'checkbox', value})"><span class="sr-only">{{ labelOf(row) }}</span></Checkbox>
                    <DateInput
                        v-else-if="kindOf(row) === 'date'"
                        :model-value="row.kind === 'date' ? row.value : null"
                        variant="bare"
                        size="sm"
                        :readonly="props.readonly"
                        :aria-label="labelOf(row)"
                        @update:model-value="(value: string | null) => writeDate(row, value)"
                    />
                    <TagInput
                        v-else-if="kindOf(row) === 'list'"
                        :model-value="row.kind === 'list' ? [...row.value] : []"
                        variant="bare"
                        size="sm"
                        :readonly="props.readonly"
                        :aria-label="labelOf(row)"
                        @update:model-value="(value: string[]) => writeRow(row, {kind: 'list', value})"
                    />
                    <span v-else class="markdown-properties__input" @focusout="onFocusout({kind: 'value', index: row.index}, $event)" @keydown.enter="onEnter({kind: 'value', index: row.index}, $event)">
                        <Input
                            :model-value="draftOf({kind: 'value', index: row.index}) ?? (row.value === null ? '' : String(row.value))"
                            variant="bare"
                            size="sm"
                            :inputmode="kindOf(row) === 'number' ? 'decimal' : undefined"
                            :readonly="props.readonly"
                            :aria-label="labelOf(row)"
                            :class="kindOf(row) === 'number' ? 'markdown-properties__tabular' : ''"
                            @update:model-value="(value: string) => setDraft({kind: 'value', index: row.index}, value)"
                        />
                    </span>
                </span>

                <!-- 表示不了的一行没有可输入的值：上下方向键的这一站是它的“在源码里改”。 -->
                <span class="markdown-properties__action" :data-property-stop="row.kind === 'complex' ? '' : undefined" :data-property-row="row.kind === 'complex' ? row.index : undefined">
                    <IconButton v-if="row.kind === 'complex'" size="xs" icon-class="i-lucide-code" :title="text.t('properties.editSource', {name: labelOf(row)})" @click="revealInSource(row.line)" />
                    <IconButton v-else-if="!props.readonly" size="xs" icon-class="i-lucide-x" class="markdown-properties__remove" :title="text.t('properties.remove', {name: labelOf(row)})" @click="remove(row)" />
                </span>
            </div>

            <div v-if="adding" class="markdown-properties__row markdown-properties__row--new">
                <span class="markdown-properties__type"><span :class="ICONS.text" aria-hidden="true" /></span>
                <span ref="newName" class="markdown-properties__name" @focusout="onFocusout({kind: 'new'}, $event)" @keydown.enter="onEnter({kind: 'new'}, $event)" @keydown.backspace="onNewBackspace">
                    <Input
                        :model-value="draftOf({kind: 'new'}) ?? ''"
                        variant="bare"
                        size="sm"
                        :placeholder="text.t('properties.newName')"
                        :aria-label="text.t('properties.newName')"
                        :invalid="duplicate"
                        @update:model-value="(value: string) => setDraft({kind: 'new'}, value)"
                    />
                </span>
                <span class="markdown-properties__value">
                    <span v-if="duplicate" class="markdown-properties__duplicate" role="status">{{ text.t("properties.duplicate") }}</span>
                </span>
                <span class="markdown-properties__action" />
            </div>

            <Button v-if="!props.readonly" size="sm" variant="ghost" icon-class="i-lucide-plus" class="markdown-properties__add" data-property-stop @click="startAdding">{{ text.t("properties.add") }}</Button>
        </div>
    </section>
</template>

<style scoped>
/* 卡片：淡底、没有线（输出 39）；用界面字号，不跟正文。行与行之间不画分隔，悬停与焦点所在的一行有底色。 */
.markdown-properties {
    position: relative;
    padding: 4px;
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 20px;
}

.markdown-properties__head {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding-right: 2px;
}

.markdown-properties__toggle {
    display: flex;
    flex: 1 1 0;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    padding: 0 6px 0 8px;
    border: 0;
    border-radius: max(2px, calc(var(--radius-panel) - 4px));
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.markdown-properties__chevron {
    flex: none;
    width: 14px;
    height: 14px;
}

.markdown-properties__label {
    flex: none;
    font-size: var(--text-xs);
    font-weight: 500;
}

.markdown-properties__summary {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    margin-left: 6px;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.markdown-properties__summary--problem {
    color: var(--status-danger);
}

.markdown-properties__source-toggle--on {
    background: var(--accent-bg);
    color: var(--accent-text);
}

.markdown-properties__row {
    display: grid;
    grid-template-columns: 16px 6em minmax(0, 1fr) 24px;
    column-gap: 10px;
    align-items: center;
    min-height: 30px;
    padding: 0 4px 0 8px;
    border-radius: max(2px, calc(var(--radius-panel) - 4px));
}

.markdown-properties__row:hover,
.markdown-properties__row:focus-within {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.markdown-properties__type {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}

span.markdown-properties__type {
    cursor: default;
}

.markdown-properties__type > span {
    width: 14px;
    height: 14px;
}

.markdown-properties__name {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 有显示名的行：看起来与普通的名字一样，点了才变成输入框。 */
.markdown-properties__name--label {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    text-align: start;
    cursor: text;
}

.markdown-properties__name :deep(input) {
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.markdown-properties__value {
    display: flex;
    align-items: center;
    min-width: 0;
}

.markdown-properties__input {
    flex: 1 1 0;
    min-width: 0;
}

.markdown-properties__value :deep(input) {
    color: var(--text-main);
    font-size: var(--text-sm);
}

.markdown-properties__tabular :deep(input) {
    font-variant-numeric: tabular-nums;
}

/* 列表的 ×：改的时候（焦点在这个列表里）才显现，平时只有一个个小块（第 2 轮评审稿）；位置一直留着，显隐不推动版式。 */
.markdown-properties__value[data-property-kind="list"]:not(:focus-within) :deep([data-reka-collection-item] button) {
    visibility: hidden;
}

.markdown-properties__complex {
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.markdown-properties__duplicate {
    overflow: hidden;
    color: var(--status-danger);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 行尾按钮的位置一直留着；“移除”只在悬停或焦点在这一行时显现（ui-development-spec 第 3 节第 4 条：显隐不推动版式）。 */
.markdown-properties__action {
    display: inline-flex;
    justify-content: center;
}

.markdown-properties__remove {
    visibility: hidden;
}

.markdown-properties__row:hover .markdown-properties__remove,
.markdown-properties__row:focus-within .markdown-properties__remove {
    visibility: visible;
}

.markdown-properties__add {
    margin: 2px 0 0 calc(8px + 16px + 10px - 8px);
    color: var(--text-muted);
}

.markdown-properties__source {
    margin: 2px 0 0;
}

.markdown-properties__code {
    position: relative;
    padding: 6px 10px;
    border-radius: max(2px, calc(var(--radius-panel) - 4px));
    background: var(--panel-surface);
}

/* 文字框与副本同一套排版，副本的波浪线才落在同一行上。 */
.markdown-properties__textarea,
.markdown-properties__mirror {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 20px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 4;
}

.markdown-properties__textarea {
    display: block;
    width: 100%;
    padding: 0;
    resize: none;
}

.markdown-properties__mirror {
    position: absolute;
    inset: 6px 10px;
    overflow: hidden;
    color: transparent;
    pointer-events: none;
}

.markdown-properties__mirror-error {
    text-decoration: underline wavy var(--status-danger);
    text-underline-offset: 3px;
}

.markdown-properties__problem {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 6px 4px 2px;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.markdown-properties__problem-icon {
    flex: none;
    width: 14px;
    height: 14px;
    margin-top: 3px;
}
</style>
