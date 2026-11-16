---
schema: nbook.task/v2
taskId: t19-resize-relayout
status: planned
updated: 2026-11-16
---

# 改窗口大小时页面的重排开销

## 目标与范围

改窗口大小时工作台每帧的强制样式重算从约 24 次降下来（分隔条吸附、过渡列表重量），改大小更跟手

开发者 2026-11-16 反馈“拖动改窗口大小不够流畅”。量过（本机 Chrome、开发服务、带桌面能力标记）：工作台每次改尺寸约 24 次样式重算、书架页约 4 次；主要来自 nb-layout 分隔条的吸附（`SashHandle.vue` 的 `snap` 边读位置边写样式）与一个 `TransitionGroup` 在每次更新时重新量所有子元素。WebView2 窗口式托管的闪白要 Electrobun 改合成托管（上游 blackboardsh/electrobun#484），不在这里做。行为合同不变。

## 当前状态

2026-11-16 新建，未开工；排在 t18 之后、t13 之前。

## 下一步

用生产构建复量（开发模式的 Vue 偏慢），定位每一处强制重算，写计划。
