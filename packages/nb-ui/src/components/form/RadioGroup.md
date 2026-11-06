---
标签: [state:local]
---

# RadioGroup

`RadioGroup` 用单选项组表达一组选一的互斥选择，可直接传入选项数据，也可通过默认插槽组合自定义内容。它同时支持描述文本、逐项禁用、方向、尺寸以及原生表单 `name`，适合需要比简单单选按钮更多呈现信息的表单。

`RadioGroup` 在表单里选一个值，跟别的字段一起提交；选项带说明或要竖排时用它。切换界面上的模式、表单里三项以内且都没有说明的单选用 `SegmentedControl`；其余见[同类零件的分工](../../../docs/ui-development-spec.md#42-同类零件的分工)。

## 布局与交互

默认纵向排列，选项之间留固定间距；`orientation="horizontal"` 时横向排列并允许换行。每项为单选圆钮和文字内容，描述可选；圆钮 `md` 为 20px、`sm` 为 16px，文字与描述随尺寸变小。

圆钮外观：未选中是淡底加细边框，悬停时边框转为 `--accent-main`。选中是 `--accent-main` 实底，中间一个 `--text-inverse` 小圆点；焦点边框取 `--focus-outline`。按下时圆钮缩小到 0.92；只读和禁用时不缩。窄屏横向项会自然换行，无不同的结构断点。

点击可用选项会选中该项并发出 `update:modelValue`。组级 `disabled` 禁用整组；`RadioOption.disabled` 禁用单项。方向键导航、焦点与单选语义由 Reka UI RadioGroup 提供；具体按键行为不由本组件另行定义。

放在 `Field` 的组形态（`group`）里时，组根读字段上下文：`id` 是 `inputId`，`aria-labelledby` 指向字段标签（`labelId`），`aria-describedby` 指向说明与错误，出错时写 `aria-invalid`，字段的 `required` 并入组的必填。`Field` 的普通形态根是 `<label>`，里面放一组单选读屏读不出组名，所以单选组要用组形态（docs/specs/ui/forms.md 输出 27）。

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
    invalid?: boolean;  // 出错：组上写 aria-invalid，圆钮描红；默认 false，与 Field 上下文的出错取或。
    readonly?: boolean; // 只读：可以聚焦当前项、写 aria-readonly，点击与方向键不改选中；默认 false。
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
- **只读**（`readonly`）：组上写 `aria-readonly`；当前项可以聚焦，点击与方向键都不改选中（方向键仍在选项间移动焦点）；光标与悬停描边、按下缩放都不出现。
- **出错**（`invalid` 或 Field 的出错）：组上写 `aria-invalid`，各圆钮描红。
- **没给 `modelValue`**：值记在组件里，初值是 `defaultValue`；只读与可编辑之间切换后照常选中。
- 加载、空数据：没有单独状态；空选项且无插槽时渲染空组。

## 上游边界

组根节点、单选语义、键盘导航、焦点管理和原生表单集成基于 Reka UI RadioGroup。本组件承诺选项数据映射、外观、方向与 props/emits；上游未显式通过 props 暴露的键盘及 DOM 细节不属于稳定承诺。
