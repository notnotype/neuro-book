---
标签: [state:inject]
---

# FloatWindowHandles

浮动窗的手柄：缩放，和键盘移动。放在 `NestedGrid` 的 `float-chrome` 插槽里，盖在窗的内容上面。只算矩形，不写文档，宿主决定写到哪。

这里的浮动窗是页面里的窗，不是操作系统的窗口，也不是浏览器的弹出窗口：`NestedGrid` 的 `floats` 里的一块叶，不在布局树里，矩形由宿主给（相对网格根），压在树里的面板上面（见 [NestedGrid](NestedGrid.md) 的“交互”里 `floats` 那一段）。窗回到树里、从树里拖出来都由宿主改树与 `floats`，本组件只管窗已经浮着时的缩放与键盘移动；指针拖标题栏移动整个窗不归它管。

把窗的矩形夹进一块区域、按手柄方向改尺寸的纯函数是根入口的 `clampFloatRect`、`resizeFloatRect`（包 [README](../../README.md) 的“我要做 X 用哪个导出”），本组件拖动时用的就是后者：`max` 与 `area` 原样进它的 `bounds`。

## 布局与交互

- 指针：四边四角 8 个手柄，命中带贴着窗的边往里 6px（上边 3px：下面就是标签条，要留给拖动）。按下捕获指针，拖动中发 `preview`，松手发 `commit`（没动不发），Esc 或失去捕获发 `preview(null)` 取消。负方向（左、上）同时改位置，到了尺寸上下限时对边不动（`resizeFloatRect`）。
- 边界：给了 `area`（相对网格根的矩形），指针与键盘缩放时跟着动的边都不越过它；起点就在区域外的边不再往外，也不往里跳。`max` 是尺寸上限，可以不给（不限）；两个都给时取小，最小尺寸优先。
- 松手的先后：同一个同步段里先发 `preview(null)`，再发 `commit(rect, direction)`；Esc 与失去捕获只发 `preview(null)`。`direction` 是这次动的边（形状同 `LayoutFloatResize`，0 是这一轴没动；键盘缩放是右下角）。`rect` 从传进来的 `rect` 算起，那是已夹取的呈现矩形，没动的那一轴在 `commit` 里也是夹过的值：要保住记录的宿主只取 `direction` 不为 0 的轴，别的轴从记录取。
- 冒泡：手柄在 `pointerdown`、`keydown` 里阻止冒泡（不让外层把它当成拖标题栏或别的快捷键）。宿主要在按下窗的任何地方时把它提到最前，接 `NestedGrid` 的 `float-raise`，或在外层的捕获阶段听，挂在冒泡阶段的监听收不到按在手柄上的那一下。
- 键盘：只有两个能聚焦，别的 `tabindex="-1"`，不让 Tab 走八步。右下角手柄用方向键缩放；移动把手平时看不见，聚焦时才露出来，方向键移动。步长 10px，Shift 1px，每次发 `commit` 或 `move`。
- 不读全局 `window`、`document`。
- `state:inject`：两个能聚焦的把手的读屏名称经 `LAYOUT_TEXT_KEY` 注入的翻译函数取，同 [Splitter](Splitter.md) 的“文字”。

## 数据

```ts
type Props = {
    /** 窗此刻的矩形（相对网格根，已夹取）：手势从这里开始。 */
    rect: GridRect;
    min: GridExtent;
    /** 尺寸上限；不给时不限。 */
    max?: GridExtent;
    /** 缩放的边界（相对网格根）：跟着指针的边不越过它。不给时只按 `min`、`max`。 */
    area?: GridRect;
    /** 移动把手的图标类：图标类要在宿主的样式引擎里，所以由宿主给。 */
    moveIconClass?: string;
};
type Emits = {
    /** 拖动中的矩形；null 是取消，回到 `rect`。 */
    (event: "preview", rect: GridRect | null): void;
    /** 松手或键盘缩放一步：`direction` 是动的边，没动的那一轴 `rect` 里是夹过的值。指针松手时紧跟在 `preview(null)` 之后。 */
    (event: "commit", rect: GridRect, direction: LayoutFloatResize): void;
    /** 键盘移动：只有位置，大小由宿主从记录取（窗被夹着时 `rect` 是夹过的）。 */
    (event: "move", position: {readonly x: number; readonly y: number}): void;
};
```

## 外观

手柄透明，只有光标（`ns-resize`、`nwse-resize` 这些）。焦点环是本包全局样式里的 `nb-layout-focus-ring`（读 `--nb-layout-focus-ring`、`--nb-layout-focus-outline`，装了 nb-ui 时与它的焦点环一样）。层级由 `float-chrome` 的外层给。
