---
schema: nbook.work/v1
workId: w00037-official-site
issueId: null
status: active
updated: 2026-11-24
---

# NeuroBook 官方服务站：账号、备份与同步、社区、插件市场

## 目标

参照 VS Code 的官方市场与配套服务，建 NeuroBook 官方网站与服务：登录、备份、跨设备同步、社区与官方插件市场（含杀毒扫描、检测与审核）。来源：w00032 t25 讨论（开发者 2026-10-30）。

## 已定的事（[w00032 t25](../w00032-agent-integration/tasks/t25-plugin-marketplace/README.md) 讨论，开发者 2026-10-30）

1. 参照 VS Code：NeuroBook 有一个官方服务网站及配套服务，提供登录、备份、跨设备同步、社区与插件市场；详细需求在本 Work 讨论。
2. 官方插件市场的安全措施照 VS Code：杀毒扫描、检测与审核；签名、评分与评论也在本 Work 讨论。NeuroBook 一侧的安装、更新与封禁在 [w00038](../w00038-plugin-distribution/README.md)。

## 补充规划与待评估方向（开发者 2026-11-23）

- **重写倾向**：倾向重新开发 `neuro-book-site`，不再背负旧版历史遗留包裹。
- **扩展承载范围**：除原有账号、备份与跨设备同步外，明确规划承载 **Skill / 插件 / Profile 市场**（延续安全扫描、检测与审核方向）、**小说发布**、**用户交流与论坛**、**OAuth 登录**。
- **部署定位与低锁定架构基线**：主定位**独立部署在 VPS**；可兼容 Cloudflare（例如外层 DNS/WAF、经标准 S3 API 使用 R2 享零出站流量、或同一套 Web Standards HTTP 路由按需部署到 Workers），但**不强依赖 Cloudflare 专有能力（D1 / Service Bindings / Queues / Containers）**，确保切出 Cloudflare 时改动极小。不建议前期拆细粒度微服务，推荐「VPS 优先的可移植模块化单体（Hono + PostgreSQL + 标准 S3 API）」，详见 [w00053 调研第 5.3 节](../w00053-telemetry-feedback-stats/research/2026-11-23-telemetry-feedback-and-stats.md#53-专题评估cloudflare-workers-能否做-neuro-book-site-微服务如何兼顾-vps-独立部署与灵活切出)。
- **重写方向（开发者 2026-11-24）**：按微服务的思想搭，按 2 核 2 GB 承接 100 同时访问设计；Bun、TypeScript、前后端分离、前端用 nb-ui；后端测试要能在换语言重写后复用；第一版只做管理面板（用户、邀请码、类似 Umami 的数据收集、OAuth），先不做市场。取代上一条里“不建议拆微服务”的建议，详见 [t01](tasks/t01-requirements/README.md)。
- **设计审查之后（开发者 2026-11-24）**：数据库用每个模块一个 SQLite 文件（取代上面的 PostgreSQL）；第一版的范围先查旧站的账号数再定；境外存放先不找人确认。提案草稿见 [官方站重写](../../../docs/proposals/official-site-rewrite.md)。
- **与遥测/反馈的关系**：产品遥测与非阻塞反馈在 [w00053](../w00053-telemetry-feedback-stats/README.md) 独立推进，暂不阻塞或强耦合官网重写排期。

## 开工顺序（主会话 2026-11-24 的安排）

开发者 2026-11-24：顺序 1 到 4 派 Opus 子代理去做，同时接着做设计。每个 Task 的实施计划由主会话审，只把会改变产品结果、范围或不可逆后果的事交开发者定。

提案已接受（[官方站重写](../../../docs/proposals/official-site-rewrite.md)），ADR 0059 到 0061 与七份 `planned` Spec 已写。第一版做全（开发者 2026-11-24）。

| 顺序 | Task | 说明 |
|---|---|---|
| 1 | t05 脚手架 | 之后的一切都建在它上面 |
| 2 | t06 统计的写入 | 唯一已有使用方的部分，不依赖账号；做完可以先在遥测的域名上线（t13 的第一步） |
| 3 | t07 账号核心 | |
| 4 | t08 社交登录与对外 OAuth | 要开发者的 Google、GitHub 应用与定死的站点地址 |
| 与 1 到 4 同时 | t09 前端设计评审 | 不依赖后端实现，要开发者参与 |
| 5 | t10 前端实现、t11 看板 | 等 t09 定稿与接口可用 |
| 6 | t12 旧站导入与演练 | 要生产快照的授权 |
| 7 | t13 部署与切换 | 每一步生产操作另取授权 |

应用这边（本机统计、遥测插件、条款）在 [w00053](../w00053-telemetry-feedback-stats/README.md)，与上表的 1 到 4 可以同时做。

开发者 2026-11-24 另说“都按照你推荐就行”：此前各 Task 记录里标着“待追认”的主会话理解与推荐（第一版界面只有中文、`site.admin` 列表分页的参数名与缺省值、OIDC 的几处取值、遥测子域名的名字等）都算追认；合同测试拨时间用测试控制入口（见 [t05](tasks/t05-scaffold/README.md)）。

已定（开发者 2026-11-24）：站点地址沿用 `nbook.notnotype.com`，遥测写入口单独一个子域名；对外 OAuth 按标准 OpenID Connect 做（见 [t08](tasks/t08-social-login-and-oauth-provider/README.md)）；前端的注意力排序（见 [t09](tasks/t09-frontend-design-review/README.md)）。

还没决定、会卡住某一步的事：前端的外观与图表库（t09 的静态稿）；Google 与 GitHub 的 OAuth 应用（部署验收时要）；处理者的名称与联系方式（条款）；异地备份（t13）；旧站不合规则的用户名怎么处理（t12，要先看生产数据）。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与范围讨论 |
| [t02](tasks/t02-selection/README.md) | 选型：身份库、数据库访问与测试里的 PostgreSQL |
| [t03](tasks/t03-architecture/README.md) | 架构细节讨论与提案 |
| [t04](tasks/t04-adr-and-specs/README.md) | ADR 0059 到 0061 与七份 `planned` Spec（已写，假设待追认） |
| [t05](tasks/t05-scaffold/README.md) | 脚手架：包、进程入口、迁移、合同测试底座、镜像（已完成，2026-11-25 合入 master） |
| [t06](tasks/t06-telemetry-ingest/README.md) | 统计模块：三个写入口、原始上报留 7 天、聚合（已完成，2026-11-25 合入 master） |
| [t07](tasks/t07-identity-core/README.md) | 账号核心：密码注册与登录、两种码、会话、资料、同意、管理与审计、限流（已完成，2026-11-25 合入 master） |
| [t08](tasks/t08-social-login-and-oauth-provider/README.md) | 社交登录与对外 OAuth 服务（未开工） |
| [t09](tasks/t09-frontend-design-review/README.md) | 前端设计评审（未开工） |
| [t10](tasks/t10-frontend/README.md) | 前端实现（未开工） |
| [t11](tasks/t11-dashboard/README.md) | 统计看板（未开工） |
| [t12](tasks/t12-legacy-import/README.md) | 旧站数据导入与切换演练（未开工） |
| [t13](tasks/t13-deploy-and-cutover/README.md) | 部署与切换（未开工） |
