---
标签: [state:inject]
---

# 数字输入框（FormNumberInput）

`FormNumberInput` 是受控数字文本字段，使用自定义上下步进按钮而非浏览器原生 spinner。它将值保留为字符串，允许用户编辑空串、负号或小数点等中间态；仅通过步进操作才应用步长与上下界。

## 布局与交互

控件占满可用宽度，左侧为文本输入，右侧为上下步进按钮。窄屏时输入主体收缩，按钮尺寸固定。输入原样发出字符串更新；点击步进按钮或在输入框按 `ArrowUp` / `ArrowDown` 时按 `step` 增减并将结果限制到有效的 `min` / `max` 边界。`Enter` 阻止浏览器默认提交并发出 `submit`。

步进采用正数 `step`；空、非法或非正值退回 `1`。当前输入无法解析时，上步以有效 `min` 或 `0` 为基值，下步以有效 `max` 或 `0` 为基值。步进输出的小数位数按 `step` 的小数位数格式化。按钮不参与 Tab 顺序，键盘步进通过输入框操作。

## 数据

```ts
type NumberInputSize = "default" | "sm";

interface FormNumberInputProps {
    modelValue?: string; // 当前数字文本；默认 ""。受控，输入/步进后由父组件回写。
    id?: string; // 原生输入 id；默认 ""，为空时使用 FormField 注入 id。
    name?: string; // 原生表单字段名；默认 ""，为空时不设置。
    placeholder?: string; // 占位文本；默认 ""。
    disabled?: boolean; // 禁止编辑；默认 false。
    readonly?: boolean; // 禁止修改；默认 false。
    required?: boolean; // 原生必填；默认 false，并与 FormField required 逻辑或。
    autofocus?: boolean; // 原生自动聚焦请求；默认 false。
    min?: string; // 步进使用的下界；默认 undefined。
    max?: string; // 步进使用的上界；默认 undefined。
    step?: string; // 步进量；默认 "1"，无效或非正数时按 1 处理。
    size?: NumberInputSize; // 控件尺寸；默认 "default"。
    title?: string; // 外层控件 title；默认 undefined。
}

interface FormNumberInputEmits {
    (event: "submit"): void; // 输入框按 Enter 时发出，且阻止原生默认提交。
    (event: "update:modelValue", value: string): void; // 原生输入或步进时发出。
}

interface FormNumberInputSlots {} // 不提供插槽。
```

组件不 expose 方法或属性。未声明 attributes 按单根组件默认 fallthrough 到外层 `<div>`，不会转发到内部 `<input>`；控件的字段 id、name、禁用和必填等由 props 显式绑定。

## 状态与边界

- 初始值为空字符串；空、负号、小数点等手工输入中间态不解析、不钳制，父级收到的仍是原始字符串。
- `min`、`max` 只参与按钮和方向键步进的钳制，不是原生约束校验属性；组件不会自动修复越界的手工输入。
- `disabled` 或 `readonly` 阻止步进，原生 input 分别不可用或只读；`Enter` 事件由输入框 keydown 处理器发出。
- 在 `FormField` 错误上下文中接入描述关联、无效标记和错误样式；不提供加载、网络错误或独立校验状态。

## 隐藏通道理由

`state:inject`：读取 `FormField` 提供的 input id、描述关联、required 与 invalid 状态，自动关联字段标签及错误文案；未处于 `FormField` 内时这些上下文值为空。
