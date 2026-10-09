<script setup lang="ts">
/** Markdown 富文本控件（同名 .md）：一个 Tiptap 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档。 */
import {Editor} from "@tiptap/core";
import {EditorState, Selection} from "@tiptap/pm/state";
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {EditorControlHandle, ViewBinding} from "../area";
import type {EditorControlEmits} from "../control";
import {createMarkdownEditorExtensions} from "../markdown/markdown-editor-extensions";
import {normalizeMarkdownDialectBlocks} from "../markdown/markdown-workbench";
import {mergeSource, splitFrontmatter} from "../markdown/source-merge";
import type {SourceSplit} from "../markdown/source-merge";

const props = defineProps<{binding: ViewBinding | null; readonly: boolean; visible: boolean; label: string; placeholder?: string}>();
const emit = defineEmits<EditorControlEmits>();

/** 停止输入这么久才把正文交给文档；保存、切换与离开之前会立即结算。 */
const COMMIT_DELAY_MS = 150;

/**
 * 每“文档 × 组”一份，存在绑定的槽里：编辑状态（含撤销历史与选区）、打开时的原文拆分与序列化结果（保存时三方合并
 * 用）、确认过的修订、“有未裁决输入”标记与滚动位置。
 */
interface MarkdownViewState {
    state: EditorState;
    split: SourceSplit;
    base: string;
    confirmed: number;
    held: boolean;
    scroll: number;
}

const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
let editor: Editor | null = null;
let bound: ViewBinding | null = null;
let detach: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 程序换内容时不当成用户输入。 */
let loading = false;

const stateOf = (binding: ViewBinding): MarkdownViewState | null => binding.slot.state as MarkdownViewState | null;

/**
 * 编辑状态绑定着创建它的编辑器（每个 Tiptap 编辑器有自己的 schema 与插件实例）。组件重挂（例如拆分让 grid 重建了这一
 * 组）后是另一个编辑器：按本编辑器的 schema 重建文档与选区。撤销历史的步骤引用旧 schema，带不过来，随之丢掉。
 */
function rebuilt(state: EditorState, target: Editor): EditorState {
    const doc = target.schema.nodeFromJSON(state.doc.toJSON());
    return EditorState.create({doc, plugins: target.state.plugins, selection: Selection.fromJSON(doc, state.selection.toJSON())});
}

/** 编辑器里的正文交给文档：只把编辑过的行换成编辑器的写法，其余保持原文字节（`source-merge.ts`）。 */
const commitNow = (): void => {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    const binding = bound;
    // 只读时编辑区本来就不接受输入；只读之前敲下的输入仍要交出（例如订阅刚结束、要抢救）。
    if (binding === null || editor === null) return;
    const view = stateOf(binding);
    if (view === null) return;
    const text = view.split.prefix + mergeSource(view.split.body, view.base, editor.getMarkdown());
    if (text === binding.document.text.value && !view.held) return;
    const result = binding.commit(view.confirmed, text);
    if (result.status === "accepted") {
        view.confirmed = result.revision;
        view.held = false;
    } else if (result.status === "conflict") {
        view.held = true;
    }
};

/** 按文档的正文重建编辑状态：新的撤销历史（外部内容不进用户的撤销栈），记下原文拆分与打开时的序列化结果。 */
const load = (binding: ViewBinding): MarkdownViewState | null => {
    if (editor === null) return null;
    const split = splitFrontmatter(binding.document.text.value);
    loading = true;
    try {
        editor.commands.setContent(normalizeMarkdownDialectBlocks(split.body), {contentType: "markdown", emitUpdate: false});
        editor.view.updateState(EditorState.create({doc: editor.state.doc, plugins: editor.state.plugins}));
    } finally {
        loading = false;
    }
    const view: MarkdownViewState = {state: editor.state, split, base: editor.getMarkdown(), confirmed: binding.document.revision.value, held: false, scroll: 0};
    binding.slot.state = view;
    return view;
};

const enter = (binding: ViewBinding): void => {
    if (editor === null) return;
    bound = binding;
    let view = stateOf(binding);
    if (view === null || (!view.held && view.confirmed !== binding.document.revision.value)) {
        view = load(binding);
    } else {
        editor.view.updateState(view.state.schema === editor.schema ? view.state : rebuilt(view.state, editor));
    }
    editor.setEditable(!props.readonly);
    if (scroller.value !== null) scroller.value.scrollTop = view?.scroll ?? 0;
    detach = binding.attach(commitNow);
};

const leave = (binding: ViewBinding): void => {
    if (bound === binding) commitNow();
    const view = stateOf(binding);
    if (view !== null && editor !== null && bound === binding) {
        view.state = editor.state;
        view.scroll = scroller.value?.scrollTop ?? 0;
    }
    detach?.();
    detach = null;
    if (bound === binding) bound = null;
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了，或自己的未裁决输入被裁决了：按文档的正文重建。
watch(() => [props.binding?.document.revision.value, props.binding?.unresolved()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const view = stateOf(binding);
    if (view === null) return;
    if (view.held && binding.unresolved()) return;
    if (!view.held && view.confirmed === binding.document.revision.value) return;
    load(binding);
});

watch(() => props.readonly, (readonly) => editor?.setEditable(!readonly));

const handle: EditorControlHandle = {
    focus: () => editor?.commands.focus(),
    undo: () => editor?.commands.undo(),
    redo: () => editor?.commands.redo(),
    flushPendingChange: commitNow,
};

onMounted(() => {
    if (root.value === null) return;
    editor = new Editor({
        element: root.value,
        extensions: createMarkdownEditorExtensions({placeholder: props.placeholder ?? ""}),
        editable: !props.readonly,
        editorProps: {attributes: {"aria-label": props.label, "class": "markdown-control__prose", "data-editor-prose": ""}},
        onUpdate: ({transaction}) => {
            if (loading || !transaction.docChanged) return;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(commitNow, COMMIT_DELAY_MS);
        },
        onFocus: () => emit("focus", true),
        onBlur: () => {
            commitNow();
            emit("focus", false);
        },
    });
    if (props.binding !== null) enter(props.binding);
    emit("ready", handle);
});

watch(() => props.label, (label) => editor?.setOptions({editorProps: {attributes: {"aria-label": label, "class": "markdown-control__prose", "data-editor-prose": ""}}}));

onBeforeUnmount(() => {
    if (props.binding !== null) leave(props.binding);
    editor?.destroy();
    editor = null;
    emit("ready", null);
});
</script>

<template>
    <div ref="scroller" class="h-full w-full overflow-auto" data-editor-control="markdown">
        <div ref="root" class="markdown-control mx-auto max-w-[760px] px-8 py-6"></div>
    </div>
</template>

<style scoped>
.markdown-control :deep(.markdown-control__prose) {
    min-height: 60vh;
    outline: none;
    color: var(--text-main);
    font-size: 15px;
    line-height: 1.8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.markdown-control :deep(.markdown-control__prose > * + *) {
    margin-top: 0.75em;
}

.markdown-control :deep(h1) {
    font-size: 1.6em;
    font-weight: 600;
    line-height: 1.3;
}

.markdown-control :deep(h2) {
    font-size: 1.35em;
    font-weight: 600;
}

.markdown-control :deep(h3) {
    font-size: 1.15em;
    font-weight: 600;
}

.markdown-control :deep(ul),
.markdown-control :deep(ol) {
    padding-left: 1.5em;
}

.markdown-control :deep(ul) {
    list-style: disc;
}

.markdown-control :deep(ol) {
    list-style: decimal;
}

.markdown-control :deep(blockquote) {
    border-left: 3px solid var(--divider);
    padding-left: 1em;
    color: var(--text-secondary);
}

.markdown-control :deep(code) {
    border-radius: 4px;
    background: var(--bg-hover);
    padding: 0.1em 0.3em;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
}

.markdown-control :deep(pre) {
    border-radius: 6px;
    background: var(--bg-hover);
    padding: 0.75em 1em;
    overflow-x: auto;
}

.markdown-control :deep(table) {
    border-collapse: collapse;
}

.markdown-control :deep(td),
.markdown-control :deep(th) {
    border: 1px solid var(--divider);
    padding: 0.25em 0.5em;
}

.markdown-control :deep(a) {
    color: var(--accent-text);
    text-decoration: underline;
}

.markdown-control :deep(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-muted);
    pointer-events: none;
}
</style>
