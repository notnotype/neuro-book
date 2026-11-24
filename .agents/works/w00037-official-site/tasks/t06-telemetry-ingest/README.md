---
schema: nbook.task/v2
taskId: t06-telemetry-ingest
status: planned
updated: 2026-11-24
---

# 统计模块：三个写入口、原始上报留 7 天、聚合

## 目标与范围

统计模块的服务端：每日上报、在线心跳、立即事件三个写入口，按收集清单校验，重发去重，原始上报留 7 天后按日删除，定时聚合；不留 IP 的清单里属于进程的几项。

合同：[`telemetry.protocol`](../../../../../docs/specs/telemetry/protocol.md)、[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：收集清单与三种上报的 schema（在 `nb-site-telemetry-contract` 里）、三个写入口、重发去重、原始上报留 7 天、聚合任务、限流、日志里不出现来源地址。看板的查询接口在 [t11](../t11-dashboard/README.md)。另从 t05 接过来一项：`site.operations` 验收 2（上一个版本接管）在 t05 没有上一个版本可用，本 Task 出现第一条真实迁移时，在 CI 的 `site-image` 作业里用基准提交的程序当上一个版本跑相邻版本测试（[t05 的计划](../t05-scaffold/plan.md) 3.3）。

前置：[t05](../t05-scaffold/README.md)。排在账号之前做：它是第一版里唯一已有使用方的部分（应用的遥测插件），并且不依赖账号。

## 下一步

开工时写实施计划。
