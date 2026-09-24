---
标签: [state:local, state:inject, env:portal]
---

# 日期范围选择器（DateRangePicker）

`DateRangePicker` 把日期范围触发器、区间日历弹层和清除操作组合为一个受控范围选择器。与 `DateRangeField` 的逐段输入不同，它在日历中选择起止日期，并能展示只选到起点的进行中范围。

## 布局与交互

触发器显示范围图标和 `start ~ end`；无起点时显示占位文本，只有起点时显示 `start ~ ...`。选择起点后弹层保持打开；范围两端齐全时发出更新并自动关闭。底部“完成”可在范围未完整时关闭弹层；“清除”发出空范围 `{start: undefined, end: undefined}` 并关闭。已有值且既非禁用也非只读时，触发器另显示内联清除图标。

`disabled` 禁止打开触发器。`readonly` 传给日历并隐藏内联清除图标，但弹层底部“清除”仍会发出空范围事件；两个清除入口的行为存在此差异。键盘日历交互由 Reka UI 管理；关闭弹层时包装会阻止默认自动聚焦回移。

## 数据

```ts
import type {DateRange} from "reka-ui";

interface DateRangePickerProps {
    modelValue?: DateRange; // 当前日期范围；默认 undefined。受控，更新后由父组件回写。
    placeholder?: string; // 无起点时的占位文本；默认 "选择起止日期区间..."。
    disabled?: boolean; // 禁止打开选择器；默认 false。
    readonly?: boolean; // 日历只读并隐藏触发器内联清除图标；默认 false。
    locale?: string; // 日历地区；默认 "zh-CN"。
    size?: "sm" | "md" | "lg"; // 触发器尺寸；默认 "md"。
}

interface DateRangePickerEmits {
    (event: "update:modelValue", value: DateRange): void; // 日历选择或清除时发出。
}

interface DateRangePickerSlots {} // 不提供公开插槽。
```

组件不 expose 方法或属性。没有显式透传 `$attrs`；Vue 单根 fallthrough 到 `PopoverRoot`，触发器 DOM 的最终 attrs 行为由 Reka UI 决定。组件通过 `NB_POPOVER_Z_INDEX` 注入宿主弹层层级；无窗口宿主时回退到普通页面层级。`PopoverPortal` 将弹层内容渲染到组件树外；目标由 Reka UI `ConfigProvider.teleportTo` 决定，未配置时默认 `body`。

## 状态与边界

- 空范围显示占位文本；仅有起点时明确显示未完成端点，完整范围按两端的 `DateValue.toString()` 显示。
- `disabled` 阻止打开；`readonly` 限制日历编辑及内联清除，但底部清除仍会触发。
- 不接入 `FormField` 错误上下文，不提供日期边界、业务范围校验、加载或请求错误状态。

## 上游边界

日历网格与区间选择行为来自 Reka UI `RangeCalendar`，弹层定位、无障碍语义和 portal 管理来自 Reka UI Popover。本组件承诺触发器、部分范围显示、自动关闭条件、底部操作、nb-ui 尺寸与公开 props/emits；未由包装明确实现的上游细节可能随 Reka UI 升级变化。

## 隐藏通道理由

- `state:inject`：读取 `NB_POPOVER_Z_INDEX`，使窗口内弹层遵循 `DialogWindow` 提供的层级；没有上下文时回退到普通页面层级。它是承载环境状态，不能由日期范围值替代。
- `env:portal`：通过 `PopoverPortal` 在组件树外渲染区间日历；目标遵循 Reka UI `ConfigProvider.teleportTo`，未配置时默认为 `body`。
