---
标签: [state:local, state:inject, env:portal]
---

# Autocomplete

`Autocomplete` 是带候选列表的文本输入框，父组件提供候选与当前值，用户可键入查询并选择候选。它保留自由文本模型值，同时在选择候选时单独发出完整选项对象，适合需要候选辅助但仍由调用方解释输入的场景。

## 布局

输入框占满可用宽度，候选面板通过 Portal 定位在输入框附近，宽度至少 220px，最大高度 240px 并在内部滚动。组件按传入顺序渲染 `options`，不会在此处按输入文本过滤。每条选项显示主标签（没有标签时显示 value）、可选图标和次级说明；禁用项不可选。无匹配时显示固定的“无匹配联想结果”提示。尺寸 `sm`、`md`、`lg` 分别使用紧凑、标准和宽松控件高度。

## 交互

- 输入组件内的值变化会发出 `update:modelValue`；外部更新 `modelValue` 不因此发出事件。候选项始终由父组件提供，本组件不做筛选。
- 用户选择时发出 `select(option)` 并更新模型值为该项的 `value`；两个事件的先后顺序不属于稳定合同。
- 禁用时输入不可交互。候选的键盘导航、焦点行为和选择策略交由 Reka UI。

## 数据

```ts
interface AutocompleteOption {
    /** 候选值；必填，也是选择后写入模型的值。 */
    value: string;
    /** 显示标签；省略或空字符串时界面显示 value。 */
    label?: string;
    /** 可选的次行说明。 */
    description?: string;
    /** 可选图标类；按图标类名渲染并设为装饰内容。 */
    iconClass?: string;
    /** 是否禁用该候选；默认 false；字段缺省时 Vue 不传 disabled。 */
    disabled?: boolean;
}

interface AutocompleteProps {
    /** 当前值；传入时受控，默认 undefined。 */
    modelValue?: string;
    /** 非受控初始值；默认空字符串。 */
    defaultValue?: string;
    /** 候选项；默认空数组。由父组件提供，本组件不按输入过滤。 */
    options?: AutocompleteOption[];
    /** 输入占位文字；默认 "输入关键词搜索联想..."。 */
    placeholder?: string;
    /** 禁用输入与选择；默认 false。 */
    disabled?: boolean;
    /** 控件尺寸；默认 "md"。 */
    size?: "sm" | "md" | "lg";
}

interface AutocompleteEmits {
    /** 输入组件内的值变化时发出。 */
    (event: "update:modelValue", value: string): void;
    /** 用户选择候选项时发出原始对象；与 update:modelValue 的相对顺序不属于合同。 */
    (event: "select", option: AutocompleteOption): void;
}

interface AutocompleteSlots {}
```

组件不 expose API。未声明 attrs 按 Vue 默认行为继承到首个根节点（AutocompleteRoot）；不要依赖它们透传到输入框或 Portal 面板。

## 状态与边界

- 默认值为空字符串、候选列表为空、控件启用。
- 禁用时输入和选项不可操作。无候选时上游提供空结果提示；组件不提供加载态或错误态。
- 组件不发起搜索请求。调用方决定何时、如何更新候选。

## 不支持

- 不提供 clear 按钮、自由输入校验、请求去抖或结果加载状态。
- 不提供选项分组、自定义选项/空状态 slot 或面板 class。

## 上游边界

Reka UI Autocomplete 提供输入、活动选项、键盘交互、选择和 Portal 生命周期。本组件将固定 `options` 渲染为候选，并把选中对象作为 `select` 事件透出；过滤算法、精确的键盘/焦点语义和未声明行为由 Reka UI 决定，升级可能变化。

## 隐藏通道理由

`env:inject`：组件读取可选的 `NB_POPOVER_Z_INDEX` 注入值，以便位于 `DialogWindow` 内容树时将候选面板放在窗口本体上方；未提供时使用公共页面浮层层级。该层级由窗口宿主掌握，父组件没有理由为每个表单字段重复传入。

`env:portal`：候选列表使用 Reka Autocomplete Portal，避免受字段祖先裁剪。Portal 目标由上游管理；目标不可用时的具体行为遵循 Reka UI。
