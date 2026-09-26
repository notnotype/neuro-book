---
标签: [state:local]
---

# RangeCalendar

`RangeCalendar` 是内嵌的日期区间日历，选择开始和结束日期并展示区间状态。它不包含输入框、弹出容器或业务日期限制，适用于日期字段、弹层和页面布局由父级负责的场景。

## 布局与交互

面板由月份标题与前后翻页按钮、星期标题行和日期网格组成。每个星期行有七个固定尺寸的日期单元格；组件按 Reka UI 提供的网格集合逐月渲染。窄屏不改变网格列数，日历保持单元格尺寸并随内容自然占宽。

选择日期建立或调整日期范围，网格将选择端点和范围高亮区分显示。`disabled` 禁止选择，`readonly` 允许浏览但不允许更改。月份翻页、日期键盘导航和区间选择规则由 Reka UI 处理。

## 数据

```ts
import type {DateRange} from "reka-ui";

interface RangeCalendarProps {
    modelValue?: DateRange; // 当前日期范围；默认 undefined。提供时受控，变更后由父组件回写。
    defaultValue?: DateRange; // 非受控初值；默认 {start: undefined, end: undefined}。
    disabled?: boolean; // 禁止选择；默认 false。
    readonly?: boolean; // 只读浏览；默认 false。
    locale?: string; // 月份与星期显示 locale；默认 "zh-CN"。
    weekdayFormat?: "narrow" | "short" | "long"; // 星期标题格式；默认 "short"。
}

interface RangeCalendarEmits {
    (event: "update:modelValue", value: DateRange): void; // 区间变更时发出。
}

interface RangeCalendarSlots {} // 不提供插槽。
```

组件未提供最早/最晚日期、禁用日期集合、显示月数或初始可见日期 props。它不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。

## 状态

- 默认：范围端点未设置；初始可见日期由 Reka UI 决定。
- 已选择：开始、结束及区间高亮按上游网格状态显示；提供 `modelValue` 时以父级值为准。
- 禁用、只读：分别禁止选择或只允许浏览。
- 加载、错误、空数据：组件不请求或校验日期数据，也无独立错误状态。

## 上游边界

日期值和 `DateRange` 语义、初始月份、locale 格式化、可见月份集合、键盘导航、区间选择规则及 ARIA 日历语义来自 Reka UI RangeCalendar。本组件承诺面板结构、周格式选项、项目主题样式与 props/emits；上游未通过 props 暴露的细节不作稳定承诺，依赖升级后可能变化。
