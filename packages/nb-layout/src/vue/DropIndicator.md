---
标签: []
验证入口: DropFeedbackOverlay
---

# DropIndicator

`DropIndicator` 是 [`DropFeedbackOverlay`](DropFeedbackOverlay.md) 的内部件，不从包入口导出：拖放反馈要画区域、条目或插入线时用覆盖层，不直接用它。它是无障碍隐藏的装饰容器，以 `variant` 标记区域、条目或插入线三种语义形状。它提供稳定的包裹节点和插槽，并由全局样式按 `variant` 给皮肤；不计算落点、不定位，也不决定尺寸。

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

组件没有 emits。根节点是 `aria-hidden="true"` 的 `div`，不可选中、不接管指针，并带 `data-drop-indicator="<variant>"`。未声明的 attrs、class 与 style 按单根节点的 Vue 默认行为落到该 div。组件没有 expose API。

## 状态与边界

组件始终只渲染包裹节点；尺寸、定位、几何动效和拖放状态均由调用方提供，皮肤来自全局样式：`area` 与 `entry` 是 1px `--drop-area-border` 描边、`--drop-area-fill` 底色、`--radius-control` 圆角加 `--elevation-raised`，只带不透明度过渡；`line` 是 `--accent-main` 实色、`--radius-pill` 圆角，带一圈同色光晕，没有任何过渡。减少动效时取消过渡。它不接收也不发出拖放数据，不处理空内容、禁用或错误状态。

## 不支持

- 不计算命中区域、插入位置或业务含义。
- 不提供定位、几何动画或可访问播报；装饰节点始终从辅助技术树隐藏。
