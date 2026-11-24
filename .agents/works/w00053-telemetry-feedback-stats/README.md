---
schema: nbook.work/v1
workId: w00053-telemetry-feedback-stats
issueId: null
status: active
updated: 2026-11-24
---

# 统计、遥测与非阻塞反馈插件体系

## 目标

规划并落地两类互补能力：面向用户的本地统计插件（使用记录、字数、Token 消耗的仪表盘与贡献点），以及面向产品改进的匿名使用遥测、Harness 错误与 Agent/用户非阻塞审批反馈上报插件及其轻量后端。

## 已定的事（开发者 2026-11-23）

1. 此前记住的开源统计项目确认为 **Umami**（`umami-software/umami`）。
2. 要做**自动匿名使用统计**（安装数据、使用情况等）与 **Harness 错误 / Agent 帮用户整理的反馈上报**（参照 `oh-my-pi` 的 `report_issue` 思路）：Agent 写反馈不阻塞当前 ReAct，写后不自动上传，由界面弹出非阻塞审批入口，用户点击确认后才上传。
3. 要做面向用户自己的**统计插件**（使用记录、字数统计、总消耗 Token 等），提供仪表盘与贡献点。
4. 隐私开关放在安装/首次启动流程中供用户选择，**默认匿名并勾选**（改善产品体验）。
5. `neuro-book-site` 后续倾向重写以摆脱历史包裹，并规划承载 Skill / 插件 / Profile 市场、小说发布、用户交流与论坛、OAuth 登录等能力（已同步登记到 [w00037-official-site](../w00037-official-site/README.md)），暂不强耦合本 Work 进度。
6. 服务端强调**敏捷与低厂商锁定**：`neuro-book-site` 计划独立部署在 VPS，兼容 Cloudflare 更佳，但**不强依赖 Cloudflare**，后续切出 Cloudflare 时要求改动极小、切换灵活。

## 后来的决定（开发者 2026-11-24）

- 遥测的服务端落在重写的官方站里，作为它的统计模块，与 [w00037](../w00037-official-site/README.md) 一起推进；第一版官方站是一个进程里的两个模块（账号、统计），按以后能拆开的边界写。
- 主会话的理解（待追认）：统计看板自己写，不部署 Umami；“首版后端部署起点”这个待定问题因此不再需要选。
- 收集哪些数据、条款怎么写，在 [t02](tasks/t02-collection-scope-and-terms/README.md) 讨论。
- 使用统计的开关默认不勾选；不勾选时只发匿名的那部分（改掉“已定的事”第 4 条里的“默认勾选”）。向导里同意之后才写设置，设置没开就不发；向导被跳过保持关闭。
- 用户自己看的统计要有日历热力图，其它图不是重点，先把底层数据做对。
- 在线状况：给用户看已登录的设备，给开发者看同时在线人数。
- 分级定为匿名档（默认发、不用同意）、要同意的三级（使用统计、诊断报告、含内容的反馈）与账号档；匿名档含每 15 分钟一次的在线心跳。生产主机在境外。
- 设计审查之后：原始上报留 7 天（还在开发，要哪些聚合还不清楚；主会话提的“入库即聚合”先不采用）；遥测按阶段做（先匿名档、心跳、本机统计与“稳定性”一类）；给诊断加一个只给本机的观察接口来按错误码计数；“匿名档算不算匿名化”与境外存放先不找人确认。提案草稿见 [本机统计、遥测与反馈](../../../docs/proposals/telemetry-stats-feedback.md)。

## 调研

- [统计、遥测与非阻塞反馈插件调研](research/2026-11-23-telemetry-feedback-and-stats.md)（2026-11-23）：历史线索核对、仓库既有约束与可复用源（`diagnostics.md`、`FirstRunWizard`、`notifications`、`projects.stats`、`SessionCore`）、`oh-my-pi` `report_issue` 拆解、Cloudflare / 重写官网 / Umami 对比、可移植 VPS 优先架构（Hono + PostgreSQL + 标准 S3 API，避免 CF 专有绑定锁定）、向导跳过与隐私风险提示。

- 2026-11-24 的三份调研：[各产品怎么分档](research/2026-11-24-telemetry-tiers-survey.md)、[上报形态与隐私技术](research/2026-11-24-reporting-shapes-survey.md)、[条款与合规](research/2026-11-24-terms-and-compliance-survey.md)；用法与结论见 [t02](tasks/t02-collection-scope-and-terms/README.md)。

## 待定问题

- 首版后端部署起点：纯 VPS Docker（Hono 网关 + PostgreSQL + Umami）vs 混合敏捷起步（同一套 Hono 网关先跑 CF Workers + Umami Cloud 免费档，日后一键切回 VPS）。
- 是否拆为「个人统计插件（纯本地）」与「遥测反馈插件（联网）」两个独立内置插件。
- 收集分档（基础信息、使用统计、主动反馈、登录后）与上报形态，见 [t02](tasks/t02-collection-scope-and-terms/README.md)。
- Agent 反馈的审批粒度、个人统计仪表盘入口与首版指标范围、`FirstRunWizard` 点“跳过”时的隐私开关口径、`w00037` 重写技术基线。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-research-and-design/README.md) | 调研与架构取舍：统计插件、遥测反馈与后端选型 | active |
| [t02](tasks/t02-collection-scope-and-terms/README.md) | 遥测收集范围与条款 | active |
| [t03](tasks/t03-telemetry-for-plugins/README.md) | 把遥测开放给第三方插件 | shelved |
| [t04](tasks/t04-surveys/README.md) | 调查问卷 | planned |
