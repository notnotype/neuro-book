---
schema: nbook.task/v2
taskId: t07-study-base-nbook
status: done
updated: 2026-11-06
---

# 书房主题改用 NeuroBook 主题包

## 目标与范围

书房的 base 从 macos 改为 nbook，浮层面跟 NeuroBook 一致（薄糊 8px、较实的面），不用 macos 的折射玻璃

合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 11（书房）；行为合同不变，只换书房用的主题包。

## 开发者的决定

1. （2026-11-06）书房的透明度与 surface 按 NeuroBook 主题来；macos 主题包的折射玻璃（中间模糊重、边缘轻）不用。书房以后作为示例主题。

## 当前状态

已合入 master。书房声明的 `base` 从 `macos` 改为 `nbook`：浮层面取 NeuroBook 的 72%（对话框 90%）加 8px 薄糊，不再是 macos 的 46% 加折射。配色、场景、画框不变。

- 验证：`themes.e2e` 14 个全过（对比度用例里书房亮色有一次双击超时，单独重跑两次都过，是负载造成的，这是推断）；真实截图看过亮色设置窗口与暗色欢迎页，外壳变成 NeuroBook 的卡片布局，设置窗口文字不再透出。
- 改的测试：`themes.e2e` 里“设置里的主题不存在”原来靠 `data-nb-theme` 是 `macos` 判断书房生效，改为只看场景属性。
