---
标签: [state:local]
别名: ["浮动窗轨宽手柄", "Float rail handle"]
---

# WorkbenchFloatRailHandle

单标签浮动窗里展开的视图段的轨宽手柄（docs/specs/ui/workbench-layout.md 输出 51 的“矩形”）：画在窗的零件层（`NestedGrid` 的 `float-chrome` 插槽，坐标相对窗），竖在视图段内侧那条边上，只改这扇窗的轨宽。

## 布局与交互

- 位置：离窗的右边 `width`（此刻生效的视图段宽）那条竖线上，6 像素宽、贯通窗高；悬停、聚焦与拖动中画强调色。
- 指针：往左拖变宽、往右拖变窄。窗的右边不动，左边跟着长，手柄一直在指针下（呈现规则在 store 的 `floatGrowth`）。每帧至多交一次 `preview`，触界即停（夹进 `bounds`），松手交一次 `commit`；Esc、失去指针捕获、`revision` 在手势中变了整场取消。
- 键盘：左右方向键每次 10 像素，Home 回缺省；双击回缺省。每次是一次提交。
- 与网格的分隔线、窗的缩放手势互斥：根上有 `data-workbench-dragging` 时按下不起拖。
- 读屏：`role="separator"`、`aria-orientation="vertical"`、`aria-valuenow`（拖动中跟着走）、`aria-valuemin`、`aria-valuemax`，名称是 `label`。

## 数据

```ts
type WorkbenchFloatRailHandleProps = {
    /** 此刻生效的视图段宽（卡片宽，CSS px）。 */
    width: number;
    /** 能拖到的范围与缺省宽（store 的 `floatRailHandle`：声明的范围里，窗放得进、左边不出界）。 */
    bounds: {minimum: number; maximum: number; width: number};
    /** 布局版本：手势中变了就整场取消。 */
    revision: unknown;
    label: string;
};

type WorkbenchFloatRailHandleEmits = {
    (e: "preview", width: number | null): void;
    (e: "commit", width: number): void;
};
```

根上写 `data-float-rail-handle`，拖动中另写 `data-dragging`。

## 状态

拖动中与没在拖两种，见上。

## 不支持

- 不管展开与收起：那是视图段底下的按钮（视图画的）。
- 不夹窗的位置：窗靠右、靠左时怎么摆由 store 的 `renderedFloats` 算。

## 隐藏通道理由

`state:local`：拖动中的手势会话（起点、指针、布局版本）与这一帧要交的预览，见 `use-rail-handle.ts`。
