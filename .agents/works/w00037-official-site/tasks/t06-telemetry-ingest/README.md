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

范围：收集清单与三种上报的 schema（在 `nb-site-telemetry-contract` 里）、三个写入口、重发去重、原始上报留 7 天、聚合任务、限流、日志里不出现来源地址。看板的查询接口在 [t11](../t11-dashboard/README.md)。

前置：[t05](../t05-scaffold/README.md)。排在账号之前做：它是第一版里唯一已有使用方的部分（应用的遥测插件），并且不依赖账号。

## 下一步

开工时写实施计划。
