---
标签: []
---

# FormCheckbox

一行高的布尔开关：一个复选框加一段文字，整行包在带边框的 `label` 里，点文字也能切换。用来表达「这一行就是一个开关」——表单里的布尔属性最常用。与 nb-ui 的 `Checkbox` 的区别是不接管表单字段上下文（没有字段 id、`aria-describedby`、`aria-invalid` 关联），只保留最小的一行形态。

## 数据

```ts
interface FormCheckboxProps {
    /** 选中态；必填、受控——组件不保存状态，只通过 update:modelValue 报告用户意图 */
    modelValue: boolean;
    /** 行内文字；留空时显示选中态本身的 "true" / "false" */
    label?: string; // 默认 ""
}

interface FormCheckboxEmits {
    /** 用户切换勾选态时发出新值（原生 change） */
    (event: "update:modelValue", value: boolean): void;
    /** 复选框获得焦点 */
    (event: "focus", event: FocusEvent): void;
}
```

没有 slots，没有 expose。attrs（含 `class`、`style`）按 Vue 默认透传到根 `<label>` 上。

不支持：没有 `disabled`、没有只读态、没有标签以外的说明文字，也不把值与文案之外的任何东西关联起来（无 `id`、无 `name`，不进原生表单提交）。
