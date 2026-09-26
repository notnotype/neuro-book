---
标签: []
---

# FormField

`FormField` 是一层表单语义容器，负责把标签、描述或错误文案与一个字段控件放在同一结构中，并通过 Vue provide 将生成的 id、required、invalid 和 `aria-describedby` 关系传给树内的 nb-ui 表单控件。它不持有字段值，也不替父组件执行校验或提交。

## 布局

根节点是一个 block 级 `label`，内部依次是可选字段标题、默认 slot 内容，以及错误或描述文字。标题和文案各占一行，默认间距由 `space-y-1.5` 提供；`error` 存在时替代 `description`，避免同一字段同时出现两条辅助文案。标题过长或辅助文案过长时由父级宽度决定换行，组件不设置固定宽度。

`390×844` 下布局仍是单列结构，字段控件由默认 slot 决定宽度；FormField 自身不创建横向滚动区域，也不改变 slot 内容的尺寸。

## 交互

- 点击标题或 label 区域会按原生 `<label>` 语义把焦点交给关联控件；关联 id 来自 `for` prop 或组件生成的 id。
- `required` 为 true 时标题后显示红色 `*`，并通过上下文让支持它的子控件设置原生 required 语义。
- `error` 为非空字符串时显示错误文案，生成错误 id，并让子控件收到 `aria-invalid` 与错误 `aria-describedby`；没有 error 且有 description 时使用描述 id。
- 组件本身没有键盘快捷键、提交动作或焦点事件；字段控件的键盘行为由 slot 内容负责。

## 数据

```ts
type FormFieldProps = {
    /** 字段标题；默认空字符串，空时不渲染标题。 */
    label?: string;
    /** 辅助描述；默认空字符串；有 error 时不渲染。 */
    description?: string;
    /** 错误文案；默认空字符串；非空时优先于 description。 */
    error?: string;
    /** 显式关联控件 id；默认空字符串；为空时生成 nb-field-* id。 */
    for?: string;
    /** 是否必填；默认 false。 */
    required?: boolean;
};

type FormFieldEmits = {
    /** 无 emits；组件不持有或修改字段值。 */
};

type FormFieldSlots = {
    /** 字段控件与自定义内容；slot props 是当前字段的可访问性上下文。 */
    default?: (props: {
        inputId: string;
        descriptionId: string | undefined;
        errorId: string | undefined;
        ariaDescribedby: string | undefined;
        invalid: boolean;
    }) => unknown;
};
```

组件生成的 id 形如 `nb-field-*`，只有 `for` prop 非空时才使用调用方给出的 id。组件不提供 expose API。未声明的 attrs、`class` 和 `style` 按 Vue 默认行为落到根 `label`，不应把它们当作内部控件属性透传入口。

FormField 通过 `NB_FORM_FIELD_CONTEXT_KEY` provide 下列只读计算值给后代：`inputId`、`descriptionId`、`errorId`、`ariaDescribedby`、`required` 和 `invalid`。`FormInput`、`FormNumberInput`、`FormSelect` 与 `FormCheckbox` 会可选读取这份上下文；其它默认 slot 内容不会自动获得原生属性。没有这些消费者时，provide 不产生额外副作用。

## 状态

- **默认**：按 `label`、slot 和 description 的组合渲染字段结构。
- **必填**：显示 `*`，并向支持上下文的子控件传递 required。
- **出错**：显示 error，隐藏 description，`invalid` 为 true，子控件可据此切换错误外观和 aria 属性。
- **空标签**：不渲染标题，但根 label 与上下文仍存在。
- **只读、禁用、加载中、空数据**：容器没有这些专用状态；由默认 slot 的字段控件表达。

## 不支持

- 不支持保存或校验字段值，不提供 `modelValue`、change 或 submit 事件。
- 不支持自动生成多字段布局、字段级 loading、错误列表或异步校验。
- 不支持跨组件树或跨表单共享这份上下文；上下文只对当前后代树有效。

## 组合边界

`FormField` 是表单控件与可访问性文案之间的组合边界：它只生成并提供语义关系，不规定后代控件必须是 nb-ui 组件，也不替普通 slot 内容注入原生属性。实际值、校验、提交和禁用策略仍由父组件通过 props、emits 与 slot 内容控制。
