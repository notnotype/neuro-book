---
标签: []
---

# AspectRatio

按指定宽高比约束内容区域的布局容器，适合保持封面、缩略图或媒体预览的固定画幅。它只控制容器比例，不负责加载、缩放或裁剪内容资源本身。

## 数据

```ts
type AspectRatioProps = {
    /** 宽高比；默认 16 / 9 */
    ratio?: number;
};

type AspectRatioSlots = {
    /** 放入受宽高比约束的内容 */
    default(): unknown;
};
```

没有 emits 或 expose。未声明的 attributes、`class` 与 `style` 交给唯一根 Reka `AspectRatio`；根容器额外使用 `overflow-hidden`，超出比例容器边界的内容会被裁切。

## 状态与边界

组件没有禁用、只读、加载、错误或空数据状态，也不持有业务状态。窄屏仍按 `ratio` 维持同一画幅，实际宽度由父级布局决定。

## 上游边界

Reka UI 负责按比例计算容器几何与内容定位。本组件只转交 `ratio`、提供默认内容插槽并裁切溢出；比例取值的校验及底层布局细节不属于本组件合同。