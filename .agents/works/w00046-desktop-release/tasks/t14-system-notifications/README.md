---
schema: nbook.task/v2
taskId: t14-system-notifications
status: planned
updated: 2026-11-16
---

# 系统通知

## 目标与范围

窗口不在前台时把重要的通知（Agent 回合结束、需要确认、后台任务结束或失败）发成系统通知；先实测 WebView2 的网页通知

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 做了桌面调研（[research-r1](evidences/research-r1.md)）：Electrobun 2.0.6 缺省时用英文消息框问通知权限，可在构建配置里自动授予；不处理 `NotificationReceived`，所以显示的是 WebView2 的缺省通知界面，它在 Windows 上的样子与点击行为要实测才知道，这决定只写页面一侧还是要壳自己发 Toast。

## 下一步

等 pc-notype 能构建（t18 里 Defender 删了 Hutch，等开发者处理）后先跑调研里列的探针，再写计划。在此之前先做 t16（见待确认清单）。
