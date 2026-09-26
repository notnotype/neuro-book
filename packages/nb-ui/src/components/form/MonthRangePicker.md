---
标签: [state:local]
---

# MonthRangePicker

`MonthRangePicker` 是内嵌的月份范围选择器，以两个端点表达起止月份，适合需要按月设置时间跨度的界面。它与逐月选择器的区别是一次管理一个范围，并可在网格中显示区间高亮；不包含输入框、浮层或业务日期限制。

## 布局与交互

面板顶部是上一页、当前日历标题和下一页按钮，下方按每行三个月份单元格呈现 Reka UI 提供的月份网格。月份单元格等宽，窄屏不切换结构；网格实际提供多少月份由上游控件决定。用户选择两个端点以建立月份区间，点击箭头切换可见网格；键盘焦点与范围选择交互由 Reka UI 提供。

## 数据

```ts
import type {DateRange} from "reka-ui";

interface MonthRangePickerProps {
    modelValue?: DateRange; // 当前范围；默认 undefined。提供时受控，选择后由父组件回写。
    defaultValue?: DateRange; // 非受控初值；默认 {start: undefined, end: undefined}。
    disabled?: boolean; // 禁止选择；默认 false。
    readonly?: boolean; // 只读，不接受范围变更；默认 false。
    locale?: string; // 日期标签 locale；默认 "zh-CN"。
}

interface MonthRangePickerEmits {
    (event: "update:modelValue", value: DateRange): void; // 范围选择变化时发出。
}

interface MonthRangePickerSlots {} // 不提供插槽。
```

没有提供最早/最晚月份、禁用区间、初始显示年份或显示月份数配置。组件不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。

## 状态

- 默认：两个端点未设置；初始展示年份由 Reka UI 决定。
- 已选择：起止月份由 `modelValue` 控制或由 `defaultValue` 初始化；选择区间的高亮外观由网格单元格状态呈现。
- 禁用、只读：分别禁止选择或只允许浏览。
- 空数据、加载、错误：组件不请求或校验日期数据，也没有错误呈现状态。

## 上游边界

`DateRange` 的端点类型、范围补齐与高亮规则、初始可见月份集合、locale 格式化、键盘导航和 ARIA 语义由 Reka UI `MonthRangePickerRoot` 决定。本组件承诺面板布局、props/emits 和项目主题样式，不承诺上游控件未通过 props 显露的行为；升级依赖可能改变这些细节。
