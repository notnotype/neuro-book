<script setup lang="ts">
/** 条目主文字的富文本输入框（同名 .md）：与源文字输入框同一个合同，读写经章节编辑器的编解码器加条目语法。 */
import {Editor, Extension} from "@tiptap/core";
import {Slice} from "@tiptap/pm/model";
import type {Fragment, Node as PMNode} from "@tiptap/pm/model";
import {EditorState, NodeSelection} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";
import {computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import {Button, Input, Popover, SuggestionMenu, suggestionMenuOptions} from "@notnotype/nb-ui/components";
import type {PopoverReference, SuggestionMenuGroup} from "@notnotype/nb-ui/components";
import {defaultChipEnv} from "@notnotype/nb-markdown/chip";
import {createMarkdownEditorExtensions} from "@notnotype/nb-markdown/editor";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, SourceMap} from "@notnotype/nb-markdown/language";
import "@notnotype/nb-markdown/markdown.css";

import type {EntryFind} from "./entry-picker";
import {useEntryFind} from "./entry-picker";
import type {EntryTextValue} from "./entry-text";
import {checkedWrite} from "../entry-check";
import {chipOf} from "../entry-chip";
import type {ChipContext, ChipModel, EntryField} from "../entry-chip";
import {attributeOf, draftOf, quoteProblem, sourceOf, withAttribute, withElseIf} from "../entry-chip-edit";
import type {ChipDraft, DraftBranch} from "../entry-chip-edit";
import {conditionView, entryValuesKey, entryValuesPlugin, setEntryValues, tagView, valueDecorations} from "../entry-chip-views";
import type {ChipHost} from "../entry-chip-views";
import {ENTRY_IF_NODE, ENTRY_TAG_NODE, entryIfNode, entrySyntax, entryTagNode} from "../entry-syntax";
import {valueSequence} from "../entry-values";
import type {TagValue} from "../entry-values";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    modelValue: string;
    label: string;
    language?: string;
    readonly?: boolean;
    baseline?: ReadonlySet<string>;
    /** 这个条目的 id：取值不写 `entry` 时指它自己。 */
    self?: string;
    /** 本条目的字段与这一页位置上的值：刚插进来的取值马上显示它。 */
    fields?: readonly EntryField[];
    /** 本条目各字段的“改过”标记，按地址。 */
    marks?: Readonly<Record<string, string>>;
    /** 世界服务按某一版整篇算的值表；对不上那一版的不用。 */
    values?: {readonly source: string; readonly values: readonly EntryTextValue[]} | null;
    /** 值正在算；为假时没有值的计算类小块是“没有算”。 */
    computing?: boolean;
    /** 条件画成条件式加各支。 */
    showBranches?: boolean;
    /** 找条目（`@` 的列表与条目引用的“换一个”）；没有时 `@` 照普通的字打进去。 */
    find?: EntryFind | null;
}>(), {language: "canon-entry", readonly: false, baseline: () => new Set<string>(), self: "", fields: () => [], marks: () => ({}), values: null, computing: true, showBranches: false, find: null});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []; "discarded": []}>();

const text = useCanonText();

/** 条目主文字的语言：核心语法加条目语法，不读 frontmatter（主文字开头的 `---` 是正文，rendering 输出 21）。全应用共用一份。 */
const language = entryLanguage();

const mount = useTemplateRef<HTMLElement>("mount");
/** 写不出（不应发生）：输入框下面写一句，暂存留着最后一次交出的文字。 */
const unwritable = ref(false);

let editor: Editor | null = null;

/** 节点视图向这里要上下文：读的是此刻的属性。 */
const host: ChipHost = {
    context: (): ChipContext => ({
        self: props.self,
        fields: new Map(props.fields.map((field) => [field.path, field])),
        marks: props.marks,
        computing: props.computing,
        words: {unknown: text("value.unknown"), deletedRef: text("value.deletedRef"), needsPlugin: text("value.needsPlugin")},
    }),
    showBranches: () => props.showBranches,
    words: () => ({noBranch: text("textEdit.noBranch"), unknown: text("value.unknown"), condition: text("textEdit.condition")}),
};
/** 最近一次对上的值（按标签原文）：属性变了要重画时用它重新挂。 */
let sequence: readonly TagValue[] = [];
/** 输入法正在组字时不换值（换了会重画小块、打断组字），组完再换。 */
let valuesWaiting = false;

/** 按最近一次的值重新挂到此刻的文档上（也让每个小块按此刻的属性重画）。 */
function hangValues(): void {
    if (editor === null) return;
    if (editor.view.composing) {
        valuesWaiting = true;
        return;
    }
    valuesWaiting = false;
    setEntryValues(editor.view, valueDecorations(editor.state, sequence));
}
let codec: MarkdownCodec | null = null;
let map: SourceMap | null = null;
/** 最近一次交出（或从外面收到）的整篇：`modelValue` 等于它就是回声，不重读。 */
let lastText = props.modelValue;
/** 程序自己发的事务（回填写法、按外面的整篇替换）期间不写出、不交出。 */
let quiet = false;

/** 程序发的事务：不进撤销历史，也不当作作者的输入。 */
function quietly(change: (tr: Transaction) => void): void {
    if (editor === null) return;
    quiet = true;
    try {
        const tr = editor.state.tr;
        change(tr);
        tr.setMeta("addToHistory", false);
        if (tr.steps.length > 0) editor.view.dispatch(tr);
    } finally {
        quiet = false;
    }
}

/** 作者改了文档：整篇写出，写得出就交出；写出被接受以后把重新写出的块实际用的写法回填（同章节编辑器）。 */
function writeOut(): void {
    if (editor === null || codec === null || map === null || props.readonly) return;
    const written = codec.write(editor.state.doc, map);
    if (!written.ok) {
        unwritable.value = true;
        return;
    }
    unwritable.value = false;
    if (written.text !== lastText) {
        lastText = written.text;
        emit("update:modelValue", written.text);
    }
    quietly((tr) => written.accept(tr));
}

/* ---------- 改小块：点开的浮层（输出 48 的“改小块”） ---------- */

/**
 * 正在改的小块。`at` 是它在文档里的范围；新插的条件、计算还没进文档，`node` 为 null、`at` 是插入的位置（`from === to`）。
 * 浮层里打的字只存在 `draft` 里，按“应用”才过检查、落进文档；对象整个换掉（`shallowRef`），`id` 用来认出等待期间被换掉的那一个。
 */
interface ChipEditing {
    readonly id: number;
    readonly at: {readonly from: number; readonly to: number};
    readonly node: PMNode | null;
    readonly anchor: HTMLElement;
    readonly reference: PopoverReference | null;
    /** 这个小块此刻显示的东西（种类、显示名、值）：浮层的标题与全文。 */
    readonly model: ChipModel | null;
    /** 条件生效的是第几支。 */
    readonly taken: number | null;
    readonly initial: ChipDraft;
    readonly draft: ChipDraft;
    readonly problem: string | null;
    readonly applying: boolean;
}
const editing = shallowRef<ChipEditing | null>(null);
let editingId = 0;
/** 浮层是按 Esc 关的：关上以后焦点回编辑器、小块仍选中。点外面关的焦点留在点的地方。 */
let closedByEscape = false;
/** 浮层里按了 Esc：原语接着把它关上，关上时据此把焦点交回编辑器。 */
const markEscape = (): void => {
    closedByEscape = true;
};

const patchEditing = (patch: Partial<ChipEditing>): void => {
    if (editing.value !== null) editing.value = {...editing.value, ...patch};
};
/** 浮层里有没应用的字。 */
const changed = (state: ChipEditing): boolean => sourceOf(state.draft) !== sourceOf(state.initial);

/** 小块的原文：标签节点存着；条件把这一个节点单独写出（成组的条件写在一行）。 */
function sourceOfNode(node: PMNode): string {
    if (node.type.name === ENTRY_TAG_NODE) return node.attrs.source as string;
    if (editor === null || codec === null) return "";
    const {schema} = editor.state;
    const written = codec.write(schema.node("doc", null, [schema.node("paragraph", null, [node])]), codec.read("").map);
    return written.ok ? written.text.trim() : "";
}

/** 挂在这个小块上的值（值表对上的那几项）。 */
function valuesAt(state: EditorState, from: number, to: number): ReadonlyArray<EntryTextValue | undefined> {
    for (const decoration of entryValuesKey.getState(state)?.find(from, to) ?? []) {
        const values = (decoration.spec as {values?: ReadonlyArray<EntryTextValue | undefined>}).values;
        if (values !== undefined) return values;
    }
    return [];
}

/** 打开 `pos` 处小块的浮层（点它，或选中它按 Enter）。再点同一个是关上。 */
function openChip(view: EditorView, pos: number): void {
    const node = view.state.doc.nodeAt(pos);
    const anchor = view.nodeDOM(pos);
    if (node === null || !(anchor instanceof HTMLElement)) return;
    if (editing.value?.node === node && editing.value.at.from === pos) {
        closeChip(false);
        return;
    }
    closeChip(false);
    const source = sourceOfNode(node);
    const values = valuesAt(view.state, pos, pos + node.nodeSize);
    const head = values[0] as {taken?: number | null} | undefined;
    const draft = draftOf(source);
    anchor.setAttribute("aria-haspopup", "dialog");
    anchor.setAttribute("aria-expanded", "true");
    editing.value = {
        id: ++editingId,
        at: {from: pos, to: pos + node.nodeSize},
        node,
        anchor,
        reference: null,
        model: node.type.name === ENTRY_TAG_NODE ? chipOf(source, values[0], host.context()) : null,
        taken: head?.taken ?? null,
        initial: draft,
        draft,
        problem: null,
        applying: false,
    };
}

/** 新插一个条件或计算：先在浮层里写好，应用时才进文档。浮层贴着光标。 */
function openNew(view: EditorView, at: {from: number; to: number}, draft: ChipDraft): void {
    closeChip(false);
    const rect = view.coordsAtPos(at.from);
    editing.value = {
        id: ++editingId,
        at,
        node: null,
        anchor: view.dom,
        reference: {getBoundingClientRect: () => new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top), contextElement: view.dom},
        model: null,
        taken: null,
        initial: draft,
        draft,
        problem: null,
        applying: false,
    };
}

/** 关上浮层。`discard` 为真（不是作者自己关的：外面换了整篇、小块不在了、变只读）且有没应用的字时，发 `discarded` 让状态行提示一句。 */
function closeChip(discard: boolean): void {
    const current = editing.value;
    if (current === null) return;
    editing.value = null;
    current.anchor.setAttribute("aria-expanded", "false");
    if (discard && changed(current)) emit("discarded");
}

/**
 * 焦点回编辑器，`pos` 处的小块是节点选区（Esc 关浮层、应用之后）。原语在浮层卸下时把焦点还给锚点（小块不能聚焦，落到 body），
 * 那一步排在卸下以后的定时器里：等这一轮更新做完、再等一个定时器，排在它后面。
 */
function focusChip(pos: number): void {
    void nextTick(() =>
        setTimeout(() => {
            if (editor === null) return;
            const {state} = editor.view;
            const node = state.doc.nodeAt(pos);
            if (node !== null && isChip(node)) editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
            editor.view.focus();
        }, 0),
    );
}

function onPopoverOpen(open: boolean): void {
    if (open) return;
    const current = editing.value;
    closeChip(false);
    if (current !== null && closedByEscape) focusChip(current.at.from);
    closedByEscape = false;
}

/**
 * 把 `at` 换成一段源文读成的节点（改小块、插入新的、从列表里选）：读出来必须正好是一个 `expected` 节点（条件读成了几个标签，说明
 * 写法把它切坏了），再整篇过写入前的检查（`entry-check.ts`）。通过的交回事务（一次改动是一个撤销步，调用方先关浮层再发：发出去
 * 以后锚着的小块换了，`followChip` 会把还开着的浮层当作“小块不在了”丢弃），不通过的交回问题的说明。
 */
function changeTo(at: {from: number; to: number}, source: string, expected: string): Transaction | string {
    if (editor === null || codec === null || map === null) return text("chipEdit.unwritable");
    const read = codec.read(source);
    const only = read.doc.childCount === 1 ? read.doc.firstChild : null;
    const content: Fragment | null = only !== null && only.type.name === "paragraph" ? only.content : null;
    if (content === null || content.childCount !== 1 || content.firstChild!.type.name !== expected) return text("chipEdit.notOne");
    const tr = editor.state.tr.replaceWith(at.from, at.to, content);
    const checked = checkedWrite(codec, tr.doc, map, props.baseline);
    if (!checked.ok) return checked.problem === null ? text("chipEdit.unwritable") : text("textEdit.problemRejected", {message: checked.problem.message});
    return tr.setSelection(NodeSelection.create(tr.doc, at.from)).scrollIntoView();
}

/** 让“应用”的进行中先画出来再做检查（整篇长时检查要几百毫秒）。 */
const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function applyChip(): Promise<void> {
    const current = editing.value;
    if (current === null || current.applying || props.readonly || current.draft.kind === "other") return;
    if (current.node !== null && !changed(current)) {
        closeChip(false);
        focusChip(current.at.from);
        return;
    }
    if (quoteProblem(current.draft)) {
        patchEditing({problem: text("chipEdit.quote")});
        return;
    }
    patchEditing({applying: true, problem: null});
    await nextPaint();
    // 等待期间浮层关了或换成了别的小块：这次不做。
    if (editing.value?.id !== current.id) return;
    const at = editing.value.at;
    const change = changeTo(at, sourceOf(current.draft), current.draft.kind === "if" ? ENTRY_IF_NODE : ENTRY_TAG_NODE);
    if (typeof change === "string") {
        patchEditing({applying: false, problem: change});
        return;
    }
    closeChip(false);
    editor?.view.dispatch(change);
    focusChip(at.from);
}

function removeChip(): void {
    const current = editing.value;
    if (current === null || current.node === null || editor === null || codec === null || map === null || props.readonly) return;
    const tr = editor.state.tr.delete(current.at.from, current.at.to);
    const checked = checkedWrite(codec, tr.doc, map, props.baseline);
    if (!checked.ok) {
        patchEditing({problem: checked.problem === null ? text("chipEdit.unwritable") : text("textEdit.problemRejected", {message: checked.problem.message})});
        return;
    }
    closeChip(false);
    editor.view.dispatch(tr);
    editor.view.focus();
}

const setDraft = (draft: ChipDraft): void => patchEditing({draft, problem: null});
function setAttribute(name: string, value: string): void {
    const draft = editing.value?.draft;
    if (draft === undefined || draft.kind === "other") return;
    setDraft({...draft, attributes: withAttribute(draft.attributes, name, value)});
}
function setBranch(index: number, patch: Partial<DraftBranch>): void {
    const draft = editing.value?.draft;
    if (draft?.kind !== "if") return;
    setDraft({...draft, branches: draft.branches.map((branch, at) => (at === index ? {...branch, ...patch} : branch))});
}
function addBranch(): void {
    const draft = editing.value?.draft;
    if (draft?.kind === "if") setDraft({...draft, branches: withElseIf(draft.branches)});
}

/** 文档变了：锚着的小块按位置映射，映射后不是同一个节点（撤销、别处的改动把它换了或删了）就关上浮层。 */
function followChip(tr: Transaction): void {
    const current = editing.value;
    if (current === null || !tr.docChanged) return;
    if (current.node === null) {
        const at = tr.mapping.map(current.at.from, -1);
        patchEditing({at: {from: at, to: at}});
        return;
    }
    const mapped = tr.mapping.mapResult(current.at.from, 1);
    const node = mapped.deleted ? null : tr.doc.nodeAt(mapped.pos);
    if (node === null || !node.eq(current.node)) {
        closeChip(true);
        return;
    }
    patchEditing({at: {from: mapped.pos, to: mapped.pos + node.nodeSize}, node});
}

/* ---------- `{`、`@` 与“换一个”：候选列表 ---------- */

/** 打开着的候选列表。`trigger` 是打开它的那个字（Esc、空格时退回成普通的字）；“换一个”打开的没有。 */
interface ChipMenu {
    readonly what: "value" | "ref";
    readonly at: {readonly from: number; readonly to: number};
    readonly anchor: Element | {getBoundingClientRect: () => DOMRect; contextElement?: Element};
    readonly trigger: "{" | "@" | null;
    /** “换一个”时原来那个标签的属性：换字段或条目时别的属性留着。 */
    readonly replacing: ChipDraft | null;
}
const menu = shallowRef<ChipMenu | null>(null);
const menuRef = useTemplateRef<{contains(node: Node | null): boolean}>("menuRef");
const query = ref("");
const activeId = ref<string | null>(null);
const menuProblem = ref<string | null>(null);
const entries = useEntryFind(() => props.find ?? (async () => ({ok: true as const, items: []})));

const IF_ITEM = "#if";
const CALC_ITEM = "#calc";
const FIELD_PREFIX = "field:";
const ENTRY_PREFIX = "entry:";

const menuGroups = computed<SuggestionMenuGroup[]>(() => {
    const current = menu.value;
    if (current === null) return [];
    const words = query.value.trim();
    if (current.what === "ref") {
        const found = entries.results.value;
        const items = found.kind === "done" ? found.items : [];
        return [{id: "entries", items: items.map((entry) => ({id: `${ENTRY_PREFIX}${entry.id}`, label: entry.name, hint: entry.note ?? entry.kind, iconClass: "i-lucide-bookmark"}))}];
    }
    // 插值的列表最前面是“条件”与“计算”（“换一个”时没有）：打“如果”“条件”“计算”“式子”也能筛到。
    const structures = current.replacing !== null ? [] : [
        {id: IF_ITEM, label: text("chipEdit.newIf"), iconClass: "i-lucide-split", words: text("chipEdit.ifWords")},
        {id: CALC_ITEM, label: text("chipEdit.newCalc"), iconClass: "i-lucide-calculator", words: text("chipEdit.calcWords")},
    ].filter((item) => words === "" || item.words.includes(words) || item.label.includes(words)).map(({words: _words, ...item}) => item);
    const fields = props.fields
        .filter((field) => words === "" || `${field.group}${field.label}${field.path}`.includes(words))
        .map((field) => ({id: `${FIELD_PREFIX}${field.path}`, label: `${field.group} · ${field.label}`, hint: field.display ?? text("value.unknown"), iconClass: "i-lucide-hash"}));
    return [...(structures.length === 0 ? [] : [{id: "structures", items: structures}]), ...(fields.length === 0 ? [] : [{id: "fields", items: fields}])];
});
const menuOptions = computed(() => suggestionMenuOptions(menuGroups.value));
watch(menuOptions, (options) => {
    activeId.value = options[0]?.id ?? null;
});
watch(query, (words) => {
    menuProblem.value = null;
    if (menu.value?.what === "ref") entries.search(words.trim());
});

function openMenu(next: ChipMenu): void {
    closeChip(false);
    menu.value = next;
    query.value = "";
    menuProblem.value = null;
    if (next.what === "ref") entries.search("");
    // 列表传送到 body：挂上以后把焦点交给搜索框，接着打的字落进搜索框而不是正文。
    void nextTick(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-chip-menu] input")?.focus()));
}

/** 关上列表，焦点回编辑器。`literal` 时把打开它的那个字补回正文（作者不想插值，就是要打这个字）。 */
function closeMenu(literal: boolean): void {
    const current = menu.value;
    if (current === null || editor === null) return;
    menu.value = null;
    const chain = editor.chain().focus();
    if (literal && current.trigger !== null) chain.insertContentAt(current.at, current.trigger);
    chain.run();
}

function choose(id: string): void {
    const current = menu.value;
    if (current === null || editor === null) return;
    if (id === IF_ITEM || id === CALC_ITEM) {
        menu.value = null;
        const draft: ChipDraft = id === IF_ITEM
            ? {kind: "if", attributes: [["test", ""]], branches: [{test: "", text: ""}, {test: null, text: ""}]}
            : {kind: "calc", attributes: [["expr", ""]]};
        openNew(editor.view, current.at, draft);
        return;
    }
    const kept = current.replacing !== null && current.replacing.kind !== "other" && current.replacing.kind !== "if" ? current.replacing.attributes : [];
    const source = id.startsWith(ENTRY_PREFIX)
        ? sourceOf({kind: "ref", attributes: withAttribute(kept, "id", id.slice(ENTRY_PREFIX.length))})
        : sourceOf({kind: "value", attributes: withAttribute(withAttribute(withAttribute(kept, "expr", null), "entry", null), "of", id.slice(FIELD_PREFIX.length))});
    const change = changeTo(current.at, source, ENTRY_TAG_NODE);
    if (typeof change === "string") {
        menuProblem.value = change;
        return;
    }
    menu.value = null;
    editor.view.dispatch(change);
    editor.view.focus();
}

function menuKey(event: KeyboardEvent): void {
    const options = menuOptions.value;
    const index = options.findIndex((item) => item.id === activeId.value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        activeId.value = options[(index + step + options.length) % Math.max(options.length, 1)]?.id ?? null;
    } else if (event.key === "Enter" && !event.isComposing && activeId.value !== null) {
        event.preventDefault();
        choose(activeId.value);
    } else if (event.key === "Escape" || (event.key === " " && query.value === "")) {
        event.preventDefault();
        closeMenu(true);
    }
}

/** 列表外按下：关上列表，不补字（作者点到别处去了）。 */
function menuOutside(event: PointerEvent): void {
    if (menu.value === null) return;
    if (menuRef.value?.contains(event.target as Node | null) !== true) menu.value = null;
}
onMounted(() => document.addEventListener("pointerdown", menuOutside, true));
onBeforeUnmount(() => document.removeEventListener("pointerdown", menuOutside, true));

/** “换一个”：关上浮层，在小块上打开同一种列表，选了就换掉它。 */
function replaceChip(): void {
    const current = editing.value;
    if (current === null || current.node === null || editor === null) return;
    const what = current.draft.kind === "ref" ? "ref" : "value";
    openMenu({what, at: current.at, anchor: current.anchor, trigger: null, replacing: current.draft});
}

/** 光标在行内代码或代码块里：标签在那里是字面的，`{`、`@` 照普通的字打。 */
function inCode(view: EditorView): boolean {
    const {$from} = view.state.selection;
    if ($from.parent.type.spec.code === true) return true;
    return (view.state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code === true);
}

/** 编辑区的按键：`{`、`@` 打开列表；选中小块时 Enter 打开浮层。 */
function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (props.readonly || event.isComposing) return false;
    const {selection} = view.state;
    if (event.key === "Enter" && selection instanceof NodeSelection && isChip(selection.node)) {
        event.preventDefault();
        openChip(view, selection.from);
        return true;
    }
    if ((event.key !== "{" && event.key !== "@") || inCode(view)) return false;
    if (event.key === "@" && props.find === null) return false;
    event.preventDefault();
    const rect = view.coordsAtPos(selection.from);
    openMenu({
        what: event.key === "{" ? "value" : "ref",
        at: {from: selection.from, to: selection.to},
        anchor: {getBoundingClientRect: () => new DOMRect(rect.left, rect.top, 1, rect.bottom - rect.top), contextElement: view.dom},
        trigger: event.key,
        replacing: null,
    });
    return true;
}

const isChip = (node: PMNode): boolean => node.type.name === ENTRY_TAG_NODE || node.type.name === ENTRY_IF_NODE;

/** 点小块：选中它并打开浮层（只读时也能打开看）。 */
function handleClickOn(view: EditorView, _pos: number, node: PMNode, nodePos: number, _event: MouseEvent, direct: boolean): boolean {
    if (!direct || !isChip(node)) return false;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
    openChip(view, nodePos);
    return true;
}

/** 浮层的标题。 */
const editingTitle = computed(() => {
    const current = editing.value;
    if (current === null) return "";
    switch (current.draft.kind) {
        case "value": {
            const field = props.fields.find((item) => item.path === attributeOf(current.draft as {attributes: ReadonlyArray<readonly [string, string]>}, "of"));
            return field === undefined ? (current.model?.label ?? text("chipEdit.valueTitle")) : `${field.group} · ${field.label}`;
        }
        case "calc":
            return text("chipEdit.calcTitle");
        case "if":
            return text("chipEdit.ifTitle");
        case "ref":
            return current.model?.text ?? text("chipEdit.refTitle");
        case "other":
            return text("chipEdit.otherTitle");
    }
});
const branchName = (branch: DraftBranch, index: number): string => (branch.test === null ? text("chipEdit.else") : index === 0 ? text("chipEdit.if") : text("chipEdit.elseIf"));

onMounted(() => {
    if (mount.value === null) return;
    const created = new Editor({
        element: mount.value,
        extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => null, assets: null, chips: defaultChipEnv}, commentMarkerLabel: null}),
        // 节点视图在读入文档时建，宿主要先放好：先以空文档建编辑器，放好宿主再换成读入的文档。
        content: "",
        editable: !props.readonly,
        editorProps: {attributes: {"class": "nb-markdown entry-rich__prose", "aria-label": props.label}, handleKeyDown, handleClickOn},
    });
    // 编辑器内部有原生对象（MutationObserver）：不能被 Vue 代理。
    editor = markRaw(created);
    codec = codecFor(created.schema, language);
    (created.storage as unknown as Record<string, {host: ChipHost | null}>)[CHIPS_STORAGE]!.host = host;
    // 读入的文档就是编辑器的文档（同一个 schema）：原文对照登记在这些节点上，没改过的块写回原文。
    const read = codec.read(props.modelValue);
    map = read.map;
    created.view.updateState(EditorState.create({doc: read.doc, plugins: created.state.plugins}));
    created.on("transaction", ({transaction}) => followChip(transaction));
    created.on("update", ({transaction}) => {
        if (!quiet && transaction.docChanged) writeOut();
    });
    hangValues();
    created.view.dom.addEventListener("compositionend", () => {
        if (valuesWaiting) queueMicrotask(hangValues);
    });
    created.on("focus", () => emit("focus"));
    created.on("blur", () => emit("blur"));
});

onBeforeUnmount(() => {
    editor?.destroy();
    editor = null;
});

watch(
    () => props.modelValue,
    (value) => {
        if (value === lastText || editor === null || codec === null) return;
        // 外面换了整篇（换成那边的、冲突里选现在的、重连后读到的暂存）：只换不同的那一段，撤销历史保留。
        lastText = value;
        unwritable.value = false;
        closeChip(true);
        menu.value = null;
        quietly((tr) => {
            map = codec!.reload(tr, value);
        });
    },
);

watch(
    () => props.values,
    (next) => {
        if (next === null) return;
        const found = valueSequence(next.source, next.values);
        // 值表对不上它说的那一版源文（前后端不同版）：这一批不用，小块留着上一次的值。
        if ("mismatch" in found) return;
        sequence = found;
        hangValues();
    },
    // 挂载时就带着值表（刚点“编辑”，用阅读视图手里的那份当初值）：先记下，编辑器建好以后挂上。
    {immediate: true},
);

watch(() => [props.fields, props.marks, props.computing, props.showBranches, props.self], hangValues);

watch(
    () => props.readonly,
    (readonly) => {
        editor?.setEditable(!readonly, false);
        // 变只读（开始提交、条目被删）：浮层里没应用的字丢掉，列表关上。
        if (readonly) {
            closeChip(true);
            menu.value = null;
        }
    },
);

/** 光标所在的顶层块之前写出的长度、加上块内按纯文字数的偏移（编解码器不给节点到源文的对照，切源文字时落在同一块里）。 */
function cursorOffset(): number | null {
    if (editor === null || codec === null || map === null) return null;
    const {doc, selection} = editor.state;
    const whole = codec.write(doc, map);
    if (!whole.ok) return null;
    const index = selection.$from.index(0);
    if (index === 0) return Math.min(selection.$from.parentOffset, whole.text.length);
    const before = codec.write(doc.copy(doc.content.cut(0, selection.$from.before(1))), map);
    if (!before.ok) return null;
    const gap = /^\s*/u.exec(whole.text.slice(before.text.length))![0].length;
    return Math.min(before.text.length + gap + selection.$from.parentOffset, whole.text.length);
}

defineExpose({
    focus: (caret?: "start" | "end"): void => {
        editor?.commands.focus(caret ?? null);
    },
    cursorOffset,
    /** 在光标处插入一段源文（读成节点，有选区时换掉选区）；插入后的整篇过写入前的检查才落。只读或检查不过时返回假。 */
    insert: (source: string): boolean => {
        if (editor === null || codec === null || map === null || props.readonly) return false;
        const read = codec.read(source);
        const only = read.doc.childCount === 1 ? read.doc.firstChild : null;
        const content = only !== null && only.type.name === "paragraph" ? only.content : read.doc.content;
        const tr = editor.state.tr.replaceSelection(new Slice(content, 0, 0));
        if (!checkedWrite(codec, tr.doc, map, props.baseline).ok) return false;
        editor.view.dispatch(tr.scrollIntoView());
        return true;
    },
});
</script>

<script lang="ts">
/** 扩展的 storage 名：每个编辑器把自己的宿主放在这里，节点视图从这里取。 */
const CHIPS_STORAGE = "canonEntryChips";

const chips = Extension.create<Record<string, never>, {host: ChipHost | null}>({
    name: CHIPS_STORAGE,
    addStorage: () => ({host: null}),
    addProseMirrorPlugins: () => [entryValuesPlugin()],
});

/** 节点视图要的宿主：编辑器建好时放进 storage（`content` 为空，读入文档在这之后）。 */
const hostOf = (editor: Editor): ChipHost => {
    const found = (editor.storage as unknown as Record<string, {host: ChipHost | null}>)[CHIPS_STORAGE]?.host;
    if (found === null || found === undefined) throw new Error("entry chips: host is not set before the document is loaded");
    return found;
};

/** 富文本用的条目语法：节点同 `entrySyntax`（schema 相同，编解码器照用），加上小块的节点视图与挂值的插件。 */
const richSyntax = {
    ...entrySyntax,
    extensions: [
        entryTagNode.extend({addNodeView() {
            const editor = this.editor;
            return ({node, view, getPos, decorations, innerDecorations}) => tagView(hostOf(editor))(node, view, getPos as () => number | undefined, decorations as never, innerDecorations);
        }}),
        entryIfNode.extend({addNodeView() {
            const editor = this.editor;
            return ({node, view, getPos, decorations, innerDecorations}) => conditionView(hostOf(editor))(node, view, getPos as () => number | undefined, decorations as never, innerDecorations);
        }}),
        chips,
    ],
};

let shared: ReturnType<typeof createMarkdownLanguage> | null = null;

/** 条目主文字的语言只建一份：语言（词法器与读法表）全应用共用，编解码器按编辑器的 schema 各建。 */
function entryLanguage(): ReturnType<typeof createMarkdownLanguage> {
    shared ??= createMarkdownLanguage([richSyntax, coreSyntax], {frontmatter: false});
    return shared;
}
</script>

<template>
    <div class="entry-rich" data-rich-input :data-readonly="props.readonly ? '' : undefined">
        <div ref="mount" class="entry-rich__mount" />
        <Transition name="entry-rich-note">
            <p v-if="unwritable" class="entry-rich__note" role="alert" data-rich-unwritable>{{ text("textEdit.unwritable") }}</p>
        </Transition>

        <Popover
            :open="editing !== null"
            :anchor="editing?.anchor ?? null"
            :reference="editing?.reference ?? null"
            side="bottom"
            align="start"
            @update:open="onPopoverOpen"
        >
            <form
                v-if="editing !== null"
                class="entry-chip-pop__body"
                :data-chip-popover="editing.draft.kind === 'other' ? (editing.model?.kind ?? 'raw') : editing.draft.kind"
                @submit.prevent="applyChip"
                @keydown.esc="markEscape"
            >
                <p class="entry-chip-pop__title">{{ editingTitle }}</p>

                <template v-if="editing.draft.kind === 'value' || editing.draft.kind === 'ref'">
                    <p class="entry-chip-pop__value" data-chip-value>{{ editing.model?.text }}</p>
                    <p v-if="editing.model?.changed !== undefined" class="entry-chip-pop__meta">{{ editing.model?.changed }}</p>
                </template>

                <template v-else-if="editing.draft.kind === 'calc'">
                    <Input
                        :model-value="attributeOf(editing.draft, 'expr') ?? ''"
                        size="sm"
                        :readonly="props.readonly"
                        :aria-label="text('chipEdit.expr')"
                        :placeholder="text('chipEdit.exprPlaceholder')"
                        data-chip-field="expr"
                        @update:model-value="(value: string) => setAttribute('expr', value)"
                    />
                    <p v-if="editing.model !== null && editing.model.state === 'value'" class="entry-chip-pop__meta">{{ text("chipEdit.result", {value: editing.model.text}) }}</p>
                </template>

                <template v-else-if="editing.draft.kind === 'if'">
                    <div v-for="(branch, index) in editing.draft.branches" :key="index" class="entry-chip-pop__branch" :data-taken="index === editing.taken ? '' : undefined">
                        <div class="entry-chip-pop__branch-head">
                            <span class="entry-chip-pop__branch-name">{{ branchName(branch, index) }}</span>
                            <Input
                                v-if="branch.test !== null"
                                :model-value="branch.test"
                                size="sm"
                                class="entry-chip-pop__grow"
                                :readonly="props.readonly"
                                :aria-label="text('chipEdit.test', {index: index + 1})"
                                :placeholder="text('chipEdit.testPlaceholder')"
                                :data-chip-field="`test-${index}`"
                                @update:model-value="(value: string) => setBranch(index, {test: value})"
                            />
                            <span v-if="index === editing.taken" class="entry-chip-pop__taken">{{ text("chipEdit.taken") }}</span>
                        </div>
                        <Input
                            :model-value="branch.text"
                            size="sm"
                            :readonly="props.readonly"
                            :aria-label="text('chipEdit.branch', {index: index + 1})"
                            :placeholder="text('chipEdit.branchPlaceholder')"
                            :data-chip-field="`branch-${index}`"
                            @update:model-value="(value: string) => setBranch(index, {text: value})"
                        />
                    </div>
                </template>

                <code v-else class="entry-chip-pop__source">{{ editing.draft.source }}</code>

                <Transition name="entry-rich-note">
                    <p v-if="editing.problem !== null" class="entry-chip-pop__problem" role="alert" data-chip-problem>{{ editing.problem }}</p>
                </Transition>

                <div v-if="!props.readonly" class="entry-chip-pop__actions">
                    <Button v-if="editing.draft.kind === 'if'" size="sm" variant="ghost" data-chip-action="add-branch" @click="addBranch">{{ text("chipEdit.addBranch") }}</Button>
                    <Button v-if="(editing.draft.kind === 'value' || editing.draft.kind === 'ref') && (editing.draft.kind === 'value' || props.find !== null)" size="sm" variant="ghost" data-chip-action="replace" @click="replaceChip">{{ text("chipEdit.replace") }}</Button>
                    <Button v-if="editing.node !== null" size="sm" variant="ghost" data-chip-action="remove" @click="removeChip">{{ text("chipEdit.remove") }}</Button>
                    <span class="flex-1" />
                    <Button v-if="editing.draft.kind === 'if' || editing.draft.kind === 'calc'" size="sm" variant="primary" type="submit" :loading="editing.applying" data-chip-action="apply">{{ text("chipEdit.apply") }}</Button>
                </div>
            </form>
        </Popover>

        <SuggestionMenu
            ref="menuRef"
            :groups="menuGroups"
            :active-id="activeId"
            :anchor="menu?.anchor ?? null"
            :label="menu?.what === 'ref' ? text('chipEdit.refMenu') : text('chipEdit.valueMenu')"
            :loading="menu?.what === 'ref' && entries.results.value.kind === 'searching'"
            :loading-text="text('chipEdit.finding')"
            :empty-text="menu?.what === 'ref' ? text('chipEdit.noEntries') : text('chipEdit.noFields')"
            @select="choose"
            @highlight="(id: string) => (activeId = id)"
        >
            <template #header>
                <div class="entry-chip-menu__search" data-chip-menu>
                    <Input
                        v-model="query"
                        size="sm"
                        :aria-label="menu?.what === 'ref' ? text('chipEdit.searchRef') : text('chipEdit.searchValue')"
                        :placeholder="menu?.what === 'ref' ? text('chipEdit.searchRef') : text('chipEdit.searchValue')"
                        @keydown="menuKey"
                    />
                    <p v-if="menuProblem !== null" class="entry-chip-pop__problem" role="alert" data-chip-problem>{{ menuProblem }}</p>
                </div>
            </template>
        </SuggestionMenu>
    </div>
</template>

<style scoped>
.entry-rich__mount :deep(.entry-rich__prose) {
    min-height: 4lh;
    padding: 6px 8px;
    outline: none;
}

/*
 * 小块（`entry-chip-views.ts` 的壳与面）：编辑里是浅底的小块（表示是一个整体、不能打字进去），与阅读视图的值同一种强调色。
 * 小块画成行内块：行内块里的文字不参与外面的光标定位，光标画在它的外缘、落在空隙里（w00055 t01 spike 的做法）。
 */
.entry-rich__mount :deep(.entry-atom) {
    padding-left: 0.12em;
}
.entry-rich__mount :deep(.entry-chip) {
    display: inline-block;
    max-width: 100%;
    line-height: 1.4;
    padding: 0.05em 0.3em;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent-main) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-main) 26%, transparent);
    color: var(--text-main);
    cursor: pointer;
    vertical-align: bottom;
    /* 长值最多两行，超出的截掉（浮层里看全文）。 */
    display: -webkit-inline-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    transition: background var(--motion-fast) var(--ease-layout), box-shadow var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.entry-rich__mount :deep(.entry-chip:hover) {
    background: color-mix(in srgb, var(--accent-main) 18%, transparent);
}
.entry-rich__mount :deep(.entry-chip--calc)::before {
    content: "＝";
    margin-right: 0.2em;
    color: var(--text-secondary);
}
.entry-rich__mount :deep(.entry-chip--ref) {
    color: var(--accent-main);
}
.entry-rich__mount :deep(.entry-chip--raw) {
    background: var(--bg-subtle);
    box-shadow: inset 0 0 0 1px var(--border-default);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.9em;
}
.entry-rich__mount :deep(.entry-chip--unknown),
.entry-rich__mount :deep(.entry-chip--pending),
.entry-rich__mount :deep(.entry-chip--uncomputed) {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border-default);
    color: var(--text-secondary);
}
.entry-rich__mount :deep(.entry-chip--pending) {
    box-shadow: none;
    outline: 1px dashed var(--text-muted);
    outline-offset: -1px;
}
.entry-rich__mount :deep(.entry-chip--incomplete),
.entry-rich__mount :deep(.entry-chip--missing-field),
.entry-rich__mount :deep(.entry-chip--deleted) {
    background: color-mix(in srgb, var(--status-warning) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--status-warning) 45%, transparent);
}
.entry-rich__mount :deep(.ProseMirror-selectednode > .entry-chip),
.entry-rich__mount :deep(.ProseMirror-selectednode > .entry-if) {
    outline: 2px solid var(--accent-main);
    outline-offset: 1px;
}
/* 条件：只画生效的那一支，极淡的底色说明“这句随数据变”（不用虚线，免得与阅读视图的值撞）。 */
.entry-rich__mount :deep(.entry-if) {
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent-main) 5%, transparent);
    cursor: pointer;
}
.entry-rich__mount :deep(.entry-if__placeholder) {
    color: var(--text-muted);
    font-size: 0.9em;
}
.entry-rich__mount :deep(.entry-if--all .entry-if__branch:not(.entry-if__branch--taken)) {
    opacity: 0.5;
    text-decoration: line-through;
}
.entry-rich__mount :deep(.entry-if--all .entry-if__branch + .entry-if__branch)::before {
    content: " / ";
    color: var(--text-muted);
}

/* 小块的浮层（传送到 body；这些元素写在本组件的模板里，作用域样式照样落到它们上）。 */
.entry-chip-pop__body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(296px, calc(100vw - 56px));
}
.entry-chip-pop__body[data-chip-popover="if"],
.entry-chip-pop__body[data-chip-popover="calc"] {
    width: min(416px, calc(100vw - 56px));
}
.entry-chip-pop__title {
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.entry-chip-pop__value {
    max-height: 12lh;
    overflow-y: auto;
    color: var(--text-main);
    overflow-wrap: anywhere;
    /* 浮层的面默认不可选；值的全文要能复制。 */
    user-select: text;
}
.entry-chip-pop__meta,
.entry-chip-pop__taken {
    color: var(--text-muted);
    font-size: var(--text-sm);
}
.entry-chip-pop__taken {
    flex-shrink: 0;
    color: var(--accent-main);
}
.entry-chip-pop__branch {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 8px;
    border-left: 2px solid var(--border-default);
    transition: border-color var(--motion-fast) var(--ease-layout);
}
.entry-chip-pop__branch[data-taken] {
    border-left-color: var(--accent-main);
}
.entry-chip-pop__branch-head {
    display: flex;
    align-items: center;
    gap: 6px;
}
.entry-chip-pop__branch-name {
    flex-shrink: 0;
    min-width: 4em;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.entry-chip-pop__grow {
    flex: 1;
    min-width: 0;
}
.entry-chip-pop__source {
    padding: 4px 6px;
    border-radius: 4px;
    background: var(--bg-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
}
.entry-chip-pop__problem {
    color: var(--status-danger);
    font-size: var(--text-sm);
}
.entry-chip-pop__actions {
    display: flex;
    align-items: center;
    gap: 4px;
}
.entry-chip-menu__search {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
}

.entry-rich__note {
    margin: 4px 8px 0;
    color: var(--status-danger);
    font-size: var(--text-sm);
}

.entry-rich-note-enter-active,
.entry-rich-note-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.entry-rich-note-enter-from,
.entry-rich-note-leave-to {
    opacity: 0;
}
</style>
