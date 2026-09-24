---
标签: [state:inject]
---

# 表单文本输入框（FormInput）

`FormInput` 是受控单行输入框，支持常见文本类型、前后缀内容和显式清空操作。它可独立使用，也可从 `FormField` 自动取得字段 id、必填与错误描述关联；组件不保留输入副本。

## 布局与交互

基础形态是占满父级宽度的原生 input；`prefix`、`suffix`、图标或清空按钮任一存在时，输入框放入横向控件容器，输入主体伸缩、装饰项保持紧凑。窄屏不改变结构，输入区域可在容器内收缩。输入时发出新字符串，父级负责回写。

`clearable` 且值非空、未禁用、非只读时显示清空按钮；点击依次发出 `update:modelValue`（空字符串）和 `clear`。原生输入的键盘、焦点、只读、禁用和约束属性行为由浏览器处理。`focus` 在原生输入获得焦点时发出。

## 数据

```ts
type FormInputType = "text" | "search" | "password" | "number";
type FormInputSize = "default" | "sm" | "md";

interface FormInputProps {
    modelValue?: string; // 当前文本；默认 ""。受控，输入后由父组件回写。
    id?: string; // 原生输入 id；默认 ""，为空时使用 FormField 注入 id。
    name?: string; // 原生表单字段名；默认 ""，为空时不设置。
    type?: FormInputType; // 原生输入类型；默认 "text"。
    placeholder?: string; // 占位文本；默认 ""。
    size?: FormInputSize; // 控件尺寸；默认 "default"；"md" 与默认采用相同中尺寸样式。
    disabled?: boolean; // 禁止输入与聚焦；默认 false。
    readonly?: boolean; // 禁止修改但仍可聚焦；默认 false。
    required?: boolean; // 原生必填；默认 false，并与 FormField required 逻辑或。
    autofocus?: boolean; // 原生自动聚焦请求；默认 false。
    autocomplete?: string; // 原生 autocomplete；默认 ""，空值不设置。
    iconClass?: string; // 前置装饰图标类；默认 ""。
    clearable?: boolean; // 显示清空入口的开关；默认 false。
    inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url"; // 原生输入模式；默认 undefined。
    minlength?: number; // 原生最小字符数；默认 undefined。
    maxlength?: number; // 原生最大字符数；默认 undefined。
    step?: string; // 原生步长属性；默认 undefined。
    min?: string; // 原生最小值属性；默认 undefined。
    max?: string; // 原生最大值属性；默认 undefined。
}

interface FormInputEmits {
    (event: "update:modelValue", value: string): void; // 每次原生 input 时发出。
    (event: "focus", event: FocusEvent): void; // 原生输入获得焦点时发出。
    (event: "clear"): void; // 点击清空按钮时，在空值更新事件之后发出。
}

interface FormInputSlots {
    prefix?(): unknown; // 输入主体前的自定义内容。
    suffix?(): unknown; // 输入主体后的自定义内容。
}
```

组件不 expose 方法或属性。未声明的 attributes 按活动根节点默认 fallthrough：无装饰时落到原生 input；存在装饰时落到外层容器，不会自动转发到内部 input。输入本身的已声明属性由组件显式绑定；`class`/`style` 等额外 attrs 不保证成为输入属性。

## 状态与边界

- 空值显示 `placeholder`；`modelValue` 始终是受控显示值，组件不因输入自行修改它。
- `disabled` 禁止编辑和聚焦；`readonly` 禁止修改但保留聚焦；`required` 与父级字段必填状态取逻辑或。
- 在 `FormField` 错误上下文中，原生 input 接收 `aria-invalid`、`aria-describedby` 并应用错误样式；自身不执行业务校验。
- 不提供加载、请求错误或多行输入状态；多行内容应使用 textarea 控件。

## 隐藏通道理由

`state:inject`：读取最近 `FormField` 的 input id、描述关联、required 与 invalid 状态，以便控件和错误/说明文案自动关联；不在字段容器内时仅使用自身 props。
