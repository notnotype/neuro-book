<script setup lang="ts">
/** 可嵌入的代码输入框（同名 .md）：一段由使用方给的源文字，高度随内容；进入视野或拿到焦点时才建 Monaco。 */
import {computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

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

const root = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | null>(null);
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
/** 建好以后要不要把焦点放进去：因为聚焦才建的、或建的途中调用了 `focus()`。 */
let focusWhenReady = false;

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
    if (focusWhenReady) {
        const line = model.getLineCount();
        editor.setPosition({lineNumber: line, column: model.getLineMaxColumn(line)});
        editor.focus();
    }
};

const focus = (): void => {
    if (editor !== null) {
        editor.focus();
        return;
    }
    focusWhenReady = true;
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
        const position = editor?.getPosition() ?? null;
        return model === null || position === null ? null : model.getOffsetAt(position);
    },
});
</script>

<template>
    <div ref="root" class="code-input" data-code-input :data-code-input-stage="stage">
        <!-- 没建 Monaco 时的原文：能聚焦，聚焦就建（建好后焦点进编辑器）。 -->
        <pre
            v-if="stage !== 'ready'"
            class="code-input__plain"
            :style="{fontSize: `${String(options.fontSize)}px`}"
            :tabindex="stage === 'failed' ? undefined : 0"
            :aria-label="label"
            data-code-input-plain
            @focus="focus"
        >{{ modelValue }}</pre>
        <div v-show="stage === 'ready'" ref="host" :style="{height: `${String(height)}px`}" data-code-input-monaco></div>
        <p v-if="failure !== null" class="px-2 pb-1 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert">{{ failure }}</p>
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
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-main);
    min-height: calc(1.5em + 12px);
}

.code-input__plain:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: -2px;
}
</style>
