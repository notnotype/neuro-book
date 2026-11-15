---
schema: nbook.task/v2
taskId: t04-desktop-settings
status: active
updated: 2026-11-15
---

# 桌面端专属设置：机制、界面缩放、开机自启

## 目标与范围

只在桌面版出现的设置：一套只在桌面里显示、壳能读到的配置项（机制），界面缩放（开发者 2026-11-15 举的例子），开机自启（开发者 2026-11-13）。托盘与关窗去向拆到 t13，系统通知拆到 t14（2026-11-15）。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-15：计划 r1 写成；设计审查第 1 轮 omp 6 条、Sonnet 14 条，处理见 [disposition](evidences/design-review-r1-disposition.txt)，计划改为 r2（[plan.md](plan.md)）：设置改由页面经窗口能力推给壳，壳只缓存。不开第 2 轮。

## 下一步

按 plan r2 的切片实施，分支 `feat/w00046-t04-desktop-settings` 从 master 开。
