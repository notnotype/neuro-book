---
schema: nbook.task/v2
taskId: t10-frontend
status: planned
updated: 2026-11-24
---

# 前端实现

## 目标与范围

照评审定下的稿实现单页应用与三个公开页面，接口类型取自合同包，中英双语。

合同：页面调用的接口见 [`site.accounts`](../../../../../docs/specs/site/accounts.md)、[`site.admin`](../../../../../docs/specs/site/admin.md)、[`site.oauth-provider`](../../../../../docs/specs/site/oauth-provider.md)、[`site.telemetry-dashboard`](../../../../../docs/specs/site/telemetry-dashboard.md)；外观以 [t09](../t09-frontend-design-review/README.md) 定下的稿为准。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：`nb-site-web` 的单页应用与三个公开页面，接口类型取自合同包，第一版只做中文（文字的组织方式留好加英文的余地），随服务端的镜像发布。

实施计划见 [`plan.md`](plan.md)（Opus 子代理起草，主会话审定，2026-11-24）：段 A 是 nb-ui 的两个通用组件，不依赖后端，现在就做，在分支 `feat/w00037-t10-nb-ui` 上，审查后先合入 master；段 B 是官方站的十片，其中外壳（B1）与管理外壳加看板（B5）不等后端，其余等 t07、t08 的合同包。十三件待定的事与 19 处 Spec 缺口的处理见计划末尾“主会话的审定”。

另含两个 nb-ui 通用组件（t09 第 12 条，开发者 2026-11-24 在评审板上同意）：“分页”与“带工具条与分页的数据表格”，按 nb-ui 的组件规范做（同名 `.md`、Lab 场景、测试），管理面板的四个列表页都用它。

图表库用 ECharts（t09 第 13 条）：只引入用到的图、组件与渲染器，看板按页面拆包；颜色与字体从 CSS 变量读出后交给它，换配色时重画。

语言：本文件原写“中英双语”，t09 记的是“第一版界面只有中文，文字的组织方式留好加英文的余地”；开发者 2026-11-24 说“都按照你推荐就行”，按 t09 的做：第一版只做中文。

前置：[t09](../t09-frontend-design-review/README.md) 定稿；[t07](../t07-identity-core/README.md)、[t08](../t08-social-login-and-oauth-provider/README.md) 的接口可用。审查派前端审查者。

## 下一步

开工时写实施计划。
