---
标签: []
---

# Progress

`Progress` 是一个只读进度条，用于显示有确定数值的任务进度；调用方提供当前值与最大值，组件绘制对应比例，并以 tone 和尺寸适配状态与视觉层级。它不执行任务，也不拥有进度数据。

## 布局与交互

进度条横向占满父容器，由圆角轨道和从左侧增长的实色填充组成。`size` 改变条高，`tone` 选择强调、成功、警告或危险色。填充比例按 `modelValue / max` 计算并限制在 0% 到 100%；`max` 非正数时用于计算的分母回退到 100。组件不可点击，不接收焦点。

根元素使用 `progressbar` 角色；Reka UI 提供 `aria-valuemin`、`aria-valuemax`、`aria-valuenow` 和默认百分比可访问标签。

## 数据

```ts
type ProgressTone = "accent" | "success" | "warning" | "danger";
type ProgressSize = "sm" | "md" | "lg";

type ProgressProps = {
    /** 当前进度值；默认 0。只读显示输入，不由用户改变。 */
    modelValue?: number;
    /** 完成值；默认 100。 */
    max?: number;
    /** 填充色调；默认 "accent"。 */
    tone?: ProgressTone;
    /** 条高档位；默认 "md"。 */
    size?: ProgressSize;
};

type ProgressEmits = Record<never, never>;
type ProgressSlots = Record<never, never>;
```

组件没有显式声明或重新发出事件，因此没有组件自有的 emits 合同；Vue 默认 attrs 透传可能将未声明的事件监听器带到 Reka 根组件，但不应依赖未声明事件作为稳定接口。无 expose API；未声明 attrs、`class` 与 `style` 按 Vue 默认行为落到进度根节点。

## 状态与边界

默认进度为 0/100。对 `[0, max]` 内的值，0 值为空轨道，达到最大值时填满，中间值按比例显示。进度语义的值域由上游限制为 `[0, max]`，最大值须为正数；无 indeterminate 输入合同。组件没有禁用、只读切换、加载动画、错误或空数据状态。

## 上游边界

Reka UI 提供 `progressbar` 语义、ARIA 数值属性及默认百分比标签；本组件负责颜色、条高与填充宽度。上游校验对不合法值的诊断和回退行为不应被当作业务输入校验。

## 已知偏差

- 进度填充依据原始 `modelValue` props 计算并裁剪到 0–100%，而 Reka 根节点会把小于 0 或大于 `max` 的值校正为 indeterminate。传入超界值时，视觉填充可能仍在 0% 或 100%，ARIA 状态则可能没有 `aria-valuenow`；调用方应提供 `[0, max]` 内的值。
