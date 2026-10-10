---
标签: []
别名: ["书脊", "Book Spine"]
---

# BookSpine

书架上的一根书脊（提案 [书架页](../../../../../../../docs/proposals/bookshelf.md) 的“书脊书架”）：竖排书名，厚度随字数，颜色取作品的主题色或按 id 取色档。它是 `SpineShelf` 列表框里的一个选项，只负责外观与选项语义；键盘、点击与打开由 `SpineShelf` 处理。

## 布局

- 高由 `height` 给出（`spineHeight(项目 id)`，200 到 220px 四档，真书高矮不一），宽由 `width` 给出（`spineWidth(字数)`，30 到 64px）。上下各一道细线像书的装订线，左右略暗、偏左一道亮，像书脊的圆度。
- 书名竖排（`writing-mode: vertical-rl`），宋体（`--font-display`）15px，字距 0.12em；拉丁字母随竖排侧转。放不下时末尾省略。
- 颜色：给了 `color` 时直接用，按它的明度选深色或浅色文字；没给时取 `hue` 档：色相从主题强调色起每档转 45°，明度与彩度固定，在四个主题、明暗两种配色里都是同一套和谐的色阶。
- `active`：上移 10px 并加 raised 阴影；悬停上移 4px。`prefers-reduced-motion` 下不移动，只加阴影。
- `running`：书脊底部一个小圆点，表示作品正在某个窗口里打开。

## 数据

```ts
type Props = {
    /** 选项的 DOM id：列表框用 aria-activedescendant 指向它。 */
    id: string;
    title: string;
    width: number;
    height: number;
    /** 0 到 7，`spineHue(项目 id)`。 */
    hue: number;
    /** `#rrggbb`；null 时用 hue。 */
    color: string | null;
    active: boolean;
    running: boolean;
    /** running 的可读说明（例如“已在一个窗口里打开”），作为圆点的 title。 */
    runningLabel: string;
};
```

无事件、无插槽。根元素是 `role="option"`，`aria-selected` 随 `active`。

## 状态

- 默认、`active`、悬停、`running` 四种外观可以叠加。
- 没有禁用、出错与加载状态：统计缺失时厚度按 0 字取最薄，不改外观。
