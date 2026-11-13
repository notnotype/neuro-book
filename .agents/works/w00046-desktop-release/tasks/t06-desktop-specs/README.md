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

已完成（2026-11-13）。Spec 初稿 `9b7d32f1e`，经 omp 三轮设计审查：第一轮有效 20 条（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-disposition.txt)，`04124d30e`），第二轮 7 条（[报告](evidences/design-review-r2-omp.txt)、[处理](evidences/design-review-r2-disposition.txt)，`99da195b9`），第三轮 2 条（[报告](evidences/design-review-r3-omp.txt)、[处理](evidences/design-review-r3-disposition.txt)，`97b1fbcec`），全部成立、全部改。第三轮是上限，最后两条局部改动作者自查定稿。

结果：新建 `runtime/desktop-shell`、`runtime/desktop-update`（planned）；在 `runtime/server-host`（托管宿主、在跑的工作）、`runtime/browser-host`（输出 9 到 11、场景 15）、`runtime/cli`、`workbench/editor`（输出 66、场景 45、46）、`workbench/notifications`（输出 18、场景 11）、`agent/sessions`（输出 20）、`workbench/background-tasks`（输出 17）加 planned 条目；`agent/conversation` 输出 40 删除；术语表加三个词。本该开发者决定的点在 [待确认清单](../../pending-confirmations.md)。`repository-workflow.md` 的发布一节挪到 t11。

## 下一步

无。实现见 t07 到 t10；新增的宿主能力与接口（在跑的工作、通知的 `onClose`）随 t09 实现。
