---
标签: [state:local]
---

# 日期范围输入字段（DateRangeField）

`DateRangeField` 将起始和结束日期作为一个可逐段编辑的行内字段呈现，适用于需要直接编辑范围端点的表单。它不同于两个独立 `DateField`：两端由同一个范围控件管理，并以固定的 `~` 分隔。

## 布局与交互

控件依次显示范围图标、起始日期段、`~` 和结束日期段。段的顺序与格式由 `locale` 决定；`size` 调整高度、字号和图标。它不切换窄屏布局，父级需为整行控件安排宽度。键盘编辑和端点切换由 Reka UI 范围字段处理；`disabled` 禁止编辑，`readonly` 允许查看但不允许修改。

## 数据

```ts
import type {DateRange} from "reka-ui";

interface DateRangeFieldProps {
    modelValue?: DateRange; // 当前日期范围；默认 undefined。提供时受控，变更由父组件回写。
    defaultValue?: DateRange; // 非受控初始范围；默认 {start: undefined, end: undefined}。
    disabled?: boolean; // 禁止编辑与交互；默认 false。
    readonly?: boolean; // 只读查看；默认 false。
    locale?: string; // 日期段地区格式；默认 "zh-CN"。
    size?: "sm" | "md" | "lg"; // 控件尺寸；默认 "md"。
}

interface DateRangeFieldEmits {
    (event: "update:modelValue", value: DateRange): void; // 范围改变时发出；受控用法由父组件回写。
}

interface DateRangeFieldSlots {} // 不提供公开插槽；内部范围段插槽由组件自行消费。
```

组件不 expose 方法或属性。未声明的 attributes 按单根组件默认 fallthrough 到 `DateRangeFieldRoot`；其最终 DOM 落点由 Reka UI 决定，本组件不承诺原生输入节点级透传。

## 状态与边界

- 默认范围两端均未设置；提供 `modelValue` 时由父级值控制，未提供时使用 `defaultValue` 作为非受控初值。
- `disabled` 禁止编辑；`readonly` 仅允许查看。组件不自行规定端点顺序或范围合法性。
- 没有加载、错误或空数据状态；不提供最早/最晚日期、禁用日期、自定义分隔符或业务校验规则。

## 上游边界

`DateRange` 值语义、端点段组成与顺序、地区格式、无障碍语义、键盘导航和受控/非受控逻辑来自 Reka UI DateRangeField。本组件承诺两端并列、固定 `~` 分隔符、图标、尺寸以及上述 props/emits；上游未由 props 暴露的行为可能随 Reka UI 升级变化。
