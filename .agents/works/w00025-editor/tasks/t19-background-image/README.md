---
schema: nbook.task/v2
taskId: t19-background-image
status: shelved
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

已撤销。开发者 2026-11-05 体验后认为效果不好，要求先删掉，放进主题体系重做，见 [w00041](../../../w00041-themes-and-backgrounds/README.md)。

合同：功能已撤销，行为合同回到做之前。代码、Spec `ui/backgrounds.md` 与 `workspace/files.md` 的“写背景图片”一节都已从 master 移除；最后一版代码是提交 `a9ec4f147`。下面的证据留作重做的参考。

- 计划：[plan.md](plan.md)。
- 设计审查：[处理](evidences/design-review-disposition.txt)。实现审查：[处理](evidences/impl-review-disposition.txt)。
- 可访问性：[量出来的对比度](evidences/contrast.txt)。
