---
标签: [state:local]
---

# Slider

`Slider` 是单值或多值滑动控件，适合在连续范围或离散步进范围内调节数值。它可用多个滑块表示数值区间，并分别通知拖动过程中的值变化与一次手势的提交值。

## 布局与交互

水平模式占满宽度且至少 80px；垂直模式占满父级高度、至少 100px。轨道厚度和滑块直径由 `size` 控制。轨道中的强调色范围和每个数值滑块共同组成控件。窄屏保持所选方向，不自动转换方向。

鼠标/触摸拖动或键盘调整滑块时发出 `update:modelValue`；上游确认一次值提交时发出 `valueCommit`。多值模式渲染一个滑块/拇指对应一个数值。焦点、方向键步进、边界处理和触屏手势由 Reka UI Slider 提供。

## 数据

```ts
type SliderSize = "sm" | "md" | "lg";

interface SliderProps {
    modelValue?: number | number[]; // 当前值；默认 undefined。提供时受控，更新后由父组件回写。
    defaultValue?: number | number[]; // 非受控初值；默认 [0]。
    min?: number; // 下界；默认 0。
    max?: number; // 上界；默认 100。
    step?: number; // 步长；默认 1。
    disabled?: boolean; // 禁止调整；默认 false。
    orientation?: "horizontal" | "vertical"; // 方向；默认 "horizontal"。
    size?: SliderSize; // 轨道与滑块尺寸；默认 "md"。
    name?: string; // 原生表单字段名；默认 undefined。
    ariaLabel?: string; // 所有 thumb 的无障碍名称；默认 undefined，回退为“滑块 N”。
}

interface SliderEmits {
    (event: "update:modelValue", value: number | number[]): void; // 值变化时发出；根据输入值形态保留 number 或 number[]。
    (event: "valueCommit", value: number | number[]): void; // 一次调整提交时发出，形态与 update:modelValue 相同。
}

interface SliderSlots {} // 不提供插槽。
```

提供标量 `modelValue`，或未提供 `modelValue` 且 `defaultValue` 为标量时，事件发出 `number`；否则发出 `number[]`。滑块数量由 `modelValue` 数组长度优先决定，其次取 `defaultValue` 数组长度，标量或默认形态下为一个。组件不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。

## 状态

- 默认：使用 `defaultValue` 初始化；默认是单个数值 `0`。
- 已调整：单值呈现一个 thumb，多值按数组长度呈现多个 thumb；当前值由父级控制或上游内部状态维护。
- 禁用：thumb 不可调整，控件整体呈禁用样式。
- 只读、加载、出错、空数据：没有独立状态；数值约束与输入合法性由调用方设置和处理。

## 上游边界

滑块角色与 ARIA 数值、手势、键盘步进、thumb 间约束、值夹取和提交时机来自 Reka UI Slider。本组件承诺数值形态的归一化/回传、方向尺寸样式和 props/emits；上游约束行为与 DOM 细节不属于本组件承诺，升级可能变化。
