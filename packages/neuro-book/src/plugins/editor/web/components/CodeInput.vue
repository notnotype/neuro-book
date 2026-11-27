<script setup lang="ts">
/** 可嵌入的代码输入框（同名 .md）：一段由使用方给的源文字，高度随内容；进入视野或拿到焦点时才建 Monaco。 */
import {computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {Textarea} from "@notnotype/nb-ui/components";

import {editorLanguagesKey} from "../code/languages";
import {loadMonaco, modelUri} from "../code/load-monaco";
import type {MonacoApi} from "../code/load-monaco";
import {MONACO_THEME} from "../code/monaco-theme";
import {codeEditorOptionsKey, DEFAULT_CODE_EDITOR_OPTIONS} from "../code/options";
import type {CodeEditorOptions} from "../code/options";
import {followMonacoTheme} from "../code/theme-follow";

const props = withDefaults(defineProps<{modelValue: string; label: string; language?: string; readonly?: boolean}>(), {language: "plaintext", readonly: false});
const emit = defineEmits<{"update:modelValue": [text: string]; "focus": []; "blur": []}>();

const languages = inject(editorLanguagesKey, null);
const codeOptions = inject(codeEditorOptionsKey, null);
const options = computed((): CodeEditorOptions => codeOptions?.value ?? DEFAULT_CODE_EDITOR_OPTIONS);

/** 与源码编辑器同一份字体、字号与行高；行号、缩略图不要，长行一律折行（高度随内容，没有横向滚动的余地）。 */
const fontOptions = (value: CodeEditorOptions): Monaco.editor.IEditorOptions => ({
    fontFamily: value.fontFamily.trim() === "" ? getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || undefined : value.fontFamily,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
});

/**
 * 原文阶段的行高照 Monaco 的算法取，换成编辑器时这一块的高度不跳：0 是按字号自动（macOS 1.5 倍，别处 1.35 倍），小于 8 当
 * 倍数，其余是像素。
 */
const plainLineHeight = computed((): number => {
    const {fontSize, lineHeight} = options.value;
    if (lineHeight === 0) return Math.round((/Mac/u.test(navigator.platform) ? 1.5 : 1.35) * fontSize);
    return lineHeight < 8 ? lineHeight * fontSize : lineHeight;
});

const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
/** Monaco 加载失败以后的退路：普通文本框，照样能改。 */
const fallback = ref<{readonly $el: HTMLTextAreaElement} | null>(null);
const stage = ref<"plain" | "ready" | "failed">("plain");
const failure = ref<string | null>(null);
const height = ref(0);

let monaco: MonacoApi | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
let model: Monaco.editor.ITextModel | null = null;
let unfollowTheme: (() => void) | null = null;
let viewport: IntersectionObserver | null = null;
let started = false;
let unmounted = false;
/** 程序换文字（使用方给了新的 `modelValue`）时不当成用户输入交出去。 */
let applying = false;
/** 建好以后把焦点放进去、光标放在文首还是文末：因为聚焦才建的、或建的途中调用了 `focus()`。null 是不给焦点。 */
let focusWhenReady: "start" | "end" | number | null = null;

const languageId = (): string => (languages?.has(props.language) === true || props.language === "json" ? props.language : "plaintext");

/** 高度跟着内容：折行以后的内容高度由 Monaco 算，宽度变了它会再报一次。 */
const fitHeight = (): void => {
    if (editor === null || host.value === null) return;
    height.value = editor.getContentHeight();
    editor.layout({width: host.value.clientWidth, height: height.value});
};

const activate = async (): Promise<void> => {
    if (started) return;
    started = true;
    viewport?.disconnect();
    viewport = null;
    try {
        monaco = await loadMonaco();
    } catch (error) {
        failure.value = error instanceof Error ? error.message : String(error);
        stage.value = "failed";
        // 是因为要焦点才建的：退回的文本框这时才挂上，等它挂好把焦点给它。
        if (focusWhenReady !== null) {
            await nextTick();
            if (!unmounted) focusFallback(focusWhenReady);
        }
        return;
    }
    if (unmounted || host.value === null) return;
    unfollowTheme = followMonacoTheme(monaco);
    languages?.install(monaco);
    model = monaco.editor.createModel(props.modelValue, languageId(), modelUri(monaco, "input"));
    model.updateOptions({bracketColorizationOptions: {enabled: false, independentColorPoolPerBracketType: false}});
    editor = monaco.editor.create(host.value, {
        model,
        theme: MONACO_THEME,
        ariaLabel: props.label,
        readOnly: props.readonly,
        ...fontOptions(options.value),
        automaticLayout: true,
        wordWrap: "on",
        lineNumbers: "off",
        minimap: {enabled: false},
        folding: false,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        renderLineHighlight: "none",
        guides: {indentation: false},
        padding: {top: 6, bottom: 6},
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        // 一页里有很多个输入框：Tab 用来在它们与旁边的按钮之间走，不留在框里缩进（缩进用 Monaco 的缩进命令）。
        tabFocusMode: true,
        // 打字时不自己弹补全：这里写的多半是正文，弹出来的是文档里别处的词，回车还会被它接走（换成那个词，不换行）。
        // 编辑器区不承诺补全（docs/specs/workbench/editor.md 的“不承诺”）；要的人按 Ctrl+Space。
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        wordBasedSuggestions: "off",
        // 高度随内容，没有可滚的东西：滚轮交给外面的页面。
        scrollbar: {vertical: "hidden", horizontal: "hidden", handleMouseWheel: false, alwaysConsumeMouseWheel: false},
        contextmenu: false,
    });
    editor.onDidChangeModelContent(() => {
        if (!applying && model !== null) emit("update:modelValue", model.getValue());
    });
    editor.onDidContentSizeChange(fitHeight);
    editor.onDidFocusEditorText(() => emit("focus"));
    editor.onDidBlurEditorText(() => emit("blur"));
    stage.value = "ready";
    // 宿主元素这时才显示出来（`v-show`）：等它有了宽度再量高度。
    await nextTick();
    if (unmounted || editor === null) return;
    fitHeight();
    if (focusWhenReady !== null) {
        placeCaret(focusWhenReady);
        editor.focus();
    }
};

/** `caret` 是文首、文末或整篇里的偏移（超出的按文末）。 */
const placeCaret = (caret: "start" | "end" | number): void => {
    if (editor === null || model === null) return;
    if (typeof caret === "number") {
        editor.setPosition(model.getPositionAt(caret));
        return;
    }
    const line = caret === "start" ? 1 : model.getLineCount();
    editor.setPosition({lineNumber: line, column: caret === "start" ? 1 : model.getLineMaxColumn(line)});
};
const focusFallback = (caret: "start" | "end" | number | undefined): void => {
    const area = fallback.value?.$el;
    if (area === undefined) return;
    area.focus();
    if (caret === undefined) return;
    const at = caret === "start" ? 0 : caret === "end" ? area.value.length : Math.min(Math.max(caret, 0), area.value.length);
    area.setSelectionRange(at, at);
};

/** `caret` 不给时：已经建好的保持原来的光标，因为这一次聚焦才建的放在文末。 */
const focus = (caret?: "start" | "end" | number): void => {
    if (editor !== null) {
        if (caret !== undefined) placeCaret(caret);
        editor.focus();
        return;
    }
    if (stage.value === "failed") {
        focusFallback(caret);
        return;
    }
    focusWhenReady = caret ?? "end";
    void activate();
};

watch(() => props.modelValue, (text) => {
    if (model === null || editor === null || model.getValue() === text) return;
    const position = editor.getPosition();
    applying = true;
    try {
        model.setValue(text);
    } finally {
        applying = false;
    }
    // Monaco 按新的文字校正位置（变短时夹到末尾）。
    if (position !== null) editor.setPosition(position);
});
watch(() => props.readonly, (readonly) => editor?.updateOptions({readOnly: readonly}));
watch(() => props.label, (label) => editor?.updateOptions({ariaLabel: label}));
watch(() => props.language, () => {
    if (monaco !== null && model !== null && model.getLanguageId() !== languageId()) monaco.editor.setModelLanguage(model, languageId());
});
watch(options, (value) => editor?.updateOptions(fontOptions(value)));

onMounted(() => {
    if (root.value === null) return;
    // 没有 IntersectionObserver 的环境（测试）不提前建：聚焦时再建。
    if (typeof IntersectionObserver === "undefined") return;
    viewport = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void activate();
    }, {rootMargin: "200px"});
    viewport.observe(root.value);
});

onBeforeUnmount(() => {
    unmounted = true;
    viewport?.disconnect();
    unfollowTheme?.();
    editor?.dispose();
    model?.dispose();
    editor = null;
    model = null;
});

defineExpose({
    focus,
    cursorOffset: (): number | null => {
        if (stage.value === "failed") return fallback.value?.$el.selectionStart ?? null;
        const position = editor?.getPosition() ?? null;
        return model === null || position === null ? null : model.getOffsetAt(position);
    },
    /**
     * 在光标处写入一段文字（有选区时换掉选区），光标落在它后面；照用户输入交出去，进撤销历史。使用方不要自己把文字拼好再经
     * `modelValue` 给回来：那样是整篇替换，撤销历史清空、光标回不到原处。只读、编辑器还没建好时不做，返回假。
     */
    insert: (text: string): boolean => {
        if (props.readonly) return false;
        if (stage.value === "failed") {
            const element = fallback.value?.$el;
            if (element === undefined) return false;
            const at = element.selectionStart + text.length;
            element.setRangeText(text, element.selectionStart, element.selectionEnd);
            element.setSelectionRange(at, at);
            element.dispatchEvent(new Event("input", {bubbles: true}));
            return true;
        }
        const selection = editor?.getSelection() ?? null;
        if (editor === null || selection === null) return false;
        editor.pushUndoStop();
        editor.executeEdits("nbook.code-input.insert", [{range: selection, text, forceMoveMarkers: true}]);
        editor.pushUndoStop();
        return true;
    },
});
</script>

<template>
    <div ref="root" class="code-input" data-code-input :data-code-input-stage="stage">
        <!-- 没建 Monaco 时的原文：能聚焦，聚焦就建（建好后焦点进编辑器）。 -->
        <pre
            v-if="stage === 'plain'"
            class="code-input__plain"
            :style="{fontSize: `${String(options.fontSize)}px`, lineHeight: `${String(plainLineHeight)}px`}"
            tabindex="0"
            role="textbox"
            aria-multiline="true"
            :aria-readonly="readonly"
            :aria-label="label"
            data-code-input-plain
            @focus="focus()"
        >{{ modelValue }}</pre>
        <!-- Monaco 加载失败：退回普通文本框，内容照样能改、能交回去。 -->
        <Textarea
            v-else-if="stage === 'failed'"
            ref="fallback"
            class="code-input__fallback"
            variant="bare"
            autosize
            :rows="1"
            :style="{fontSize: `${String(options.fontSize)}px`, lineHeight: `${String(plainLineHeight)}px`}"
            :readonly="readonly"
            :aria-label="label"
            :model-value="modelValue"
            data-code-input-fallback
            @update:model-value="(value: string) => emit('update:modelValue', value)"
            @focus="emit('focus')"
            @blur="emit('blur')"
        />
        <div v-show="stage === 'ready'" ref="host" :style="{height: `${String(height)}px`}" data-code-input-monaco></div>
        <p v-if="failure !== null" class="px-2 pb-1 text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-code-input-failure>{{ failure }}</p>
    </div>
</template>

<style scoped>
.code-input {
    width: 100%;
    min-width: 0;
}

/* 与 Monaco 的排版对齐到差不多：等宽、折行、同样的上下留白，换成编辑器时不大跳。 */
.code-input__plain {
    margin: 0;
    padding: 6px 8px;
    font-family: var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-main);
    min-height: calc(1lh + 12px);
}

.code-input__fallback {
    padding: 6px 8px;
    font-family: var(--font-mono);
}

.code-input__plain:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: -2px;
}
</style>
