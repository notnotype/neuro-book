---
标签: []
---

# LowCodeNumberField

低代码表单里的数字字段：把 `LowCodeFieldDto` 中一条 `number` 字段渲染成 nb-ui `FormInput` 的 `type="number"` 形态，并把用户输入解析成 JSON 数字上报。它与 `LowCodeTextField` 的差别是值不是字符串——空、半成品或解析不出有限数字的输入统一上报 `null`，由服务端 schema 决定合不合法；`field.integer` 为真时先截断成整数再上报。

## 数据

```ts
type LowCodeNumberFieldProps = {
    /** 字段定义。本组件用到 `integer`、`step`、`min`、`max`、`placeholder`；`label`、`description`、`required` 由 LowCodeFieldShell 渲染。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `null`；只有有限数字会被显示，`null`、字符串、布尔一律显示为空。 */
    modelValue?: LowCodeJsonValue;
    /** 只读。默认 `false`；为 `true` 时传给控件的 `readonly` 而非 `disabled`（见「已知偏差」）。 */
    disabled?: boolean;
};

type LowCodeNumberFieldEmits = {
    /** 每次输入触发。去空白后为空串、或解析结果不是有限数字时携带 `null`；`field.integer` 为真时先 `Math.trunc` 再上报。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到被包装的 nb-ui `FormInput` 上，具体落点（原生输入元素还是它的包裹元素）由该控件决定。

## 状态

- 默认：把有限数字转成文本显示；用户输入即解析并上报，组件不缓冲、不回写。
- 空值：`modelValue` 不是有限数字时显示为空；用户清空输入后上报 `null`。
- 禁用：传 `readonly`，控件仍可聚焦、可选中并复制文本，但不能编辑（见「已知偏差」）。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 注意事项

- `step`、`min`、`max` 会一并作为原生数字输入的约束交给浏览器（影响步进箭头与原生校验），本组件自己不校验范围，也不拒绝越界值。
- 组件不设置可访问名称：字段标题由 `LowCodeFieldShell` 渲染且未与控件建立 `for`/`id` 关联，输入框自己也没有 `aria-label`，因此读屏软件读不出这个字段叫什么。

## 已知偏差

- 「禁用」用的是 `readonly` 而不是 `disabled`：值确实改不动，但没有禁用态的视觉差异，控件也仍可聚焦、可被 Tab 走到、可复制文本。要按「禁用」验收（不可聚焦、变淡）需先改实现。
- 负号、小数点、`e` 这类还构不成数字的中间输入会被判为 `null` 上报；此时浏览器数字输入框是保留用户可见的中间文本还是清空，未实测，需要连续输入负数的场景先实测再依赖。
