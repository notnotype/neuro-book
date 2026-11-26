<script setup lang="ts">
/**
 * w00055 t01 富文本 spike：条目主文字用标签写法、在章节那套富文本编辑器里编辑，可以和源文字来回切。样本世界写死
 * （`entry-tags.ts`），不连内核；浮层里改字段的值是为了体验“值变了，小块与条件跟着变”，正式做法是去设定组里改。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import "@notnotype/nb-markdown/markdown.css";

import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";

import {defaultChipEnv} from "@notnotype/nb-markdown/chip";
import {createMarkdownEditorExtensions} from "@notnotype/nb-markdown/editor";
import {codecFor} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, SourceMap} from "@notnotype/nb-markdown/language";
import {AnchoredPopover, Button, IconButton, Input, SegmentedControl, SuggestionMenu, Switch, Textarea} from "@notnotype/nb-ui/components";
import {suggestionMenuOptions} from "@notnotype/nb-ui/components";
import type {SuggestionMenuGroup} from "@notnotype/nb-ui/components";

import {activeBranch, branchText, createEntryLanguage, display, ENTRIES, entryName, evaluate, fieldAt, HOME, IF_NODE, readableTest, refreshAtoms, REF_NODE, SAMPLE_SOURCE, sampleFields, VALUE_NODE} from "./entry-tags";
import type {AtomHost, Branch, Field} from "./entry-tags";

const props = withDefaults(defineProps<{
    /** 一开始在哪个模式；默认 "rich"。 */
    mode?: "rich" | "source";
    /** 一开始是否把条件的各支都画出来；默认 false（只画生效的一支）。 */
    showBranches?: boolean;
    /** 一开始的源文字；默认样本。 */
    source?: string;
}>(), {mode: "rich", showBranches: false, source: SAMPLE_SOURCE});

const fields = ref<Field[]>(sampleFields());
const mode = ref<"rich" | "source">(props.mode);
const showBranches = ref(props.showBranches);
const sourceText = ref(props.source);
const switchProblem = ref("");

/* ---------- 浮层：点了哪个小块 ---------- */

type Open =
    | {kind: "value"; pos: number; dom: HTMLElement; editing: boolean}
    | {kind: "if"; pos: number; dom: HTMLElement}
    | {kind: "ref"; pos: number; dom: HTMLElement}
    | {kind: "pick"; what: "value" | "ref" | "if-field"; pos: number; replace: boolean; dom: HTMLElement | {getBoundingClientRect: () => DOMRect}};
const open = shallowRef<Open | null>(null);

const host: AtomHost = {
    fields: fields.value,
    ifStyle: props.showBranches ? "both" : "active",
    activate: (kind, pos, dom) => {
        open.value = kind === "value" ? {kind, pos, dom, editing: false} : {kind, pos, dom};
    },
};
const language = createEntryLanguage(() => host);

watch(showBranches, (both) => {
    host.ifStyle = both ? "both" : "active";
    refreshAtoms();
});

/* ---------- 编辑器 ---------- */

const mount = useTemplateRef<HTMLElement>("mount");
let editor: Editor | null = null;
let codec: MarkdownCodec | null = null;
let map: SourceMap | null = null;

function load(text: string): void {
    if (editor === null || codec === null) return;
    const read = codec.read(text);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    map = read.map;
}

function written(): string | null {
    if (editor === null || codec === null || map === null) return null;
    const result = codec.write(editor.state.doc, map);
    return result.ok ? result.text : null;
}

/** 源文字里写坏了的标签：读成原样内容的片段里还有条目的标签名。 */
function brokenTag(text: string): string | null {
    if (codec === null) return null;
    let found: string | null = null;
    codec.read(text).doc.descendants((node) => {
        const raw = String(node.attrs.raw ?? "");
        if (found === null && (node.type.name === "rawInline" || node.type.name === "rawBlock") && /<\/?(?:V|If|ElseIf|Else|Ref)\b/u.test(raw)) found = raw.slice(0, 60);
    });
    return found;
}

function switchMode(next: "rich" | "source"): void {
    switchProblem.value = "";
    if (next === mode.value) return;
    if (next === "source") {
        sourceText.value = written() ?? sourceText.value;
        open.value = null;
        mode.value = "source";
        return;
    }
    const broken = brokenTag(sourceText.value);
    if (broken !== null) {
        switchProblem.value = `这里的标签写得不对，改好才能切回富文本：${broken}`;
        return;
    }
    mode.value = "rich";
    load(sourceText.value);
}

function insertAt(pos: number, node: {type: string; attrs: Record<string, unknown>}, replace: boolean): void {
    if (editor === null) return;
    const chain = editor.chain().focus();
    if (replace) chain.deleteRange({from: pos, to: pos + 1});
    chain.insertContentAt(pos, node).run();
}

onMounted(() => {
    if (mount.value === null) return;
    editor = new Editor({
        element: mount.value,
        extensions: createMarkdownEditorExtensions({language, placeholder: "写这个条目的设定；输入 { 插入一个值，@ 提到一个条目", host: {base: () => null, assets: null, chips: defaultChipEnv}, commentMarkerLabel: null}),
        editorProps: {
            attributes: {"class": "nb-markdown entry-rich__prose", "aria-label": "主文字"},
            handleKeyDown: (view, event) => {
                if (event.isComposing || (event.key !== "{" && event.key !== "@")) return false;
                event.preventDefault();
                const at = view.state.selection.from;
                const rect = view.coordsAtPos(at);
                open.value = {kind: "pick", what: event.key === "{" ? "value" : "ref", pos: at, replace: false, dom: {getBoundingClientRect: () => new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top)}};
                return true;
            },
        },
    });
    codec = codecFor(editor.schema, language);
    editor.on("transaction", () => {
        docVersion.value += 1;
    });
    if (mode.value === "rich") load(sourceText.value);
});

onBeforeUnmount(() => {
    editor?.destroy();
    editor = null;
});

/* ---------- 插入与换值：字段与条目的列表 ---------- */

const IF_ITEM = "#if";
const CALC_ITEM = "#calc";
/** 在条件或计算的式子里插一个字段（浮层里“插入字段”按钮）：`target` 是条件的第几支或计算值。 */
const pathPick = shallowRef<{target: number | "calc"; dom: HTMLElement; at: readonly [number, number] | null} | null>(null);
/** 点“插入字段”时记下同一行输入框里的光标（浮层里按下按钮不抢焦点，光标还在），选了字段就插在那里。 */
function startPathPick(target: number | "calc", event: MouseEvent): void {
    const dom = event.currentTarget as HTMLElement;
    const input = dom.parentElement?.querySelector("input");
    const at = input !== null && input !== undefined && input.selectionStart !== null ? [input.selectionStart, input.selectionEnd ?? input.selectionStart] as const : null;
    pathPick.value = {target, dom, at};
}
const query = ref("");
const activeId = ref<string | null>(null);
const pickGroups = computed<SuggestionMenuGroup[]>(() => {
    const current = open.value;
    if (current?.kind !== "pick" && pathPick.value === null) return [];
    const words = query.value.trim();
    if (current?.kind !== "pick") return fieldGroups(words);
    if (current.what === "ref") return [{id: "entries", items: ENTRIES.filter((entry) => entry.name.includes(words)).map((entry) => ({id: entry.id, label: entry.name, iconClass: "i-lucide-bookmark"}))}];
    // 插值的列表最前面是“条件”与“计算”：打“如果”“条件”“计算”“式子”也能筛到它们。
    const structures = current.what !== "value" ? [] : [
        {id: IF_ITEM, label: "条件（如果……否则……）", hint: "再选看哪个字段", iconClass: "i-lucide-split", words: "条件如果否则"},
        {id: CALC_ITEM, label: "计算（写一个式子）", hint: "加减乘除、取整、最大最小、百分比", iconClass: "i-lucide-calculator", words: "计算式子公式"},
    ].filter((item) => words === "" || item.words.includes(words)).map(({words: _words, ...item}) => item);
    return [...(structures.length === 0 ? [] : [{id: "structures", items: structures}]), ...fieldGroups(words)];
});

/** 字段的列表：本条目的字段排前面（最常用），再是别的条目。 */
function fieldGroups(words: string): SuggestionMenuGroup[] {
    return ENTRIES.map((entry) => ({
        id: entry.id,
        label: entry.id === HOME ? "这个条目" : entry.name,
        items: fields.value
            .filter((field) => field.entry === entry.id && `${entry.name}${field.group}${field.label}`.includes(words))
            .map((field) => ({id: `${field.entry}|${field.namespace}.${field.id}`, label: `${field.group} · ${field.label}`, hint: display(field.value), iconClass: field.kind === "number" ? "i-lucide-hash" : "i-lucide-text"})),
    })).filter((group) => group.items.length > 0);
}
const pickOptions = computed(() => suggestionMenuOptions(pickGroups.value));
watch(pickOptions, (options) => {
    activeId.value = options[0]?.id ?? null;
});
watch(pathPick, (pick) => {
    if (pick === null) return;
    query.value = "";
    void nextTick(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".entry-pick__search input")?.focus()));
});
watch(() => (open.value?.kind === "pick" ? `pick:${open.value.what}` : open.value?.kind), (kind, before) => {
    if (kind?.startsWith("pick") === true) {
        query.value = "";
        // 列表传送到 body，搜索框的 autofocus 赶不上挂载：挂上以后再把焦点交给它，接着打的字才落进搜索框而不是正文。
        void nextTick(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".entry-pick__search input")?.focus()));
    }
    if (before?.startsWith("pick") === true && kind?.startsWith("pick") !== true) editor?.commands.focus();
});

function choose(id: string): void {
    if (pathPick.value !== null) {
        const [entry = "", of = ""] = id.split("|");
        const path = entry === HOME ? of : `ref('${entry}').${of}`;
        const target = pathPick.value.target;
        const before = target === "calc" ? calcExpression.value : (branches.value[target]?.test ?? "");
        const [from, to] = pathPick.value.at ?? [before.length, before.length];
        const head = before.slice(0, from);
        const tail = before.slice(to);
        const next = `${head}${head === "" || head.endsWith(" ") ? "" : " "}${path}${tail === "" || tail.startsWith(" ") ? "" : " "}${tail}`;
        if (target === "calc") updateCalc(next);
        else updateBranch(target, {test: next});
        pathPick.value = null;
        return;
    }
    const current = open.value;
    if (current?.kind !== "pick") return;
    if (id === CALC_ITEM) {
        open.value = null;
        editor?.chain().focus().insertContentAt(current.pos, {type: VALUE_NODE, attrs: {of: "", entry: null, expr: ""}}).run();
        void nextTick(() => {
            const dom = editor?.view.nodeDOM(current.pos);
            if (dom instanceof HTMLElement) open.value = {kind: "value", pos: current.pos, dom, editing: false};
            requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-pop=calc] input")?.focus());
        });
        return;
    }
    if (id === IF_ITEM) {
        open.value = {...current, what: "if-field"};
        return;
    }
    if (current.what === "if-field") {
        insertIf(current.pos, id);
        return;
    }
    if (current.what === "ref") insertAt(current.pos, {type: REF_NODE, attrs: {id}}, current.replace);
    else {
        const [entry = "", of = ""] = id.split("|");
        insertAt(current.pos, {type: VALUE_NODE, attrs: {of, entry: entry === HOME ? null : entry}}, current.replace);
    }
    open.value = null;
}

function pickKey(event: KeyboardEvent): void {
    const options = pickOptions.value;
    const index = options.findIndex((item) => item.id === activeId.value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeId.value = options[(index + step + options.length) % Math.max(options.length, 1)]?.id ?? null;
    } else if (event.key === "Enter" && activeId.value !== null) {
        event.preventDefault();
        choose(activeId.value);
    } else if (event.key === "Escape" && pathPick.value !== null) {
        event.preventDefault();
        pathPick.value = null;
    } else if (event.key === "Escape" || (event.key === " " && query.value === "")) {
        // 不想插值：退回成普通的字（触发它的那个符号），焦点回到编辑器。
        event.preventDefault();
        const current = open.value;
        open.value = null;
        if (current?.kind === "pick" && !current.replace && current.what !== "if-field") editor?.chain().focus().insertContentAt(current.pos, current.what === "value" ? "{" : "@").run();
    }
}

function insertFromToolbar(what: "value" | "ref" | "if"): void {
    if (editor === null) return;
    const at = editor.state.selection.from;
    const rect = editor.view.coordsAtPos(at);
    open.value = {kind: "pick", what: what === "if" ? "if-field" : what, pos: at, replace: false, dom: {getBoundingClientRect: () => new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top)}};
}

/** 按选的字段插一个条件：数比“至少现在的值”，文字比“等于现在的值”；插好就打开浮层，接着写各支的文字。 */
function insertIf(pos: number, id: string): void {
    if (editor === null) return;
    const [entry = "", of = ""] = id.split("|");
    const field = fieldAt(fields.value, entry === HOME ? null : entry, of);
    const path = entry === HOME ? of : `ref('${entry}').${of}`;
    const test = field?.kind === "number" ? `${path} >= ${String(field.value ?? 0)}` : `${path} == '${String(field?.value ?? "")}'`;
    const branches: Branch[] = [{test, text: ""}, {test: null, text: ""}];
    open.value = null;
    editor.chain().focus().insertContentAt(pos, {type: IF_NODE, attrs: {branches}}).run();
    void nextTick(() => {
        const dom = editor?.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) open.value = {kind: "if", pos, dom};
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-pop=if] textarea")?.focus());
    });
}

/* ---------- 点开的小块 ---------- */

/** 编辑器的文档不是响应式的：每次变更加一，读节点的计算属性靠它重算（否则浮层改过一次以后读到的还是旧属性）。 */
const docVersion = ref(0);
const node = computed(() => {
    void docVersion.value;
    const current = open.value;
    if (current === null || current.kind === "pick" || editor === null) return null;
    return editor.state.doc.nodeAt(current.pos);
});
const calcExpression = computed(() => (node.value?.type.name === VALUE_NODE && node.value.attrs.expr !== null ? String(node.value.attrs.expr) : ""));
const isCalc = computed(() => node.value?.type.name === VALUE_NODE && node.value.attrs.expr !== null);
function updateCalc(expression: string): void {
    const current = open.value;
    if (current?.kind !== "value" || editor === null || node.value === null) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, {...node.value.attrs, expr: expression}));
    refreshAtoms();
}
const calcState = computed(() => {
    try {
        const value = evaluate(calcExpression.value, fields.value);
        return {problem: "", readable: readableTest(calcExpression.value, fields.value), result: value === undefined ? "算不出（有值是未知）" : typeof value === "boolean" ? (value ? "是" : "否") : display(value)};
    } catch (error) {
        return {problem: (error as Error).message, readable: "", result: ""};
    }
});
const openedField = computed(() => {
    const current = node.value;
    if (current?.type.name !== VALUE_NODE || current.attrs.expr !== null) return null;
    return fieldAt(fields.value, current.attrs.entry === null ? null : String(current.attrs.entry), String(current.attrs.of)) ?? null;
});
const valueDraft = ref("");
watch(openedField, (field) => {
    valueDraft.value = field === null ? "" : String(field.value ?? "");
});

function setField(): void {
    const field = openedField.value;
    if (field === null) return;
    field.value = field.kind === "number" ? (valueDraft.value.trim() === "" ? null : Number(valueDraft.value)) : valueDraft.value;
    refreshAtoms();
    open.value = null;
}

function removeOpened(): void {
    const current = open.value;
    if (current === null || current.kind === "pick" || editor === null) return;
    editor.chain().focus().deleteRange({from: current.pos, to: current.pos + 1}).run();
    open.value = null;
}

function replaceOpened(what: "value" | "ref"): void {
    const current = open.value;
    if (current === null || current.kind === "pick") return;
    open.value = {kind: "pick", what, pos: current.pos, replace: true, dom: current.dom};
}

/** 条件浮层里正在改的几支：改了立刻写回节点（撤销照常可用）。 */
const branches = computed<Branch[]>(() => (node.value?.type.name === IF_NODE ? (node.value.attrs.branches as Branch[]) : []));
function updateBranch(index: number, patch: Partial<Branch>): void {
    const current = open.value;
    if (current?.kind !== "if" || editor === null) return;
    const next = branches.value.map((branch, at) => (at === index ? {...branch, ...patch} : branch));
    editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, {branches: next}));
    refreshAtoms();
}
function addElseIf(): void {
    const current = open.value;
    if (current?.kind !== "if" || editor === null) return;
    const list = [...branches.value];
    const at = list.findIndex((branch) => branch.test === null);
    list.splice(at < 0 ? list.length : at, 0, {test: list[0]?.test ?? "", text: ""});
    editor.view.dispatch(editor.state.tr.setNodeMarkup(current.pos, undefined, {branches: list}));
    refreshAtoms();
}
const testProblem = (test: string | null): string => {
    if (test === null) return "";
    try {
        const value = evaluate(test, fields.value);
        return value === undefined ? "现在算不出（有值是未知）" : "";
    } catch (error) {
        return (error as Error).message;
    }
};
const activeIndex = computed(() => activeBranch(branches.value, fields.value));

function closeOnOutside(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-entry-atom], .nb-ui-popover-surface") === null) {
        open.value = null;
        pathPick.value = null;
    }
}
onMounted(() => document.addEventListener("pointerdown", closeOnOutside, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", closeOnOutside, true));

const anchor = computed(() => open.value?.dom ?? null);
</script>

<template>
    <div class="entry-rich" data-entry-rich>
        <div class="entry-rich__bar">
            <span class="entry-rich__where">第 3 章末尾</span>
            <template v-if="mode === 'rich'">
                <Button size="sm" variant="ghost" icon-class="i-lucide-braces" data-insert="value" @click="insertFromToolbar('value')">插入值</Button>
                <Button size="sm" variant="ghost" icon-class="i-lucide-split" data-insert="if" @click="insertFromToolbar('if')">条件</Button>
                <Button size="sm" variant="ghost" icon-class="i-lucide-at-sign" data-insert="ref" @click="insertFromToolbar('ref')">提到条目</Button>
            </template>
            <span class="flex-1" />
            <label v-if="mode === 'rich'" class="entry-rich__toggle">
                <Switch v-model="showBranches" size="sm" />
                <span>显示全部分支</span>
            </label>
            <SegmentedControl :model-value="mode" size="sm" aria-label="编辑方式" :options="[{value: 'rich', label: '富文本'}, {value: 'source', label: '源文字'}]" @update:model-value="(value) => switchMode(value as 'rich' | 'source')" />
        </div>
        <Transition name="entry-rich-fade">
            <p v-if="switchProblem !== ''" class="entry-rich__problem" role="alert">{{ switchProblem }}</p>
        </Transition>
        <div v-show="mode === 'rich'" ref="mount" class="entry-rich__mount" />
        <Textarea v-if="mode === 'source'" v-model="sourceText" class="entry-rich__source" variant="bare" autosize :max-rows="40" aria-label="源文字" />

        <AnchoredPopover :open="open !== null && open.kind !== 'pick'" :anchor="anchor" side="bottom" align="start">
            <div v-if="open?.kind === 'value' && isCalc" class="entry-pop entry-pop--wide" data-pop="calc">
                <div class="entry-pop__head"><span class="entry-pop__title">计算</span></div>
                <div class="entry-pop__expr">
                    <Input :model-value="calcExpression" size="sm" class="entry-pop__test" placeholder="例如 panel.魔力上限 - panel.魔力" aria-label="式子" @update:model-value="(value: string) => updateCalc(value)" />
                    <IconButton size="sm" icon-class="i-lucide-braces" title="插入字段" @click="(event: MouseEvent) => startPathPick('calc', event)" />
                </div>
                <p class="entry-pop__readable" :class="{'entry-pop__readable--bad': calcState.problem !== ''}">{{ calcState.problem || calcState.readable }}</p>
                <p v-if="calcState.result !== ''" class="entry-pop__value">＝ {{ calcState.result }}</p>
                <div class="entry-pop__actions">
                    <Button size="sm" variant="ghost" @click="removeOpened">删掉</Button>
                </div>
            </div>
            <div v-else-if="open?.kind === 'value'" class="entry-pop" data-pop="value">
                <template v-if="openedField !== null">
                    <div class="entry-pop__head">
                        <span class="entry-pop__title">{{ openedField.group }} · {{ openedField.label }}</span>
                        <span class="entry-pop__meta">{{ entryName(openedField.entry) }} · 第 3 章末尾</span>
                    </div>
                    <template v-if="!open.editing">
                        <p class="entry-pop__value">{{ display(openedField.value) }}</p>
                        <div class="entry-pop__actions">
                            <Button size="sm" variant="ghost" data-act="edit" @click="open = {...open, editing: true}">{{ openedField.entry === HOME ? "去设定组里改" : `去${entryName(openedField.entry)}那里改` }}</Button>
                            <Button size="sm" variant="ghost" @click="replaceOpened('value')">换一个</Button>
                            <Button size="sm" variant="ghost" @click="removeOpened">删掉</Button>
                        </div>
                    </template>
                    <form v-else class="entry-pop__edit" @submit.prevent="setField">
                        <Input v-model="valueDraft" size="sm" autofocus :aria-label="openedField.label" />
                        <Button size="sm" variant="primary" type="submit" data-act="save">保存</Button>
                    </form>
                </template>
                <template v-else>
                    <div class="entry-pop__head"><span class="entry-pop__title entry-pop__title--bad">这个字段读不到</span></div>
                    <div class="entry-pop__actions">
                        <Button size="sm" variant="ghost" @click="replaceOpened('value')">换一个字段</Button>
                        <Button size="sm" variant="ghost" @click="removeOpened">删掉</Button>
                    </div>
                </template>
            </div>
            <div v-else-if="open?.kind === 'ref'" class="entry-pop" data-pop="ref">
                <div class="entry-pop__head"><span class="entry-pop__title">{{ entryName(String(node?.attrs.id ?? "")) }}</span></div>
                <div class="entry-pop__actions">
                    <Button size="sm" variant="ghost" @click="replaceOpened('ref')">换一个条目</Button>
                    <Button size="sm" variant="ghost" @click="removeOpened">删掉</Button>
                </div>
            </div>
            <div v-else-if="open?.kind === 'if'" class="entry-pop entry-pop--wide" data-pop="if">
                <div v-for="(branch, index) in branches" :key="index" class="entry-pop__branch" :data-on="index === activeIndex ? '' : undefined">
                    <div class="entry-pop__branch-head">
                        <span class="entry-pop__branch-name">{{ branch.test === null ? "否则" : index === 0 ? "如果" : "否则如果" }}</span>
                        <Input v-if="branch.test !== null" :model-value="branch.test" size="sm" class="entry-pop__test" placeholder="例如 panel.魔力 >= 1000 && panel.回溯 > 0" :aria-label="`第 ${index + 1} 支的条件`" @update:model-value="(value: string) => updateBranch(index, {test: value})" />
                        <IconButton v-if="branch.test !== null" size="sm" icon-class="i-lucide-braces" title="插入字段" @click="(event: MouseEvent) => startPathPick(index, event)" />
                        <span v-if="index === activeIndex" class="entry-pop__now">现在是这一支</span>
                    </div>
                    <p v-if="branch.test !== null" class="entry-pop__readable">{{ testProblem(branch.test) || readableTest(branch.test, fields) }}</p>
                    <Textarea :model-value="branch.text" :rows="1" autosize :max-rows="6" :placeholder="branch.test === null ? '都不满足时显示的文字（可以空着）' : '满足时显示的文字'" :aria-label="`第 ${index + 1} 支的文字`" @update:model-value="(value: string) => updateBranch(index, {text: value})" />
                    <p v-if="branch.text.includes('<V')" class="entry-pop__readable">显示为：{{ branchText(branch.text, fields) }}</p>
                </div>
                <div class="entry-pop__actions">
                    <Button size="sm" variant="ghost" @click="addElseIf">加一个“否则如果”</Button>
                    <Button size="sm" variant="ghost" @click="removeOpened">删掉这个条件</Button>
                </div>
            </div>
        </AnchoredPopover>

        <SuggestionMenu :groups="pickGroups" :active-id="activeId" :anchor="open?.kind === 'pick' ? open.dom : (pathPick?.dom ?? null)" label="插入" @select="(id: string) => choose(id)" @highlight="(id: string) => (activeId = id)">
            <template #header>
                <div class="entry-pick__search">
                    <Input v-model="query" size="sm" autofocus :placeholder="open?.kind === 'pick' && open.what === 'ref' ? '找条目' : open?.kind === 'pick' && open.what === 'if-field' ? '条件看哪个字段' : pathPick !== null ? '插入哪个字段' : '找字段，或“条件”“计算”'" aria-label="搜索" @keydown="pickKey" />
                </div>
            </template>
        </SuggestionMenu>
    </div>
</template>

<style scoped>
.entry-rich {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 46rem;
    margin: 0 auto;
    padding: 1rem;
}
.entry-rich__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle, var(--border-default));
}
.entry-rich__where {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    margin-right: 0.25rem;
}
.entry-rich__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.entry-rich__problem {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-sm);
}
.entry-rich__mount :deep(.entry-rich__prose) {
    min-height: 16rem;
    outline: none;
}
.entry-rich__source {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-sm);
    min-height: 16rem;
}
.entry-rich-fade-enter-active,
.entry-rich-fade-leave-active {
    transition: opacity var(--duration-fast, 150ms) var(--ease-standard, ease);
}
.entry-rich-fade-enter-from,
.entry-rich-fade-leave-to {
    opacity: 0;
}

/* 行内小块：值是此刻的样子，所以字用正文色；底色与描边用信息色（“引用”）淡淡地标出这是取来的。 */
.entry-rich__mount :deep(.entry-chip) {
    display: inline;
    /* 与两边的字留出空隙：光标停在小块前后时，看得出它在小块外面。 */
    margin: 0 0.2em;
    padding: 0.05em 0.3em;
    border-radius: 4px;
    background: color-mix(in srgb, var(--status-info) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--status-info) 28%, transparent);
    color: var(--text-main);
    cursor: pointer;
    transition: background var(--duration-fast, 150ms) var(--ease-standard, ease), box-shadow var(--duration-fast, 150ms) var(--ease-standard, ease);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
}
.entry-rich__mount :deep(.entry-chip:hover) {
    background: color-mix(in srgb, var(--status-info) 18%, transparent);
}
.entry-rich__mount :deep(.entry-chip--long) {
    padding: 0;
    background: color-mix(in srgb, var(--status-info) 6%, transparent);
    box-shadow: none;
    border-bottom: 1px solid color-mix(in srgb, var(--status-info) 45%, transparent);
    border-radius: 0;
}
.entry-rich__mount :deep(.entry-chip__from) {
    margin-right: 0.25em;
    color: var(--text-secondary);
    font-size: 0.85em;
}
.entry-rich__mount :deep(.entry-chip--unknown) {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border-default);
    border: 1px dashed var(--border-default);
    color: var(--text-secondary);
}
.entry-rich__mount :deep(.entry-chip--missing) {
    background: color-mix(in srgb, var(--status-warning) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--status-warning) 45%, transparent);
    color: var(--text-main);
}
.entry-rich__mount :deep(.entry-chip--ref) {
    background: transparent;
    box-shadow: none;
    border-bottom: 1px solid var(--accent-main);
    border-radius: 0;
    padding: 0;
    color: var(--accent-main);
}
.entry-rich__mount :deep(.ProseMirror-selectednode.entry-chip),
.entry-rich__mount :deep(.ProseMirror-selectednode.entry-if) {
    outline: 2px solid var(--focus-ring, var(--accent-main));
    outline-offset: 1px;
}

/* 条件：只画生效的一支时，它读起来就是正文，下面一条虚线说明“这句随数据变”。 */
.entry-rich__mount :deep(.entry-if) {
    cursor: pointer;
}
.entry-rich__mount :deep(.entry-if--active .entry-if__text) {
    border-bottom: 1px dashed color-mix(in srgb, var(--status-info) 60%, transparent);
    transition: background var(--duration-fast, 150ms) var(--ease-standard, ease);
}
.entry-rich__mount :deep(.entry-if--active:hover .entry-if__text) {
    background: color-mix(in srgb, var(--status-info) 10%, transparent);
}
.entry-rich__mount :deep(.entry-if__placeholder) {
    color: var(--text-tertiary, var(--text-secondary));
    font-size: 0.85em;
    border: 1px dashed var(--border-default);
    border-radius: 4px;
    padding: 0 0.3em;
}
.entry-rich__mount :deep(.entry-if--both) {
    margin: 0 0.2em;
    padding: 0.05em 0.25em;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--status-info) 28%, transparent);
}
.entry-rich__mount :deep(.entry-if__test) {
    margin-right: 0.35em;
    padding: 0 0.3em;
    border-radius: 3px;
    background: color-mix(in srgb, var(--status-info) 14%, transparent);
    color: var(--text-secondary);
    font-size: 0.85em;
}
.entry-rich__mount :deep(.entry-if__branch) {
    color: color-mix(in srgb, var(--text-main) 42%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--text-main) 55%, transparent);
}
.entry-rich__mount :deep(.entry-if__branch + .entry-if__branch)::before {
    content: "｜";
    color: var(--border-default);
    text-decoration: none;
    display: inline-block;
}
.entry-rich__mount :deep(.entry-if__branch--on) {
    color: var(--text-main);
    text-decoration: none;
}

.entry-pop {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 15rem;
    max-width: min(22rem, calc(100vw - 2rem));
    padding: 0.75rem;
}
.entry-pop--wide {
    max-width: min(28rem, calc(100vw - 2rem));
}
.entry-pop__head {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
}
.entry-pop__title {
    font-weight: 600;
}
.entry-pop__title--bad {
    color: var(--status-warning);
}
.entry-pop__meta,
.entry-pop__readable {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.entry-pop__value {
    margin: 0;
    font-size: var(--text-lg, 1.125rem);
}
.entry-pop__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-left: -0.5rem;
}
.entry-pop__edit {
    display: flex;
    gap: 0.5rem;
}
.entry-pop__branch {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: 6px;
    transition: background var(--duration-fast, 150ms) var(--ease-standard, ease);
}
.entry-pop__branch[data-on] {
    background: color-mix(in srgb, var(--status-info) 8%, transparent);
}
.entry-pop__branch-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.entry-pop__branch-name {
    flex: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.entry-pop__expr {
    display: flex;
    align-items: center;
    gap: 0.25rem;
}
.entry-pop__readable--bad {
    color: var(--status-warning);
}
.entry-rich__mount :deep(.entry-chip--calc .entry-chip__from) {
    color: var(--status-info);
}
.entry-pop__test {
    flex: 1;
    font-family: var(--font-mono, ui-monospace, monospace);
}
.entry-pop__now {
    flex: none;
    color: var(--status-info);
    font-size: var(--text-xs, 0.75rem);
}
.entry-pick__search {
    padding: 0.5rem 0.5rem 0.25rem;
}
</style>
