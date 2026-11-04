---
标签: [state:local]
---

# ToggleGroup

`ToggleGroup` 把一组紧凑按钮组织成可叠加的开关（例如粗体、斜体、删除线），每个按钮各自按下或弹起，可以同时按下几个，也可以都不按下。可由数据选项生成，也可通过默认插槽放入自定义项目；支持受控值和非受控初值。

“几个里选一个”不用它：换模式用 `SegmentedControl`，表单里选值用 `RadioGroup`；其余见[同类零件的分工](../../../docs/ui-development-spec.md#42-同类零件的分工)。

## 布局

选项以紧凑分段组呈现，横向或纵向排列。`sm`、`md`、`lg` 的项目高度分别为 24px、28px、32px，字号取 `--text-xs`、`--text-sm`、`--text-md`；最小宽度依次为 24px、28px、32px。选中项使用面板底色和强调色文字，未选中项在悬停时增强背景和文字对比。组宽随内容伸缩，垂直模式将项目纵向排列。

在 `390×844` 窄屏中，横向组保持单行并可被父级约束；组件自身不提供滚动。选项较多或标签较长时由父级选择纵向排列或提供外层滚动。

## 交互

- 值是按下的项目的 `value` 数组；点一个项目切换它的按下状态，不影响其它项目。
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
    /** 按下的项目；传入时受控；默认 undefined */
    modelValue?: string[];
    /** 非受控初值；默认 undefined */
    defaultValue?: string[];
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
    /** 按下的项目变化时发出 */
    (event: "update:modelValue", value: string[]): void;
};

type ToggleGroupSlots = {
    /** options 为空时作为项目内容；可省略 */
    default?: () => unknown;
};
```

没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认规则落在根 `ToggleGroupRoot` 上，最终 DOM 透传细节由 Reka 决定。

`state:local` 来自省略 `modelValue` 时，上游在组件实例内持有的 `defaultValue` 后选择状态；传入 `modelValue` 时选择值归父组件持有。组件没有 store、请求或持久化通道。

## 状态

- 默认：按下的项目由 `modelValue` 或非受控初值决定。
- 禁用：全组或单项禁用时不可操作，禁用项降低不透明度。
- 空数据：`options` 为空且默认插槽也为空时显示空组容器。
- 只读、加载、错误：没有统一只读、加载或错误状态；宿主可禁用整个组并自行呈现业务反馈。

## 不支持

- 不支持单选：“几个里选一个”用 `SegmentedControl` 或 `RadioGroup`。
- 不支持非字符串选项值或 option 级自定义 slot；需要自定义视觉时使用默认插槽模式。
- 不支持同时将 `options` 数据与默认 slot 混合渲染。

## 上游边界

Reka UI（多选模式）负责按下状态、禁用处理、roving focus 与方向键行为。本组件负责选项映射、尺寸、方向及外观；上游未由组件显式固定的焦点细节和 DOM 结构不属于稳定合同。
