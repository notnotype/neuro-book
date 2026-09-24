---
标签: [state:local]
---

# YearPicker

用于在年份网格中选择单个年份的日历控件。它把“选哪一年”与月、日选择分开，适合年份跨度较大的日期筛选；网格与年月导航由 Reka UI 提供。

## 布局与交互

控件是带边框和内边距的行内面板：顶部有上一段、当前年份范围标题和下一段按钮，下面以三列网格显示年份。窄屏保持三列，不改成列表；整体宽度由网格内容决定。

上一段与下一段按钮切换当前显示的年份区间，选择年份后发出 `update:modelValue`。键盘焦点移动、年份网格的选择操作和可访问语义由 Reka UI 管理。`disabled` 禁止选择和导航；`readonly` 禁止更改所选值，但其它导航行为由上游原语决定。

## 数据

```ts
import type {DateValue} from "reka-ui";

type YearPickerProps = {
    /** 当前所选年份对应的日期值；传入时为受控值，默认 undefined */
    modelValue?: DateValue;
    /** 非受控初始日期值；默认 undefined */
    defaultValue?: DateValue;
    /** 禁止选择与导航；默认 false */
    disabled?: boolean;
    /** 只读；默认 false */
    readonly?: boolean;
    /** 年份文字及日历本地化所用地区；默认 "zh-CN" */
    locale?: string;
};

type YearPickerEmits = {
    /** 用户选中年份后发出；受控用法由父组件回写 */
    (event: "update:modelValue", value: DateValue | undefined): void;
};

type YearPickerSlots = {};
```

没有 expose，也没有 slots。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `YearPickerRoot`；实际 DOM 落点由 Reka 决定。

## 状态与边界

- `modelValue` 为受控选择；未提供时 `defaultValue` 是非受控初值。未选择时具体显示哪个年份区间由 Reka UI 决定。
- `disabled`、`readonly` 由 Reka 年份选择器语义处理；没有独立加载、错误或空数据状态。
- 不提供月份或日期选择，也不提供自定义网格插槽。

## 上游边界

Reka UI 负责 `DateValue` 的构造与比较、当前年份区间、年份网格和键盘/无障碍行为。本组件固定网格为三列并提供 nb-ui 面板、按钮与选中态样式；其他行为不作承诺，可能随 Reka UI 升级变化。