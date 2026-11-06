---
标签: []
别名: ["品牌标志", "NeuroBook 图形标志"]
---

# NeuroBookMark

NeuroBook 单独的图形标志（捧书的猫，品牌成品，来源见同目录 `README.md`）。用在放不下横排标志（`NeuroBookLockup`）的窄标题栏与编辑区空态的水印。

## 布局

一个行内块，宽高相等，默认 `1em`，使用方用 `width`、`height` 或 `font-size` 定大小。成品 SVG 作为 CSS 遮罩、以 `currentColor` 填色：跟随文字颜色，深色主题下自然反白；要做淡水印时由使用方给颜色或透明度。

## 数据

| 属性 | 说明 |
|---|---|
| `decorative` | 纯装饰（旁边已有文字说明）：根节点 `aria-hidden="true"`，不带 `role` 与名称。缺省 `false`：根节点带 `role="img"` 与 `aria-label="NeuroBook"`。 |

没有事件。

## 不支持

不提供彩色版（赤红底块的应用图标版）；需要时另加组件，不在这里加 prop。
