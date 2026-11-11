# 品牌成品

NeuroBook 的标志、字标与看板娘心情组件，来自仓库内的品牌成品（[`brand/logo/06-production/`](../../../../../brand/logo/06-production/index.html)，由 [`brand/logo/tools/produce.py`](../../../../../brand/logo/tools/produce.py) 生成）。这里的文件是**复制件，不要手改**：要改造型或动画，改 `brand/logo/tools/` 里的定义再重新导出、再复制过来。

| 文件 | 来源 | 用法 |
| --- | --- | --- |
| `neurobook-lockup.svg` | `svg/lockup/neurobook-lockup-horizontal-ink.svg` | 标志 + 字标横排，墨色；经 `NeuroBookLockup.vue` 用 CSS mask 着色，跟随 `currentColor` |
| `neurobook-mark.svg` | `svg/mark/neurobook-mark-ink.svg` | 单独的标志，墨色；`NeuroBookMark.vue` 同样按 mask 着色 |
| `neurobook-mood.js` | `animation/neurobook-mood.js` | 原生自定义元素 `<neurobook-mood>`：十一种心情，带切换与循环动画，空闲时跟随鼠标；经 `NeuroBookMood.vue` 使用 |
| `../../web/public/favicon.svg` 等 | `web/` | 浏览器图标，`index.html` 引用 |
| `packages/nb-ui/themes/nbook/assets/fonts/fraunces-latin.woff2` | `fonts/Fraunces.ttf` 裁成拉丁子集（`pyftsubset`，保留全部可变轴） | 字标所用的 Fraunces，nbook 主题的拉丁展示字体；许可见同目录 `OFL-Fraunces.txt` |

标准色：赤红 `#871222`、象牙 `#F7F2EC`、墨 `#2E211B`、夜 `#1C1418`、金 `#E1B285`、深金 `#A8762F`。浅色底上首选“应用图标 + 字标”，深色底用反白；安全留白、最小尺寸见[品牌使用规范](../../../../../brand/logo/07-guidelines/index.html)。

`neurobook-mood` 的状态键：`focus`、`think`、`write`、`done`、`ask`、`error`、`idle`、`sleep`、`idea`、`shy`、`shy_more`；`variant="dark"` 透明底放深色背景；`paused` 停掉循环；系统设了减少动画时自动不动。
