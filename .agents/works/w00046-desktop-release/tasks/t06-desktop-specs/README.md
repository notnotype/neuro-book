---
schema: nbook.task/v2
taskId: t06-desktop-specs
status: planned
updated: 2026-11-13
---

# 桌面发行的 Spec

## 目标与范围

按已接受的提案 docs/proposals/desktop-distribution.md 与 ADR 0051 写 Spec：新建 runtime/desktop-shell（单实例与转交、连接判定、关闭前询问、三态停止、崩溃两类结果、导航、WebView2、状态根与便携、更新）；改 runtime/server-host（--stop-stdin 与认领应答作为托管合同）、runtime/browser-host 与 workbench/editor（宿主发起的关闭前询问）、runtime/cli（应用包托管入口、Windows 停止限制）；repository-workflow 的发布一节。先列验收再实现。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-13 经 nbdev 新建，尚未开工。

## 下一步

待补充。
