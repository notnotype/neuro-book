---
标签: [state:local, env:timer]
---

# Rating

`Rating` 以一排星形图标表示评分值，并提供星数、尺寸、禁用、只读和半星等输入 props。它旨在用于显示或采集离散评分；当前星形模板没有接入可选择的上游项目，因此交互相关 props 的行为存在已知偏差。

## 布局与交互

星星横向排列并保持紧凑间距，未激活星使用低对比度文字色；active 样式预期使用警告色填充，但当前项目没有得到该状态（见「已知偏差」）。`size` 控制每颗星的占位尺寸。组件不增加外层宽度限制，项目数由 `max` 决定。

## 数据

```ts
type RatingSize = "sm" | "md" | "lg";

type RatingProps = {
    /** 当前评分；默认 undefined。提供后为受控值。 */
    modelValue?: number;
    /** 非受控初始评分；默认 0。未提供 modelValue 时由组件状态持有。 */
    defaultValue?: number;
    /** 星形项目数；默认 5。 */
    max?: number;
    /** 禁止修改评分；默认 false。 */
    disabled?: boolean;
    /** 只读显示；默认 false。 */
    readonly?: boolean;
    /** 允许半星评分；默认 false。 */
    allowHalf?: boolean;
    /** 图标尺寸；默认 "md"。 */
    size?: RatingSize;
};

type RatingEmits = {
    /** 评分改变时发出新值。 */
    (e: "update:modelValue", value: number): void;
};

type RatingSlots = Record<never, never>;
```

`modelValue`、`defaultValue`、`max`、`disabled`、`readonly` 与 `allowHalf` 传给上游根组件；组件没有 expose API。根节点的 attrs、`class` 与 `style` 按 Vue 默认行为透传。

## 状态与边界

默认显示 5 颗空星，非受控初值为 0。受控值由父组件提供；未传 `modelValue` 时 `defaultValue` 是组件内部状态的初始值。评分交互、禁用、只读与半星的实现差异见「已知偏差」。组件没有加载、错误或空数据状态。

`state:local` 标记非受控初值对应的评分状态，以及上游根组件中的悬停预览状态；受控评分仍由父组件持有。`env:timer` 来自上游 radio group 的 roving focus 在鼠标释放时用于重置点击焦点标记的短时定时器。

## 上游边界

Reka UI 提供评分根状态与 radio group 容器。本组件负责星形项目的数量与图标外观；未由本组件显式实现的评分细节不作保证。

## 已知偏差

- 模板使用 Reka `RatingItem`（仅提供 `<label>` 项目容器），没有使用可选择的 `RatingItemIndicator`。因此星星当前不形成可操作的 radio 项目，用户点击或键盘操作不会改变评分，`update:modelValue` 不会由星星触发；焦点与激活样式也不能按预期工作，`disabled` 无法阻止这些不存在的评分交互。
- 当前依赖版本 Reka UI 2.10.1 的根组件使用 `length` 与 `step` 控制项目数量和粒度，并不提供 `max`、`allowHalf` 或 `readonly` props。包装器将这些属性传给根组件，但没有映射成上游所需的 `length` / `step`；`max` 只用于本地 `v-for` 星数。`allowHalf` 与 `readonly` 因而不会启用半星或只读行为。需依赖这些能力前先订正适配。
