---
schema: nbook.task/v2
taskId: t01-research-and-design
status: planned
updated: 2026-11-05
---

# 调研与设计

## 目标与范围

弄清背景图片和主题该是什么关系，交开发者确认方向，再写 Spec 与计划。

- 先问清第一版哪里效果不好：这是重做的出发点，还没有问。
- 看 dsh 社区主题怎么处理背景、透明与文字可读性，从[主题列表](https://github.com/Renakoni/awesome-dsh-themes/blob/main/THEMES.md)按 Stars 取代表性的几个读上游仓库，调研写进 `docs/research/`，只写事实。
- 对照现有主题合同：[`theme/system.md`](../../../../../docs/specs/theme/system.md)、`packages/nb-ui/docs/authoring-themes.md`。
- 界面要拍板的部分走 design-review。

合同：待定，方向定了之后写 Spec；第一版的 `ui/backgrounds.md` 已删，要看从 git 历史取。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 第一版留下的可复用事实

都在 [t19 的证据](../../../w00025-editor/tasks/t19-background-image/README.md)里，是否沿用由这里的设计决定：

- 对比度的量法：把文字藏起来截图，逐像素和文字颜色算，并有正向对照（`impl-review-disposition.txt`、`contrast.txt`；e2e 在提交 `a9ec4f147` 的 `e2e/backgrounds.e2e.ts`）。
- 给窗口铺图时，子作用域覆盖 `--panel-surface` 行不通：派生变量已在根上算好，层数还会相乘。

## 下一步

等开发者说明第一版哪里效果不好，然后开始调研。
