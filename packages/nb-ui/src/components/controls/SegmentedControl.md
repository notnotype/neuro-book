---
标签: []
---

# SegmentedControl

`SegmentedControl` 用紧凑的互斥选项在少量固定模式之间切换，例如列表/网格或显示范围。它将当前选项表现为一组 radio 按钮，并以滑动指示块强调选中项；与 `Tabs` 不同，它面向控件级模式切换，不承载对应的内容面板。

## 布局

根节点是带边框和浅底色的水平选项组，选中指示块位于选项下方并按选项数等分宽度。`fullWidth` 让组占满父容器宽度；否则宽度由内容决定。`wrap` 允许按钮换行，并隐藏滑动指示块。选项标签截断而不撑开布局；图标、标签与可选计数在同一项内排列。

在 `390×844` 下默认不换行；若项目总宽超过可用空间，应设置 `wrap` 或由父级约束。`fullWidth` 只改变组宽度，不会改变每项均分指示块的计算方式。

## 交互

- 点击启用的选项时发出 `update:modelValue`；值由父组件持有，组件不维护选择状态。
- 禁用选项不会响应点击或键盘导航。方向键 Right/Down 前进，Left/Up 后退，Home/End 跳到首/末个启用项；移动会循环并发出新值，同时把焦点移到目标选项。
- 每个选项使用 `role="radio"`、`aria-checked` 和选中项 roving tabindex；根节点为 `role="group"`，可通过 `ariaLabel` 命名。
- `title` 优先作为选项可访问名称和悬停提示，否则使用 `label`。选项本身的 `iconClass` 是装饰性图标，不进入可访问名称。

## 数据

```ts
export type SegmentedControlValue = string | number | boolean | null;
export type SegmentedControlSize = "xs" | "sm";
export type SegmentedControlTone = "default" | "accent" | "warning";

export type SegmentedControlOption = {
    /** 右侧计数；默认不显示 */
    count?: number | string;
    /** 是否禁用该选项；默认 false */
    disabled?: boolean;
    /** 装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 可见标签；必填；允许空字符串，此时无标签文字 */
    label: string;
    /** 透传到按钮的数据测试标识；默认 undefined */
    testId?: string;
    /** 原生 title 与可访问名称；默认回退到 label */
    title?: string;
    /** 选项色调；默认 undefined；当前未应用，见已知偏差 */
    tone?: SegmentedControlTone;
    /** 选项值；必填，应唯一 */
    value: SegmentedControlValue;
};

type SegmentedControlProps = {
    /** 当前选中值；必填、受控 */
    modelValue: SegmentedControlValue;
    /** 选项；必填，顺序决定显示顺序 */
    options: SegmentedControlOption[];
    /** radio 组可访问名称；默认空字符串（空时不设置 aria-label） */
    ariaLabel?: string;
    /** 项目尺寸；默认 "sm" */
    size?: SegmentedControlSize;
    /** 控件色调；默认 "default"；当前实现未应用该值，见已知偏差 */
    tone?: SegmentedControlTone;
    /** 是否允许选项换行；默认 false；为 true 时不显示滑动指示块 */
    wrap?: boolean;
    /** 是否占满父容器宽度；默认 false */
    fullWidth?: boolean;
};

type SegmentedControlEmits = {
    /** 用户选择另一个启用项时发出其 value */
    (event: "update:modelValue", value: SegmentedControlValue): void;
};

type SegmentedControlSlots = {};
```

没有 slot 或 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落在根分组 `<div>` 上。选中状态严格使用 `option.value === modelValue` 比较；值应唯一，且需与支持的原始类型一致。

## 状态

- 默认：匹配 `modelValue` 的选项被标为选中并显示指示块；没有匹配项时不显示选中项或指示块。
- 禁用：单个禁用选项降低透明度并不可激活、不可由方向键选中。
- 空选项：不显示按钮或指示块，根组仍存在。
- 只读、加载、错误：组件没有统一状态；需要禁止修改时由父组件提供全禁用方案或不渲染控件。

## 不支持

- 不支持多选、动态搜索、选项插槽或在组件内保存选择。
- 不支持在 `wrap` 模式下显示连续滑动指示块。
- `count` 仅展示为计数，不隐含数据过滤或状态语义。

## 已知偏差

- 顶层 `tone` 与每个 option 的 `tone` 都有类型和默认值，但当前模板没有读取它们；传入不同色调不会改变外观。本文不把它们描述为已生效能力，实现待订正。
- 按键后聚焦目标选项时，组件以 `String(option.value)` 查找 DOM 项；当启用项使用不同类型但字符串表示相同的值（例如 `1` 和 `"1"`）时，焦点可能落到另一项。避免在同一组内混用这种可碰撞的值。
