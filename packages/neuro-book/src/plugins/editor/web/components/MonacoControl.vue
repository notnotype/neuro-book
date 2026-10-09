<script setup lang="ts">
/** 源码编辑器控件（同名 .md）：一个 Monaco 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档。 */
import {onBeforeUnmount, onMounted, ref, watch} from "vue";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type {EditorControlHandle, ViewBinding, ViewStateSlot} from "../area";
import {languageOf, loadMonaco} from "../code/load-monaco";
import type {MonacoApi} from "../code/load-monaco";
import {buildMonacoTheme, MONACO_THEME} from "../code/monaco-theme";
import type {EditorControlEmits} from "../control";
import {mergeSource} from "../markdown/source-merge";

// `host`：撤销栈在模型里、模型在视图状态槽里，重挂只重建编辑器实例；槽里只记卸载时焦点是否在编辑器里，重挂后还给它。
const props = defineProps<{binding: ViewBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string}>();
const emit = defineEmits<EditorControlEmits>();

/**
 * 每“文档 × 组”一份，存在绑定的槽里：模型（含撤销栈）、视图状态、确认过的修订与“有未裁决输入”标记，以及换入模型时的
 * 原文与模型给出的文本。Monaco 的模型把换行统一成一种、把 BOM 单独存放：交给文档的正文按行三方合并回原文
 * （`source-merge.ts`），没改的行连同自己的换行符原样保留，BOM 也不丢（workspace/files.md 的字节往返）。
 */
interface CodeViewState {
    readonly model: Monaco.editor.ITextModel;
    view: Monaco.editor.ICodeEditorViewState | null;
    confirmed: number;
    held: boolean;
    source: string;
    base: string;
}

const root = ref<HTMLElement | null>(null);
const failed = ref<string | null>(null);
let monaco: MonacoApi | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let bound: ViewBinding | null = null;
let detach: (() => void) | null = null;
/** 程序改模型（换成文档的正文）时不当成用户输入交出去。 */
let applying = false;
let unmounted = false;
let themeObserver: MutationObserver | null = null;

const stateOf = (binding: ViewBinding): CodeViewState | null => binding.slot.state as CodeViewState | null;

/** 模型的文本带上 BOM（`getValue` 默认去掉它）。 */
const valueOf = (model: Monaco.editor.ITextModel): string => model.getValue(undefined, true);

/** 模型的当前内容对应的正文：没改的行取原文的字节。 */
const textOf = (state: CodeViewState): string => mergeSource(state.source, state.base, valueOf(state.model));

const commit = (binding: ViewBinding, state: CodeViewState): void => {
    if (props.readonly) return;
    const result = binding.commit(state.confirmed, textOf(state));
    if (result.status === "accepted") {
        state.confirmed = result.revision;
        state.held = false;
    } else if (result.status === "conflict") {
        state.held = true;
    }
};

/** 换成文档的正文：`setValue` 清掉这个模型的撤销栈，外部内容不进用户的撤销历史（输出 12）。 */
const adopt = (binding: ViewBinding, state: CodeViewState): void => {
    if (textOf(state) !== binding.document.text.value) {
        applying = true;
        try {
            state.model.setValue(binding.document.text.value);
        } finally {
            applying = false;
        }
    }
    state.source = binding.document.text.value;
    state.base = valueOf(state.model);
    state.confirmed = binding.document.revision.value;
    state.held = false;
};

const enter = (binding: ViewBinding): void => {
    if (monaco === null || editor === null) return;
    let state = stateOf(binding);
    if (state === null) {
        const model = monaco.editor.createModel(binding.document.text.value, languageOf(binding.document.target.value.path));
        state = {model, view: null, confirmed: binding.document.revision.value, held: false, source: binding.document.text.value, base: valueOf(model)};
        binding.slot.state = state;
        binding.slot.dispose = () => model.dispose();
    } else if (!state.held && state.confirmed !== binding.document.revision.value) {
        adopt(binding, state);
    }
    editor.setModel(state.model);
    if (state.view !== null) editor.restoreViewState(state.view);
    editor.updateOptions({readOnly: props.readonly});
    bound = binding;
    // 每次输入立即交出，没有缓冲；结算只需补交与文档不同的内容（例如回执冲突后）。
    detach = binding.attach(() => {
        const current = stateOf(binding);
        if (current !== null && !current.held && textOf(current) !== binding.document.text.value) commit(binding, current);
    });
};

const leave = (binding: ViewBinding): void => {
    const state = stateOf(binding);
    if (state !== null && editor !== null && editor.getModel() === state.model) state.view = editor.saveViewState();
    detach?.();
    detach = null;
    if (bound === binding) bound = null;
    editor?.setModel(null);
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了，或自己的未裁决输入被裁决了：按文档的正文重设。
watch(() => [props.binding?.document.revision.value, props.binding?.unresolved()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const state = stateOf(binding);
    if (state === null) return;
    if (state.held && binding.unresolved()) return;
    if (!state.held && state.confirmed === binding.document.revision.value) return;
    adopt(binding, state);
});

watch(() => props.readonly, (readonly) => editor?.updateOptions({readOnly: readonly}));
watch(() => props.visible, (visible) => {
    if (visible) editor?.layout();
});

const applyTheme = (): void => {
    if (monaco === null) return;
    monaco.editor.defineTheme(MONACO_THEME, buildMonacoTheme(document.documentElement));
    monaco.editor.setTheme(MONACO_THEME);
};

const handle: EditorControlHandle = {
    focus: () => editor?.focus(),
    undo: () => editor?.trigger("nbook", "undo", null),
    redo: () => editor?.trigger("nbook", "redo", null),
    flushPendingChange: () => undefined,
    navigation: {
        getLineCount: () => editor?.getModel()?.getLineCount() ?? null,
        revealLine: (line) => {
            const model = editor?.getModel();
            if (editor === null || model === null || model === undefined) return {ok: false, reason: "编辑器尚未就绪"};
            if (line < 1 || line > model.getLineCount()) return {ok: false, reason: `行号超出范围：${String(line)}`};
            editor.setPosition({lineNumber: line, column: 1});
            editor.revealLineInCenter(line);
            editor.focus();
            return {ok: true, value: {line}};
        },
    },
};

onMounted(async () => {
    try {
        monaco = await loadMonaco();
    } catch (error) {
        failed.value = error instanceof Error ? error.message : String(error);
        return;
    }
    if (unmounted || root.value === null) return;
    applyTheme();
    editor = monaco.editor.create(root.value, {
        model: null,
        automaticLayout: true,
        minimap: {enabled: false},
        wordWrap: "on",
        fontSize: 14,
        scrollBeyondLastLine: false,
        theme: MONACO_THEME,
        ariaLabel: props.label,
    });
    editor.onDidChangeModelContent(() => {
        const binding = bound;
        if (applying || binding === null) return;
        const state = stateOf(binding);
        if (state !== null) commit(binding, state);
    });
    editor.onDidFocusEditorText(() => emit("focus", true));
    editor.onDidBlurEditorText(() => emit("focus", false));
    // 主题或明暗变了（文档根上的 token 换了）：重新生成 Monaco 的主题。
    themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["style", "class", "data-nb-appearance", "data-nb-theme"]});
    if (props.binding !== null) enter(props.binding);
    emit("ready", handle);
    const kept = props.host.state as {refocus: boolean} | null;
    if (kept?.refocus === true) {
        kept.refocus = false;
        editor.focus();
    }
});

watch(() => props.label, (label) => editor?.updateOptions({ariaLabel: label}));

onBeforeUnmount(() => {
    unmounted = true;
    if (props.binding !== null) leave(props.binding);
    themeObserver?.disconnect();
    props.host.state = {refocus: editor?.hasTextFocus() === true};
    // 模型归视图状态槽，由编辑器区在标签关闭或淘汰时释放；这里只释放编辑器实例。
    editor?.dispose();
    editor = null;
    emit("ready", null);
});
</script>

<template>
    <div class="relative h-full w-full" data-editor-control="code">
        <div ref="root" class="h-full w-full" data-editor-monaco></div>
        <p v-if="failed !== null" class="absolute inset-0 p-6 text-sm text-[var(--status-danger)]" role="alert">{{ failed }}</p>
    </div>
</template>
