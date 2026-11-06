---
schema: nbook.task/v2
taskId: t02-eye-care-themes
status: done
updated: 2026-11-06
---

# 护眼主题

## 目标与范围

把撤销背景功能时一起没了的护眼底色（[w00025 t19 决定 2](../../../w00025-editor/tasks/t19-background-image/README.md#开发者的决定)：“再给几个纯色底”）做成内置主题。开发者 2026-11-06 同意。

合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 12。

## 当前状态

已合入 master。

- 两套：护眼绿（`eye-green`）、护眼米黄（`eye-sepia`），各有亮暗，色相沿用第一版预设。放在工作台的内置主题里：只有配色，不需要素材，不用单开一个插件。
- 可读性：e2e 用真实页面量欢迎页、活动栏、侧栏、正文，四种组合最低 5.54（米黄暗色的高亮正文），状态色在各底色上按色值算不低于 4.5。

## 遗留

- 代码块与 Monaco 语法色没有逐个量，沿用主题包的。
