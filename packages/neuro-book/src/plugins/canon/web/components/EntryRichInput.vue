<script setup lang="ts">
/** 条目主文字的富文本输入框（同名 .md）：与源文字输入框同一个合同，读写经章节编辑器的编解码器加条目语法。 */
import {Editor} from "@tiptap/core";
import {Slice} from "@tiptap/pm/model";
import {EditorState} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {markRaw, onBeforeUnmount, onMounted, ref, useTemplateRef, watch} from "vue";

import {defaultChipEnv} from "@notnotype/nb-markdown/chip";
import {createMarkdownEditorExtensions} from "@notnotype/nb-markdown/editor";
import {codecFor, coreSyntax, createMarkdownLanguage} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, SourceMap} from "@notnotype/nb-markdown/language";
import "@notnotype/nb-markdown/markdown.css";

import {checkedWrite} from "../entry-check";
import {entrySyntax} from "../entry-syntax";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{modelValue: string; label: string; language?: string; readonly?: boolean; baseline?: ReadonlySet<string>}>(), {language: "canon-entry", readonly: false, baseline: () => new Set<string>()});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []}>();

const text = useCanonText();

/** 条目主文字的语言：核心语法加条目语法，不读 frontmatter（主文字开头的 `---` 是正文，rendering 输出 21）。全应用共用一份。 */
const language = entryLanguage();

const mount = useTemplateRef<HTMLElement>("mount");
/** 写不出（不应发生）：输入框下面写一句，暂存留着最后一次交出的文字。 */
const unwritable = ref(false);

let editor: Editor | null = null;
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
        editable: !props.readonly,
        editorProps: {attributes: {"class": "nb-markdown entry-rich__prose", "aria-label": props.label}},
    });
    // 编辑器内部有原生对象（MutationObserver）：不能被 Vue 代理。
    editor = markRaw(created);
    codec = codecFor(created.schema, language);
    // 读入的文档就是编辑器的文档（同一个 schema）：原文对照登记在这些节点上，没改过的块写回原文。
    const read = codec.read(props.modelValue);
    map = read.map;
    created.view.updateState(EditorState.create({doc: read.doc, plugins: created.state.plugins}));
    created.on("update", ({transaction}) => {
        if (!quiet && transaction.docChanged) writeOut();
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
let shared: ReturnType<typeof createMarkdownLanguage> | null = null;

/** 条目主文字的语言只建一份：语言（词法器与读法表）全应用共用，编解码器按编辑器的 schema 各建。 */
function entryLanguage(): ReturnType<typeof createMarkdownLanguage> {
    shared ??= createMarkdownLanguage([entrySyntax, coreSyntax], {frontmatter: false});
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
