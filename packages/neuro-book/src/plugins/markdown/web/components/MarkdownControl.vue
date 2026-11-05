<script setup lang="ts">
/** Markdown 富文本控件（同名 .md）：一个 Tiptap 编辑器实例，按编辑器控件合同（`nbook/plugins/editor/web/control.ts`）绑定文档。 */
import {Editor} from "@tiptap/core";
import {EditorState, Selection, TextSelection} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import "@notnotype/nb-markdown/markdown.css";

import {createMarkdownEditorExtensions, markdownEditingActions, REFRESH_REFERENCE_LINKS} from "@notnotype/nb-markdown/editor";
import type {MarkdownViewHost} from "@notnotype/nb-markdown/editor";
import {markdownViewContext, useMarkdownText} from "@notnotype/nb-markdown/host";
import {codecFor} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, MarkdownLanguage, SourceMap} from "@notnotype/nb-markdown/language";

import {editorMenusKey, editorToolbarSlotKey} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle, EditorEditing, EditorOutline, TextEditorBinding, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlEmits} from "nbook/plugins/editor/web/control";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {NBOOK_IMAGE_MISSING, nbookChips} from "../host";
import {languageFor} from "../language-registry";
import MarkdownMenus from "./menus/MarkdownMenus.vue";
import MarkdownToolbar from "./menus/MarkdownToolbar.vue";
import {markdownAssetsKey} from "../parts/asset-urls";
import {syntaxCatalogKey} from "../syntax-catalog";

// `locale`：控件合同的一员。本控件不按它取文字：引用小块的悬停提示与图片的说明经窗口注入的翻译端口（下面的 `context`），
// 编辑器区传的 `locale` 就是那个端口的语言。
const props = defineProps<{binding: TextEditorBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; placeholder?: string; locale?: DisplayLocale}>();
const emit = defineEmits<EditorControlEmits>();

/** 编辑器区给的菜单；Lab 与组件测试不经插件挂控件时没有，就没有工具栏与菜单。 */
const menus = inject(editorMenusKey, null);
/** 工具栏并入面包屑那一行时传送到这里；传送出去后它不在控件里，这个控件不可见时要自己不画。 */
const toolbarSlot = inject(editorToolbarSlotKey, null);
const toolbarTarget = computed(() => (menus?.toolbarPlacement.value === "merged" ? (toolbarSlot?.value as HTMLElement | null | undefined) ?? null : null));
const catalog = inject(syntaxCatalogKey, null);
if (catalog === null) throw new Error("MarkdownControl 要由 nbook.markdown 交出的组件挂上：缺少方言目录（syntaxCatalogKey）");

/** 停止输入这么久才把正文交给文档；保存、切换与离开之前会立即结算。 */
const COMMIT_DELAY_MS = 150;

/** 光标停下这么久才记到标签上（随会话记录保存，输出 30）；换文档与失焦时立即记。 */
const CURSOR_REMEMBER_MS = 1000;

/**
 * 每“文档 × 组”一份，存在绑定的槽里：编辑状态（含撤销历史与选区）、原文对照（编解码器写回用，随每次被接受的写出累积）、
 * 确认过的修订、`held`（这个视图的输入没有进入正文：未裁决或写不出，别处的修改不重载它）与滚动位置。
 */
interface MarkdownViewState {
    state: EditorState;
    map: SourceMap;
    confirmed: number;
    held: boolean;
    scroll: number;
}

const text = useMarkdownText();

/**
 * 方言外观（引用小块、图片）要的宿主信息：地址按函数取，换文档不重建扩展；`context` 带着注入的翻译端口，节点视图挂的图片
 * 跟着端口换语言。引用小块的悬停提示是算装饰时取的字符串，不跟着端口，换语言时由下面的 `watch` 重算。
 */
const viewHost: MarkdownViewHost = {
    base: () => bound?.address.value ?? null,
    context: markdownViewContext(text),
    assets: inject(markdownAssetsKey, null),
    chips: nbookChips,
    imageMissing: NBOOK_IMAGE_MISSING,
};

const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
let editor: Editor | null = null;
/** 菜单层要的实例：响应式，随挂载与卸载变。这个文件里的逻辑直接用 `editor`。 */
const currentEditor = shallowRef<Editor | null>(null);
const menuLayer = useTemplateRef<InstanceType<typeof MarkdownMenus>>("menuLayer");
/** 这个实例建好时取定的语言（docs/specs/workspace/markdown-syntaxes.md 输出 7）：与 `editor` 同时设上、同时清空。 */
let language: MarkdownLanguage | null = null;
let bound: TextEditorBinding | null = null;
let detach: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let cursorTimer: ReturnType<typeof setTimeout> | null = null;
/** 程序换内容时不当成用户输入。 */
let loading = false;

const stateOf = (binding: TextEditorBinding): MarkdownViewState | null => binding.slot.state as MarkdownViewState | null;

/**
 * 编解码器按编辑器自己的 schema 建（每个编辑器实例一份 schema），缓存在 `codecFor` 里。schema 从编辑状态的文档上取：组关闭时
 * 编辑器区先释放实例，Tiptap 销毁后 `editor.schema` 不再可用，而卸载前的结算还要写出这个视图的输入。
 */
const codec = (current: Editor): MarkdownCodec => {
    if (language === null) throw new Error("MarkdownControl：编辑器实例没有记下语言");
    return codecFor(current.state.doc.type.schema, language);
};

/** 写不出的那一块给人看的样子：第几块（顶层块，从 1 起）与开头几个字（组顶部的提示用）。 */
const EXCERPT_LENGTH = 16;
const blockAt = (doc: EditorState["doc"], from: number, to: number): {index: number; excerpt: string} => {
    let index = 0;
    doc.forEach((_node, offset, at) => {
        if (offset <= from) index = at;
    });
    const text = doc.textBetween(from, Math.min(to, doc.content.size), " ", " ").replace(/\s+/gu, " ").trim();
    return {index: index + 1, excerpt: text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text};
};

/** 程序做的、不算用户输入的改动（重载、写法回填）：不进撤销历史，不让自动链接插件给内容加链接。 */
const quietly = (current: Editor, change: (tr: Transaction) => void): void => {
    const tr = current.state.tr;
    change(tr);
    if (!tr.docChanged) return;
    loading = true;
    try {
        current.view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventAutolink", true));
    } finally {
        loading = false;
    }
};

/** 组的实例槽里存的编辑器实例（焦点在重挂后由编辑器区交还给活动视图，见 `area.ts` 的 `focusActive`）。 */
interface KeptEditor {
    readonly editor: Editor;
    readonly language: MarkdownLanguage;
}

// `nb-markdown`：正文的样子与展示器共用（nb-markdown 的 `display/markdown.css`）。
const attributes = (): Record<string, string> => ({"aria-label": props.label, "class": "markdown-control__prose nb-markdown", "data-editor-prose": ""});

/**
 * 编辑器里的正文交给文档（docs/specs/workspace/markdown-dialect.md 输出 1–3）：没编辑的块写原文，编辑过的块重新写出并读回校验。
 * 写不出时这次输入不交，文档记下这个视图写不出（editor 输出 61）；被接受时把写出的写法回填进编辑器。
 */
const commitNow = (): void => {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    const binding = bound;
    // 只读时编辑区本来就不接受输入；只读之前敲下的输入仍要交出（例如订阅刚结束、要抢救）。
    const current = editor;
    if (binding === null || current === null) return;
    const view = stateOf(binding);
    if (view === null) return;
    const written = codec(current).write(current.state.doc, view.map);
    if (!written.ok) {
        view.held = true;
        binding.block({reason: written.reason, from: written.from, to: written.to, ...blockAt(current.state.doc, written.from, written.to), fallback: written.fallback()});
        return;
    }
    if (written.text === binding.text.value && !view.held) return;
    const result = binding.commit(view.confirmed, written.text);
    if (result.status === "accepted") {
        view.confirmed = result.revision;
        view.held = false;
        quietly(current, (tr) => written.accept(tr));
        view.state = current.state;
    } else if (result.status === "conflict") {
        view.held = true;
    }
};

/** 按文档的正文新建编辑状态：新的撤销历史，原文对照取这次读入的。 */
const load = (binding: TextEditorBinding): MarkdownViewState | null => {
    if (editor === null) return null;
    const read = codec(editor).read(binding.text.value);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    // 标签记着上次的光标：放回去，正文变短时夹到末尾（输出 30）。
    const cursor = binding.cursor;
    if (cursor !== null && "offset" in cursor) {
        const doc = editor.state.doc;
        loading = true;
        try {
            editor.view.dispatch(editor.state.tr.setSelection(Selection.near(doc.resolve(Math.min(cursor.offset, doc.content.size)))));
        } finally {
            loading = false;
        }
    }
    const view: MarkdownViewState = {state: editor.state, map: read.map, confirmed: binding.revision.value, held: false, scroll: 0};
    binding.slot.state = view;
    return view;
};

/**
 * 正文被别处改了（另一组的输入、磁盘的新内容、裁决）：只把不同的那一段换掉，这次替换不进撤销历史（输出 12），本组已有
 * 的撤销步骤映射过这次替换后仍可用。原文对照换成按新正文读入的（`codec.reload`）。
 */
const reload = (binding: TextEditorBinding, view: MarkdownViewState): void => {
    const current = editor;
    if (current === null) return;
    let map = view.map;
    quietly(current, (tr) => {
        map = codec(current).reload(tr, binding.text.value);
    });
    view.map = map;
    view.state = current.state;
    view.confirmed = binding.revision.value;
    view.held = false;
};

const enter = (binding: TextEditorBinding): void => {
    if (editor === null) return;
    bound = binding;
    let view = stateOf(binding);
    // 同一个编辑器实例（存在组的实例槽里）的编辑状态才能直接换回；其余情况按正文新建。
    const fresh = view === null || view.state.schema !== editor.schema;
    if (fresh) {
        view = load(binding);
    } else if (view !== null) {
        editor.view.updateState(view.state);
        if (!view.held && !binding.blocked() && view.confirmed !== binding.revision.value) reload(binding, view);
        // 留着的编辑状态里，引用小块是按当时的地址算的：文件可能改过名。
        editor.view.dispatch(editor.state.tr.setMeta(REFRESH_REFERENCE_LINKS, true).setMeta("addToHistory", false));
    }
    editor.setEditable(!props.readonly);
    if (scroller.value !== null) scroller.value.scrollTop = view?.scroll ?? 0;
    // 按记下的光标新建的视图：滚到光标处。
    if (fresh && binding.cursor !== null) editor.commands.scrollIntoView();
    detach = binding.attach(commitNow);
    refreshOutline(true);
    // 换编辑状态走 `updateState`，不产生事务。
    editingVersion.value += 1;
};

/** 把光标记到当前绑定的标签上。 */
const rememberCursor = (): void => {
    if (cursorTimer !== null) {
        clearTimeout(cursorTimer);
        cursorTimer = null;
    }
    if (bound !== null && editor !== null) bound.remember({offset: editor.state.selection.head});
};

const leave = (binding: TextEditorBinding): void => {
    if (bound === binding) {
        commitNow();
        rememberCursor();
    }
    const view = stateOf(binding);
    if (view !== null && editor !== null && bound === binding) {
        view.state = editor.state;
        view.scroll = scroller.value?.scrollTop ?? 0;
    }
    detach?.();
    detach = null;
    if (bound === binding) bound = null;
    refreshOutline(true);
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了，或自己的未裁决输入被裁决了、写不出被“采用当前正文”解除了：按文档的正文更新。写不出期间不更新（输出 61）。
watch(() => [props.binding?.revision.value, props.binding?.unresolved(), props.binding?.blocked()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const view = stateOf(binding);
    if (view === null) return;
    if (view.held && (binding.unresolved() || binding.blocked())) return;
    if (!view.held && view.confirmed === binding.revision.value) return;
    reload(binding, view);
});

// 变成只读（例如文件被外部删除）之前敲下、还在延迟里的输入照常由计时器交出：文档在已删除时仍接受输入回执。
watch(() => props.readonly, (readonly) => editor?.setEditable(!readonly));

// 换语言：引用小块的悬停提示重算一次。留在槽里的别的文档的编辑状态不用管，换回来时 `enter` 会重算。
watch(() => text.locale.value, () => {
    editor?.view.dispatch(editor.state.tr.setMeta(REFRESH_REFERENCE_LINKS, true).setMeta("addToHistory", false));
});

/**
 * 大纲（面包屑用，docs/specs/workbench/editor.md 输出 60）：跟着当前绑定。正文变了重算、`version` 加一；光标动了只换
 * `current`。标题的位置只在这里记，面包屑拿到的是 id，跳转时按 `binding` 与 `version` 核对，对不上不跳。
 */
const outline = shallowRef<EditorOutline | null>(null);
let outlineVersion = 0;
let headingPositions: ReadonlyMap<string, number> = new Map();
const currentHeading = (): string | null => {
    if (editor === null) return null;
    const at = editor.state.selection.from;
    let current: string | null = null;
    for (const [id, position] of headingPositions) if (position <= at) current = id;
    return current;
};
const refreshOutline = (contentChanged: boolean): void => {
    const binding = bound;
    if (binding === null || editor === null) {
        outline.value = null;
        headingPositions = new Map();
        return;
    }
    const previous = outline.value;
    if (!contentChanged && previous !== null && previous.binding === binding.token) {
        const current = currentHeading();
        if (current !== previous.current) outline.value = {...previous, current};
        return;
    }
    outlineVersion += 1;
    const items: Array<{id: string; level: number; text: string}> = [];
    const positions = new Map<string, number>();
    editor.state.doc.descendants((node, position) => {
        if (node.type.name !== "heading") return true;
        const id = `h${String(items.length)}`;
        items.push({id, level: Number(node.attrs.level), text: node.textContent});
        positions.set(id, position);
        return false;
    });
    headingPositions = positions;
    outline.value = {binding: binding.token, version: outlineVersion, items, current: currentHeading()};
};
const revealHeading = (binding: string, version: number, id: string): "ok" | "stale" => {
    const position = headingPositions.get(id);
    if (editor === null || outline.value?.binding !== binding || outline.value.version !== version || position === undefined) return "stale";
    editor.chain().focus().setTextSelection(position + 1).scrollIntoView().run();
    return "ok";
};

/**
 * 编辑动作（docs/specs/workbench/markdown-editing.md）：`active`、`enabled` 依赖版本号，选区或文档变化、换文档时加一，放进
 * computed 里读会跟着变；没人读就不算（`enabled` 要在事务副本上试跑命令）。
 */
const editingVersion = ref(0);
const editing: EditorEditing = {
    run: (action, args = {}) => {
        const implementation = markdownEditingActions[action];
        return editor !== null && !props.readonly && implementation !== undefined && implementation.enabled(editor, args) && implementation.run(editor, args);
    },
    active: (action) => {
        void editingVersion.value;
        return editor !== null && markdownEditingActions[action]?.active?.(editor) === true;
    },
    enabled: (action) => {
        void editingVersion.value;
        return editor !== null && !props.readonly && markdownEditingActions[action]?.enabled(editor, {}) === true;
    },
    hasSelection: computed(() => {
        void editingVersion.value;
        return editor !== null && !editor.state.selection.empty;
    }),
};

const handle: EditorControlHandle = {
    editing,
    outline,
    revealHeading,
    focus: () => editor?.commands.focus(),
    undo: () => editor?.commands.undo(),
    redo: () => editor?.commands.redo(),
    flushPendingChange: commitNow,
    rememberCursor,
    revealEnd: () => editor?.commands.focus("end"),
    revealRange: (from, to) => {
        if (editor === null) return;
        const doc = editor.state.doc;
        const clamp = (position: number): number => Math.max(0, Math.min(position, doc.content.size));
        // 位置是块的边界（写不出的那几块的起止）：选中其中的全部文字与行内节点。
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(doc.resolve(clamp(from)), doc.resolve(clamp(to)))).scrollIntoView());
        editor.view.focus();
    },
};

/**
 * 停手的结算：输入法还在组字时不交（交出被接受后的写法回填会重画这一块，打断组字），组字结束后的下一次停手再交。失焦、换文档
 * 与保存之前的结算照常立即进行。
 */
const commitWhenSettled = (): void => {
    if (editor?.view.composing === true) {
        timer = setTimeout(commitWhenSettled, COMMIT_DELAY_MS);
        return;
    }
    commitNow();
};

const onUpdate = ({transaction}: {transaction: {docChanged: boolean}}): void => {
    // 程序换的内容（按文档的正文重载）也改大纲。
    if (transaction.docChanged) refreshOutline(true);
    if (loading || !transaction.docChanged) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(commitWhenSettled, COMMIT_DELAY_MS);
};
const onSelection = (): void => {
    refreshOutline(false);
    if (loading) return;
    if (cursorTimer !== null) clearTimeout(cursorTimer);
    cursorTimer = setTimeout(rememberCursor, CURSOR_REMEMBER_MS);
};
const onTransaction = ({transaction}: {transaction: Transaction}): void => {
    if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) editingVersion.value += 1;
};
const onFocus = (): void => emit("focus", true);
const onBlur = (): void => {
    commitNow();
    rememberCursor();
    emit("focus", false);
};

onMounted(() => {
    if (root.value === null) return;
    // 组的实例槽里已有编辑器（组件因布局变化重挂）：挂到新的位置接着用，撤销历史还在。实例的寿命归槽：`unmount` 之后
    // Tiptap 的 `isDestroyed` 也为真，不能用它判断实例还能不能用。
    const kept = props.host.state as KeptEditor | null;
    if (kept !== null) {
        editor = kept.editor;
        language = kept.language;
        editor.mount(root.value);
        editor.setOptions({editorProps: {attributes: attributes()}});
    } else {
        const current = languageFor(catalog);
        const created = new Editor({
            element: root.value,
            extensions: createMarkdownEditorExtensions({language: current, placeholder: props.placeholder ?? "", host: viewHost}),
            editable: !props.readonly,
            editorProps: {attributes: attributes()},
        });
        props.host.state = {editor: created, language: current} satisfies KeptEditor;
        props.host.dispose = () => created.destroy();
        editor = created;
        language = current;
    }
    // 事件处理器属于这一次挂载的组件，卸载时摘掉；实例本身留在槽里。
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onSelection);
    editor.on("transaction", onTransaction);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    currentEditor.value = editor;
    if (props.binding !== null) enter(props.binding);
    editingVersion.value += 1;
    emit("ready", handle);
});

watch(() => props.label, () => editor?.setOptions({editorProps: {attributes: attributes()}}));

onBeforeUnmount(() => {
    if (props.binding !== null) leave(props.binding);
    if (editor !== null) {
        editor.off("update", onUpdate);
        editor.off("selectionUpdate", onSelection);
        editor.off("transaction", onTransaction);
        editor.off("focus", onFocus);
        editor.off("blur", onBlur);
        // 只从 DOM 上拿下：组还在时实例由组的实例槽保留，组关闭时编辑器区释放它。
        editor.unmount();
    }
    editor = null;
    currentEditor.value = null;
    language = null;
    refreshOutline(true);
    emit("ready", null);
});
</script>

<template>
    <div class="markdown-control-root relative flex h-full w-full flex-col">
        <Teleport :to="toolbarTarget" :disabled="toolbarTarget === null">
            <MarkdownToolbar v-if="menus !== null && menus.toolbarVisible.value && (toolbarTarget === null || props.visible)" :editing="editing" :menus="menus" :readonly="props.readonly" @prompt="(action) => menuLayer?.prompt(action)" @refocus="currentEditor?.commands.focus()" />
        </Teleport>
        <div ref="scroller" class="relative min-h-0 w-full flex-1 overflow-auto" data-editor-control="markdown">
            <div ref="root" class="markdown-control"></div>
        </div>
        <MarkdownMenus v-if="menus !== null" ref="menuLayer" :editor="currentEditor" :scroller="scroller" :editing="editing" :menus="menus" :readonly="props.readonly" :binding="props.binding?.token ?? null" />
    </div>
</template>

<style scoped>
/*
 * 纸面（docs/specs/workbench/editor.md 输出 32）：界面字体，版心、留白、字号、行距与段距是这个控件自己的变量，以后做成
 * 偏好（例如宋体与更宽的版心）时只换这几个值。版心含左右留白。
 */
.markdown-control-root {
    --markdown-measure: 720px;
    --markdown-padding-top: 64px;
    --markdown-padding-bottom: 120px;
    --markdown-padding-inline: 48px;
    --markdown-font-size: 17px;
    --markdown-line-height: 1.95;
    --markdown-block-gap: 1.1em;
}

.markdown-control {
    box-sizing: border-box;
    max-width: var(--markdown-measure);
    margin-inline: auto;
    padding: var(--markdown-padding-top) var(--markdown-padding-inline) var(--markdown-padding-bottom);
}

.markdown-control :deep(.markdown-control__prose) {
    min-height: 60vh;
    outline: none;
    color: var(--text-main);
    font-size: var(--markdown-font-size);
    line-height: var(--markdown-line-height);
    letter-spacing: 0.01em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.markdown-control :deep(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-muted);
    pointer-events: none;
}
</style>
