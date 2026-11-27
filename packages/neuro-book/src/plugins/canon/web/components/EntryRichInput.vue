<script setup lang="ts">
/** 条目主文字的富文本输入框（同名 .md）：与源文字输入框同一个合同，读写经章节编辑器的编解码器加条目语法。 */
import {Editor, Extension} from "@tiptap/core";
import {Slice} from "@tiptap/pm/model";
import {EditorState} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {markRaw, onBeforeUnmount, onMounted, ref, useTemplateRef, watch} from "vue";

import {defaultChipEnv} from "@notnotype/nb-markdown/chip";
import {createMarkdownEditorExtensions} from "@notnotype/nb-markdown/editor";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, SourceMap} from "@notnotype/nb-markdown/language";
import "@notnotype/nb-markdown/markdown.css";

import type {EntryTextValue} from "./entry-text";
import {checkedWrite} from "../entry-check";
import type {ChipContext, EntryField} from "../entry-chip";
import {conditionView, entryValuesPlugin, setEntryValues, tagView, valueDecorations} from "../entry-chip-views";
import type {ChipHost} from "../entry-chip-views";
import {entryIfNode, entrySyntax, entryTagNode} from "../entry-syntax";
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
}>(), {language: "canon-entry", readonly: false, baseline: () => new Set<string>(), self: "", fields: () => [], marks: () => ({}), values: null, computing: true, showBranches: false});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []}>();

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

onMounted(() => {
    if (mount.value === null) return;
    const created = new Editor({
        element: mount.value,
        extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => null, assets: null, chips: defaultChipEnv}, commentMarkerLabel: null}),
        // 节点视图在读入文档时建，宿主要先放好：先以空文档建编辑器，放好宿主再换成读入的文档。
        content: "",
        editable: !props.readonly,
        editorProps: {attributes: {"class": "nb-markdown entry-rich__prose", "aria-label": props.label}},
    });
    // 编辑器内部有原生对象（MutationObserver）：不能被 Vue 代理。
    editor = markRaw(created);
    codec = codecFor(created.schema, language);
    (created.storage as unknown as Record<string, {host: ChipHost | null}>)[CHIPS_STORAGE]!.host = host;
    // 读入的文档就是编辑器的文档（同一个 schema）：原文对照登记在这些节点上，没改过的块写回原文。
    const read = codec.read(props.modelValue);
    map = read.map;
    created.view.updateState(EditorState.create({doc: read.doc, plugins: created.state.plugins}));
    created.on("update", ({transaction}) => {
        if (!quiet && transaction.docChanged) writeOut();
    });
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
);

watch(() => [props.fields, props.marks, props.computing, props.showBranches, props.self], hangValues);

watch(
    () => props.readonly,
    (readonly) => editor?.setEditable(!readonly, false),
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
    outline: 1px dashed var(--border-default);
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
