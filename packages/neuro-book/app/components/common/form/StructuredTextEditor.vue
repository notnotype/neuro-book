<script setup lang="ts">
import type {MarkdownFormatCommand, MarkdownStudioEditorHandle} from "nbook/app/composables/useMarkdownStudioController";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import TipTapMarkdownEditor from "nbook/app/components/markdown-studio/TipTapMarkdownEditor.vue";
import MarkdownSourceEditor from "nbook/app/components/markdown-studio/MarkdownSourceEditor.vue";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";

type StructuredTextMode = "rich" | "source";
type PopoverDirection = "auto" | "up" | "down";
type StructuredTextSize = "sm" | "md";

const props = withDefaults(defineProps<{
    modelValue: string;
    rows?: number;
    size?: StructuredTextSize;
    placeholder?: string;
    minHeight?: number;
    maxHeight?: number;
    minRows?: number;
    maxRows?: number;
    autoHeight?: boolean;
    mode?: StructuredTextMode | null;
    defaultMode?: StructuredTextMode;
    showToolbar?: boolean;
    showFormatToolbar?: boolean;
    resizable?: boolean;
    popoverDirection?: PopoverDirection;
    submitOnEnter?: boolean;
    enableQuickTriggers?: boolean;
    matchPopoverWidth?: boolean;
    menuRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onSkillTriggerStart?: () => void;
    readonly?: boolean;
    activePath?: string;
    referenceRefreshKey?: string | number;
    openReference?: (target: string) => void;
    resolveReference?: WorkspaceReferenceResolver;
    editorPreferences?: MarkdownEditorPreferences;
    monacoPreferences?: MonacoEditorPreferences;
    monacoTemporaryFontSize?: number | null;
    borderless?: boolean;
}>(), {
    rows: 5,
    size: "sm",
    placeholder: "",
    minHeight: undefined,
    maxHeight: undefined,
    minRows: undefined,
    maxRows: undefined,
    autoHeight: false,
    mode: null,
    defaultMode: "rich",
    showToolbar: true,
    showFormatToolbar: true,
    resizable: true,
    popoverDirection: "auto",
    submitOnEnter: false,
    enableQuickTriggers: false,
    matchPopoverWidth: false,
    menuRefreshKey: "",
    readonly: false,
    activePath: "",
    editorPreferences: () => ({...DEFAULT_MARKDOWN_EDITOR_PREFERENCES}),
    monacoPreferences: () => ({...DEFAULT_MONACO_EDITOR_PREFERENCES}),
    monacoTemporaryFontSize: null,
    borderless: false,
    resolveMenu: () => ({
        title: "",
        prefix: "",
        sections: [],
    }),
    onSkillTriggerStart: () => {},
    openReference: () => {},
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string): void;
    (e: "update:mode", value: StructuredTextMode): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    (e: "save-request"): void;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const richEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
const sourceEditorRef = ref<MarkdownStudioEditorHandle | null>(null);
const currentMode = ref<StructuredTextMode>(props.defaultMode);
const compactToolbar = ref(true);
let toolbarResizeObserver: ResizeObserver | null = null;

const modeButtons: Array<{mode: StructuredTextMode; title: string; iconClass: string}> = [
    {mode: "rich", title: "富文本模式", iconClass: "i-lucide-book-open-text"},
    {mode: "source", title: "源码模式", iconClass: "i-lucide-file-code-2"},
];
const formatButtons: Array<{
    command: MarkdownFormatCommand;
    title: string;
    iconClass: string;
    priority: "core" | "wide";
}> = [
    {command: "heading-2", title: "二级标题", iconClass: "i-lucide-heading-2", priority: "wide"},
    {command: "heading-3", title: "三级标题", iconClass: "i-lucide-heading-3", priority: "wide"},
    {command: "bold", title: "粗体", iconClass: "i-lucide-bold", priority: "core"},
    {command: "italic", title: "斜体", iconClass: "i-lucide-italic", priority: "core"},
    {command: "underline", title: "下划线", iconClass: "i-lucide-underline", priority: "wide"},
    {command: "strike", title: "删除线", iconClass: "i-lucide-strikethrough", priority: "wide"},
    {command: "code", title: "行内代码", iconClass: "i-lucide-code", priority: "core"},
    {command: "bullet-list", title: "无序列表", iconClass: "i-lucide-list", priority: "wide"},
    {command: "ordered-list", title: "有序列表", iconClass: "i-lucide-list-ordered", priority: "wide"},
    {command: "blockquote", title: "引用块", iconClass: "i-lucide-text-quote", priority: "wide"},
    {command: "clear-format", title: "清除格式", iconClass: "i-lucide-eraser", priority: "wide"},
];

const effectiveMode = computed<StructuredTextMode>(() => props.mode ?? currentMode.value);
const isRichMode = computed(() => effectiveMode.value === "rich");
const showFormatTools = computed(() => props.showToolbar && props.showFormatToolbar && isRichMode.value);
const canResize = computed(() => props.resizable && props.showToolbar && !props.readonly && !props.autoHeight);
const resolvedMinHeight = computed(() => {
    if (props.minHeight !== undefined) {
        return props.minHeight;
    }
    const rows = props.minRows ?? props.rows;
    return props.size === "sm" ? Math.max(rows * 20, 24) : Math.max(rows * 28, 40);
});
const resolvedMaxHeight = computed(() => {
    if (props.maxHeight !== undefined) {
        return props.maxHeight;
    }
    const rows = props.maxRows ?? props.rows;
    return props.size === "sm" ? Math.max(rows * 34, resolvedMinHeight.value) : Math.max(rows * 48, resolvedMinHeight.value);
});
const resolvedAutoHeight = computed(() => {
    const lineCount = Math.max(props.minRows ?? 1, props.modelValue.split(/\r\n|\r|\n/).length);
    const cappedLineCount = props.maxRows ? Math.min(lineCount, props.maxRows) : lineCount;
    const lineHeight = props.size === "sm" ? 20 : 28;
    const padding = props.size === "sm" ? 18 : 28;
    return Math.min(Math.max((cappedLineCount * lineHeight) + padding, resolvedMinHeight.value), resolvedMaxHeight.value);
});
const bodyStyle = computed(() => ({
    height: `${props.autoHeight ? resolvedAutoHeight.value : resolvedMinHeight.value}px`,
    minHeight: `${resolvedMinHeight.value}px`,
    maxHeight: `${resolvedMaxHeight.value}px`,
}));
const rootClass = computed(() => {
    const classes = [];
    if (props.size === "md") classes.push("structured-text-editor--md");
    if (props.borderless) classes.push("structured-text-editor--borderless");
    return classes.join(" ");
});
const toolbarClass = computed(() => props.size === "sm" ? "px-2 py-1" : "px-3 py-2");
const modeGroupClass = computed(() => props.size === "sm" ? "gap-0.5 rounded p-[1px]" : "gap-1 rounded-lg p-0.5");
const modeButtonClass = computed(() => props.size === "sm" ? "h-5 w-5 rounded-[4px]" : "h-6 w-6 rounded-md");
const modeIconClass = computed(() => props.size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5");
const formatButtonClass = computed(() => props.size === "sm" ? "h-5 w-5 rounded-[4px]" : "h-6 w-6 rounded-md");
const fullToolbarMinWidth = computed(() => {
    const buttonSize = props.size === "sm" ? 20 : 24;
    const formatButtonCount = formatButtons.length + 1;
    const formatGap = 2;
    const modeGroupWidth = (buttonSize * modeButtons.length) + (props.size === "sm" ? 8 : 12);
    const toolbarPadding = props.size === "sm" ? 16 : 24;
    const toolbarGap = 8;
    const safety = 10;
    return (buttonSize * formatButtonCount)
        + (formatGap * (formatButtonCount - 1))
        + modeGroupWidth
        + toolbarPadding
        + toolbarGap
        + safety;
});
const visibleFormatButtons = computed(() => compactToolbar.value
    ? formatButtons.filter((button) => button.priority === "core")
    : formatButtons);
const sourceEditorPreferences = computed<MonacoEditorPreferences>(() => {
    if (props.size === "md") {
        return props.monacoPreferences;
    }
    return {
        ...props.monacoPreferences,
        fontSize: Math.min(props.monacoPreferences.fontSize, 12),
        lineHeight: Math.min(props.monacoPreferences.lineHeight, 20),
        lineNumbers: false,
    };
});

/**
 * 根据容器宽度压缩格式工具数量，避免表单侧栏里工具条溢出。
 */
function updateToolbarDensity(width: number): void {
    compactToolbar.value = width < fullToolbarMinWidth.value;
}

onMounted(() => {
    if (!rootRef.value) {
        return;
    }
    updateToolbarDensity(rootRef.value.getBoundingClientRect().width);
    toolbarResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
            updateToolbarDensity(entry.contentRect.width);
        }
    });
    toolbarResizeObserver.observe(rootRef.value);
});

onBeforeUnmount(() => {
    toolbarResizeObserver?.disconnect();
    toolbarResizeObserver = null;
});

watch(() => props.size, () => {
    updateToolbarDensity(rootRef.value?.getBoundingClientRect().width ?? 0);
});

watch(() => props.defaultMode, (nextMode) => {
    if (props.mode === null) {
        currentMode.value = nextMode;
    }
});

watch(() => props.modelValue, (nextValue) => {
    richEditorRef.value?.update(nextValue);
    sourceEditorRef.value?.update(nextValue);
});

// 模式切换会 v-if 销毁当前编辑器，而编辑器 unmount 只 cancel 不上报（防 workspace 场景串位）；
// 本组件数据宿主（modelValue）不变，必须在翻转前结算防抖输入，否则丢最后 300ms 内的输入。
// sync 时机保证旧编辑器实例仍挂载；统一覆盖内部 setMode 与外部 :mode prop 两条切换路径。
watch(effectiveMode, () => {
    richEditorRef.value?.flushPendingChange?.();
    sourceEditorRef.value?.flushPendingChange?.();
}, {flush: "sync"});

/**
 * 切换包装层当前展示的编辑模式。
 */
function setMode(mode: StructuredTextMode): void {
    currentMode.value = mode;
    emit("update:mode", mode);
}

/**
 * 聚焦当前可见编辑器。
 */
function focus(): void {
    if (isRichMode.value) {
        richEditorRef.value?.focus();
        return;
    }
    sourceEditorRef.value?.focus();
}

/**
 * 在当前光标插入 Markdown 文本。
 */
function insertText(text: string): void {
    if (isRichMode.value) {
        richEditorRef.value?.insertMarkdown?.(text);
        return;
    }
    sourceEditorRef.value?.insertMarkdown?.(text);
}

/**
 * 执行富文本格式工具条命令。
 */
function applyFormat(command: MarkdownFormatCommand): void {
    richEditorRef.value?.applyMarkdownFormat?.(command);
}

/**
 * 给当前选区添加 inline comment。
 */
function addInlineComment(): void {
    richEditorRef.value?.addComment?.("");
}

/**
 * 读取当前 Markdown 字符串。
 */
function getMarkdown(): string {
    if (isRichMode.value) {
        return richEditorRef.value?.getValue?.() ?? props.modelValue;
    }
    return sourceEditorRef.value?.getValue?.() ?? props.modelValue;
}

/**
 * 同步子编辑器变更到表单 v-model。
 */
function emitChange(value: string): void {
    emit("update:modelValue", value);
}

defineExpose({
    focus,
    insertText,
    getMarkdown,
});
</script>

<template>
    <!-- Markdown 表单编辑器：工具栏包装层，底层唯一编辑器是 TipTapMarkdownEditor -->
    <div
        ref="rootRef"
        class="structured-text-editor relative overflow-visible"
        :class="[
            rootClass,
            props.borderless
                ? 'border-none shadow-none bg-[var(--bg-panel)]'
                : 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]'
        ]"
    >
        <div
            v-if="props.showToolbar"
            class="structured-text-editor__toolbar flex min-w-0 items-center justify-between gap-2 border-b border-[var(--border-color)] bg-[var(--bg-input)]/40"
            :class="toolbarClass"
        >
            <div class="flex min-w-0 flex-1 items-center">
                <div v-if="showFormatTools" class="structured-text-editor__format-tools flex min-w-0 items-center gap-0.5 overflow-hidden text-[var(--text-muted)]">
                    <button
                        v-for="button in visibleFormatButtons"
                        :key="button.command"
                        type="button"
                        class="inline-flex shrink-0 items-center justify-center transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-45"
                        :class="formatButtonClass"
                        :title="button.title"
                        :disabled="props.readonly"
                        @mousedown.prevent
                        @click="applyFormat(button.command)"
                    >
                        <span :class="[modeIconClass, button.iconClass]"></span>
                    </button>
                    <button
                        type="button"
                        class="inline-flex shrink-0 items-center justify-center transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-45"
                        :class="formatButtonClass"
                        title="添加评论"
                        :disabled="props.readonly"
                        @mousedown.prevent
                        @click="addInlineComment"
                    >
                        <span :class="[modeIconClass, 'i-lucide-message-square-plus']"></span>
                    </button>
                </div>
            </div>
            <div class="flex shrink-0 items-center border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]" :class="modeGroupClass">
                <button
                    v-for="button in modeButtons"
                    :key="button.mode"
                    type="button"
                    class="inline-flex items-center justify-center transition-colors"
                    :class="[modeButtonClass, effectiveMode === button.mode ? 'bg-[var(--bg-hover)] text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]']"
                    :title="button.title"
                    @click="setMode(button.mode)"
                >
                    <span :class="[modeIconClass, button.iconClass]"></span>
                </button>
            </div>
        </div>

        <div class="structured-text-editor__body min-h-0 overflow-hidden" :class="canResize ? 'structured-text-editor__body--resizable' : ''" :style="bodyStyle">
            <TipTapMarkdownEditor
                v-if="isRichMode"
                ref="richEditorRef"
                :initial-value="props.modelValue"
                :visible="isRichMode"
                :readonly="props.readonly"
                :editor-preferences="props.editorPreferences"
                :placeholder="props.placeholder"
                :active-path="props.activePath"
                :reference-refresh-key="props.referenceRefreshKey ?? props.menuRefreshKey"
                :resolve-menu="props.resolveMenu"
                :open-reference="props.openReference"
                :resolve-reference="props.resolveReference"
                :show-frontmatter-panel="false"
                :submit-on-enter="props.submitOnEnter"
                :enable-quick-triggers="props.enableQuickTriggers"
                :on-skill-trigger-start="props.onSkillTriggerStart"
                :popover-direction="props.popoverDirection"
                :match-popover-width="props.matchPopoverWidth"
                @change="emitChange"
                @focus="emit('focus')"
                @blur="emit('blur')"
                @submit="emit('submit', $event)"
                @shift-tab="emit('shift-tab')"
                @save-request="emit('save-request')"
            />

            <MarkdownSourceEditor
                v-else
                ref="sourceEditorRef"
                :initial-value="props.modelValue"
                :visible="!isRichMode"
                :readonly="props.readonly"
                :placeholder="props.placeholder"
                :monaco-preferences="sourceEditorPreferences"
                :temporary-font-size="props.monacoTemporaryFontSize"
                :submit-on-enter="props.submitOnEnter"
                :compact="props.size === 'sm'"
                @change="emitChange"
                @focus="emit('focus')"
                @blur="emit('blur')"
                @submit="emit('submit', $event)"
                @shift-tab="emit('shift-tab')"
                @save-request="emit('save-request')"
            />
        </div>
    </div>
</template>

<style scoped>
.structured-text-editor--borderless {
    border: none !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
    background: var(--bg-panel) !important;
    box-shadow: none !important;
}
.structured-text-editor--borderless .structured-text-editor__body {
    background: var(--bg-panel) !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
}
.structured-text-editor--borderless :deep(.tiptap-markdown-wrapper) {
    background: var(--bg-panel) !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
}
.structured-text-editor--borderless :deep(.markdown-source-shell) {
    background: var(--panel-surface) !important;
    border-top-left-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
    border-top-right-radius: calc(var(--composer-radius, 0.75rem) - 1px) !important;
}

.structured-text-editor {
    --structured-editor-padding: 6px 9px;
    --structured-editor-font-size: 0.8125rem;
    --structured-editor-line-height: 1.45rem;
    --structured-editor-paragraph-margin: 0 0 0.2rem;
    border-radius: 8px;
}

.structured-text-editor--md {
    --structured-editor-padding: 12px;
    --structured-editor-font-size: 0.9375rem;
    --structured-editor-line-height: 1.8rem;
    --structured-editor-paragraph-margin: 0 0 0.45rem;
}

.structured-text-editor__toolbar {
    border-top-left-radius: calc(8px - 1px);
    border-top-right-radius: calc(8px - 1px);
}

.structured-text-editor__body {
    background: var(--bg-panel);
    border-bottom-left-radius: calc(8px - 1px);
    border-bottom-right-radius: calc(8px - 1px);
}

.structured-text-editor__body--resizable {
    resize: vertical;
}

:deep(.tiptap-markdown-wrapper) {
    height: 100%;
    min-height: 100%;
    background: var(--bg-panel);
}

:deep(.tiptap-markdown-content) {
    min-height: 100%;
}

:deep(.nb-markdown-editor) {
    max-width: none;
    min-height: 100%;
    margin: 0;
    padding: var(--structured-editor-padding);
    color: var(--text-main);
    font-family: inherit;
    font-size: var(--structured-editor-font-size);
    line-height: var(--structured-editor-line-height);
}

:deep(.nb-markdown-editor p) {
    margin: var(--structured-editor-paragraph-margin);
}

:deep(.nb-markdown-editor h1),
:deep(.nb-markdown-editor h2),
:deep(.nb-markdown-editor h3) {
    margin: 0.75em 0 0.35em;
    font-family: inherit;
}

:deep(.markdown-source-shell) {
    height: 100%;
    border: 0;
    background: var(--panel-surface);
}
</style>
