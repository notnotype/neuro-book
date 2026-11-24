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
- **与遥测/反馈的关系**：产品遥测与非阻塞反馈在 [w00053](../w00053-telemetry-feedback-stats/README.md) 独立推进，暂不阻塞或强耦合官网重写排期。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与范围讨论 |
| [t02](tasks/t02-selection/README.md) | 选型：身份库、数据库访问与测试里的 PostgreSQL |
| [t03](tasks/t03-architecture/README.md) | 架构细节讨论与提案 |
