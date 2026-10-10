<script setup lang="ts">
/** Markdown 富文本控件（同名 .md）：一个 Tiptap 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档。 */
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {EditorControlHandle, ViewBinding, ViewStateSlot} from "../area";
import type {EditorControlEmits} from "../control";
import {createMarkdownEditorExtensions} from "../markdown/markdown-editor-extensions";
import {normalizeMarkdownDialectBlocks} from "../markdown/markdown-workbench";
import {mergeSource, splitFrontmatter} from "../markdown/source-merge";
import type {SourceSplit} from "../markdown/source-merge";

const props = defineProps<{binding: ViewBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; placeholder?: string}>();
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

/** 组的实例槽里存的编辑器实例（焦点在重挂后由编辑器区交还给活动视图，见 `area.ts` 的 `focusActive`）。 */
interface KeptEditor {
    readonly editor: Editor;
}

const attributes = (): Record<string, string> => ({"aria-label": props.label, "class": "markdown-control__prose", "data-editor-prose": ""});

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

/** 按文档的正文新建编辑状态：新的撤销历史，记下原文拆分与打开时的序列化结果。 */
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

/**
 * 正文被别处改了（另一组的输入、磁盘的新内容、裁决）：只把不同的那一段换掉，这次替换不进撤销历史（输出 12），本组已有
 * 的撤销步骤映射过这次替换后仍可用。原文拆分与序列化结果按新正文重记，之后的保存以它为准。
 */
const reload = (binding: ViewBinding, view: MarkdownViewState): void => {
    if (editor === null || editor.markdown === undefined) return;
    const split = splitFrontmatter(binding.document.text.value);
    const next = editor.schema.nodeFromJSON(editor.markdown.parse(normalizeMarkdownDialectBlocks(split.body)));
    const current = editor.state.doc;
    const start = current.content.findDiffStart(next.content);
    const end = current.content.findDiffEnd(next.content);
    if (start !== null && end !== null) {
        let {a: endA, b: endB} = end;
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
            endA += overlap;
            endB += overlap;
        }
        loading = true;
        try {
            editor.view.dispatch(editor.state.tr.replace(start, endA, next.slice(start, endB)).setMeta("addToHistory", false));
        } finally {
            loading = false;
        }
    }
    view.state = editor.state;
    view.split = split;
    view.base = editor.getMarkdown();
    view.confirmed = binding.document.revision.value;
    view.held = false;
};

const enter = (binding: ViewBinding): void => {
    if (editor === null) return;
    bound = binding;
    let view = stateOf(binding);
    // 同一个编辑器实例（存在组的实例槽里）的编辑状态才能直接换回；其余情况按正文新建。
    if (view === null || view.state.schema !== editor.schema) {
        view = load(binding);
    } else {
        editor.view.updateState(view.state);
        if (!view.held && view.confirmed !== binding.document.revision.value) reload(binding, view);
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

// 正文被别处改了，或自己的未裁决输入被裁决了：按文档的正文更新。
watch(() => [props.binding?.document.revision.value, props.binding?.unresolved()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const view = stateOf(binding);
    if (view === null) return;
    if (view.held && binding.unresolved()) return;
    if (!view.held && view.confirmed === binding.document.revision.value) return;
    reload(binding, view);
});

// 变成只读（例如文件被外部删除）之前敲下、还在延迟里的输入照常由计时器交出：文档在已删除时仍接受输入回执。
watch(() => props.readonly, (readonly) => editor?.setEditable(!readonly));

const handle: EditorControlHandle = {
    focus: () => editor?.commands.focus(),
    undo: () => editor?.commands.undo(),
    redo: () => editor?.commands.redo(),
    flushPendingChange: commitNow,
    revealEnd: () => editor?.commands.focus("end"),
};

const onUpdate = ({transaction}: {transaction: {docChanged: boolean}}): void => {
    if (loading || !transaction.docChanged) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(commitNow, COMMIT_DELAY_MS);
};
const onFocus = (): void => emit("focus", true);
const onBlur = (): void => {
    commitNow();
    emit("focus", false);
};

onMounted(() => {
    if (root.value === null) return;
    // 组的实例槽里已有编辑器（组件因布局变化重挂）：挂到新的位置接着用，撤销历史还在。实例的寿命归槽：`unmount` 之后
    // Tiptap 的 `isDestroyed` 也为真，不能用它判断实例还能不能用。
    const kept = props.host.state as KeptEditor | null;
    if (kept !== null) {
        editor = kept.editor;
        editor.mount(root.value);
        editor.setOptions({editorProps: {attributes: attributes()}});
    } else {
        const created = new Editor({
            element: root.value,
            extensions: createMarkdownEditorExtensions({placeholder: props.placeholder ?? ""}),
            editable: !props.readonly,
            editorProps: {attributes: attributes()},
        });
        props.host.state = {editor: created} satisfies KeptEditor;
        props.host.dispose = () => created.destroy();
        editor = created;
    }
    // 事件处理器属于这一次挂载的组件，卸载时摘掉；实例本身留在槽里。
    editor.on("update", onUpdate);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    if (props.binding !== null) enter(props.binding);
    emit("ready", handle);
});

watch(() => props.label, () => editor?.setOptions({editorProps: {attributes: attributes()}}));

onBeforeUnmount(() => {
    if (props.binding !== null) leave(props.binding);
    if (editor !== null) {
        editor.off("update", onUpdate);
        editor.off("focus", onFocus);
        editor.off("blur", onBlur);
        // 只从 DOM 上拿下：组还在时实例由组的实例槽保留，组关闭时编辑器区释放它。
        editor.unmount();
    }
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
