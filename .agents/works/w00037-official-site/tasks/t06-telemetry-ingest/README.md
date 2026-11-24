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

计划的设计审查（Opus）回来 14 条：重要 5、建议 9，没有阻断，报告在 [`evidences/design-review-opus.txt`](evidences/design-review-opus.txt)，逐条的处理在 [`plan.md`](plan.md) 的“设计审查的处理”。14 条都成立、都改；改到协议的有四处：错误码回到提案写的码表（原 Spec 写成了任意小写串）、系统与大版本合成一个字段 `osVersion`、安装所在周只收服务端日前后的范围、内容类型精确比较。omp（`@review`）的那一份还在后台跑。

## 下一步

开第 1 片（合同包）：先查应用里的错误码能不能从一处列全，定码表的来源。第 3 片（写入口）要等 [t05](../t05-scaffold/README.md) 的分支空出来（合同测试底座已在分支上）。omp 的报告回来后单独处理。
