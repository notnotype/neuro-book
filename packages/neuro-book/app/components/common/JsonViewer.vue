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
/* 外壳形状；颜色全部走配色角色，见下面 .jse-main 那一段 */
.json-viewer {
    display: flex;
    min-height: 0;
    flex-direction: column;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--bg-panel);
}

/* 自定义工具栏 */
.json-viewer__toolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    padding: 0.25rem 0.35rem;
    /* 比正文低一档：工具条是 chrome，与下面的内容区要分得开 */
    background: var(--bg-subtle);
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

/*
 * 把 jsoneditor 的主题变量接到配色角色上。
 *
 * 这一段原来是 vanilla-jsoneditor/themes/jse-theme-dark.css 的拷贝：`--jse-theme: dark` 写死，
 * 外加二十来个暗色系字面色值。它写在应用只有暗色主题的年代，那时「永远暗色」是对的。
 * 有了浅色配色之后，一半变量来自我们的浅色主题、一半是这份暗色拷贝，混出来是一块脏灰。
 *
 * `--jse-theme` 不是装饰：jsoneditor 用 JS 读它的计算值（`getPropertyValue("--jse-theme")
 * .includes("dark")`）来决定文本模式里 CodeMirror 用哪套语法配色。所以它必须跟着配色走，
 * 而不是常量——写成 var() 是可以的，自定义属性的 var() 在计算值阶段就已经代换完。
 *
 * 字号仍是字面值：改它会改变 markdown-studio 里 JSON 视图的密度，不在这次的范围内。
 */
.json-viewer :deep(.jse-main) {
    --jse-theme: var(--color-scheme, dark);
    --jse-theme-color: color-mix(in srgb, var(--bg-input) 76%, var(--accent-main) 24%);
    --jse-theme-color-highlight: color-mix(in srgb, var(--bg-hover) 70%, var(--accent-main) 30%);
    --jse-font-family: var(--font-ui);
    --jse-font-family-mono: var(--font-mono);
    --jse-font-size: 11px;
    --jse-font-size-mono: 11px;
    --jse-font-size-main-menu: 11px;
    --jse-font-size-text-mode-search: 80%;
    --jse-line-height: calc(1em + 4px);
    --jse-indent-size: calc(1em + 4px);
    --jse-padding: 8px;
    --jse-color-picker-button-size: 1em;
    /* 查看器是嵌在面板里的一块内容，取面板面而不是页面底——页面底在浅色配色下是灰的，
       摆在白面板中间就成了一块无缘无故的灰。 */
    --jse-background-color: var(--bg-panel);
    --jse-text-color: var(--text-main);
    --jse-text-color-inverse: var(--text-inverse);
    --jse-text-readonly: var(--text-muted);
    --jse-error-color: var(--status-danger);
    --jse-warning-color: var(--status-warning);
    --jse-info-color: var(--status-info);
    --jse-main-border: 1px solid var(--border-color);
    --jse-menu-color: var(--text-secondary);
    --jse-menu-button-size: 26px;
    --jse-modal-background: var(--bg-panel);
    /* --color-scheme 与 --overlay-bg 是 nb-ui 配色契约自有的两个，产品自己的主题系统还没有它们
       （见 nb-ui colorway-contract.ts 开头的对齐说明）。所以这两处必须带兜底值，
       兜底走的正是产品当前的样子：暗色 + 半透明黑遮罩。产品补齐这两个变量后兜底自然失效。 */
    --jse-overlay-background: var(--overlay-bg, rgb(0 0 0 / 0.5));
    --jse-modal-code-background: var(--bg-input);
    --jse-modal-editor-theme-color: var(--text-muted);
    --jse-modal-editor-theme-color-highlight: var(--text-secondary);
    --jse-tooltip-color: var(--text-main);
    --jse-tooltip-background: var(--bg-panel);
    --jse-tooltip-border: 1px solid var(--border-color);
    --jse-tooltip-action-button-color: inherit;
    --jse-tooltip-action-button-background: var(--bg-hover);
    --jse-panel-background: var(--bg-input);
    --jse-panel-background-border: 1px solid var(--border-color);
    --jse-panel-color: var(--text-main);
    --jse-panel-color-readonly: var(--text-muted);
    --jse-panel-border: 1px solid var(--border-color);
    --jse-panel-button-color-highlight: var(--text-main);
    --jse-panel-button-background-highlight: var(--bg-hover);
    --jse-navigation-bar-background: var(--bg-subtle);
    --jse-navigation-bar-background-highlight: var(--bg-hover);
    --jse-navigation-bar-dropdown-color: var(--text-main);
    --jse-context-menu-background: var(--bg-panel);
    --jse-context-menu-background-highlight: var(--bg-hover);
    --jse-context-menu-separator-color: var(--border-color);
    --jse-context-menu-color: var(--text-main);
    /* 这四个原本就与各自的底色取同一个值——指针块靠形状而不是颜色区分，别把它们拆开 */
    --jse-context-menu-pointer-background: var(--bg-panel);
    --jse-context-menu-pointer-background-highlight: var(--bg-hover);
    --jse-context-menu-pointer-color: var(--bg-panel);
    --jse-context-menu-pointer-color-highlight: var(--bg-hover);
    --jse-key-color: var(--accent-text);
    --jse-value-color: var(--text-main);
    /* 值的类型色走状态色四档。它们不表示状态，借的是「四个彼此拉得开、且在明暗两套配色里
       都保证过对比度」这一点——直接写四个字面色就等于再开一处颜色来源。 */
    --jse-value-color-string: var(--status-success);
    --jse-value-color-url: var(--status-success);
    --jse-value-color-number: var(--status-info);
    --jse-value-color-boolean: var(--status-warning);
    --jse-value-color-null: var(--status-danger);
    --jse-delimiter-color: var(--text-muted);
    --jse-separator-color: var(--border-color);
    --jse-edit-outline: 2px solid var(--text-main);
    --jse-contents-background-color: transparent;
    --jse-selection-background-color: var(--accent-bg);
    --jse-selection-background-inactive-color: var(--bg-hover);
    /* 悬停与当前行是「在底色上加一点前景色」，两种明暗下都成立；
       原来写死的 rgba(255,255,255,…) 只在暗底上是提亮，浅底上等于什么都没有。 */
    --jse-hover-background-color: color-mix(in srgb, var(--text-main) 5%, transparent);
    --jse-active-line-background-color: color-mix(in srgb, var(--text-main) 7%, transparent);
    --jse-search-match-background-color: var(--bg-subtle);
    --jse-collapsed-items-background-color: var(--bg-input);
    --jse-collapsed-items-selected-background-color: var(--bg-hover);
    --jse-collapsed-items-link-color: var(--text-muted);
    --jse-collapsed-items-link-color-highlight: var(--accent-main);
    /* 搜索命中是一块高亮底（上游默认就是黄色底），不是文字色，别按名字当成前景 */
    --jse-search-match-color: var(--status-warning-bg);
    --jse-search-match-outline: 1px solid var(--status-warning-border);
    --jse-search-match-active-color: color-mix(in srgb, var(--status-warning) 45%, var(--status-warning-bg));
    --jse-search-match-active-outline: 1px solid var(--status-warning);
    --jse-tag-background: var(--bg-subtle);
    --jse-tag-color: var(--text-muted);
    --jse-table-header-background: var(--bg-input);
    --jse-table-header-background-highlight: var(--bg-hover);
    --jse-table-row-odd-background: color-mix(in srgb, var(--text-main) 4%, transparent);
    --jse-input-background: var(--bg-input);
    --jse-input-border: 1px solid var(--border-color);
    --jse-button-background: var(--bg-hover);
    --jse-button-background-highlight: var(--bg-subtle);
    --jse-button-color: var(--text-main);
    --jse-button-secondary-background: color-mix(in srgb, var(--bg-input) 94%, var(--accent-main) 6%);
    --jse-button-secondary-background-highlight: color-mix(in srgb, var(--bg-hover) 88%, var(--accent-main) 12%);
    --jse-button-secondary-background-disabled: color-mix(in srgb, var(--text-main) 8%, transparent);
    --jse-button-secondary-color: var(--text-main);
    --jse-button-secondary-color-highlight: var(--text-main);
    --jse-button-secondary-color-disabled: var(--text-muted);
    --jse-a-color: var(--accent-main);
    --jse-a-color-highlight: color-mix(in srgb, var(--accent-main) 75%, var(--text-main));
    --jse-color-picker-background: var(--bg-input);
    --jse-color-picker-border-box-shadow: var(--border-color) 0 0 0 1px;
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
