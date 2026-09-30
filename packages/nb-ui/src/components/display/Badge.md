---
标签: []
---

# Badge

`Badge` 是行内状态徽标，用于在标题、列表项或操作旁附加简短分类、状态或计数。它把状态色调、实心/柔光/镂空外观、尺寸、圆点和图标组合在一个紧凑元素中，内容由默认插槽提供。

## 布局与交互

徽标按内容宽度横向排列、不收缩、不换行；可选状态圆点、图标、默认插槽文字和末尾计数依次出现。`size` 选择紧凑或标准尺寸。`variant` 控制实心、柔光或透明描边表面；`tone` 控制中性、强调、成功、警告或危险色。实心使用反色文字，warning 色调基于状态警告色加深。

组件是静态展示元素，没有点击或键盘交互，不增加状态语义 role。

## 数据

```ts
type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";
type BadgeVariant = "solid" | "soft" | "outline";
type BadgeSize = "sm" | "md";

type BadgeProps = {
    /** 状态色调；默认 "neutral"。 */
    tone?: BadgeTone;
    /** 表面变体；默认 "solid"。 */
    variant?: BadgeVariant;
    /** 尺寸；默认 "md"。 */
    size?: BadgeSize;
    /** 是否在文字前显示同色圆点；默认 false。 */
    dot?: boolean;
    /** 图标 CSS class；默认空字符串，不显示图标。 */
    iconClass?: string;
    /** 末尾计数；默认 undefined，不渲染计数。0 与空字符串也会渲染。 */
    count?: number | string;
};

type BadgeEmits = Record<never, never>;

type BadgeSlots = {
    /** 徽标主要文字；可省略。 */
    default?(): unknown;
};
```

无 expose API。未声明 attrs、`class` 与 `style` 按 Vue 默认行为透传至根 `span`。徽标本身不声明隐藏通道。

## 状态与边界

组件没有受控状态、禁用、只读、加载、错误或空数据状态。空默认插槽时仍可单独呈现圆点、图标或计数；所有内容为空时只留下徽标外观。

## 不支持

- 不为圆点、图标或计数自动生成可访问名称，也不推断这些内容的业务含义。
- 不提供交互、动画状态控制、计数上限或数字格式化。
