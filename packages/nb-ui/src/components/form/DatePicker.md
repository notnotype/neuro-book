---
标签: [state:local, state:inject, env:portal]
---

# 日期选择器（DatePicker）

`DatePicker` 将日期按钮、日历弹层和清除操作组合为一个日期选择控件。与内嵌逐段编辑的 `DateField` 不同，它用紧凑触发器展示当前值，并在弹层中选择日期。

## 布局与交互

触发器显示日历图标和日期字符串；未选择时显示占位文本。选择日期后立即发出更新事件并关闭弹层。值非空且既非禁用也非只读时，触发器内显示清除图标；弹层底部另有“清除”和“关闭”按钮。清除发出 `undefined` 并关闭；“关闭”仅关闭弹层。

`disabled` 禁止打开触发器。`readonly` 时日历禁止改值且触发器不显示内联清除图标，但弹层底部的“清除”按钮仍会发出清除事件；这是当前两个清除入口的行为差异。选择、日历键盘操作与弹层基础行为由 Reka UI 提供。关闭弹层时本包装阻止默认自动聚焦回移。

## 数据

```ts
import type {DateValue} from "reka-ui";

interface DatePickerProps {
    modelValue?: DateValue; // 当前日期；默认 undefined。受控，更新后由父组件回写。
    placeholder?: string; // 无日期时的占位文本；默认 "选择日期..."。
    disabled?: boolean; // 禁止打开选择器；默认 false。
    readonly?: boolean; // 日历只读并隐藏触发器内联清除图标；默认 false。
    locale?: string; // 日历地区；默认 "zh-CN"。
    size?: "sm" | "md" | "lg"; // 触发器尺寸；默认 "md"。
}

interface DatePickerEmits {
    (event: "update:modelValue", value: DateValue | undefined): void; // 选择或清除日期时发出。
}

interface DatePickerSlots {} // 不提供公开插槽。
```

组件不 expose 方法或属性。没有显式透传 `$attrs`；Vue 单根 fallthrough 到 `PopoverRoot`，触发器 DOM 的最终 attrs 行为由 Reka UI 决定。组件通过 `NB_POPOVER_Z_INDEX` 注入宿主弹层层级；无窗口宿主时回退到普通页面层级。`PopoverPortal` 将弹层内容渲染到组件树外；目标由 Reka UI `ConfigProvider.teleportTo` 决定，未配置时默认 `body`。

## 状态与边界

- 空值显示占位文本；有效日期按 `DateValue.toString()` 展示，不提供格式化字符串 prop。
- `disabled` 阻止触发器交互；`readonly` 仅限制日历编辑及内联清除入口，弹层底部清除仍可触发。
- 组件不接入 `FormField` 错误上下文，不验证最小/最大日期或业务规则，也没有加载、请求错误状态。

## 上游边界

日历网格与选择行为来自 Reka UI `Calendar`，弹层定位、无障碍语义和 portal 管理来自 Reka UI Popover；组件只承诺触发器、按钮、nb-ui 尺寸、层级注入回退及公开 props/emits。未由本包装明确实现的上游行为可能随 Reka UI 升级变化。

## 隐藏通道理由

- `state:inject`：读取 `NB_POPOVER_Z_INDEX`，使弹层在 `DialogWindow` 等窗口宿主内遵循其层级；没有提供值时使用 `NB_Z_INDEX.popover` 回退。该层级属于承载环境，不是日期数据，故由宿主上下文提供。
- `env:portal`：通过 `PopoverPortal` 在组件树外渲染日历弹层；目标遵循 Reka UI `ConfigProvider.teleportTo`，未配置时默认为 `body`。
