---
schema: nbook.task/v2
taskId: t19-background-image
status: planned
updated: 2026-11-05
---

# 背景图片与护眼底色

## 目标与范围

开发者 2026-11-05 提出：背景图片（自定义壁纸）与护眼模式，也借此验证编辑器的可访问性。行为合同待写。已有的设计依据：[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（图片是 `user://backgrounds/` 下的文件，配置记引用、透明度与填充方式）、[nb-ui 表面模型](../../../../../docs/proposals/nb-ui-surface-model.md)（一个应用只有一层材质、面板叠在照片上的可读性问题）。Lab 已有壁纸，存在 IndexedDB，只作参照。

## 当前状态

第 1 轮在[评审板](artifacts/review/index.html)上待开发者选：放在哪里、护眼怎么做。已量的对比度写在评审板上。

## 下一步

定了之后写 Spec 与计划。
