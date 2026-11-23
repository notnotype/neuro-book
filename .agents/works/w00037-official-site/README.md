---
schema: nbook.work/v1
workId: w00037-official-site
issueId: null
status: active
updated: 2026-11-23
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
- **服务端架构候选**：评估是否以 **Cloudflare Workers + Service Bindings + D1 / R2 / Queues / Containers** 承载多模块服务（对比自托管 VPS 容器），具体一手限制与“粗粒度模块化单体 vs 细粒度微服务”分析见 [w00053 调研第 5.3 节](../w00053-telemetry-feedback-stats/research/2026-11-23-telemetry-feedback-and-stats.md#53-专题评估cloudflare-workers-能否承载-neuro-book-site-的多模块微服务架构)。
- **与遥测/反馈的关系**：产品遥测与非阻塞反馈在 [w00053](../w00053-telemetry-feedback-stats/README.md) 独立推进，暂不阻塞或强耦合官网重写排期。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求与范围讨论 |
