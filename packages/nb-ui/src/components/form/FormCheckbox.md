---
标签: [state:inject]
---

# 表单复选框（FormCheckbox）

`FormCheckbox` 是受控复选框，可显示选中、未选中和半选状态，并支持标签与辅助描述。它可直接使用，也可放在 `FormField` 中自动取得字段 id、必填和错误语义。

## 布局与交互

根部是可点击的标签行，包含屏幕阅读器可访问的原生 checkbox、定制方形指示器和标签内容；有 `description` 时在标签下显示次行说明。禁用时整行呈不可交互状态。复选框聚焦事件向外发出；用户改变选中状态时发出布尔值更新。半选由 `indeterminate` 或模型值 `"indeterminate"` 决定，事件仍只发出布尔值。

## 数据

```ts
interface FormCheckboxProps {
    modelValue?: boolean | "indeterminate"; // 当前值；默认 false。受控，变更后由父组件回写。
    indeterminate?: boolean; // 强制半选显示；默认 false。
    label?: string; // 无默认插槽内容时的标签文本；默认 ""。
    description?: string; // 标签下的辅助说明；默认 ""。
    id?: string; // 原生 checkbox id；默认 ""，为空时使用 FormField 注入的 id。
    name?: string; // 原生表单字段名；默认 ""，为空时不设置。
    disabled?: boolean; // 禁止操作；默认 false。
    required?: boolean; // 原生必填；默认 false，并与 FormField 的 required 逻辑或。
}

interface FormCheckboxEmits {
    (event: "update:modelValue", value: boolean): void; // 原生 change 时发出；禁用时不发出。
    (event: "focus", event: FocusEvent): void; // 原生 checkbox 获得焦点时发出。
}

interface FormCheckboxSlots {
    default?(): unknown; // 自定义标签内容；提供时替代 label 文本或 true/false 回退文本。
}
```

组件不 expose 方法或属性。未声明的 attributes 按单根组件默认 fallthrough 到外层 `<label>`，不会自动作为属性转发到内部原生 checkbox。

## 状态与边界

- 默认未选中；`modelValue: true` 显示勾选，`indeterminate: true` 或 `modelValue: "indeterminate"` 显示半选横线。半选时不视为 checked。
- 未提供 `label` 且未提供默认插槽时，标签文本回退为 `true` 或 `false`，对应当前是否选中。
- `disabled` 禁止改变并阻止 change 更新事件。位于 `FormField` 内时，字段错误设置 `aria-invalid` 并应用错误样式，描述关联使用注入的 `aria-describedby`。
- 没有加载、校验或请求错误状态；组件本身不判断业务有效性。

## 隐藏通道理由

`state:inject`：通过 `useFormFieldContext` 读取最近 `FormField` 提供的 input id、必填状态、错误状态和描述关联 id，让组合字段共享标签与错误语义；未置于 `FormField` 中时这些关联为空，由组件自身 props 决定行为。
