---
标签: [state:local]
---

# TimeField

按 locale 展示可逐段编辑的单个时间字段。它与自由文本输入的区别是小时、分钟等时间段由 Reka UI 管理，用户可在段之间导航；组件只负责统一 nb-ui 的控件外观与尺寸。

## 布局与交互

字段以行内控件呈现，左侧是装饰性时钟图标，后面按 `locale` 排列时间段及分隔符。`size` 只改变控件高度、字号和小尺寸图标；窄屏不切换布局，宽度由内容和父级布局决定。

用户聚焦某段后由 Reka UI 处理时间段编辑与键盘导航。`disabled` 禁止交互并降低不透明度；`readonly` 保留查看与聚焦，但不允许修改。时间格式、段的顺序及键盘细节属于 Reka UI 行为，见「上游边界」。

## 数据

```ts
import type {TimeValue} from "reka-ui";

type TimeFieldProps = {
    /** 当前时间；传入时为受控值，未提供时使用 defaultValue 管理初始状态 */
    modelValue?: TimeValue;
    /** 非受控初始时间；默认 undefined */
    defaultValue?: TimeValue;
    /** 禁止编辑与交互；默认 false */
    disabled?: boolean;
    /** 只读但仍可查看；默认 false */
    readonly?: boolean;
    /** 时间段格式与次序所用地区；默认 "zh-CN" */
    locale?: string;
    /** 控件尺寸；默认 "md"，可选 "sm" | "md" | "lg" */
    size?: "sm" | "md" | "lg";
};

type TimeFieldEmits = {
    /** 用户修改时间后发出新值；受控用法由父组件回写 */
    (event: "update:modelValue", value: TimeValue | undefined): void;
};

type TimeFieldSlots = {};
```

没有 expose。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `TimeFieldRoot`；其最终 DOM 落点由 Reka 决定，不作为额外组件合同。

## 状态与边界

- `modelValue` 提供当前受控值；未提供时，`defaultValue` 作为非受控初值，变更通过 `update:modelValue` 报出。
- 没有独立的加载、错误或空数据状态；未选值的具体段显示由 Reka UI 决定。
- 不提供清除按钮、时间范围或自定义段布局。

## 上游边界

Reka UI 负责时间值表示、locale 格式化、时间段渲染、无障碍语义、键盘编辑和受控/非受控状态。本组件承诺的只有上述 props/emits、nb-ui 尺寸外观与时钟装饰图标；其余行为随 Reka UI 版本变化，不属于本组件合同。
