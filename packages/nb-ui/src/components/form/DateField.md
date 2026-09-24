---
标签: [state:local]
---

# 日期输入字段（DateField）

`DateField` 是按地区格式展示、可逐段键盘编辑的日期字段。它适合需要直接编辑日期各部分、而不是打开日历弹层的表单；日期格式与分段编辑由日期字段原语管理。

## 布局与交互

控件行内显示日历图标和按 `locale` 排列的日期段，段之间保留地区格式所需的文字分隔符。`size` 调整高度、字号和图标尺寸；结构不随屏宽改变，父级负责为行内字段提供足够空间。聚焦某段后可按上游日期字段键盘交互编辑；禁用时不可编辑，只读时可查看但不可修改。

## 数据

```ts
import type {DateValue} from "reka-ui";

interface DateFieldProps {
    modelValue?: DateValue; // 当前日期；默认 undefined。提供时受控，变更后由父组件回写。
    defaultValue?: DateValue; // 非受控初始日期；默认 undefined。
    disabled?: boolean; // 禁止编辑与交互；默认 false。
    readonly?: boolean; // 只读查看；默认 false。
    locale?: string; // 日期段的地区格式；默认 "zh-CN"。
    size?: "sm" | "md" | "lg"; // 控件尺寸；默认 "md"。
}

interface DateFieldEmits {
    (event: "update:modelValue", value: DateValue | undefined): void; // 日期值改变时发出；受控用法由父组件回写。
}

interface DateFieldSlots {} // 不提供公开插槽；内部日期段插槽由组件自行消费。
```

组件不 expose 方法或属性。未声明的 attributes 按单根组件默认 fallthrough 到 `DateFieldRoot`；其最终 DOM 落点由 Reka UI 决定，本组件不承诺原生输入节点级透传。

## 状态与边界

- 初始值未设置时，日期段的初始显示与编辑状态由 Reka UI 处理；提供 `modelValue` 时显示父级值，修改通过事件回传。
- `disabled` 禁止编辑；`readonly` 保留查看但禁止修改。
- 没有独立加载、错误或空数据状态；组件不校验业务日期规则，也不提供日期范围限制。

## 上游边界

`DateValue` 的结构、分段组成与顺序、地区格式、无障碍语义、键盘导航和受控/非受控状态来自 Reka UI DateField。本组件承诺图标、nb-ui 尺寸样式及上述 props/emits；未由 props 暴露的上游细节不作稳定承诺，可能随 Reka UI 升级变化。
