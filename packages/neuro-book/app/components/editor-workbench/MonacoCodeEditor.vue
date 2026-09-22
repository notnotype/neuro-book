<script setup lang="ts">
import { buildMonacoTheme } from "nbook/app/components/markdown-studio/monaco-theme";
import { loadMonacoEditor } from "nbook/app/components/markdown-studio/load-monaco-editor";
import type { MonacoEditorApi } from "nbook/app/components/markdown-studio/load-monaco-editor";
import {useEditorChangeDebounce} from "nbook/app/composables/useEditorChangeDebounce";
import {THEME_HOST_SELECTOR} from "nbook/app/utils/theme/host";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type {TextEditorHandle} from "nbook/app/components/editor-workbench/editor-view.types";
import {DEFAULT_MONACO_EDITOR_PREFERENCES, type MonacoEditorPreferences} from "nbook/shared/editor-workbench";

const props = withDefaults(defineProps<{
    initialValue?: string;
    readonly?: boolean;
    autofocus?: boolean;
    placeholder?: string;
    visible?: boolean;
    language?: string;
    modelPath?: string;
    monacoPreferences?: MonacoEditorPreferences;
    temporaryFontSize?: number | null;
    submitOnEnter?: boolean;
    compact?: boolean;
}>(), {
    initialValue: "",
    readonly: false,
    autofocus: false,
    placeholder: "",
    visible: false,
    language: "plaintext",
    modelPath: "",
    monacoPreferences: () => ({...DEFAULT_MONACO_EDITOR_PREFERENCES}),
    temporaryFontSize: null,
    submitOnEnter: false,
    compact: false,
});

const emit = defineEmits<{
    (e: "ready"): void;
    (e: "change", value: string): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "update-temporary-font-size", value: number): void;
}>();
const {t} = useI18n();
const {appearance} = useProductTheme();

const editorRootRef = ref<HTMLDivElement | null>(null);
let monacoApi: MonacoEditorApi | null = null;
let editorInstance: Monaco.editor.IStandaloneCodeEditor | null = null;
let modelInstance: Monaco.editor.ITextModel | null = null;
let contentListener: Monaco.IDisposable | null = null;
let focusListener: Monaco.IDisposable | null = null;
let blurListener: Monaco.IDisposable | null = null;
let keydownListener: Monaco.IDisposable | null = null;
let wheelListener: ((event: WheelEvent) => void) | null = null;
let wheelListenerRoot: HTMLDivElement | null = null;
let editorDisposed = false;
let suppressModelSync = false;
let outsideSyncVersion = 0;
const editorPlaceholder = computed(() => props.placeholder || t("markdownStudio.source.placeholder"));

const effectiveFontSize = computed(() => clampNumber(
    props.temporaryFontSize ?? props.monacoPreferences.fontSize,
    10,
    32,
    DEFAULT_MONACO_EDITOR_PREFERENCES.fontSize,
));

/**
 * 标记一次来自父层的内容同步，避免 Monaco 把被动更新再次 emit 回去。
 */
const beginOutsideSync = (): number => {
    outsideSyncVersion += 1;
    suppressModelSync = true;
    return outsideSyncVersion;
};

/**
 * 结束一次父层同步。若期间没有新的外部同步，则释放 suppress 标记。
 */
const endOutsideSync = (version: number): void => {
    queueMicrotask(() => {
        if (outsideSyncVersion !== version) {
            return;
        }
        suppressModelSync = false;
    });
};

/**
 * 在屏蔽回环的前提下执行一次外部同步。
 */
const runOutsideSync = (callback: () => void): void => {
    const version = beginOutsideSync();
    callback();
    endOutsideSync(version);
};

/**
 * 读取宿主元素上的主题变量；变量写在 `<html>`，宿主只决定继承链起点。
 */
const readThemeVars = (): CSSStyleDeclaration => {
    const themeHost = editorRootRef.value?.closest(THEME_HOST_SELECTOR);
    return getComputedStyle(themeHost ?? document.documentElement);
};

/**
 * 生成并注册 Monaco 主题。
 */
const applyTheme = (): void => {
    if (!monacoApi) {
        return;
    }

    const cssVars = readThemeVars();
    const background = cssVars.getPropertyValue("--panel-surface").trim() || "#1f1f1f";
    const foreground = cssVars.getPropertyValue("--text-main").trim() || "#f3f4f6";
    const muted = cssVars.getPropertyValue("--text-muted").trim() || "#94a3b8";
    const accent = cssVars.getPropertyValue("--accent-main").trim() || "#3b82f6";
    const lineHighlight = cssVars.getPropertyValue("--bg-hover").trim() || "rgba(255,255,255,0.04)";
    const selection = cssVars.getPropertyValue("--accent-bg").trim() || "rgba(59,130,246,0.18)";
    const border = cssVars.getPropertyValue("--border-color").trim() || "#2b3340";
    const themeName = `neuro-book-source-${appearance.value}`;

    monacoApi.editor.defineTheme(themeName, buildMonacoTheme(appearance.value, {
        accent,
        background,
        border,
        foreground,
        hover: lineHighlight,
        muted,
        selection,
    }));

    monacoApi.editor.setTheme(themeName);
};

/**
 * 让 Monaco 重新计算当前容器尺寸。
 */
const layoutEditor = (): void => {
    const root = editorRootRef.value;
    if (root && root.clientWidth > 0 && root.clientHeight > 0) {
        editorInstance?.layout({width: root.clientWidth, height: root.clientHeight});
    }
};

/**
 * 把源码编辑器偏好收敛成 Monaco options。
 */
const buildEditorOptions = (): Monaco.editor.IEditorOptions => {
    const preferences = props.monacoPreferences;
    return {
        fontFamily: preferences.fontFamily || DEFAULT_MONACO_EDITOR_PREFERENCES.fontFamily,
        fontSize: effectiveFontSize.value,
        lineHeight: clampNumber(preferences.lineHeight, 16, 56, DEFAULT_MONACO_EDITOR_PREFERENCES.lineHeight),
        wordWrap: preferences.wordWrap ? "on" : "off",
        lineDecorationsWidth: props.compact ? 6 : 12,
        minimap: {
            enabled: preferences.minimapEnabled,
        },
        lineNumbers: preferences.lineNumbers ? "on" : "off",
        padding: {
            top: props.compact ? 8 : 20,
            bottom: props.compact ? 72 : 192,
        },
        renderWhitespace: preferences.renderWhitespace ? "boundary" : "none",
    };
};

/**
 * 应用源码编辑器偏好和当前标签页临时字号。
 */
const applyEditorOptions = (): void => {
    editorInstance?.updateOptions(buildEditorOptions());
};

/**
 * 应用源码模型级缩进偏好。
 */
const applyModelOptions = (): void => {
    const options: Monaco.editor.ITextModelUpdateOptions = {
        tabSize: clampNumber(props.monacoPreferences.tabSize, 2, 8, DEFAULT_MONACO_EDITOR_PREFERENCES.tabSize),
        insertSpaces: true,
    };
    modelInstance?.updateOptions(options);
};

/**
 * 创建当前实例专有的 Monaco model。
 *
 * modelPath 已包含实例 token，因此同 URI 的模型只可能来自未释放的旧实例：
 * 模型归实例所有、可独立 dispose，绝不按 URI 取用别人的模型后互相释放。
 */
const createEditorModel = (): Monaco.editor.ITextModel | null => {
    if (!monacoApi) {
        return null;
    }

    const modelUri = props.modelPath ? monacoApi.Uri.parse(`file:///workspace/${encodeURIComponent(props.modelPath).replace(/%2F/g, "/")}`) : undefined;
    if (!modelUri) {
        return monacoApi.editor.createModel(props.initialValue, props.language);
    }

    monacoApi.editor.getModel(modelUri)?.dispose();
    return monacoApi.editor.createModel(props.initialValue, props.language, modelUri);
};

/**
 * 处理 Ctrl/Cmd + 滚轮临时调整当前标签页源码字号。
 */
const handleWheelZoom = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
        return;
    }
    event.preventDefault();
    const nextSize = effectiveFontSize.value + (event.deltaY < 0 ? 1 : -1);
    emit("update-temporary-font-size", clampNumber(nextSize, 10, 32, DEFAULT_MONACO_EDITOR_PREFERENCES.fontSize));
};

/**
 * 显式更新编辑器内容（外部权威正文回灌）。
 *
 * `model.setValue` 整体重设缓冲区并清空该模型的撤销栈：回灌本身不成为可撤销项，
 * 同步前的旧历史也不会被 Ctrl+Z 重放到新正文上（用户撤销只回溯本实例同步后的输入）。
 * setValue 的 flush 会把视口与光标推走，因此前后自行保留选区与滚动位置。
 */
const update = (markdown: string): void => {
    const model = modelInstance;
    if (!model || markdown === model.getValue()) {
        return;
    }

    // 外部权威内容覆盖本地状态，未结算的防抖输入作废
    changeDebounce.cancel();
    const editor = editorDisposed ? null : editorInstance;
    const selection = editor?.getSelection() ?? null;
    const scrollTop = editor?.getScrollTop() ?? 0;
    const scrollLeft = editor?.getScrollLeft() ?? 0;
    runOutsideSync(() => model.setValue(markdown));
    if (!editor) {
        return;
    }
    if (selection) {
        editor.setSelection({
            selectionStartLineNumber: clampLine(model, selection.selectionStartLineNumber),
            selectionStartColumn: clampColumn(model, selection.selectionStartLineNumber, selection.selectionStartColumn),
            positionLineNumber: clampLine(model, selection.positionLineNumber),
            positionColumn: clampColumn(model, selection.positionLineNumber, selection.positionColumn),
        });
    }
    editor.setScrollTop(scrollTop);
    editor.setScrollLeft(scrollLeft);
};

/**
 * 聚焦源码编辑器。
 */
const focus = (): void => {
    editorInstance?.focus();
};

/**
 * 将源码编辑器滚动到顶部。
 */
const scrollToTop = (): void => {
    editorInstance?.setScrollTop(0);
    editorInstance?.setScrollLeft(0);
};

/**
 * 行号导航：只有真实就绪的内核才回应。拒绝越界而不 clamp——静默挪到最近一行
 * 会让「跳转到第 61 行」看起来成功了，实际落点是另一处。
 */
const revealLine = (line: number): {ok: true; value: {line: number}} | {ok: false; reason: string} => {
    const editor = editorInstance;
    const model = modelInstance;
    if (!editor || !model || editorDisposed) {
        return {ok: false, reason: "编辑器尚未就绪"};
    }
    const lineCount = model.getLineCount();
    if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) {
        return {ok: false, reason: `行号超出范围：${line}（共 ${lineCount} 行）`};
    }
    editor.setPosition({lineNumber: line, column: 1});
    editor.revealLineInCenter(line);
    editor.focus();
    return {ok: true, value: {line}};
};

const getLineCount = (): number | null => {
    return editorInstance && modelInstance && !editorDisposed ? modelInstance.getLineCount() : null;
};

/**
 * 获取当前源码值。
 */
const getValue = (): string => {
    return modelInstance?.getValue() ?? props.initialValue;
};

/**
 * 执行 Monaco 撤销。
 */
const undo = (): void => {
    editorInstance?.trigger("keyboard", "undo", null);
};

/**
 * 执行 Monaco 重做。
 */
const redo = (): void => {
    editorInstance?.trigger("keyboard", "redo", null);
};

/**
 * 在当前光标插入文本。
 */
const insertText = (markdown: string): void => {
    const editor = editorInstance;
    const model = modelInstance;
    const api = monacoApi;
    if (!editor || !model || !api) {
        return;
    }
    const selection = editor.getSelection() ?? model.getFullModelRange();
    const range = new api.Range(selection.startLineNumber, selection.startColumn, selection.startLineNumber, selection.startColumn);
    editor.executeEdits("markdown-insert", [{range, text: markdown, forceMoveMarkers: true}]);
};

/**
 * 用 Markdown 替换当前选区。
 */
const replaceSelection = (markdown: string): void => {
    const editor = editorInstance;
    if (!editor) {
        return;
    }
    const range = editor.getSelection();
    if (!range) {
        insertText(markdown);
        return;
    }
    editor.executeEdits("markdown-replace", [{range, text: markdown, forceMoveMarkers: true}]);
};

/**
 * 将文本追加到文件末尾。
 */
const appendText = (markdown: string): void => {
    const editor = editorInstance;
    const model = modelInstance;
    const api = monacoApi;
    if (!editor || !model || !api) {
        return;
    }
    const lineCount = model.getLineCount();
    const lastColumn = model.getLineMaxColumn(lineCount);
    const range = new api.Range(lineCount, lastColumn, lineCount, lastColumn);
    editor.executeEdits("markdown-append", [{range, text: markdown, forceMoveMarkers: true}]);
};

/**
 * 变更上报防抖：Monaco 每键 getValue() 是 O(全文) 拼接，且 emit 会触发
 * store 的全文 dirty 对比与 tab 数组重建，大文档下每键传播是 CPU 激增主因。
 * 打字期间只 schedule；失焦、保存快捷键、store flush 钩子结算；外部覆盖丢弃。
 */
const changeDebounce = useEditorChangeDebounce({
    readValue: () => modelInstance?.getValue() ?? null,
    onEmit: (value) => {
        if (props.readonly) {
            return;
        }
        // emit 后父层可能同步回写，同一微任务内的模型变更是回环，不再上报
        suppressModelSync = true;
        emit("change", value);
        queueMicrotask(() => {
            suppressModelSync = false;
        });
    },
});

/**
 * 有未结算的输入时立即上报最新源码。
 */
const flushPendingChange = (): void => {
    changeDebounce.flush();
};

watch(() => props.readonly, (readonly) => {
    editorInstance?.updateOptions({
        readOnly: readonly,
        domReadOnly: readonly,
    });
});

watch([
    () => props.monacoPreferences,
    () => props.temporaryFontSize,
    () => props.compact,
], () => {
    applyEditorOptions();
    applyModelOptions();
}, {deep: true});

watch(appearance, async () => {
    await nextTick();
    applyTheme();
});

watch(() => props.initialValue, (value) => {
    update(value);
});

watch(() => props.language, (language) => {
    if (monacoApi && modelInstance) monacoApi.editor.setModelLanguage(modelInstance, language);
});

watch(() => props.visible, async (visible) => {
    if (!visible) {
        return;
    }

    await nextTick();
    requestAnimationFrame(() => {
        layoutEditor();
    });
});

onMounted(async () => {
    const editorRoot = editorRootRef.value;
    if (!editorRoot) {
        return;
    }

    const monacoModule = await loadMonacoEditor();
    if (editorDisposed || editorRootRef.value !== editorRoot) {
        return;
    }

    monacoApi = monacoModule;
    applyTheme();

    modelInstance = createEditorModel();
    if (!modelInstance || editorDisposed || editorRootRef.value !== editorRoot) {
        modelInstance?.dispose();
        modelInstance = null;
        return;
    }

    editorInstance = monacoApi.editor.create(editorRoot, {
        model: modelInstance,
        language: props.language,
        readOnly: props.readonly,
        domReadOnly: props.readonly,
        automaticLayout: true,
        minimap: {
            enabled: false,
        },
        lineNumbers: "on",
        lineDecorationsWidth: props.compact ? 6 : 12,
        glyphMargin: false,
        folding: true,
        wordWrap: "on",
        wrappingIndent: "same",
        scrollBeyondLastLine: false,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            alwaysConsumeMouseWheel: true,
            handleMouseWheel: true,
        },
        renderLineHighlight: "gutter",
        roundedSelection: true,
        ...buildEditorOptions(),
        placeholder: editorPlaceholder.value,
    });
    applyModelOptions();

    editorInstance.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
        // 保存前结算防抖，保证 store 拿到的是最新输入
        flushPendingChange();
        emit("save-request");
    });

    wheelListener = handleWheelZoom;
    wheelListenerRoot = editorRoot;
    wheelListenerRoot.addEventListener("wheel", wheelListener, {passive: false});

    contentListener = modelInstance.onDidChangeContent(() => {
        if (suppressModelSync || props.readonly) {
            return;
        }
        changeDebounce.schedule();
    });

    focusListener = editorInstance.onDidFocusEditorText(() => {
        emit("focus");
    });

    blurListener = editorInstance.onDidBlurEditorText(() => {
        flushPendingChange();
        emit("blur");
    });

    keydownListener = editorInstance.onKeyDown((event) => {
        if (event.browserEvent.key === "Tab" && event.browserEvent.shiftKey) {
            event.preventDefault();
            emit("shift-tab");
            return;
        }
        if (props.submitOnEnter && event.browserEvent.key === "Enter" && !event.browserEvent.shiftKey) {
            event.preventDefault();
            flushPendingChange();
            emit("submit", {ctrlKey: event.browserEvent.ctrlKey, metaKey: event.browserEvent.metaKey});
        }
    });

    await nextTick();
    layoutEditor();
    emit("ready");

    if (props.autofocus) {
        focus();
    }
});

onBeforeUnmount(() => {
    editorDisposed = true;
    // 卸载时 store 活动文件可能已切换，此刻 emit 会把内容写进新文件；
    // 切换入口统一由 store 的 activeEditorFlush 钩子在切换前结算，这里只丢弃
    changeDebounce.cancel();
    if (wheelListener && wheelListenerRoot) {
        wheelListenerRoot.removeEventListener("wheel", wheelListener);
    }
    contentListener?.dispose();
    focusListener?.dispose();
    blurListener?.dispose();
    keydownListener?.dispose();
    editorInstance?.dispose();
    modelInstance?.dispose();
    contentListener = null;
    focusListener = null;
    blurListener = null;
    keydownListener = null;
    wheelListener = null;
    wheelListenerRoot = null;
    editorInstance = null;
    modelInstance = null;
    monacoApi = null;
});

defineExpose<TextEditorHandle>({
    update,
    focus,
    scrollToTop,
    undo,
    redo,
    insertText,
    replaceSelection,
    appendText,
    getValue,
    flushPendingChange,
    navigation: {getLineCount, revealLine},
});

/**
 * 把用户配置限制在 Monaco 可接受的显示范围。
 */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(Math.max(value, min), max);
}

/** 回灌后原选区可能越过新正文边界：夹到最近的合法位置，而不是把非法坐标交给 Monaco。 */
function clampLine(model: Monaco.editor.ITextModel, line: number): number {
    return Math.min(Math.max(line, 1), model.getLineCount());
}

function clampColumn(model: Monaco.editor.ITextModel, line: number, column: number): number {
    return Math.min(Math.max(column, 1), model.getLineMaxColumn(clampLine(model, line)));
}
</script>

<template>
    <!-- Markdown 源码编辑器 -->
    <div class="ide-panel markdown-source-shell">
        <div ref="editorRootRef" class="markdown-source-editor"></div>
    </div>
</template>

<style scoped>
.markdown-source-shell {
    height: 100%;
    background: var(--panel-surface);
    overflow: hidden;
}

.markdown-source-editor {
    width: 100%;
    height: 100%;
}

.markdown-source-shell :deep(.monaco-editor),
.markdown-source-shell :deep(.monaco-editor .margin),
.markdown-source-shell :deep(.monaco-editor .monaco-editor-background) {
    background: var(--panel-surface) !important;
}
</style>
