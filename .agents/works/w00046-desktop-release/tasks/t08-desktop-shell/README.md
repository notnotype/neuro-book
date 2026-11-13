---
schema: nbook.task/v2
taskId: t08-desktop-shell
status: active
updated: 2026-11-13
---

# Electrobun 桌面壳

## 目标与范围

新建桌面壳：随包 Bun 拉起托管入口、从认领应答取地址、单实例锁与带版本的开窗转交、连接判定表、三态停止与截止、导航与新窗口、WebView2 检查、状态根与便携标记、缺省端口；Hutch 与 Electrobun 固定版本。依据提案 4.2 到 4.5、ADR 0051 决定 1、2、4、5。

合同：[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)（壳一侧）；[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的实例认领（nb-host 认领的扩展）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13：计划经 omp 设计审查一轮（有效 12 条，阻断 2，全部照改，[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-disposition.txt)）；Spec 随之小改（`hello` 状态用 `ready`、对话框是壳的小窗口、新窗口的已知限制）。下一步切片 1：nb-host 认领的扩展。

## 下一步

按计划切片 1 到 4 推进，代码在 Work 分支 `feat/w00046-desktop-release`。
