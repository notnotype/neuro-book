---
标签: []
---

# DropIndicator

`DropIndicator` 是拖放反馈的无障碍隐藏装饰容器，以 `variant` 标记区域、条目或插入线三种语义形状。它只负责提供稳定的包裹节点和插槽，不计算落点、不定位，也不决定颜色或尺寸。

## 数据

```ts
type DropIndicatorVariant = "area" | "entry" | "line";

type DropIndicatorProps = {
    /** 供 data-drop-indicator 标识该装饰形状；必填。 */
    variant: DropIndicatorVariant;
};

type DropIndicatorSlots = {
    /** 形状内部内容；可留空。 */
    default(): unknown;
};
```

组件没有 emits。根节点是 `aria-hidden="true"` 的 `div`，并带 `data-drop-indicator="<variant>"`。未声明的 attrs、class 与 style 按单根节点的 Vue 默认行为落到该 div。组件没有 expose API。

## 状态与边界

组件始终只渲染包裹节点；尺寸、定位、视觉皮肤、动效和拖放状态均由调用方提供。它不接收也不发出拖放数据，不处理空内容、禁用或错误状态。

## 不支持

- 不计算命中区域、插入位置或业务含义。
- 不提供默认样式、定位、动画或可访问播报；装饰节点始终从辅助技术树隐藏。
