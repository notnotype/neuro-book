---
标签: [state:local, state:inject, env:global]
---

# Combobox

`Combobox` 是可搜索的单选下拉框：既显示选中项标签，也允许输入自由文本来过滤候选；输入和选择均通过一个字符串或 `null` 的模型事件交给父组件。与原生下拉不同，它使用自绘列表、键盘高亮和表单字段上下文。

## 布局

触发器由输入框和展开箭头组成，默认宽度随父容器。候选列表贴在触发器下方，最大高度 224px 并在列表内部滚动；仅当浮层打开且过滤后仍有选项时渲染。尺寸 `default` 高 36px，`sm` 高 28px。字段提供方可补充输入 id、必填、错误和描述关联。

## 交互

- 聚焦或点击输入框打开列表并将高亮同步到当前选中项。箭头按钮切换列表展开状态。
- 输入文本发出 `update:modelValue`（空字符串转为 `null`），并打开列表；候选按 label 或 value 的不区分大小写包含关系过滤。若当前 value 对应选项，输入框显示该选项 label，否则显示原 value。
- 上下方向键循环移动到可用项，Home/End 移至首尾；Enter 选中当前高亮项并关闭列表。Escape 关闭列表并阻止事件继续传播，避免同一按键关闭外层对话框。
- 点击候选项选择其 value 并关闭列表；点击组件外部关闭列表。
- `disabled` 时不能打开、输入或选择。方向键通过 `moveHighlight` 跳过禁用项，但初次同步和鼠标悬停仍可能把禁用项设为当前高亮；Enter 最终会被选项禁用检查拦下。

## 数据

```ts
type ComboboxSize = "default" | "sm";

type FormSelectOption = {
    label: string;
    value: string;
    /** 次行说明文字；本组件不呈现。 */
    description?: string;
    iconClass?: string;
    /** 状态色圆点类；与 iconClass 互斥，indicator 优先。 */
    indicatorClass?: string;
    disabled?: boolean;
};

interface ComboboxProps {
    /** 当前搜索文本或选中值；受控，默认 null。 */
    modelValue?: string | null;
    /** 候选项；必填，支持字符串简写或 FormSelectOption 对象。 */
    options: (string | FormSelectOption)[];
    /** 输入 id；默认空字符串，未指定时可用 FormField 提供的 id。 */
    id?: string;
    /** 原生输入 name；默认空字符串。 */
    name?: string;
    /** 空值时的 placeholder；默认空字符串。 */
    placeholder?: string;
    /** 禁用控件；默认 false。 */
    disabled?: boolean;
    /** 是否必填；默认 false，可叠加 FormField 上下文。 */
    required?: boolean;
    /** 控件尺寸；默认 "default"。 */
    size?: ComboboxSize;
}

interface ComboboxEmits {
    /** 输入或选项选择导致值变化；父组件应更新 modelValue。 */
    (event: "update:modelValue", value: string | null): void;
}

interface ComboboxSlots {}
```

`options` 使用 `FormSelectOption` 类型：字段定义见上方导入类型及同目录 `FormSelect.vue`。组件没有 expose API 或 slot。未声明 attrs 按 Vue 默认行为继承到根 `div`，不会自动落到输入框。

## 状态与边界

- 默认值 `null`、选项必填、启用、标准尺寸。
- 无匹配候选时隐藏列表，没有空状态提示。组件不显示加载或错误提示。
- 禁用项不会被方向键移动逻辑选中；初始同步或鼠标悬停仍可能显示为高亮，但 Enter 选择会被阻止。
- 当 `FormField` 提供上下文时读取字段 id、required、invalid、aria 描述关系并应用错误样式；脱离字段上下文时只使用自身 props，不报错。

## 不支持

- 不发起搜索请求、不做异步加载、不提供空结果 slot 或清除按钮。
- 不提供选项分组、自定义渲染、加载或空结果 slot；选项只消费 `label`、`value` 和 `disabled`，`description`、`iconClass`、`indicatorClass` 不呈现。

## 上游边界

组件使用 VueUse `onClickOutside` 处理外部点击；其余搜索过滤、列表、键盘导航和 ARIA 关系由本组件实现，没有封装第三方 Combobox 原语。`FormField` 注入契约来自同目录 `form-field-context.ts`。

## 隐藏通道理由

`state:inject`：读取可选的 `NB_FORM_FIELD_CONTEXT_KEY`，以复用父级 FormField 提供的输入 id、必填、错误和描述关系。字段内嵌控件不应要求父组件把这组仅在 FormField 中已知的关联数据逐项重复传入；脱离 FormField 时回退到本组件 props。

`env:global`：VueUse `onClickOutside` 在组件挂载期间监听组件外部指针事件，以关闭自绘列表；监听生命周期由 VueUse 绑定组件作用域并在卸载时清理。该交互属于自绘浮层的关闭规则。
