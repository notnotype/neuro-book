---
schema: nbook.task/v2
taskId: t06-desktop-specs
status: active
updated: 2026-11-13
---

# 桌面发行的 Spec

## 目标与范围

按已接受的提案 docs/proposals/desktop-distribution.md 与 ADR 0051 写 Spec：新建 runtime/desktop-shell（单实例与转交、连接判定、关闭前询问、三态停止、崩溃两类结果、导航、WebView2、状态根与便携、更新）；改 runtime/server-host（--stop-stdin 与认领应答作为托管合同）、runtime/browser-host 与 workbench/editor（宿主发起的关闭前询问）、runtime/cli（应用包托管入口、Windows 停止限制）；repository-workflow 的发布一节。先列验收再实现。

合同：新建 [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)、[`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)；修改 [`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/cli`](../../../../../docs/specs/runtime/cli.md)、[`workbench/editor`](../../../../../docs/specs/workbench/editor.md)、[`agent/conversation`](../../../../../docs/specs/agent/conversation.md)、[`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md)、[运行时术语表](../../../../../docs/specs/runtime/glossary.md)。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13 经 nbdev 新建。开发者指定用 autonomous-delivery 推进；Spec 初稿写完，`docs:check` 通过，待设计审查（omp）。本该开发者决定的点记在 [待确认清单](../../pending-confirmations.md)。

## 下一步

设计审查，处理后提交，然后进 t07。
