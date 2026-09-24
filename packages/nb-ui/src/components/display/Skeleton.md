---
标签: []
---

# Skeleton

`Skeleton` 是数据尚未就绪时使用的装饰性骨架占位，不承载内容或加载状态；它用文本行、块或圆形轮廓表达预期尺寸，并对辅助技术隐藏。

## 数据

```ts
type SkeletonShape = "text" | "block" | "circle";

interface SkeletonProps {
    /** 占位轮廓；可选，默认 "text" */
    shape?: SkeletonShape;
    /** CSS 宽度；可选，默认空字符串（使用形状默认宽度） */
    width?: string;
    /** CSS 高度；可选，默认空字符串（使用形状默认高度） */
    height?: string;
}

// 无 emits：组件不发出事件。
// 无 slots：组件不提供插槽。
```

`width`、`height` 是样式覆盖，不是受控状态；空字符串不生成对应的行内尺寸。默认轮廓分别为：`text` 使用全宽、`h-3.5` 高度与控件圆角；`block` 使用全宽、`h-20` 高度与面板圆角；`circle` 使用 `h-10 w-10` 与全圆角。任一非空尺寸可覆盖对应默认尺寸，骨架持续呈现脉冲动画。

根节点是 `aria-hidden="true"` 的 `span`。不提供 `expose` API；未声明的 attributes（包括 `class`、`style`）按 Vue 单根节点默认行为落到根节点。组件不支持内容插槽、加载控制或错误状态，是否显示及何时替换由父组件决定。
