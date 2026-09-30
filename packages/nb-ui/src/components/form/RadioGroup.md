---
标签: [state:local]
---

# RadioGroup

`RadioGroup` 用单选项组表达一组选一的互斥选择，可直接传入选项数据，也可通过默认插槽组合自定义内容。它同时支持描述文本、逐项禁用、方向、尺寸以及原生表单 `name`，适合需要比简单单选按钮更多呈现信息的表单。

## 布局与交互

默认纵向排列，选项之间留固定间距；`orientation="horizontal"` 时横向排列并允许换行。每项为单选圆钮和文字内容，描述可选；小尺寸缩小标记与文字。窄屏横向项会自然换行，无不同的结构断点。

点击可用选项会选中该项并发出 `update:modelValue`。组级 `disabled` 禁用整组；`RadioOption.disabled` 禁用单项。方向键导航、焦点与单选语义由 Reka UI RadioGroup 提供；具体按键行为不由本组件另行定义。

## 数据

```ts
interface RadioOption {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

type RadioGroupSize = "sm" | "md";

interface RadioGroupProps {
    modelValue?: string; // 当前值；默认 undefined。提供时受控，更新后由父组件回写。
    defaultValue?: string; // 非受控初值；默认 undefined。
    name?: string; // 原生表单字段名；默认 undefined。
    disabled?: boolean; // 禁用整组；默认 false。
    required?: boolean; // 原生必填语义；默认 false。
    orientation?: "horizontal" | "vertical"; // 排列方向；默认 "vertical"。
    size?: RadioGroupSize; // 圆钮及文字大小；默认 "md"。
    options?: RadioOption[]; // 数据选项；默认 []。非空时优先于默认插槽。
}

interface RadioGroupEmits {
    (event: "update:modelValue", value: string): void; // 选中值变化时发出；上游空值被归一化为 ""。
}

interface RadioGroupSlots {
    default?: () => unknown; // options 为空时渲染；本组件不向插槽传参。
}
```

当 `options` 非空时默认插槽内容不渲染；插槽模式下内容由调用方提供并处于 Reka UI RadioGroup 根节点内。组件不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。

## 状态

- 默认：未传值时由 Reka UI 依据 `defaultValue` 初始化；未提供初值则没有选中项。
- 已选：选项呈选中态；有 `modelValue` 时始终以父级值为准。
- 禁用：组级或单项禁用会阻止对应项交互并降低视觉强调。
- 只读、加载、出错、空数据：没有单独状态；空选项且无插槽时渲染空组。

## 上游边界

组根节点、单选语义、键盘导航、焦点管理和原生表单集成基于 Reka UI RadioGroup。本组件承诺选项数据映射、外观、方向与 props/emits；上游未显式通过 props 暴露的键盘及 DOM 细节不属于稳定承诺。
