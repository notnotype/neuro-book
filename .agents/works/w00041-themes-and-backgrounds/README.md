---
schema: nbook.work/v1
workId: w00041-themes-and-backgrounds
issueId: null
status: done
updated: 2026-11-07
---

# 主题与背景重新设计

## 目标

把背景图片放进主题体系重新设计，参考 dsh 社区主题的做法

## 由来

开发者 2026-11-05 体验 w00025 t19 的背景功能后说：“背景图片这里需要重做。效果不是很好，可以先删掉。同时背景图片这里涉及到主题。具体怎么做可以开一个 work，同时可以参考 dsh 社区主题是怎么处理的。”

## 参考

- [Awesome DSH Themes 的主题列表](https://github.com/Renakoni/awesome-dsh-themes/blob/main/THEMES.md)：DeepSeek Harness 的社区主题合集，收录 132 个主题，每个主题有预览图与上游仓库。
- 第一版的记录：[w00025 t19](../w00025-editor/tasks/t19-background-image/README.md)，代码已从 master 撤销，最后一版是提交 `a9ec4f147`。

## 待确认清单

自主推进时记下的、等开发者追认的决定：[pending-confirmations.md](pending-confirmations.md)

## 完成情况

2026-11-07 收口。t01 到 t17 全部完成并合入 master（未 push）：主题声明与场景（t02 到 t07）、主题编辑器与素材管线（t08 到 t12）、场景提供者显示名、书房工作态场景、图标名目录、素材清理、加载页的主题（t13 到 t17）。待追认的决定都在 [pending-confirmations.md](pending-confirmations.md)，开发者 2026-11-07 说明无异议的按默认追认处理。

没有做、也没有排期的事（均为可选后续，需要时另开 Task）：主题切换的交叉淡入、Agent 更细状态的场景、`workbench.themes` 的 `title` 补全、加载页自定义动画素材、加载页场景图的 preload。
