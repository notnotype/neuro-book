---
schema: nbook.task/v2
taskId: t01-research-and-design
status: active
updated: 2026-11-23
---

# 调研与架构取舍：统计插件、遥测反馈与后端选型

## 目标与范围

完成历史线索核对、参考实现拆解（`oh-my-pi` `report_issue`）、仓库既有约束盘点及服务端方案对比（Cloudflare / 重写 `neuro-book-site` / Umami），产出调研报告并收敛架构与边界取舍。

合同：本 Task 只做调研与方案讨论，不改行为合同；后续拆出的实现 Task 需遵守 [`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 无遥测边界，并在新 Spec 中定义统计贡献点、隐私白名单与非阻塞反馈审批流程。

## 当前状态

2026-11-23 完成调研与低锁定/VPS 优先架构补充，报告见 [统计、遥测与非阻塞反馈插件调研](../../research/2026-11-23-telemetry-feedback-and-stats.md)。等待开发者拍板首版后端部署起点、插件拆分与隐私/审批细节。

## 下一步

- 待开发者拍板调研报告第 7 节的 6 项取舍后，拆出后续提案/Spec 与实现 Task（本地统计插件、遥测与非阻塞反馈插件、可移植收集网关与 Umami 接入）。
