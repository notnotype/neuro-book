---
标签: []
---

# DateRangeField

`DateRangeField` 是一个紧凑的分段式日期区间输入控件。它在同一个控件中并列编辑开始日期和结束日期，中间用 `~` 分隔；与 `DateRangePicker` 不同，它不打开日历浮层，也不提供清除按钮。

## 布局

根节点是一行内联控件，左侧是区间日历图标，随后是开始日期 segments、`~` 分隔符和结束日期 segments。开始与结束两组 segment 使用相同的上游日期格式；每个 segment 获得焦点时显示强调色背景与反色文字。`size` 控制 `sm`、`md`（默认）、`lg` 三档控件高度与字号。

组件没有固定宽度、换行或内部横向滚动。`390×844` 下仍保持开始区间、分隔符和结束区间一行，父级应为控件预留足够宽度。

## 交互

- 直接编辑开始日期或结束日期的各个 segment；segment 导航、日期解析和键盘编辑由上游日期区间原语负责。
- `disabled` 时整个区间不可编辑并降低不透明度。
- `readonly` 时保留两组日期展示，但不接受日期修改。
- 区间图标和 `~` 仅作视觉结构，不是操作入口。
- 组件不声明自己的 focus、blur 或键盘事件。

## 数据

```ts
import type {DateRange} from "reka-ui";

type DateRangeFieldProps = {
    /** 当前区间；传入后由父组件控制，默认 undefined。 */
    modelValue?: DateRange;
    /** 非受控模式的初始区间；默认 {start: undefined, end: undefined}。 */
    defaultValue?: DateRange;
    /** 禁止编辑；默认 false。 */
    disabled?: boolean;
    /** 只读展示；默认 false。 */
    readonly?: boolean;
    /** 日期格式化与解析所用的 locale；默认 "zh-CN"。 */
    locale?: string;
    /** 控件尺寸；默认 "md"。 */
    size?: "sm" | "md" | "lg";
};

type DateRangeFieldEmits = {
    /** 上游区间变化时发出；值的类型始终为 DateRange。 */
    (event: "update:modelValue", value: DateRange): void;
};

type DateRangeFieldSlots = {
    /** 无插槽。 */
};
```

`modelValue` 与 `defaultValue` 同时转发给上游 `DateRangeFieldRoot`。传入 `modelValue` 时父组件控制区间，组件自身不改写 prop；不持续传入 `modelValue` 时由 `defaultValue` 启动上游的非受控编辑状态。`defaultValue` 的默认对象两端均为 `undefined`，因此初始状态可以是尚未选择任何端点的空区间。

组件没有 expose API，也没有公共 slot。未声明 attrs、`class` 和 `style` 不属于稳定合同，不应依赖它们透传到某个 segment。

## 状态

- **默认/空值**：显示区间图标、分隔符和空的开始/结束 segment。
- **部分区间**：上游可只保留一端，组件仍按两组 segment 渲染。
- **禁用**：整个区间字段不可编辑并降低不透明度。
- **只读**：保留当前区间展示但不接受编辑。
- **加载中、出错、空数据**：没有专用视觉状态；校验和错误文案由宿主组合。

## 不支持

- 不支持日历浮层、范围快捷选项或清除动作；需要这些能力时使用 `DateRangePicker`。
- 不支持最小/最大日期、禁用日期集合或自定义区间校验 prop。
- 不支持分别为开始和结束端点提供独立 slot 或事件。

## 上游边界

`DateRangeFieldRoot` 与 `DateRangeFieldInput` 负责区间日期的解析、segment 划分、键盘编辑、locale 语义和 disabled/readonly 的具体行为。本组件承诺的是区间布局、图标与尺寸样式、props 转发以及 `update:modelValue` 事件；上游未声明的日期合法性、端点调整和键盘边界不属于本组件合同。

## 注意事项

`defaultValue` 只作为非受控初始化入口。需要父组件持续决定区间时使用 `modelValue` 并处理 `update:modelValue`；不要把变更后的 `defaultValue` 当作运行时同步入口。
