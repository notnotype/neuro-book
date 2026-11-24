---
schema: nbook.task/v2
taskId: t06-telemetry-ingest
status: active
updated: 2026-11-24
---

# 统计模块：三个写入口、原始上报留 7 天、聚合

## 目标与范围

统计模块的服务端：每日上报、在线心跳、立即事件三个写入口，按收集清单校验，重发去重，原始上报留 7 天后按日删除，定时聚合；不留 IP 的清单里属于进程的几项。

合同：[`telemetry.protocol`](../../../../../docs/specs/telemetry/protocol.md)、[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md)。

## 当前状态

开发者 2026-11-24 让顺序 1 到 4 开工。实施计划见 [`plan.md`](plan.md)（Opus 子代理起草，主会话审定，2026-11-24）：五片，前三片（合同包、迁移与校验、写入口）之后交一次审查，后两片（定时任务与备份、相邻版本）之后再交一次。起草时在真实的 bun:sqlite 上跑了九个探针，结论与数字在计划第 9 节。计划列的 22 处 Spec 缺口里 21 处已在 master 上改完（[`telemetry.protocol`](../../../../../docs/specs/telemetry/protocol.md)、[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md)、[`site.operations`](../../../../../docs/specs/site/operations.md)），剩下的一处是实现后补证据。八件待定的事按主会话的推荐定了，见计划末尾“主会话的审定”。

范围：收集清单与三种上报的 schema（在 `nb-site-telemetry-contract` 里）、三个写入口、重发去重、原始上报留 7 天、聚合任务、限流、日志里不出现来源地址。看板的查询接口在 [t11](../t11-dashboard/README.md)。另从 t05 接过来一项：`site.operations` 验收 2（上一个版本接管）在 t05 没有上一个版本可用，本 Task 出现第一条真实迁移时，在 CI 的 `site-image` 作业里用基准提交的程序当上一个版本跑相邻版本测试（[t05 的计划](../t05-scaffold/plan.md) 3.3）。

前置：[t05](../t05-scaffold/README.md)。排在账号之前做：它是第一版里唯一已有使用方的部分（应用的遥测插件），并且不依赖账号。

## 下一步

计划交设计审查（Opus 先审，omp 在后台），处理完开第 1 片（合同包）；第 3 片（写入口）要等 [t05](../t05-scaffold/README.md) 的合同测试底座合入分支。
