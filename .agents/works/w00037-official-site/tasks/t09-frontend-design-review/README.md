---
schema: nbook.task/v2
taskId: t09-frontend-design-review
status: planned
updated: 2026-11-24
---

# 前端设计评审：静态稿与评审板

## 目标与范围

按仓库的设计评审流程，为登录、注册、账号设置、同意条款页、授权确认页、管理面板、统计看板与三个公开页面出静态稿，开发者逐轮定外观与交互。

合同：只定外观与交互，行为合同未变；页面要调的接口见 [`site.accounts`](../../../../../docs/specs/site/accounts.md)、[`site.admin`](../../../../../docs/specs/site/admin.md)、[`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md)、[`site.telemetry-dashboard`](../../../../../docs/specs/site/telemetry-dashboard.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。 前端的样子与交互还没有任何决定。

范围：登录、注册（含用 Google 或 GitHub 注册时先填注册码与用户名）、同意条款页、账号设置（资料、邮箱、密码、已关联的账号、会话、邀请码、给过的授权）、OAuth 授权确认页、管理面板（用户、注册码与邀请码、OAuth 客户端、审计）、统计看板、三个公开页面（主页、隐私政策、服务条款）。按 design-review 的流程出静态稿与评审板，逐轮记录开发者的决定。

前置：不依赖后端实现，可以与 t05 到 t08 同时进行；需要开发者参与评审。看板的图表库在这里选。

## 下一步

开工时先截旧站的现有页面作起点，再出第一轮静态稿。
