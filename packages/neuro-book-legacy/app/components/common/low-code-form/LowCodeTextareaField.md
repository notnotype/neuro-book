---
标签: []
---

# LowCodeTextareaField

低代码表单里的多行文本字段：把 `LowCodeFieldDto` 中一条 `textarea` 字段渲染成 nb-ui `FormTextarea`，并把用户的输入原样上报。与 `LowCodeTextField` 的差别是多行、可纵向拖拽改高，并且是按 `disabled` 真禁用（不是只读）。

## 数据

```ts
type LowCodeTextareaFieldProps = {
    /** 字段定义。本组件只用到 `placeholder` 与 `rows`；`label`、`description`、`required` 由 LowCodeFieldShell 渲染。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `""`；非字符串（`null`、数字、布尔）一律按空串显示，不做转换、不上报。 */
    modelValue?: LowCodeJsonValue;
    /** 是否禁用。默认 `false`；为 `true` 时控件真禁用：不可聚焦、不可编辑、外观变淡。 */
    disabled?: boolean;
};

type LowCodeTextareaFieldEmits = {
    /** 用户每次输入（含每次击键、含换行与粘贴）触发，携带文本域当前的字符串。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到被包装的 nb-ui `FormTextarea` 上，最终落在原生文本域元素。

## 状态

- 默认：按 `modelValue` 显示文本；用户输入即上报，组件不缓冲、不回写。
- 空值：`modelValue` 非字符串时显示为空串；用户清空后上报 `""`。
- 禁用：控件真禁用，不可聚焦、不可编辑，外观变淡。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 注意事项

- `field.rows` 只决定初始行数（未提供时为 3 行），是文本域的初始高度而不是高度上限：控件可纵向拖拽改高，内容与长度都不由本组件限制。
- 组件不设置可访问名称：字段标题由 `LowCodeFieldShell` 渲染且未与控件建立 `for`/`id` 关联，文本域自己也没有 `aria-label`，因此读屏软件读不出这个字段叫什么。
