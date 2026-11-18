# NeuroBook 品牌标识（Logo）

本目录是 NeuroBook 品牌标识与心情差分系统的**单一源码源**（定稿生成器 + 成品导出 + 使用规范）。

产品与应用文档中引用的品牌资源（[`packages/neuro-book/src/ui/brand/`](../../packages/neuro-book/src/ui/brand/README.md)、[`packages/neuro-book/src/web/public/`](../../packages/neuro-book/src/web/public/)、[`packages/neuro-book/desktop/assets/`](../../packages/neuro-book/desktop/assets/)、[`docs/images/readme/`](../../docs/images/readme/README.md)）都是从这里的 `06-production/` 复制过去的，不要在下游手工编辑。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| [`01-brief.md`](01-brief.md) | 标识设计简报与第 1–21 轮收敛决策记录 |
| [`tools/`](tools/) | 定稿几何、字标轮廓、心情差分、动画与导出脚本 |
| [`06-production/`](06-production/index.html) | 导出的全套成品（SVG、PNG、桌面图标、Web 图标、24 位色终端 ANSI、`<neurobook-mood>` Web 组件与循环动画） |
| [`07-guidelines/`](07-guidelines/index.html) | 标识使用规范网页（标准色、安全留白、最小尺寸、心情差分、动画与常见误用） |

前期调研、草图与精修探索过程（`02-research/`–`05-refine/`、`archive/`、候选字体与草图脚本）保留在开发者本机 `.local/brand/logo-archive/`，不进入 Git。

## 标准色

| 名称 | 色值 | 用途 |
| --- | --- | --- |
| 赤红（Crimson） | `#871222` | 应用图标底块、浅色底标志主色 |
| 象牙（Ivory） | `#F7F2EC` | 赤红/深色底上的猫与书本体 |
| 墨（Ink） | `#2E211B` | 浅色底字标与单色标志 |
| 夜（Night） | `#1C1418` | 深色背景参考色 |
| 金（Gold） | `#E1B285` | 赤红/深色底上的光环、封面边框与赤星之节外环 |
| 深金（Deep Gold） | `#A8762F` | 象牙底上的光环、封面角饰与星徽 |

## 重新生成

导出成品与规范页面（需要 `uv` 与本机 `resvg`；默认不重录视频并保留现有 `neurobook-moods-tour.webm`）：

```bash
uv run --no-project --with shapely python brand/logo/tools/produce.py --no-video
uv run --no-project --with shapely python brand/logo/tools/guidelines.py
```

如需重录轮播视频（需要根 `node_modules/playwright`、Chrome 与 `ffmpeg`），去掉 `--no-video`；如需额外导出聊天用 `.gif`，加 `--gif`。字标轮廓已固化在 `tools/wordmark.json`，重跑 `tools/wordmark.py` 时可通过环境变量 `NEUROBOOK_FRAUNCES_FONT` 指定 `Fraunces.ttf` 路径。

## 许可

本目录下的标识、脚本与导出成品随仓库按 [AGPL-3.0-only](../../LICENSE) 提供；字标轮廓源自 Fraunces（SIL Open Font License 1.1，许可证文本见 [`packages/nb-ui/themes/nbook/assets/fonts/OFL-Fraunces.txt`](../../packages/nb-ui/themes/nbook/assets/fonts/OFL-Fraunces.txt)）。
