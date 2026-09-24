---
标签: [state:local]
验证入口: PlotThreadDetailPanel
---

# StructuredTextEditor

`StructuredTextEditor` 是 Markdown 表单编辑器：同一段 Markdown 可在带格式工具栏的富文本视图和源码视图之间切换，并把编辑结果通过受控模型交给宿主。它比普通多行文本框多了 Markdown 格式操作、模式切换和按内容或行数约束高度；并不负责保存文档。

本组件由 [PlotThreadDetailPanel](../../novel-ide/plot/thread-panel/PlotThreadDetailPanel.vue) 直接使用，编辑 thread / scene 的摘要、目的和写作提示。它是当前集成验证入口之一；`PlotThreadEditorDialog` 也有直接调用。Component Lab 当前没有这些宿主的场景，因此本文档不为编辑器伪造独立 fixture 或宿主。

## 布局

外层为带边框的编辑器面板，`borderless` 时去掉边框并交由外部结构接管。可见工具栏包含富文本格式按钮和富文本 / 源码模式切换；`showToolbar` 关闭时两组都不显示，`showFormatToolbar` 只控制格式按钮。窄到工具栏容不下完整按钮组时，组件根据自身宽度收起低优先级格式按钮；模式按钮仍保留。

正文区最小高度由 `minHeight` 或 `minRows` / `rows` 推导，最大高度由 `maxHeight` 或 `maxRows` / `rows` 推导。默认不自动增高；`autoHeight` 时按 `modelValue` 的行数估高并受最小、最大高度约束。工具栏显示、可编辑且非自动高度时，可通过垂直 resize 改变正文区高度。超出高度时由编辑器内部处理滚动；390×844 窄屏下工具按钮密度先收缩，正文仍在自身高度内显示。

## 交互

- 点击模式按钮切换富文本与源码编辑器，并发出 `update:mode`。`mode` 为 `null` 时由组件持有当前模式；传入非空 `mode` 时由父组件控制，必须回传更新后的值才会切换。
- 富文本模式提供标题、粗体、斜体、下划线、删除线、行内代码、列表、引用、清除格式和添加评论等工具；`readonly` 时格式操作不可用。源码模式使用 Markdown 文本编辑器，不显示富文本格式按钮。
- 编辑内容变化时发出 `update:modelValue`；宿主应将新值写回。`submit`、`shift-tab`、`focus`、`blur` 与 `save-request` 转发当前子编辑器对应事件，不自行保存或移动焦点。
- 通过组件实例 `focus()` 可聚焦当前模式的编辑器；`insertText(text)` 在当前光标插入 Markdown；`getMarkdown()` 读取当前编辑器内容。

## 数据

```ts
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";
import type {MarkdownEditorPreferences, MonacoEditorPreferences} from "nbook/shared/editor-workbench";

type StructuredTextMode = "rich" | "source";
type StructuredTextSize = "sm" | "md";
type PopoverDirection = "auto" | "up" | "down";

interface StructuredTextEditorProps {
    /** Markdown 内容；必填、受控，默认无默认值。 */
    modelValue: string;
    /** 行数基准；默认 5。 */
    rows?: number;
    /** 密度尺寸；默认 "sm"。 */
    size?: StructuredTextSize;
    /** 空内容提示；默认空字符串。 */
    placeholder?: string;
    /** 正文最小高度 px；默认由 size 与 minRows ?? rows 推导。 */
    minHeight?: number;
    /** 正文最大高度 px；默认由 size 与 maxRows ?? rows 推导。 */
    maxHeight?: number;
    /** 最小行数覆盖 rows；默认未设置。 */
    minRows?: number;
    /** 最大行数；默认未设置。 */
    maxRows?: number;
    /** 是否按 modelValue 行数自动增高；默认 false。 */
    autoHeight?: boolean;
    /** 受控模式；默认 null，null 表示组件使用 defaultMode 和内部状态。 */
    mode?: StructuredTextMode | null;
    /** 内部模式初值；默认 "rich"，仅在 mode 为 null 时生效。 */
    defaultMode?: StructuredTextMode;
    /** 是否显示模式工具栏；默认 true。 */
    showToolbar?: boolean;
    /** 是否显示富文本格式工具组；默认 true。 */
    showFormatToolbar?: boolean;
    /** 是否允许垂直调整正文高度；默认 true，需同时满足工具栏显示、可编辑且非 autoHeight。 */
    resizable?: boolean;
    /** 引用菜单方向；默认 "auto"。 */
    popoverDirection?: PopoverDirection;
    /** 是否允许提交键；默认 false。 */
    submitOnEnter?: boolean;
    /** 是否启用快速触发菜单；默认 false。 */
    enableQuickTriggers?: boolean;
    /** 是否令引用菜单宽度匹配锚点；默认 false。 */
    matchPopoverWidth?: boolean;
    /** 菜单数据刷新键；默认空字符串；referenceRefreshKey 未给时也作为子编辑器刷新键。 */
    menuRefreshKey?: string | number;
    /** 解析快速触发菜单；默认返回空菜单。 */
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 技能触发开始回调；默认空函数。 */
    onSkillTriggerStart?: () => void;
    /** 只读；默认 false。 */
    readonly?: boolean;
    /** 当前文档路径；默认空字符串。 */
    activePath?: string;
    /** 引用节点刷新键；默认未设置，回退到 menuRefreshKey。 */
    referenceRefreshKey?: string | number;
    /** 打开工作区引用的宿主回调；默认空函数。 */
    openReference?: (target: string) => void;
    /** 解析工作区引用；默认未设置。 */
    resolveReference?: WorkspaceReferenceResolver;
    /** 富文本显示偏好；默认克隆 DEFAULT_MARKDOWN_EDITOR_PREFERENCES。 */
    editorPreferences?: MarkdownEditorPreferences;
    /** 源码显示偏好；默认克隆 DEFAULT_MONACO_EDITOR_PREFERENCES。 */
    monacoPreferences?: MonacoEditorPreferences;
    /** 源码编辑器临时字号；默认 null。 */
    monacoTemporaryFontSize?: number | null;
    /** 无边框模式；默认 false。 */
    borderless?: boolean;
}

interface StructuredTextEditorEmits {
    /** 编辑器正文变更时发出完整 Markdown 字符串，宿主负责回写。 */
    (event: "update:modelValue", value: string): void;
    /** 用户请求模式切换时发出目标模式。 */
    (event: "update:mode", value: StructuredTextMode): void;
    /** 子编辑器触发提交时转发；payload 可能省略。 */
    (event: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    /** 子编辑器 Shift+Tab 请求。 */
    (event: "shift-tab"): void;
    /** 当前编辑器获得焦点。 */
    (event: "focus"): void;
    /** 当前编辑器失去焦点。 */
    (event: "blur"): void;
    /** 子编辑器请求宿主保存。 */
    (event: "save-request"): void;
}

interface StructuredTextEditorExpose {
    /** 聚焦当前模式的编辑器。 */
    focus(): void;
    /** 在当前光标插入 Markdown 文本。 */
    insertText(text: string): void;
    /** 读取当前模式中的 Markdown。 */
    getMarkdown(): string;
}
```

没有 slots。未声明的 attrs（包括 `class`、`style`）按单根组件默认行为落到外层编辑器元素。组件暴露上列三个方法；底层编辑器的其它句柄不向外暴露。

## 状态与边界

- 默认：富文本模式、工具栏可见、可编辑，正文高度由 rows 推导；值由父组件持有。
- 只读：格式工具不可用，正文不可编辑；模式按钮仍存在。
- 工具栏关闭：模式切换和格式工具均隐藏，正文编辑器仍显示。
- 空值：正文显示 placeholder；组件不产生单独空态。
- 编辑内容变化由子编辑器发出后转为 `update:modelValue`；父组件若不回写，后续模式切换时仍以原 prop 为宿主快照。
- 组件本身没有加载 / 错误 UI；子编辑器初始化失败按其上游行为处理。

## 不支持

- 不读取、保存或持久化文档，不调用业务请求；`save-request` 只是交给宿主的意图事件。
- 不提供评论内容编辑之外的文档会话、冲突裁决或跨视图同步；不承诺完整 Monaco / TipTap 编辑器能力。
- 没有插槽，不支持替换工具栏或正文布局。

## 上游边界

本包装器负责双模式切换、外层工具栏与高度约束、上述 props / emits / expose 契约。富文本正文、Markdown 序列化、快速触发菜单、源码编辑器、主题、对话框与通知行为来自 `TipTapMarkdownEditor` / `MonacoCodeEditor` 及其依赖；本组件只转发明确列出的事件，不承诺子编辑器未声明的行为，升级内核时需检查其各自合同。

## 已知集成入口

`PlotThreadDetailPanel.vue` 直接使用本组件编辑摘要、目的和写作提示；`PlotThreadEditorDialog.vue` 也直接使用。本文将前者登记为导航入口。Component Lab 当前没有 `PlotThreadDetailPanel` 的集成场景，因此不可独立挂载，也不在 Lab fixture registry 中登记虚构场景。

## 隐藏通道理由

`state:local`：本组件本身只持有模式选择、工具栏密度和根元素尺寸观察结果；组件卸载后这些临时状态消失。TipTap / Monaco 子编辑器各自持有的服务依赖与环境行为属于上游组件通道，不在这里重复声明。
