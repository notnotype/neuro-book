<script setup lang="ts">
/**
 * 通用 JSON 查看器组件。
 * 基于 json-editor-vue（vanilla-jsoneditor 的 Vue 3 封装）。
 * 默认只读，tree 模式。
 *
 * @example
 * <JsonViewer :value="someObject" />
 * <JsonViewer :value="someObject" mode="text" :max-height="200" />
 */
import {IconButton as NbIconButton, ToggleGroup as NbToggleGroup} from "@notnotype/nb-ui/components";
import type {ToggleGroupOption} from "@notnotype/nb-ui/components";
import JsonEditorVue from "json-editor-vue";
import {Mode} from "vanilla-jsoneditor";

type JsonViewerMode = Mode;

/**
 * json-editor-vue 暴露的编辑器实例接口。
 * 这里只声明当前自定义 toolbar 实际会使用到的方法，避免把类型扩得过大。
 */
interface JsonEditorInstance {
    expand(path: Array<string | number>, callback?: (path: Array<string | number>) => boolean): void;
    collapse(path: Array<string | number>, recursive?: boolean): void;
}

/**
 * json-editor-vue 组件实例暴露的字段。
 * `jsonEditor` 来自上游 defineExpose，这里显式声明，避免使用 any。
 */
interface JsonEditorVueExpose {
    jsonEditor?: JsonEditorInstance;
}

const props = withDefaults(defineProps<{
    /** 要展示的 JSON 值（对象、数组、字符串等）。 */
    value: unknown;
    /** 编辑器模式。默认 tree。 */
    mode?: JsonViewerMode;
    /** 是否只读。默认 true。 */
    readOnly?: boolean;
    /** 是否显示自定义工具栏。默认 true。 */
    mainMenuBar?: boolean;
    /** 是否显示导航栏。默认 false。 */
    navigationBar?: boolean;
    /** 是否显示状态栏。默认 false。 */
    statusBar?: boolean;
    /** 容器最大高度（px）。超出后内部滚动。为 0 表示不限制。 */
    maxHeight?: number;
}>(), {
    mode: Mode.tree,
    readOnly: true,
    mainMenuBar: true,
    navigationBar: false,
    statusBar: false,
    maxHeight: 300,
});

const emit = defineEmits<{
    /** 编辑内容变化；字符串模式保留用户当前输入，即使 JSON 暂时不完整。 */
    (e: "update:value", value: unknown): void;
    /** 编辑器报告语法或结构校验结果。 */
    (e: "validation-change", hasErrors: boolean): void;
}>();

/**
 * 当前编辑器模式。
 * 外部 `mode` 变化时会覆盖内部状态；用户点击 toolbar 时只更新内部状态。
 */
const currentMode = ref<JsonViewerMode>(props.mode);

watch(() => props.mode, (mode) => {
    currentMode.value = mode;
});

/**
 * JsonEditorVue 组件引用。
 */
const editorRef = ref<(InstanceType<typeof JsonEditorVue> & JsonEditorVueExpose) | null>(null);

/**
 * 底层 json editor 实例。
 */
const jsonEditor = computed(() => editorRef.value?.jsonEditor);

const containerStyle = computed(() => {
    if (props.maxHeight > 0) {
        return { maxHeight: `${props.maxHeight}px` };
    }
    return {};
});

/**
 * 是否允许展开/折叠。
 * table 模式下不提供这两个操作。
 */
const canToggleExpand = computed(() => currentMode.value !== Mode.table);

/**
 * 模式切换按钮定义。
 */
const modeButtons: ToggleGroupOption[] = [
    { value: Mode.text, iconClass: "i-lucide-file-json-2", title: "切换到文本模式" },
    { value: Mode.tree, iconClass: "i-lucide-git-branch", title: "切换到树形模式" },
    { value: Mode.table, iconClass: "i-lucide-table-properties", title: "切换到表格模式" },
];

/**
 * 切换查看模式。
 * ToggleGroup 单选模式下再次点击当前项会发出空值取消选择，而查看器必须始终处于某个模式，
 * 因此空值保持原模式不变。
 */
function switchMode(value: string | string[] | undefined) {
    const next = Array.isArray(value) ? value[0] : value;
    if (!next) {
        return;
    }

    currentMode.value = next as JsonViewerMode;
}

/**
 * 复制当前 JSON 内容。
 * 字符串保持原样，其他值使用格式化 JSON 输出。
 */
async function copyValue() {
    try {
        const text = typeof props.value === "string"
            ? props.value
            : JSON.stringify(props.value, null, 2);

        if (!text) {
            return;
        }

        await navigator.clipboard.writeText(text);
    } catch (error) {
        console.warn("JsonViewer 复制失败", error);
    }
}

/**
 * 展开全部节点。
 */
function expandAll() {
    if (!canToggleExpand.value) {
        return;
    }

    jsonEditor.value?.expand([], () => true);
}

/**
 * 折叠全部节点。
 */
function collapseAll() {
    if (!canToggleExpand.value) {
        return;
    }

    jsonEditor.value?.collapse([], true);
}

/**
 * 将 json-editor-vue 的正式 v-model 输出回写给父组件。
 * `stringified` 模式会保留文本模式中的原始输入，即使 JSON 仍处于编辑中的非法状态。
 */
function handleEditorUpdate(value: unknown): void {
    emit("update:value", value);
    if (typeof value !== "string" || !value.trim()) {
        emit("validation-change", false);
        return;
    }
    try {
        JSON.parse(value);
        emit("validation-change", false);
    } catch {
        emit("validation-change", true);
    }
}
</script>

<template>
    <!-- JSON 查看器容器 -->
    <div class="json-viewer" :class="{'json-viewer--readonly': props.readOnly}" :style="containerStyle">
        <!-- 自定义工具栏 -->
        <div v-if="props.mainMenuBar" class="json-viewer__toolbar">
            <NbToggleGroup
                size="sm"
                :options="modeButtons"
                :model-value="currentMode"
                @update:model-value="switchMode"
            />

            <div class="json-viewer__actions">
                <NbIconButton size="sm" title="复制 JSON" icon-class="i-lucide-copy" @click="copyValue" />
                <NbIconButton
                    size="sm"
                    title="展开全部"
                    icon-class="i-lucide-unfold-vertical"
                    :disabled="!canToggleExpand"
                    @click="expandAll"
                />
                <NbIconButton
                    size="sm"
                    title="折叠全部"
                    icon-class="i-lucide-fold-vertical"
                    :disabled="!canToggleExpand"
                    @click="collapseAll"
                />
            </div>
        </div>

        <!-- JSON 编辑器主体：外层只负责裁切与高度，内部由 jsoneditor 自己滚动 -->
        <div class="json-viewer__editor">
            <JsonEditorVue
                ref="editorRef"
                :model-value="props.value"
                :mode="currentMode"
                :stringified="typeof props.value === 'string'"
                :read-only="props.readOnly"
                :main-menu-bar="false"
                :navigation-bar="props.navigationBar"
                :status-bar="props.statusBar"
                @update:model-value="handleEditorUpdate"
            />
        </div>
    </div>
</template>

<style scoped>
/* 适配项目的暗色主题 CSS 变量 */
.json-viewer {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--bg-main);
}

/* 自定义工具栏 */
.json-viewer__toolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    padding: 0.25rem 0.35rem;
    /* border-bottom: 1px solid var(--border-color); */
    background: color-mix(in srgb, var(--bg-input) 96%, transparent);
}

.json-viewer__actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.2rem;
}

/* 承载 jsoneditor 根节点，内容区在内部滚动 */
.json-viewer__editor {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: auto;
}

.json-viewer__editor :deep(.jse-main) {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    border: none;
}

/* 覆盖 jsoneditor 的默认主题变量以适配项目暗色方案 */
.json-viewer :deep(.jse-theme-dark),
.json-viewer :deep(.jse-main) {
    --jse-theme: dark;
    --jse-theme-color: color-mix(in srgb, var(--bg-input) 76%, var(--accent-main) 24%);
    --jse-theme-color-highlight: color-mix(in srgb, var(--bg-hover) 70%, var(--accent-main) 30%);
    --jse-font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --jse-font-family-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    --jse-font-size: 11px;
    --jse-font-size-mono: 11px;
    --jse-font-size-main-menu: 11px;
    --jse-font-size-text-mode-search: 80%;
    --jse-line-height: calc(1em + 4px);
    --jse-indent-size: calc(1em + 4px);
    --jse-padding: 8px;
    --jse-color-picker-button-size: 1em;
    --jse-background-color: var(--bg-main);
    --jse-text-color: var(--text-main);
    --jse-text-color-inverse: var(--bg-main);
    --jse-text-readonly: var(--text-muted);
    --jse-error-color: #ee5341;
    --jse-warning-color: #fdc539;
    --jse-info-color: #4f91ff;
    --jse-main-border: 1px solid var(--border-color);
    --jse-menu-color: var(--text-secondary);
    --jse-menu-button-size: 26px;
    --jse-modal-background: var(--bg-panel);
    --jse-overlay-background: rgba(0, 0, 0, 0.5);
    --jse-modal-code-background: var(--bg-input);
    --jse-modal-editor-theme-color: #707070;
    --jse-modal-editor-theme-color-highlight: #646464;
    --jse-tooltip-color: var(--text-main);
    --jse-tooltip-background: #4b4b4b;
    --jse-tooltip-border: 1px solid #737373;
    --jse-tooltip-action-button-color: inherit;
    --jse-tooltip-action-button-background: #737373;
    --jse-panel-background: var(--bg-input);
    --jse-panel-background-border: 1px solid var(--border-color);
    --jse-panel-color: var(--text-main);
    --jse-panel-color-readonly: var(--text-muted);
    --jse-panel-border: 1px solid var(--border-color);
    --jse-panel-button-color-highlight: var(--text-main);
    --jse-panel-button-background-highlight: var(--bg-hover);
    --jse-navigation-bar-background: color-mix(in srgb, var(--bg-input) 88%, white 12%);
    --jse-navigation-bar-background-highlight: color-mix(in srgb, var(--bg-hover) 86%, white 14%);
    --jse-navigation-bar-dropdown-color: var(--text-main);
    --jse-context-menu-background: #4b4b4b;
    --jse-context-menu-background-highlight: #595959;
    --jse-context-menu-separator-color: #595959;
    --jse-context-menu-color: var(--text-main);
    --jse-context-menu-pointer-background: #4b4b4b;
    --jse-context-menu-pointer-background-highlight: #595959;
    --jse-context-menu-pointer-color: #4b4b4b;
    --jse-context-menu-pointer-color-highlight: #595959;
    --jse-key-color: var(--accent-text);
    --jse-value-color: var(--text-main);
    --jse-value-color-string: #a5d6a7;
    --jse-value-color-url: #a5d6a7;
    --jse-value-color-number: #90caf9;
    --jse-value-color-boolean: #ce93d8;
    --jse-value-color-null: #ef9a9a;
    --jse-delimiter-color: var(--text-muted);
    --jse-separator-color: var(--border-color);
    --jse-edit-outline: 2px solid var(--text-main);
    --jse-contents-background-color: transparent;
    --jse-selection-background-color: var(--accent-bg);
    --jse-selection-background-inactive-color: var(--bg-hover);
    --jse-hover-background-color: rgba(255, 255, 255, 0.04);
    --jse-active-line-background-color: rgba(255, 255, 255, 0.06);
    --jse-search-match-background-color: #343434;
    --jse-collapsed-items-background-color: var(--bg-input);
    --jse-collapsed-items-selected-background-color: #565656;
    --jse-collapsed-items-link-color: #b2b2b2;
    --jse-collapsed-items-link-color-highlight: #ec8477;
    --jse-search-match-color: #724c27;
    --jse-search-match-outline: 1px solid #966535;
    --jse-search-match-active-color: #9f6c39;
    --jse-search-match-active-outline: 1px solid #bb7f43;
    --jse-tag-background: #444444;
    --jse-tag-color: #bdbdbd;
    --jse-table-header-background: var(--bg-input);
    --jse-table-header-background-highlight: var(--bg-hover);
    --jse-table-row-odd-background: rgba(255, 255, 255, 0.04);
    --jse-input-background: var(--bg-input);
    --jse-input-border: 1px solid var(--border-color);
    --jse-button-background: #808080;
    --jse-button-background-highlight: #7a7a7a;
    --jse-button-color: #e0e0e0;
    --jse-button-secondary-background: color-mix(in srgb, var(--bg-input) 94%, var(--accent-main) 6%);
    --jse-button-secondary-background-highlight: color-mix(in srgb, var(--bg-hover) 88%, var(--accent-main) 12%);
    --jse-button-secondary-background-disabled: rgba(128, 128, 128, 0.14);
    --jse-button-secondary-color: var(--text-main);
    --jse-button-secondary-color-highlight: var(--text-main);
    --jse-button-secondary-color-disabled: var(--text-muted);
    --jse-a-color: #55abff;
    --jse-a-color-highlight: #4387c9;
    --jse-color-picker-background: #656565;
    --jse-color-picker-border-box-shadow: #8c8c8c 0 0 0 1px;
    font-size: 11px;
}

/* 内部各模式内容区占满剩余空间 */
.json-viewer :deep(.jse-navigation-bar),
.json-viewer :deep(.jse-main-contents),
.json-viewer :deep(.jse-contents-outer),
.json-viewer :deep(.jse-contents),
.json-viewer :deep(.jse-text-mode),
.json-viewer :deep(.jse-tree-mode),
.json-viewer :deep(.jse-table-mode) {
    width: 100%;
    min-width: 0;
    min-height: 0;
}

.json-viewer :deep(.jse-main-contents),
.json-viewer :deep(.jse-contents-outer),
.json-viewer :deep(.jse-contents) {
    flex: 1;
}

.json-viewer :deep([data-jsoneditor-scrollable-contents]),
.json-viewer :deep(.cm-scroller) {
    width: 100%;
    min-width: 0;
}

/* 只读查看场景下，插入热区不应吞掉大段横向空间；编辑模式保留这些热区。 */
.json-viewer--readonly :deep(.jse-insert-selection-area),
.json-viewer--readonly :deep(.jse-insert-selection-area.jse-after),
.json-viewer--readonly :deep(.jse-insert-selection-area.jse-before) {
    width: 0 !important;
    min-width: 0 !important;
    flex: 0 0 0 !important;
    overflow: hidden;
}
.json-viewer :deep(.jse-tree-mode .jse-contents) {
    border: none;
}
</style>
