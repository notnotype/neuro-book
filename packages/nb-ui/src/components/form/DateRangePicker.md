---
标签: [state:local, state:inject, env:portal]
---

# DateRangePicker

`DateRangePicker` 是带范围日历浮层的日期区间选择控件。触发器显示开始日期、结束日期或“开始 ~ ...”的部分区间，用户可以在一个 Popover 中连续选取两个端点；它把浏览、选取、清除和完成关闭组织成完整的范围选择流程。

## 布局

触发器是带区间日历图标的按钮：左侧显示完整区间、部分区间或 placeholder，右侧在有值且可清除时显示清除图标。`size` 控制 `sm`、`md`（默认）、`lg` 三档控件高度与字号；区间文本使用紧凑的等宽小字号并在内容区内截断。

打开后，浮层由 `RangeCalendar` 和底部操作栏组成。操作栏左侧是“清除”，右侧是“完成”；浮层距触发器 6px，层级读取可选的窗口注入。`390×844` 下触发器仍保持一行，区间文本不把图标和操作入口推出控件，浮层定位由 Popover 上游负责避让视口。

## 交互

- 点击触发器打开或关闭范围 Popover。
- 选取第一个端点后发出当前 `DateRange`，浮层保持打开，等待结束端点。
- 当选取结果同时存在 `start` 与 `end` 时发出 `update:modelValue` 并自动关闭浮层。
- 有值且未禁用、未只读时，触发器右侧清除图标发出空区间并关闭。
- 底部“清除”按钮发出 `{start: undefined, end: undefined}` 并关闭；“完成”按钮只关闭，不改变当前区间。
- `disabled` 会禁用触发器；`readonly` 转发给范围日历并隐藏触发器清除图标。底部清除按钮当前仍可调用清除逻辑，见「已知偏差」。
- Popover 的 Escape、外部点击与范围日历的键盘导航由上游原语处理；关闭弹层时本包装阻止默认自动聚焦回移。组件不公开 open 状态事件。

## 数据

```ts
import type {DateRange} from "reka-ui";

type DateRangePickerProps = {
    /** 当前日期区间；受控值，默认 undefined。 */
    modelValue?: DateRange;
    /** 无区间时的占位文字；默认 "选择起止日期区间..."。 */
    placeholder?: string;
    /** 禁止打开和选择；默认 false。 */
    disabled?: boolean;
    /** 只读范围日历；默认 false。 */
    readonly?: boolean;
    /** 范围日历的日期 locale；默认 "zh-CN"。 */
    locale?: string;
    /** 控件尺寸；默认 "md"。 */
    size?: "sm" | "md" | "lg";
};

type DateRangePickerEmits = {
    /** 范围日历变化时发出；清除时为 {start: undefined, end: undefined}。 */
    (event: "update:modelValue", value: DateRange): void;
};

type DateRangePickerSlots = {
    /** 无插槽。 */
};
```

`modelValue` 是父组件持有的受控区间；组件不提供 `defaultValue`。浮层开关由组件内部 `isOpen` 管理，不提供 `v-model:open`、`open` prop 或 expose API。未声明 attrs、`class` 和 `style` 按 Vue 单根 fallthrough 到 `PopoverRoot`，不应依赖它们落到触发器、浮层或范围日历内部。

## 状态

- **默认/空值**：浮层关闭，触发器显示区间图标与 placeholder。
- **部分区间**：只有 `start` 时显示 `start.toString() ~ ...`，继续选择结束端点前浮层保持打开。
- **完整区间**：显示 `start.toString() ~ end.toString()`。
- **禁用**：触发器不可点击并降低不透明度。
- **只读**：范围日历接收 `readonly`，触发器清除图标隐藏；底部清除按钮的当前行为见「已知偏差」。
- **加载中、出错**：组件没有专用状态；宿主通过周围表单表达。

## 不支持

- 不支持单日期模式、多区间、时间选择或自定义日期禁用规则。
- 不支持父组件直接控制 Popover 开关，也不提供自定义触发器、范围日历、操作栏 slot。
- 不接入 `FormField` 错误上下文，不直接发起请求、校验业务区间规则或持久化日期。

## 上游边界

Reka UI 的 Popover 原语负责浮层生命周期、定位、外部点击、Escape 和焦点处理；`RangeCalendar` 负责端点选择、范围高亮、月份导航、日期键盘语义和 locale。本组件承诺触发器展示、部分区间的保持打开规则、清除/完成操作、尺寸样式、层级注入和 `update:modelValue` 连接；上游未声明的日期合法性与范围边界不属于本组件合同。

## 隐藏通道理由

- `state:local`：`isOpen` 只记录本次组件实例的浮层开关，不把临时 UI 状态扩散给父组件；区间值仍由 `modelValue` 明面控制。
- `state:inject`：组件读取 `NB_POPOVER_Z_INDEX`，让 `DialogWindow` 内部的范围浮层按窗口层级叠放；未提供注入时回退到 `NB_Z_INDEX.popover`，不读取业务 store。
- `env:portal`：`PopoverPortal` 将范围浮层移出宿主局部 stacking context，避免被父容器裁剪；目标遵循 Reka UI `ConfigProvider.teleportTo`，未配置时默认为 `body`；缺失目标行为交给 Reka Portal，不自行创建或持久化目标。

## 已知偏差

`readonly` 会转发给 `RangeCalendar` 并隐藏触发器清除图标，但底部“清除”按钮没有同步禁用，仍会调用 `handleClear`。需要只读期间绝不清除时不能依赖组件当前的完整只读保证。
