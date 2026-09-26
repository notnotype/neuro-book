---
标签: []
别名: ["滚动区域", "Scroll Container"]
---

# ScrollArea

带自绘滚动条的滚动容器：内容超出时在它内部滚动，滚动条按需出现或隐藏，外观取主题颜色而不是操作系统的原生样式。它和直接写 `overflow-auto` 的差别只有两点——滚动条的显现时机可控（默认悬停时才出现，不长期占用视觉宽度），以及滚动条外观跟着主题走。它不管理数据、不感知内容，只负责「一块可以被滚动的区域」。

组件本身没有状态：三个 prop 全部转交给底层的 Reka UI ScrollArea 原语。

## 数据

```ts
type ScrollAreaType = "auto" | "always" | "scroll" | "hover";
type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

type ScrollAreaProps = {
    /** 滚动条的显现策略；默认 "hover" */
    type?: ScrollAreaType;
    /** 指针离开后滚动条淡出的延迟（毫秒）；默认 600 */
    scrollHideDelay?: number;
    /** 渲染哪几条滚动条；默认 "vertical" */
    orientation?: ScrollAreaOrientation;
};

type ScrollAreaSlots = {
    /** 被滚动的内容 */
    default(): unknown;
};
```

没有 emits，没有 expose。未声明的 attribute 以及 `class` / `style` 落在唯一根节点上（Reka 的滚动区域根，`relative overflow-hidden`），与它自带的类合并。

`type` 四种取值的含义：`hover`（默认，指针进入时出现、离开后按 `scrollHideDelay` 淡出）、`scroll`（滚动期间出现）、`auto`（内容溢出时常驻）、`always`（常驻）。这些时机由底层实现，本组件只把值转交过去。

## 状态与边界

组件没有默认、禁用、加载、出错、空数据这些状态——它就是一块滚动区域，内容自己表达状态。

## 不支持

- 不支持受控滚动位置：没有滚动位置相关的 prop 或 emits，也没有 expose 拿内部视口元素，要从外部把内容滚到指定位置只能自己按 DOM 结构找元素。
- 不支持转发滚动事件：滚动过程中的位置变化不报给调用方。
- 不支持自定义滚动条的宽度、颜色或圆角；组件只消费主题色，尺寸写死。
- 不支持在内容不足时也强制画一条「空轨道」以外的任何形态；没有间距、内边距之类的样式口子（要改只能靠外层容器）。

## 上游边界

Reka UI 负责滚动条的出现与消失（含 `scrollHideDelay` 的计时）、拇指拖动、`type` 的四种语义、视口与滚动条之间的关联（含无障碍属性）、原生滚动条的隐藏，以及内容不足以撑满时的判断。本组件承诺的只有：按 `orientation` 渲染对应的滚动条、它们的尺寸与配色（轨道用 `w-2.5` / `h-2.5` 加 0.5 单位内边距、拇指取 `--text-main` 的透明度变体并在悬停时加深、过渡用 `--motion-fast` 与 `--ease-standard`）、以及两轴都渲染时的右下角补角。上游的其他行为不在本组件的合同内，升级底层库时可能变化。

## 注意事项

- **必须由父容器给出受约束的尺寸。** 根节点是 `overflow-hidden`、视口是 `h-full w-full`，父级不给高度（或宽度）时组件只会按内容长高，永远不出现滚动。放进 flex 布局时通常要配 `flex-1` / `min-h-0`。
- **`orientation` 决定的不只是画哪几条滚动条，还决定内容能不能滚。** 没有滚动条的那根轴是 `overflow: hidden`，内容会被裁掉而不是「没有条但仍可滚」——只给 `vertical` 时横向超出的内容看不见也滚不到。
