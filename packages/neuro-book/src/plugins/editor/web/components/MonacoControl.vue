<script setup lang="ts">
/** 源码编辑器控件（同名 .md）：一个 Monaco 编辑器实例，按编辑器控件合同（`control.ts`）绑定文档。 */
import {inject, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {editorText} from "../../shared/text";
import type {EditorControlHandle, TextEditorBinding, ViewStateSlot} from "../area";
import {editorLanguagesKey} from "../code/languages";
import {loadMonaco, modelUri} from "../code/load-monaco";
import {codeEditorOptionsKey, DEFAULT_CODE_EDITOR_OPTIONS} from "../code/options";
import type {CodeEditorOptions} from "../code/options";
import type {MonacoApi} from "../code/load-monaco";
import {buildMonacoTheme, MONACO_THEME} from "../code/monaco-theme";
import type {EditorControlEmits} from "../control";
import {mergeSource} from "../code/source-merge";

// `host`：撤销栈在模型里、模型在视图状态槽里，重挂只重建编辑器实例，不需要把实例留在组的实例槽。
// `locale`：控件合同的一员；源码编辑器自己不显示要翻译的文字。
const props = defineProps<{binding: TextEditorBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; locale?: DisplayLocale}>();
const emit = defineEmits<EditorControlEmits>();

/**
 * 每“文档 × 组”一份，存在绑定的槽里：模型（含撤销栈）、视图状态、确认过的修订与“有未裁决输入”标记，以及换入模型时的
 * 原文与模型给出的文本。Monaco 的模型把换行统一成一种、把 BOM 单独存放：交给文档的正文按行三方合并回原文
 * （`source-merge.ts`），没改的行连同自己的换行符原样保留，BOM 也不丢（workspace/files.md 的字节往返）。
 */
interface CodeViewState {
    readonly model: Monaco.editor.ITextModel;
    /** 这个模型上次按哪份缩进设置应用过；设置没变时进入不再推测，切走再切回缩进不变。 */
    indentation: string | null;
    view: Monaco.editor.ICodeEditorViewState | null;
    confirmed: number;
    held: boolean;
    source: string;
    base: string;
}

/** 贡献点登记的语言（编辑器区提供）；Lab 这类没有提供的场合只有 Monaco 自带的纯文本与 JSON。 */
const languages = inject(editorLanguagesKey, null);

/** 编辑器区交来的排版选项（随配置变化）；没有交时（Lab）用缺省值。 */
const codeOptions = inject(codeEditorOptionsKey, null);
const options = (): CodeEditorOptions => codeOptions?.value ?? DEFAULT_CODE_EDITOR_OPTIONS;

/** 排版选项里属于编辑器实例的部分：变化时 `updateOptions`，编辑器不重建。字体留空时取主题的等宽字体。 */
const editorOptionsOf = (value: CodeEditorOptions): Monaco.editor.IEditorOptions => ({
    fontFamily: value.fontFamily.trim() === "" ? getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || undefined : value.fontFamily,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
    lineNumbers: value.lineNumbers,
    minimap: {enabled: value.minimap},
    wordWrap: value.wordWrap ? "on" : "off",
});

/**
 * 缩进是模型的选项，不随编辑器实例：推测打开时按内容推测，推测不出时用 Tab 宽度与空格；关掉时一律用 Tab 宽度与空格
 * （同 VS Code 的 editor.detectIndentation）。
 */
const applyIndentation = (state: CodeViewState): void => {
    const {tabSize, detectIndentation} = options();
    const key = `${String(detectIndentation)}:${String(tabSize)}`;
    if (state.indentation === key) return;
    state.indentation = key;
    if (detectIndentation) state.model.detectIndentation(true, tabSize);
    else state.model.updateOptions({tabSize, indentSize: tabSize, insertSpaces: true});
};

const root = ref<HTMLElement | null>(null);
const failed = ref<string | null>(null);
let monaco: MonacoApi | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let bound: TextEditorBinding | null = null;
let detach: (() => void) | null = null;
/** 程序改模型（换成文档的正文）时不当成用户输入交出去。 */
let applying = false;
let unmounted = false;
let themeObserver: MutationObserver | null = null;
let cursorTimer: ReturnType<typeof setTimeout> | null = null;

/** 光标停下这么久才记到标签上（随会话记录保存，输出 30）；换文档与失焦时立即记。 */
const CURSOR_REMEMBER_MS = 1000;

const stateOf = (binding: TextEditorBinding): CodeViewState | null => binding.slot.state as CodeViewState | null;

/** 标签记着的语言，已登记时才用；不在了回退到识别，不改写记录（输出 44）。 */
const wantedLanguage = (binding: TextEditorBinding): string | null => {
    const wanted = binding.language.value;
    return wanted !== null && languages?.has(wanted) === true ? wanted : null;
};

/** 模型的文本带上 BOM（`getValue` 默认去掉它）。 */
const valueOf = (model: Monaco.editor.ITextModel): string => model.getValue(undefined, true);

/** 模型的当前内容对应的正文：没改的行取原文的字节。 */
const textOf = (state: CodeViewState): string => mergeSource(state.source, state.base, valueOf(state.model));

const commit = (binding: TextEditorBinding, state: CodeViewState): void => {
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
const adopt = (binding: TextEditorBinding, state: CodeViewState): void => {
    if (textOf(state) !== binding.text.value) {
        applying = true;
        try {
            state.model.setValue(binding.text.value);
        } finally {
            applying = false;
        }
    }
    state.source = binding.text.value;
    state.base = valueOf(state.model);
    state.confirmed = binding.revision.value;
    state.held = false;
};

const enter = (binding: TextEditorBinding): void => {
    if (monaco === null || editor === null) return;
    let state = stateOf(binding);
    const fresh = state === null;
    // 后来才交付声明的语言也在建模型之前登记进去。
    languages?.install(monaco);
    const wanted = wantedLanguage(binding);
    if (state === null) {
        const model = monaco.editor.createModel(binding.text.value, wanted ?? undefined, modelUri(monaco, binding.address.value));
        state = {model, indentation: null, view: null, confirmed: binding.revision.value, held: false, source: binding.text.value, base: valueOf(model)};
        binding.slot.state = state;
        binding.slot.dispose = () => model.dispose();
    } else {
        if (!state.held && state.confirmed !== binding.revision.value) adopt(binding, state);
        if (wanted !== null && state.model.getLanguageId() !== wanted) monaco.editor.setModelLanguage(state.model, wanted);
    }
    applyIndentation(state);
    editor.setModel(state.model);
    if (state.view !== null) editor.restoreViewState(state.view);
    // 第一次为这份文档建模型、标签记着上次的光标：放回去并滚到它（输出 30）。Monaco 按模型校正位置，正文变短时自己夹到
    // 末尾，滚动用校正后的位置。
    const cursor = binding.cursor;
    if (fresh && cursor !== null && "line" in cursor) {
        editor.setPosition({lineNumber: cursor.line, column: cursor.column});
        const placed = editor.getPosition();
        if (placed !== null) editor.revealPositionInCenter(placed);
    }
    readPosition();
    language.value = state.model.getLanguageId();
    editor.updateOptions({readOnly: props.readonly});
    bound = binding;
    // 每次输入立即交出，没有缓冲；结算只需补交与文档不同的内容（例如回执冲突后）。
    detach = binding.attach(() => {
        const current = stateOf(binding);
        if (current !== null && !current.held && textOf(current) !== binding.text.value) commit(binding, current);
    });
};

/** 把光标记到当前绑定的标签上。 */
const rememberCursor = (): void => {
    if (cursorTimer !== null) {
        clearTimeout(cursorTimer);
        cursorTimer = null;
    }
    const at = editor?.getModel() === null ? null : editor?.getPosition() ?? null;
    if (bound !== null && at !== null) bound.remember({line: at.lineNumber, column: at.column});
};

const leave = (binding: TextEditorBinding): void => {
    const state = stateOf(binding);
    if (bound === binding) rememberCursor();
    if (state !== null && editor !== null && editor.getModel() === state.model) state.view = editor.saveViewState();
    detach?.();
    detach = null;
    if (bound === binding) bound = null;
    editor?.setModel(null);
    position.value = null;
    language.value = null;
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了，或自己的未裁决输入被裁决了：按文档的正文重设。
watch(() => [props.binding?.revision.value, props.binding?.unresolved()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const state = stateOf(binding);
    if (state === null) return;
    if (state.held && binding.unresolved()) return;
    if (!state.held && state.confirmed === binding.revision.value) return;
    adopt(binding, state);
});

// 换语言（输出 45）：标签记下的语言变了，换这个模型的语言；绑定不变。
watch(() => (props.binding === null ? null : wantedLanguage(props.binding)), (wanted) => {
    const binding = props.binding;
    const state = binding === null ? null : stateOf(binding);
    if (monaco === null || binding !== bound || state === null || wanted === null || state.model.getLanguageId() === wanted) return;
    monaco.editor.setModelLanguage(state.model, wanted);
    language.value = state.model.getLanguageId();
});

watch(() => props.readonly, (readonly) => editor?.updateOptions({readOnly: readonly}));
// 排版设置变了：编辑器实例的选项就地更新；缩进用到当前模型，停放的模型在下次进入时补上（`applyIndentation`）。
watch(options, (value) => {
    editor?.updateOptions(editorOptionsOf(value));
    const state = bound === null ? null : stateOf(bound);
    if (state !== null) applyIndentation(state);
});
watch(() => props.visible, (visible) => {
    if (visible) editor?.layout();
});

const applyTheme = (): void => {
    if (monaco === null) return;
    monaco.editor.defineTheme(MONACO_THEME, buildMonacoTheme(document.documentElement));
    monaco.editor.setTheme(MONACO_THEME);
};

/** 选区活动端的位置（输出 28）：换文档、卸载时为 null。 */
const position = shallowRef<{readonly line: number; readonly column: number} | null>(null);
const readPosition = (): void => {
    const selection = editor?.getModel() === null ? null : editor?.getSelection() ?? null;
    position.value = selection === null ? null : {line: selection.positionLineNumber, column: selection.positionColumn};
};

/** 视图此刻的语言（输出 45 的状态栏条目显示它）；换文档、卸载时为 null。 */
const language = shallowRef<string | null>(null);

const handle: EditorControlHandle = {
    position,
    language,
    focus: () => editor?.focus(),
    undo: () => editor?.trigger("nbook", "undo", null),
    redo: () => editor?.trigger("nbook", "redo", null),
    flushPendingChange: () => undefined,
    rememberCursor,
    navigation: {
        getLineCount: () => editor?.getModel()?.getLineCount() ?? null,
        revealLine: (line) => {
            const model = editor?.getModel();
            if (editor === null || model === null || model === undefined) return {ok: false, reason: editorText("refusal.notReady")};
            if (line < 1 || line > model.getLineCount()) return {ok: false, reason: editorText("refusal.lineOutOfRange", {line})};
            editor.setPosition({lineNumber: line, column: 1});
            editor.revealLineInCenter(line);
            editor.focus();
            return {ok: true, value: {line}};
        },
    },
    revealEnd: () => {
        const model = editor?.getModel();
        if (editor === null || model === null || model === undefined) return;
        const line = model.getLineCount();
        editor.setPosition({lineNumber: line, column: model.getLineMaxColumn(line)});
        editor.revealLineInCenter(line);
        editor.focus();
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
    languages?.install(monaco);
    editor = monaco.editor.create(root.value, {
        model: null,
        automaticLayout: true,
        ...editorOptionsOf(options()),
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
    editor.onDidChangeCursorSelection(() => {
        readPosition();
        if (bound === null) return;
        if (cursorTimer !== null) clearTimeout(cursorTimer);
        cursorTimer = setTimeout(rememberCursor, CURSOR_REMEMBER_MS);
    });
    editor.onDidFocusEditorText(() => emit("focus", true));
    editor.onDidBlurEditorText(() => {
        rememberCursor();
        emit("focus", false);
    });
    // 主题或明暗变了（文档根上的 token 换了）：重新生成 Monaco 的主题。
    themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["style", "class", "data-nb-appearance", "data-nb-theme"]});
    if (props.binding !== null) enter(props.binding);
    emit("ready", handle);
});

watch(() => props.label, (label) => editor?.updateOptions({ariaLabel: label}));

onBeforeUnmount(() => {
    unmounted = true;
    if (props.binding !== null) leave(props.binding);
    themeObserver?.disconnect();
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
