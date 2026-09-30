---
标签: [state:local]
---

# DateField

`DateField` 是一个紧凑的分段式日期输入控件。它把日期拆成可分别编辑的年、月、日等 segment，适合放在表单行内；与 `DatePicker` 不同，它不打开日历浮层，也不自带清除按钮。组件只负责控件外观与 `DateValue` 的受控/非受控连接。

## 布局

根节点是一行内联控件，左侧是日历图标，右侧按上游日期格式渲染可编辑 segment；日期分隔符作为只读文字插在相邻 segment 之间。控件高度和字号由 `size` 决定：`sm`、`md`（默认）、`lg` 分别使用对应的 nb-ui 控件高度。每个 segment 获得焦点时以强调色背景和反色文字突出显示。

组件没有设置固定宽度，也不主动折行或产生横向滚动；宿主应给它足够的横向空间。`390×844` 下仍保持图标、segment 和分隔符的一行结构，窄屏适配由父级布局负责。

## 交互

- 直接聚焦某个 segment 并编辑该段日期；segment 的光标移动、数字输入、合法值处理和段间导航由日期字段上游原语完成。
- `disabled` 时字段不可编辑，呈禁用光标和降低不透明度。
- `readonly` 时保留日期展示和焦点结构，但不接受日期修改。
- 日历图标仅作识别用途，不是按钮，也不会打开日历。
- 组件不声明自己的 focus、blur 或键盘事件；需要监听这些原生行为时，应依据上游字段节点的行为实测，不把未声明事件当作公共合同。

## 数据

```ts
import type {DateValue} from "reka-ui";

type DateFieldProps = {
    /** 当前日期；传入后由父组件控制，默认 undefined。 */
    modelValue?: DateValue;
    /** 非受控模式的初始日期；只在上游字段初始化时使用，默认 undefined。 */
    defaultValue?: DateValue;
    /** 禁止编辑；默认 false。 */
    disabled?: boolean;
    /** 只读展示；默认 false。 */
    readonly?: boolean;
    /** 日期格式化与解析所用的 locale；默认 "zh-CN"。 */
    locale?: string;
    /** 控件尺寸；默认 "md"。 */
    size?: "sm" | "md" | "lg";
};

type DateFieldEmits = {
    /** 上游字段日期变化时发出；清空或无有效日期时 value 为 undefined。 */
    (event: "update:modelValue", value: DateValue | undefined): void;
};

type DateFieldSlots = {
    /** 无插槽。 */
};
```

`modelValue` 与 `defaultValue` 同时传给上游字段根节点：使用 `modelValue` 时是受控值，组件自身不会改写它；使用 `defaultValue` 且不持续传入 `modelValue` 时由上游字段保留内部编辑状态，变化仍通过 `update:modelValue` 通知父组件。`modelValue` 的默认值是 `undefined`，`defaultValue` 的默认值也是 `undefined`；其余默认值见类型注释。

组件没有 expose API，也没有公共 slot。未声明的 attrs、`class` 和 `style` 按 Vue 单根 fallthrough 到 `DateFieldRoot`，最终 DOM 落点由 Reka UI 决定；不应依赖它们落到某个 segment 或原生输入节点。

## 状态

- **默认/空值**：没有日期时仍渲染图标和日期格式的空 segment，等待用户逐段输入。
- **受控**：父组件传入的 `modelValue` 决定显示值；事件只报告上游字段变化，不在组件内回写 prop。
- **禁用**：整个字段不可编辑，视觉上降低不透明度。
- **只读**：显示当前值但不接受编辑。
- **加载中、出错、空数据**：组件没有这些专用状态；错误提示、校验文案和加载占位由宿主另行组合。

## 不支持

- 不支持日历弹层、月份导航、快捷日期和清除按钮；需要这些能力时使用 `DatePicker`。
- 不支持最小/最大日期、禁用日期集合或自定义日期解析器 prop。
- 不支持把 segment 的中间编辑文本作为另一种事件单独上报。

## 上游边界

`DateFieldRoot` 与 `DateFieldInput` 负责日期值的解析、segment 划分、键盘编辑、无障碍语义、locale 语义以及 disabled/readonly 的具体行为。本组件承诺的是图标、主题控件外观、尺寸映射、props 转发和 `update:modelValue` 事件；上游日期原语未声明的输入边界与格式细节不属于本组件合同，升级上游后应重新实测。

## 注意事项

`defaultValue` 是初始值入口，不是持续同步入口。需要父组件始终决定字段值时使用 `modelValue` 并处理 `update:modelValue`；不要在非受控模式下把变化后的 `defaultValue` 当成更新指令。
