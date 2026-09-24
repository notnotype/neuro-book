---
标签: []
---

# LowCodeTextField

低代码表单里的单行文本字段：把 `LowCodeFieldDto` 中一条 `text` 字段渲染成 nb-ui `FormInput`，并把用户的输入原样上报给表单宿主。它自己不存草稿——显示什么完全由 `modelValue` 决定，用户每敲一个字就发一次事件，值写不写回去、写去哪儿都由宿主决定。

与 `LowCodeTextareaField` 的差别是控件形态与禁用方式：这里是单行文本，超长不换行、不保留换行符。

## 数据

```ts
type LowCodeTextFieldProps = {
    /** 字段定义。本组件只用到 `placeholder`；`label`、`description`、`required` 由 LowCodeFieldShell 渲染，不在本组件内出现。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `""`；非字符串（`null`、数字、布尔）一律按空串显示，不做转换、不上报。 */
    modelValue?: LowCodeJsonValue;
    /** 只读。默认 `false`；为 `true` 时传给控件的 `readonly` 而非 `disabled`（见「状态」）。 */
    disabled?: boolean;
};

type LowCodeTextFieldEmits = {
    /** 用户每次输入（含每次击键）触发，携带输入框当前的字符串。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到被包装的 nb-ui `FormInput` 上，具体落点（原生输入元素还是它的包裹元素）由该控件决定。

## 状态

- 默认：按 `modelValue` 显示文本；用户输入即上报，组件不缓冲、不回写。
- 空值：`modelValue` 为 `null`、数字或布尔时显示为空串；用户清空输入框会上报 `""`。
- 禁用：传 `readonly`——控件仍可聚焦、可选中并复制文本、可被 Tab 走到，但不能编辑；`readonly` 不带视觉变化（见「已知偏差」）。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 已知偏差

- 「禁用」用的是 `readonly` 而不是 `disabled`：值确实改不动，但没有禁用态的视觉差异，控件也仍可聚焦、可被 Tab 走到、可复制文本。要按「禁用」验收（不可聚焦、变淡）需先改实现。
- 组件不设置可访问名称：字段标题由 `LowCodeFieldShell` 渲染且未与控件建立 `for`/`id` 关联，输入框自己也没有 `aria-label`，因此读屏软件读不出这个字段叫什么。
