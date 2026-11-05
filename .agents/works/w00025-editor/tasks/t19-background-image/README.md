---
schema: nbook.task/v2
taskId: t19-background-image
status: done
updated: 2026-11-05
---

# 背景图片与护眼底色

## 目标与范围

开发者 2026-11-05 提出：背景图片（自定义壁纸）与护眼模式，也借此验证编辑器的可访问性。行为合同待写。已有的设计依据：[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（图片是 `user://backgrounds/` 下的文件，配置记引用、透明度与填充方式）、[nb-ui 表面模型](../../../../../docs/proposals/nb-ui-surface-model.md)（一个应用只有一层材质、面板叠在照片上的可读性问题）。Lab 已有壁纸，存在 IndexedDB，只作参照。

## 开发者的决定

1. （2026-11-05）背景有多种，现在有两种：正文（编辑器区）与整个窗口，都做。
2. （2026-11-05）护眼模式：图片之外，再给几个纯色底。
3. （2026-11-05，计划）设置是应用级的；源码编辑器也透出背景。
4. （2026-11-05，`r2-legibility`）读得动靠模糊开关与遮罩下限：开模糊下限 75%，关模糊下限 92%，缺省开模糊、遮罩 85%；实际下限按配色算，可能更高。取代第 3 条原来的“下限 75%”。

## 当前状态

已合入 master。计划：[plan.md](plan.md)。Spec：[`ui/backgrounds.md`](../../../../../docs/specs/ui/backgrounds.md)（`implemented`）。

- 设计审查：前端 12 条、后端 6 条，[处理](evidences/design-review-disposition.txt)。
- 实现审查：前端 18 条、后端 7 条，[处理](evidences/impl-review-disposition.txt)。
- 可访问性：[量出来的对比度](evidences/contrast.txt)，三张图、nbook 与 macos 的明暗、正文与窗口两种背景，遮罩取下限。

实施时的改动：遮罩下限模糊时按这张图实际最亮、最暗处算（一律按最坏情况时 nbook 被顶到 90–92，模糊的 75 没有意义）；背景页不写说明文字，改搜索关键词。

## 遗留

- Hono 插件路由抛错时走默认处理器（纯文本 500、不进诊断、客户端断开打印栈），所有插件路由都这样，不属于本 Task。
- 设置窗口开着时缩窄浏览器窗口，浮窗不跟着移回来（在窄窗口里重新打开正常）。未确认是否既有，未改。
