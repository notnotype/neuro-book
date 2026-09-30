---
标签: [state:local]
---

# MonthPicker

`MonthPicker` 是选择单个月份的内嵌日历，不带输入框或弹出层，适合宿主已经负责日期字段布局、只需要月份网格的场景。它提供月份前后翻页和本地化标签，并通过受控值或非受控初值向父级表达选择。

## 布局与交互

组件是带边框和面板底色的紧凑内联面板：顶部为上一页按钮、当前日历标题和下一页按钮，下方把月份网格按每行三项排列。月份单元格等宽；窄屏保持网格结构，没有额外响应式变体。点击月份单元格选择月份，左右箭头切换可见网格；焦点导航和单元格选择的键盘语义由 Reka UI 提供。

## 数据

```ts
import type {DateValue} from "reka-ui";

interface MonthPickerProps {
    modelValue?: DateValue; // 当前月份值；默认 undefined。提供时受控，选择后由父组件回写。
    defaultValue?: DateValue; // 非受控初值；默认 undefined。
    disabled?: boolean; // 禁止选择；默认 false。
    readonly?: boolean; // 只读，不接受选择变更；默认 false。
    locale?: string; // 日期标签 locale；默认 "zh-CN"。
}

interface MonthPickerEmits {
    (event: "update:modelValue", value: DateValue | undefined): void; // 选择变更时发出。
}

interface MonthPickerSlots {} // 不提供插槽。
```

没有提供年份范围、月份禁用规则、初始显示月份或月数配置；这些能力不会通过 props 暴露。组件不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。

## 状态

- 默认：未传选择值时由 Reka UI 决定初始显示月份；组件自身不生成当前日期初值。
- 已选择：月份单元格展示所选状态，值由 `modelValue` 控制或由 `defaultValue` 初始化。
- 禁用、只读：分别阻止选择或只允许浏览；底层控件决定对应键盘与视觉细节。
- 空数据、加载、错误：组件不加载日期数据，也不提供错误状态。

## 上游边界

月份值类型、初始可见月份、locale 格式化、网格日期算法、键盘导航及日历 ARIA 语义来自 Reka UI 的 `MonthPickerRoot`。本组件承诺三列月份网格、翻页按钮、props/emits 和项目主题样式；上游未通过 props 暴露的行为不作额外承诺，升级 Reka UI 后可能变化。
