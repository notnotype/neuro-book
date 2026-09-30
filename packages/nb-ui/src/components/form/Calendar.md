---
标签: [state:local]
---

# Calendar

`Calendar` 是单月日期网格，用于直接浏览和选择一个日历日期；与日期输入框不同，它把月视图完整呈现为周列和日期格。所选日期可受控，也可用初值由日历内部维护。

## 布局

顶部为上一月按钮、年月标题和下一月按钮，下方按周显示星期标题与日期网格。日期格为 32×32px，星期标题为 32px 高；每周七列，月视图按日期所需周数伸展。组件外框约 250px 宽（七个 32px 日期列、左右内边距与边框）；窄屏不改为其它形态，按固定七列显示，父容器过窄时可能溢出。

## 交互

- 日期选择状态更新时发出 `update:modelValue`，参数类型为 `DateValue | undefined`。
- `disabled` 与 `readonly` 都传给 Reka CalendarRoot；本组件意图是禁用/只读日历，翻月按钮在各状态下的具体可用行为取决于上游。
- 日期键盘导航、初始焦点、周起始日和禁用日期等语义由 Reka Calendar 原语提供。焦点离开组件后的去向由调用方决定。

## 数据

```ts
import type {DateValue} from "reka-ui";

interface CalendarProps {
    /** 当前选择日期；传入时受控，默认 undefined。 */
    modelValue?: DateValue;
    /** 非受控初始日期；默认 undefined。 */
    defaultValue?: DateValue;
    /** 禁用状态；默认 false，具体作用范围由 Reka CalendarRoot 决定。 */
    disabled?: boolean;
    /** 只读状态；默认 false，不能选择日期。 */
    readonly?: boolean;
    /** 日期语言环境；默认 "zh-CN"。 */
    locale?: string;
    /** 星期标题格式；默认 "short"。 */
    weekdayFormat?: "narrow" | "short" | "long";
}

interface CalendarEmits {
    /** 日期选择状态变化时发出。 */
    (event: "update:modelValue", value: DateValue | undefined): void;
}

interface CalendarSlots {}
```

组件不 expose API，也不提供自定义插槽。未声明 attrs 按 Vue 默认行为继承到根 CalendarRoot；这不是稳定的日期格透传接口。

## 状态与边界

- 无 `modelValue` 和 `defaultValue` 时没有预选值；当前月份、初始焦点与“今天”是否突出显示由 Reka 默认日期状态决定。
- `disabled` 与 `readonly` 如上区分；本组件没有加载、错误或数据空态。
- 日期值类型为 Reka UI `DateValue`，应与同一上游日期组件族的数据类型保持一致。

## 不支持

- 不显示多个并排月份，不提供日期范围选择、最小/最大日期或自定义禁用日期 props。
- 不提供月份/年份下拉选择器；用户通过前后月按钮浏览。

## 上游边界

Reka UI Calendar 负责日期值模型、月网格生成、星期/本地化处理、键盘导航、日期选择与可访问语义。本组件只承诺单月布局、导航按钮和样式；上游日期运算、周起始规则、焦点管理与未声明行为可能随 Reka 升级变化。
