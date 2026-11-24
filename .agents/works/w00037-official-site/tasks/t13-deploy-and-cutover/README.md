---
schema: nbook.task/v2
taskId: t13-deploy-and-cutover
status: planned
updated: 2026-11-24
---

# 部署与切换

## 目标与范围

生产主机上的 Compose 与反向代理配置（含不留 IP 的那几项）、每晚备份、按固定摘要升级；先在遥测的域名上线，再切站点域名。每一步生产操作另取开发者授权。

合同：[`site.operations`](../../../../../docs/specs/site/operations.md)；[`site.telemetry-ingest`](../../../../../docs/specs/site/telemetry-ingest.md) 的部署前置（写入口不留来源地址）。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：生产主机上的 Compose 与反向代理配置、每晚备份、按固定摘要升级的脚本；分两步上线：先在遥测的域名上线（旧站不动），再切站点域名（停旧站、导入、切换）。

前置：第一步要 [t06](../t06-telemetry-ingest/README.md)；第二步要 t07 到 t12 全部完成、条款上线（[w00053 t08](../../../w00053-telemetry-feedback-stats/tasks/t08-terms/README.md)）。每一步生产操作（DNS、证书、反向代理、启停服务）动手前另取开发者授权。还没定的：遥测写入口的域名、站点域名是否沿用现在的、异地备份。

## 下一步

开工时写实施计划与逐步的回退办法。
