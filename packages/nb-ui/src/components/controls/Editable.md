---
标签: [state:local]
---

# Editable

`Editable` 把一段文本以预览态展示，并在需要时就地切换为单行编辑。它适合标题、名称等短文本的轻量修改；相比始终显示输入框，它把编辑控件和保存/取消动作收在同一个组件里，并支持受控值与非受控初值。

## 布局

根节点是水平 inline-flex，预览或输入区与操作按钮间距为 6px。`sm`、`md`、`lg` 分别使用 12px、14px、16px 文字；预览文字单行截断，输入框最小宽度 80px。编辑态显示输入区以及 24×24px 的保存、取消按钮；预览态可选显示 24×24px 的编辑按钮。组件不固定整体宽度，父级负责给长文本提供空间。

在 `390×844` 窄屏中组件仍保持单行，预览可截断；父级应允许它收缩，避免与同排内容争抢宽度。

## 交互

- 可编辑且未处于编辑态时，`showEditTrigger` 为真显示铅笔按钮；激活编辑后显示保存与取消按钮。
- 保存发出 `submit`，取消发出 `cancel`；值变化通过 `update:modelValue` 上报。具体编辑入口、键盘提交/取消键和焦点归还由 Reka Editable 原语负责，不作为额外的键盘合同。
- `disabled` 或 `readonly` 时不显示组件提供的编辑/保存/取消按钮；`readonly` 不允许编辑，`disabled` 同时禁用上游编辑原语。
- 组件不在挂载或卸载时主动移动焦点。编辑过程中焦点由上游输入与触发器管理。

## 数据

```ts
export type EditableSize = "sm" | "md" | "lg";

type EditableProps = {
    /** 当前文本；传入时受控，省略时使用 defaultValue；默认 undefined */
    modelValue?: string;
    /** 非受控初值；默认空字符串 */
    defaultValue?: string;
    /** 空值时显示的提示；默认 "点击编辑..." */
    placeholder?: string;
    /** 禁用编辑；默认 false */
    disabled?: boolean;
    /** 只读；默认 false */
    readonly?: boolean;
    /** 是否由上游输入自动调整尺寸；默认 false */
    autoResize?: boolean;
    /** 文字尺寸；默认 "md" */
    size?: EditableSize;
    /** 是否显示预览态铅笔按钮；默认 true；不等同于 readonly */
    showEditTrigger?: boolean;
};

type EditableEmits = {
    /** 编辑中的文本变化时发出；受控使用时父组件决定最终值 */
    (event: "update:modelValue", value: string): void;
    /** 确认提交时发出最终文本 */
    (event: "submit", value: string): void;
    /** 取消当前编辑时发出；不携带值 */
    (event: "cancel"): void;
};

type EditableSlots = {};
```

没有 `expose` API，也没有 slot。组件以 `EditableRoot` 为唯一根组件，未声明的 attribute、`class` 与 `style` 按 Vue 默认规则传给该根组件；最终 DOM attribute 落点由 Reka 决定。

`state:local` 来自未传 `modelValue` 时由上游根据 `defaultValue` 管理的文本，以及编辑中/预览态切换状态；传入 `modelValue` 时文本归父组件持有。

## 状态

- 默认：展示当前文本；空文本时使用 `placeholder`。
- 编辑：上游显示输入控件，且值变化会发出 `update:modelValue`。
- 禁用/只读：隐藏组件提供的编辑操作；没有加载、错误或空数据专属状态。
- 空值：显示 placeholder，不自动生成默认文案之外的内容。

## 不支持

- 不支持多行编辑、格式化、校验或异步保存；这些职责由父组件承担。
- `showEditTrigger=false` 只隐藏铅笔按钮，不等同于 `readonly`，也不构成禁止编辑的保证。
- 不支持额外的确认对话框或自动持久化。

## 上游边界

Reka UI 的 Editable 原语管理预览/输入切换、非受控值、输入自动调整、提交与取消生命周期。本组件承诺将值变化和提交/取消映射到所声明的 emits，并提供尺寸、按钮和样式；其它编辑键盘行为、内部 DOM 结构与焦点细节来自上游，不属于稳定合同。
