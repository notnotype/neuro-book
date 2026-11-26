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

进行中（2026-11-26 开工，开发者说“继续后续的开发”）：段 A（nb-ui 的 `Pagination`、`DataTable`、`Table.stickyHeader`）已在 master 上；段 B 在分支 `feat/w00037-t10-web`、worktree `.worktree/w00037-t10-web`（从官方站分支开，D13）上按片做，每片派一个 Opus 编码子代理，主会话审 diff、自己重跑验证。t07、t08 的合同包都已合入，B2 到 B4、B6、B7 不再等合同。Google、GitHub 的 OAuth 应用开发者先不配，社交部分只对着仿真上游与假接口验。

范围：`nb-site-web` 的单页应用与三个公开页面，接口类型取自合同包，第一版只做中文（文字的组织方式留好加英文的余地），随服务端的镜像发布。

实施计划见 [`plan.md`](plan.md)（Opus 子代理起草，主会话审定，2026-11-24）：段 A 是 nb-ui 的两个通用组件，不依赖后端，现在就做，在分支 `feat/w00037-t10-nb-ui` 上，审查后先合入 master；段 B 是官方站的十片，其中外壳（B1）与管理外壳加看板（B5）不等后端，其余等 t07、t08 的合同包。十三件待定的事与 19 处 Spec 缺口的处理见计划末尾“主会话的审定”。

另含两个 nb-ui 通用组件（t09 第 12 条，开发者 2026-11-24 在评审板上同意）：“分页”与“带工具条与分页的数据表格”，按 nb-ui 的组件规范做（同名 `.md`、Lab 场景、测试），管理面板的四个列表页都用它。

图表库用 ECharts（t09 第 13 条）：只引入用到的图、组件与渲染器，看板按页面拆包；颜色与字体从 CSS 变量读出后交给它，换配色时重画。

语言：本文件原写“中英双语”，t09 记的是“第一版界面只有中文，文字的组织方式留好加英文的余地”；开发者 2026-11-24 说“都按照你推荐就行”，按 t09 的做：第一版只做中文。

前置：[t09](../t09-frontend-design-review/README.md) 定稿；[t07](../t07-identity-core/README.md)、[t08](../t08-social-login-and-oauth-provider/README.md) 的接口可用。审查派前端审查者。

从 t05 前端骨架的审查接过来的（2026-11-24，[t05 的计划](../t05-scaffold/plan.md)“收口审查（第 4 到 7 片）的处理”）：

- B1（外壳）要做的两条：明暗的装法做成可切换的函数形状（现在写死成跟随系统）；构建测试不再绑在占位的 `App.vue` 上，并给主题的运行期接线加一条检查。
- 同一份审查第 8 条里还提到 `index.html` 没有站点图标、没有不开脚本时的回退文字：修正片没做，B1 做外壳时一并定。
- 上游候选，不挡本 Task：“装主题、跟随系统明暗”的代码在 dev-panel、nb-story、官方站各有一份拷贝，可以让 nb-ui 给不是应用的宿主提供一个统一入口。已告知开发者，要做时单开 Task。

## 下一步

B2（稿纸与登录）进行中；B5（管理外壳与看板）可与 B2 之后的片交错。

## 实施进度

B1（外壳）已提交（`91322650a`，39 个文件）：路由与守卫、分派、主题与明暗（可切换的函数形状）、站点变量、文字目录（已登记 `message-catalogs`）、存储模块、接口层核心、当前账号模块、“没有这一页”；`index.html` 加了站点图标与不开脚本时的文字。新依赖 `vue-router`、身份合同包，开发依赖 `vitest`、`happy-dom`、`@vue/test-utils`。主会话重跑：类型检查、bun test 50、vitest 20、构建、`governance:check` 都过；实现者 3 条变异都被抓到。
- 与计划的出入（接受）：守卫的访问级别多一个 `consent`（同意页的规则与访客页、要登录的页都不同）；文字目录在 `text.ts` 顶层登记（组件测试不经 `main.ts`）；`whoami`、`me` 两个读接口 B1 就接上了，B2 挪进接口层；还没做的页面共用一个空壳页，看板一开始就是单独的块。
- 构建测试原来量的是开发版产物（子进程继承了 `NODE_ENV=test`），已改成显式生产构建。生产入口约 68 KB（gzip，含 `vue-router`）。
- 只从合同包导入常量也会把 TypeBox 打进入口，约 14.5 KB（gzip）。先不改：要省就给合同包加一个只放常量的入口，入口体积成问题时再做。
- `Retry-After` 的日期只认 IMF-fixdate，另两种过时写法按读不懂、退到 30 秒。
- 给 B2 的：注册接口声明 `handles: ["consent_required"]`（不然统一处理会把注册时没勾同意的人带去同意页）；登录、注册、同意、登出成功后刷新或清掉当前账号；定暗色的稿纸变量；`App.vue` 重试时路由跳转失败的处理。给 B5 的：ECharts 的识别正则现在空过，装上后先补一条“看板块里有”的正向断言。dom 测试用 `data-site-page=<路由名>` 与 `data-site-unavailable`。
