---
schema: nbook.work/v1
workId: w00053-telemetry-feedback-stats
issueId: null
status: active
updated: 2026-11-23
---

# 统计、遥测与非阻塞反馈插件体系

## 目标

规划并落地两类互补能力：面向用户的本地统计插件（使用记录、字数、Token 消耗的仪表盘与贡献点），以及面向产品改进的匿名使用遥测、Harness 错误与 Agent/用户非阻塞审批反馈上报插件及其轻量后端。

## 已定的事（开发者 2026-11-23）

1. 此前记住的开源统计项目确认为 **Umami**（`umami-software/umami`）。
2. 要做**自动匿名使用统计**（安装数据、使用情况等）与 **Harness 错误 / Agent 帮用户整理的反馈上报**（参照 `oh-my-pi` 的 `report_issue` 思路）：Agent 写反馈不阻塞当前 ReAct，写后不自动上传，由界面弹出非阻塞审批入口，用户点击确认后才上传。
3. 要做面向用户自己的**统计插件**（使用记录、字数统计、总消耗 Token 等），提供仪表盘与贡献点。
4. 隐私开关放在安装/首次启动流程中供用户选择，**默认匿名并勾选**（改善产品体验）。
5. `neuro-book-site` 后续倾向重写以摆脱历史包裹，与 [w00037-official-site](../w00037-official-site/README.md) 关联但暂不强耦合本 Work 进度。

## 调研

- [统计、遥测与非阻塞反馈插件调研](research/2026-11-23-telemetry-feedback-and-stats.md)（2026-11-23）：历史线索核对、仓库既有约束与可复用源（`diagnostics.md`、`FirstRunWizard`、`notifications`、`projects.stats`、`SessionCore`）、`oh-my-pi` `report_issue` 拆解、Cloudflare / 重写官网 / Umami 对比与推荐组合架构、隐私风险提示。

## 待定问题

- 后端落地选型：推荐组合（Cloudflare Worker 统一网关 + D1 收反馈 + Umami 看统计）vs 纯 Cloudflare vs 自托管。
- 是否拆为「个人统计插件（纯本地）」与「遥测反馈插件（联网）」两个独立内置插件。
- Agent 反馈的审批粒度、个人统计仪表盘的入口与首版指标范围、与 `w00037` 的衔接方式。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-research-and-design/README.md) | 调研与架构取舍：统计插件、遥测反馈与后端选型 | active |
