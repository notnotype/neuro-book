---
标签: [state:inject]
---

# FloatWindowHandles

浮动窗的手柄（[`ui/workbench-layout.md`](../../../../docs/specs/ui/workbench-layout.md)“应用内浮动”）：缩放，和键盘移动。放在 `NestedGrid` 的 `float-chrome` 插槽里，盖在窗的内容上面。只算矩形，不写文档，宿主决定写到哪。

## 布局与交互

- 指针：四边四角 8 个手柄，命中带贴着窗的边往里 6px（上边 3px：下面就是标签条，要留给拖动）。按下捕获指针，拖动中发 `preview`，松手发 `commit`，Esc 或失去捕获发 `preview(null)` 取消。负方向（左、上）同时改位置，到了尺寸上下限时对边不动（`resizeFloatRect`）。
- 键盘：只有两个能聚焦，别的 `tabindex="-1"`，不让 Tab 走八步。右下角手柄用方向键缩放；移动把手平时看不见，聚焦时才露出来，方向键移动。步长 10px，Shift 1px，每次发 `commit`。
- 不读全局 `window`、`document`。

## 数据

```ts
type Props = {
    /** 窗此刻的矩形（相对网格根，已夹取）：手势从这里开始。 */
    rect: GridRect;
    min: GridExtent;
    max: GridExtent;
    /** 移动把手的图标类：图标类要在宿主的样式引擎里，所以由宿主给。 */
    moveIconClass?: string;
};
type Emits = {
    /** 拖动中的矩形；null 是取消，回到 `rect`。 */
    (event: "preview", rect: GridRect | null): void;
    (event: "commit", rect: GridRect): void;
};
```

## 外观

手柄透明，只有光标（`ns-resize`、`nwse-resize` 这些）。焦点环走 `nb-ui-focus-ring`。层级由 `float-chrome` 的外层给。
