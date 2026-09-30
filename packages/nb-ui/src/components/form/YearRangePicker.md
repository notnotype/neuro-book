---
标签: [state:local]
---

# YearRangePicker

用于选择连续起止年份的年份网格。与两个单年选择器相比，它把起点、终点及两者之间的高亮作为同一个范围选择处理，适用于按年份筛选时间跨度。

## 布局与交互

控件是带边框和内边距的行内面板：顶部有上一段、当前年份范围标题和下一段按钮，下面以三列网格显示年份。范围起止与区间高亮由 Reka UI 的范围选择状态提供。窄屏维持三列布局，整体宽度随网格内容确定。

上一段与下一段按钮切换当前年份区间；选择年份会更新范围并发出 `update:modelValue`。键盘焦点移动、范围选择步骤和可访问语义由 Reka UI 管理。`disabled` 禁止选择和导航；`readonly` 禁止更改范围，导航的具体行为由上游原语决定。

## 数据

```ts
import type {DateRange} from "reka-ui";

type YearRangePickerProps = {
    /** 当前起止范围；传入时为受控值，默认 undefined */
    modelValue?: DateRange;
    /** 非受控初始范围；默认 {start: undefined, end: undefined} */
    defaultValue?: DateRange;
    /** 禁止选择与导航；默认 false */
    disabled?: boolean;
    /** 只读；默认 false */
    readonly?: boolean;
    /** 年份文字及日历本地化所用地区；默认 "zh-CN" */
    locale?: string;
};

type YearRangePickerEmits = {
    /** 用户选择范围时发出；受控用法由父组件回写 */
    (event: "update:modelValue", value: DateRange): void;
};

type YearRangePickerSlots = {};
```

没有 expose，也没有 slots。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `YearRangePickerRoot`；实际 DOM 落点由 Reka 决定。

## 状态与边界

- `modelValue` 为受控范围；未提供时默认值为 `{start: undefined, end: undefined}`，两端均未选择。
- `disabled`、`readonly` 由 Reka 范围选择器语义处理；没有独立加载、错误或空数据状态。
- 不提供月、日选择，不提供自定义网格插槽，也不额外校验范围规则。

## 上游边界

Reka UI 负责 `DateRange` 的结构、年份区间、起止与中间范围状态、键盘和无障碍行为。本组件固定网格为三列并提供 nb-ui 面板、导航按钮及选中/范围高亮样式；其余行为可能随 Reka UI 升级变化。