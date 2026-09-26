---
标签: [state:local]
---

# Accordion

把一组标题与内容组织成可展开的纵向章节。它提供两种内容接入方式：用 `items` 快速生成统一样式的章节，或在 `items` 为空时完全由默认插槽提供自定义结构；这使数据驱动列表与自定义 Reka Accordion 项可以共用同一状态外壳。

## 布局与交互

容器占满父级宽度，带面板边框、圆角和分隔线。数据项的触发区包含可选图标、标题、副标题和展开箭头；标题与副标题单行截断，内容区在下方展开。窄屏保持纵向结构，触发区文字可用宽度随容器收缩。

点击或用键盘激活某项会切换其展开状态，并发出 `update:modelValue`。`type="single"` 时按单项模式工作，`type="multiple"` 时按多项模式工作；是否允许关闭当前展开项由 `collapsible` 决定。键盘焦点移动和展开语义由 Reka UI 管理。

## 数据

```ts
interface AccordionItemData {
    /** 项的稳定标识，也用于匹配 content-<value> 插槽 */
    value: string;
    /** 标题文字 */
    title: string;
    /** 可选副标题；默认不显示 */
    subtitle?: string;
    /** 无对应内容插槽时显示的文本；默认不显示 */
    content?: string;
    /** 可选图标 class；默认不显示图标 */
    iconClass?: string;
    /** 禁用此项；默认 false */
    disabled?: boolean;
}

type AccordionProps = {
    /** 当前展开项；单项/多项模式分别使用 string / string[]；受控值 */
    modelValue?: string | string[];
    /** 非受控初始展开项；默认 undefined */
    defaultValue?: string | string[];
    /** 展开模式；默认 "single" */
    type?: "single" | "multiple";
    /** 单项模式下允许收起当前项；默认 true */
    collapsible?: boolean;
    /** 禁用整个手风琴；默认 false */
    disabled?: boolean;
    /** 数据项；默认 []。非空时启用数据驱动渲染 */
    items?: AccordionItemData[];
};

type AccordionEmits = {
    /** 展开项变化时发出；受控用法由父组件回写 */
    (event: "update:modelValue", value: string | string[]): void;
};

type AccordionSlots = {
    /** items 为空时渲染的自定义手风琴内容 */
    default(): unknown;
    /** 对应项优先渲染的自定义内容，slot props 为该项数据 */
    [name: `content-${string}`]: (props: {item: AccordionItemData}) => unknown;
};
```

当 `items` 非空时默认插槽不渲染；每项按 `content-${item.value}` 查找内容插槽，未提供时显示 `item.content`。没有 expose。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `AccordionRoot`；具体 DOM 透传位置由 Reka 决定。

## 状态与边界

- `modelValue` 提供受控展开状态；未提供时使用 `defaultValue` 作为非受控初值。
- `disabled` 禁用整组；单项 `disabled` 只禁用对应项。
- 空数据且无默认插槽时只保留手风琴容器，不显示占位内容。
- 不支持内置加载、错误或空状态；这些内容需由插槽表达。

## 上游边界

Reka UI 负责单项/多项展开状态、触发器语义、键盘导航与内容展开生命周期。本组件承诺数据项展示、两种 slot 渲染路径和 nb-ui 样式；其余交互细节不作承诺，可能随 Reka UI 升级变化。