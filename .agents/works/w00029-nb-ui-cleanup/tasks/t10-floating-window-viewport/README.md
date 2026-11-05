---
schema: nbook.task/v2
taskId: t10-floating-window-viewport
status: active
updated: 2026-11-05
---

# 浏览器缩窄时浮动窗口推回可见区

## 目标与范围

拖过的浮动窗口放不下时推回完整可见，没拖过的保持居中，比浏览器大时只在显示上收窄

合同：[`settings/settings-window.md`](../../../../../../docs/specs/settings/settings-window.md) 输出 16；通用规则在 `packages/nb-ui/src/components/feedback/FloatingWindow.md` 的“位置”。

## 开发者的决定

2026-11-05：不按比例移动。规则：没拖过的保持居中；拖过的放得下不动，放不下推回完整可见；比浏览器还小时只在显示上收窄；放大不回原位。放在 w00029。

## 当前状态

已合入 master。验证：`settings.e2e.ts` 的“浏览器窗口变化”（把推回去掉后这条失败）、`settings.e2e.ts` 与 `lab-nb-ui.e2e.ts` 共 31 条通过。
