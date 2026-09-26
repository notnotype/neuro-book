---
标签: [state:local]
---

# ToggleGroup

`ToggleGroup` 把一组紧凑按钮组织成单选或多选控件，可由数据选项生成，也可通过默认插槽放入自定义项目。它支持受控值和非受控初值，适合互斥模式选择或可叠加的格式开关；与 `SegmentedControl` 不同，它允许多选并由 Reka ToggleGroup 管理选中语义。

## 布局

选项以紧凑分段组呈现，横向或纵向排列。`sm`、`md`、`lg` 的项目高度分别为 24px、28px、32px；最小宽度依次为 24px、28px、32px。选中项使用面板底色和强调色文字，未选中项在悬停时增强背景和文字对比。组宽随内容伸缩，垂直模式将项目纵向排列。

在 `390×844` 窄屏中，横向组保持单行并可被父级约束；组件自身不提供滚动。选项较多或标签较长时由父级选择纵向排列或提供外层滚动。

## 交互

- `type="single"` 时同一时间最多选择一个值；`type="multiple"` 时值是字符串数组，可同时选择多项。
- 点击或键盘激活项目后发出 `update:modelValue`。传 `modelValue` 时父组件控制最终值；省略时上游以 `defaultValue` 作为非受控初值。
- 禁用整个组或单项时相应项目不可操作。方向键导航、焦点停靠、选择/取消规则由 Reka ToggleGroup 原语负责。
- `options` 非空时按数组渲染项目并忽略默认插槽；`options` 为空时显示默认插槽内容。

## 数据

```ts
export interface ToggleGroupOption {
    /** 项目值；必填，组内应唯一 */
    value: string;
    /** 可见文字；默认不显示 */
    label?: string;
    /** 装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 原生 title；默认回退到 label */
    title?: string;
    /** 是否禁用该项目；默认 false */
    disabled?: boolean;
}

export type ToggleGroupSize = "sm" | "md" | "lg";

type ToggleGroupProps = {
    /** 当前选择；传入时受控；默认 undefined */
    modelValue?: string | string[];
    /** 非受控初值；默认 undefined */
    defaultValue?: string | string[];
    /** 单选或多选；默认 "single" */
    type?: "single" | "multiple";
    /** 是否禁用全组；默认 false */
    disabled?: boolean;
    /** 项目尺寸；默认 "md" */
    size?: ToggleGroupSize;
    /** 项目排列方向；默认 "horizontal" */
    orientation?: "horizontal" | "vertical";
    /** 选项数据；默认空数组；非空时优先渲染并忽略默认插槽 */
    options?: ToggleGroupOption[];
};

type ToggleGroupEmits = {
    /** 上游选择值变化时发出；运行时值形状随 single/multiple 模式而定 */
    (event: "update:modelValue", value: string | string[]): void;
};

type ToggleGroupSlots = {
    /** options 为空时作为项目内容；可省略 */
    default?: () => unknown;
};
```

单选模式对应字符串值，多选模式对应字符串数组；`modelValue` 与 `defaultValue` 应匹配当前 `type`。没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认规则落在根 `ToggleGroupRoot` 上，最终 DOM 透传细节由 Reka 决定。

`state:local` 来自省略 `modelValue` 时，上游在组件实例内持有的 `defaultValue` 后选择状态；传入 `modelValue` 时选择值归父组件持有。组件没有 store、请求或持久化通道。

## 状态

- 默认：单选或多选值由 `modelValue` 或非受控初值决定。
- 禁用：全组或单项禁用时不可操作，禁用项降低不透明度。
- 空数据：`options` 为空且默认插槽也为空时显示空组容器。
- 只读、加载、错误：没有统一只读、加载或错误状态；宿主可禁用整个组并自行呈现业务反馈。

## 不支持

- 不支持非字符串选项值或 option 级自定义 slot；需要自定义视觉时使用默认插槽模式。
- 不支持同时将 `options` 数据与默认 slot 混合渲染。

## 上游边界

Reka UI 负责选择状态、单选/多选操作、禁用处理、roving focus 与方向键行为。本组件负责选项映射、尺寸、方向及外观；上游未由组件显式固定的焦点细节和 DOM 结构不属于稳定合同。

## 已知偏差

- 单选模式再次激活已选项目时，上游可能发出 `undefined` 清空值；包装器以类型断言转发为声明的 `string | string[]`。若允许取消单选，接收端应处理运行时 `undefined`，不要依赖声明类型覆盖该行为。
- `modelValue` 或 `defaultValue` 的字符串/数组形状与 `type` 不匹配时，上游可能根据值形状推断行为；输入应与所选模式一致。
