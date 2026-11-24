---
schema: nbook.task/v2
taskId: t11-dashboard
status: planned
updated: 2026-11-24
---

# 统计看板：查询接口与图表

## 目标与范围

统计模块给看板的查询接口（要管理员身份）与管理面板里的几张图：活跃与新增、按周留存、在线、版本与平台分布、同意率、错误码。

合同：[`site.telemetry-dashboard`](../../../../../docs/specs/site/telemetry-dashboard.md)。

## 当前状态

未开工：开发者 2026-11-24 要求先把 ADR、Task 与文档写好，开工等他的指示。

范围：看板的六个只读查询接口（活跃数的算法、新增与留存、在线、分维度与小格子、错误码），以及管理面板里对应的图。

前置：[t06](../t06-telemetry-ingest/README.md)（有聚合）、[t07](../t07-identity-core/README.md)（“问身份”）、[t09](../t09-frontend-design-review/README.md)（图的样子与图表库）。

## 下一步

开工时写实施计划。
