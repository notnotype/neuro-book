---
标签: [state:local, state:inject, env:portal]
---

# DatePicker

`DatePicker` 是带日历浮层的单日期选择控件。触发器用一行文本展示当前 `DateValue` 或占位文字，选择日期后自动收起；它与只编辑 segment 的 `DateField` 的区别是把日期浏览、选择和清除动作集中到一个 Popover 工作流里。

## 布局

触发器是带日历图标的按钮：左侧显示日期或 placeholder，右侧在有值且可清除时显示清除图标。`size` 控制 `sm`、`md`（默认）、`lg` 三档控件高度与字号。日期文本使用等宽字体；内容区域允许截断，不会因为长日期把同一行的图标和清除入口推出控件。

打开后，`PopoverContent` 在触发器外渲染 `Calendar` 日历，下方是带上边框的操作栏，左侧为“清除”，右侧为“关闭”。日历和操作栏共同属于同一个浮层。浮层与触发器相距 6px，层级来自当前的公共浮层层级；被 `DialogWindow` 承载时会跟随窗口注入的层级。

`390×844` 下触发器结构不改变，日期长文本在内容区内截断；浮层仍由 Popover 的碰撞定位负责避让视口，日历本身保持网格布局。

## 交互

- 点击触发器打开或关闭日期 Popover。
- 在日历中选取日期时发出 `update:modelValue`，随后关闭浮层。
- 有日期且未禁用、未只读时，触发器右侧的清除图标发出空值事件并关闭浮层。
- 浮层底部“清除”按钮发出空值事件并关闭；“关闭”按钮只关闭浮层，不改变日期。
- `disabled` 会禁用触发器；组件不再通过触发器打开日历。
- `readonly` 转发给日历，并隐藏触发器右侧清除图标；日历的只读选择语义由上游实现。当前实现中浮层底部的“清除”按钮没有同步设置 disabled，因此只读场景仍可能通过该按钮清除值，见「已知偏差」。
- Popover 的 Escape、外部点击、焦点恢复和日历的键盘导航由上游原语处理；组件没有另行声明快捷键，也没有公开 `open` 控制事件。

## 数据

```ts
import type {DateValue} from "reka-ui";

type DatePickerProps = {
    /** 当前日期；受控值，默认 undefined。 */
    modelValue?: DateValue;
    /** 无日期时的占位文字；默认 "选择日期..."。 */
    placeholder?: string;
    /** 禁止打开和选择；默认 false。 */
    disabled?: boolean;
    /** 只读日历；默认 false。 */
    readonly?: boolean;
    /** 日历的日期 locale；默认 "zh-CN"。 */
    locale?: string;
    /** 控件尺寸；默认 "md"。 */
    size?: "sm" | "md" | "lg";
};

type DatePickerEmits = {
    /** 选择或清除日期时发出；清除时 value 为 undefined。 */
    (event: "update:modelValue", value: DateValue | undefined): void;
};

type DatePickerSlots = {
    /** 无插槽。 */
};
```

`modelValue` 没有默认日期，父组件必须通过 `update:modelValue` 接住选择结果以维持受控值。浮层是否打开由组件内部 `isOpen` 持有，不提供 `v-model:open`、`open` prop 或 open/close emit。组件不提供 expose API。

未声明的 attrs、`class` 和 `style` 不属于稳定公共合同；不要依赖它们透传到触发器、Popover 内容或日历内部节点。组件也不提供自定义日历、触发器或 footer slot。

## 状态

- **默认/空值**：浮层关闭，触发器显示日历图标与 `placeholder`。
- **已选值**：触发器显示 `DateValue.toString()` 的结果，打开后日历接收同一 `modelValue`。
- **禁用**：触发器不可点击并降低不透明度。
- **只读**：日历接收 `readonly`，触发器清除图标隐藏；底部清除按钮的当前行为见「已知偏差」。
- **加载中、出错**：组件没有专用状态；宿主通过周围表单或替代内容表达。

## 不支持

- 不支持日期范围、多月并排或自定义日期禁用规则；需要区间选择时使用 `DateRangePicker`。
- 不支持由父组件控制 Popover 开关，也不提供打开状态事件。
- 不支持自定义触发器、日历主体、操作栏的 slot 或 expose 方法。
- 不直接发起请求、校验业务规则或持久化日期。

## 上游边界

Reka UI 的 `PopoverRoot`、`PopoverTrigger`、`PopoverContent` 与 `PopoverPortal` 负责浮层生命周期、定位、外部点击、Escape 和焦点处理；`Calendar` 负责日期网格、月份导航、日期输入与 locale 语义。本组件承诺触发器显示、清除/关闭操作、尺寸样式、层级注入和 `update:modelValue` 连接；上游未声明的日期合法性和 Popover 细节不属于本组件合同。

## 隐藏通道理由

- `state:local`：打开状态 `isOpen` 只描述本次组件实例的 Popover 生命周期，关闭组件即丢失；日期值仍通过受控 `modelValue` 由父组件持有。
- `state:inject`：组件读取 `NB_POPOVER_Z_INDEX`。`DialogWindow` 需要让窗口内日期浮层压在窗口表面之上；通过可选注入传层级比让每个父组件重复改写浮层样式更稳定。没有注入时回退到 `NB_Z_INDEX.popover`，不读取业务 store。
- `env:portal`：`PopoverPortal` 把日历浮层放到组件树之外，以脱离宿主局部 stacking context 并避免被表单容器裁剪；目标与缺失目标行为由 Reka Portal 处理，组件不创建隐式目标或持久化 DOM。

## 已知偏差

`readonly` 只转发给 `Calendar`，并用于隐藏触发器上的清除图标；底部“清除”按钮仍直接调用 `handleClear`，没有 `readonly` 条件。若业务必须保证只读期间不能清除，宿主应在使用前规避该入口，或待组件实现与只读语义统一后再依赖该保证。
