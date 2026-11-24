---
schema: nbook.task/v2
taskId: t06-stats-plugin
status: planned
updated: 2026-11-24
---

# 本机统计插件

## 目标与范围

nbook.stats：记数的服务与指标声明、按日存储、字数与模型用量的交数、诊断的本机观察接口与错误码计数、给用户看的字数与模型用量与日历热力图；从不联网。

合同：[`stats.local`](../../../../../docs/specs/stats/local.md)，[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 的本机观察一条。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：`nbook.stats` 插件：指标声明的贡献点、记数服务（服务端实例提供，项目子进程与窗口经远程服务）、按日存储、诊断的本机观察接口与错误码计数、项目插件交字数、Agent 插件在请求结束处交用量、统计视图（字数、模型用量、日历热力图）、“不联网”的导入图检查。

前置：无，不依赖官方站，可以与 w00037 的脚手架同时做。代码在 Work 分支 `feat/w00053-telemetry-feedback-stats`（开工时建）。碰内核的诊断与跨进程记数，按高风险后端审；统计视图是界面，要先过设计评审。

## 下一步

开工时写实施计划。
