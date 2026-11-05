---
schema: nbook.task/v2
taskId: t01-research-and-design
status: active
updated: 2026-11-05
---

# 调研与设计

## 目标与范围

弄清背景图片和主题该是什么关系，交开发者确认方向，再写 Spec 与计划。

- 看 dsh 社区主题怎么处理背景、透明与文字可读性（已完成，见下一步）。
- 对照现有主题合同：[`theme/system.md`](../../../../../docs/specs/theme/system.md)、`packages/nb-ui/docs/authoring-themes.md`。
- 界面要拍板的部分走 design-review。

合同：待定，方向定了之后写 Spec；第一版的 `ui/backgrounds.md` 已删，要看从 git 历史取。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 开发者的决定

1. （2026-11-05）要的是整套主题换皮肤，不是“单独贴一张图”；也不是把图片放到最底层，靠半透明磨砂产生效果。

## 第一版留下的可复用事实

都在 [t19 的证据](../../../w00025-editor/tasks/t19-background-image/README.md)里，是否沿用由这里的设计决定：

- 对比度的量法：把文字藏起来截图，逐像素和文字颜色算，并有正向对照（`impl-review-disposition.txt`、`contrast.txt`；e2e 在提交 `a9ec4f147` 的 `e2e/backgrounds.e2e.ts`）。
- 给窗口铺图时，子作用域覆盖 `--panel-surface` 行不通：派生变量已在根上算好，层数还会相乘。

## 下一步

调研已写：[DSH 社区皮肤的做法](../../../../../docs/research/dsh-community-skins.md)。等开发者定方向（皮肤的范围、接入方式、第一套样例），再出静态稿。
