---
标签: [env:portal]
---

# DropSectorsOverlay

落点分区（[`ui/workbench-layout.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/workbench-layout.md)“落点分区”）：拖动经过面板正文时，把这块面板能往哪放画出来，形状就是判定的形状。它只画宿主给的东西：每块的 id 与多边形由宿主算（工作台用 `@notnotype/nb-workbench-layout` 的 `layoutDropSectors`），当前块、字与开关归宿主。

## 布局与交互

Teleport 到 `body`，固定定位在 `rect` 上，不接指针。整块压暗（不透明度加调暗，不模糊），每块是一个多边形，线与底色都走变量；当前块线更粗、底更深。

每块可以写一个字样：写在这块外接盒的中心，外接盒小于 96×28px 时不写，当前块不写（`DropFeedbackOverlay` 的提示在说它）。

出现时淡入（`--nb-layout-motion-fast`），换面板时复用节点，不重放也不过渡位置。减少动效时直接出现。整层 `aria-hidden`：播报由 `DropFeedbackOverlay` 负责。

## 数据

```ts
type Props = {
    /** 这块面板正文的矩形（视口坐标）；没有为 null，整层不渲染。 */
    rect: GridDropRect | null;
    sectors: ReadonlyArray<{readonly id: string; readonly points: ReadonlyArray<readonly [number, number]>}>;
    /** 指针此刻落在哪块；没有为 null。 */
    active: string | null;
    /** 每块写的字；不给不写。 */
    labels?: Readonly<Record<string, string | undefined>>;
};
```

无 emits、slots、expose。attrs 落在覆盖层根上。标记：根是 `data-drag-feedback`、`data-drop-sectors`；每块是 `data-drop-sector="<id>"`（宿主给的 id，工作台的取值是 `left`、`right`、`top`、`bottom`、`center` 与整块的 `whole`），当前块另有 `data-drop-sector-active`；字是 `data-drop-sector-label`。

## 布局与状态

装了 nb-ui 时，前三行经它的桥接取主题的 `--layout-scrim`、`--layout-sector-*`。

| 变量 | 作用 |
|---|---|
| `--nb-layout-scrim` | 压暗的颜色 |
| `--nb-layout-sector-fill`、`--nb-layout-sector-line` | 每块的底色与线 |
| `--nb-layout-sector-active-fill`、`--nb-layout-sector-active-line` | 当前块的底色与线 |
| `--nb-layout-sector-radius` | 整层的圆角；缺省 0。不是主题令牌：宿主写在 attrs 落到的根上（工作台给卡片下面两个角） |

层级取 `--nb-layout-z-drop-sectors`（nb-ui 的桥接给层级登记表里的 `dropSectors`，缺省 59），低于 `DropFeedbackOverlay` 的 `--nb-layout-z-drop-feedback`（缺省 60）：提交后的矩形要压在分区上面。

`forced-colors` 下去掉压暗（系统色会把它变成不透明的底），线用 `CanvasText`，当前块用 `Highlight` 且更粗；`prefers-contrast: more` 时线用当前块那条。

## 不支持

- 点击分区：它不接指针。
